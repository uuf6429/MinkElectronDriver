if (process.argv.length < 3
    || process.argv.length > 5
    || !process.versions['electron']
) {
    var RED = "\033[31m",
        YEL = "\033[33m",
        GRN = "\033[32m",
        RST = "\033[0m",
        NL = "\n"
    ;

    process.stdout.write(RED + 'Command called incorrectly.' + RST + NL);
    process.stdout.write(NL);
    process.stdout.write(YEL + 'Usage:' + RST + NL);
    process.stdout.write('  electron ElectronServer.js <host:port> [show|hide] [log level]' + NL);
    process.stdout.write(NL);
    process.stdout.write(YEL + 'Parameters:' + RST + NL);
    process.stdout.write('  ' + GRN + '<host:port>' + RST + '   (Required) Specifies the IP / port the server should listen on.' + NL);
    process.stdout.write('  ' + GRN + '[show|hide]' + RST + '   Show or hide Electron window (default is hide).' + NL);
    process.stdout.write('  ' + GRN + '[log level]' + RST + '   Sets logging verbosity (default is "debug").' + NL);
    process.stdout.write('                See PSR-3 LogLevel constants for available values.' + NL);

    process.exit(1);
}

const Electron = require('electron'),
    BrowserWindow = Electron.BrowserWindow,
    DNode = require('dnode'),
    Temp = require('temp'),
    FS = require('fs'),
    Util = require('util'),
    QueryString = require('querystring'),
    // See PSR-3 LogLevel constants.
    // TODO in the future, support switching log format (console|json)
    Logger = {
        LogLevel: 0,
        LevelMap: {
            'debug': 0,
            'info': 1,
            'warning': 2,
            'error': 3
        },
        log: function(level, message, context) {
            if (Logger.LogLevel <= Logger.LevelMap[level]) {
                context = context || {};
                context.srcTime = Date.now() / 1000;
                process.stdout.write(JSON.stringify({
                        'level': level,
                        'message': message,
                        'context': context
                    }) + '\n');
            }
        },
        debug: function(){
            this.log('debug', Util.format.apply(null, arguments));
        },
        info: function(){
            this.log('info', Util.format.apply(null, arguments));
        },
        warn: function(){
            this.log('warning', Util.format.apply(null, arguments));
        },
        error: function(){
            this.log('error', Util.format.apply(null, arguments));
        }
    };

var showWindow = process.argv[3] === 'show';
Logger.LogLevel = Logger.LevelMap[process.argv[4] || ''] || 0;

// Global exception handler
process.on('uncaughtException', function (error) {
    Logger.error('Uncaught exception: %s', (error ? (error.stack || error) : '').toString());
    process.exit(1);
});

// Show stack trace for deprecations (see https://electron.atom.io/blog/2015/11/17/electron-api-changes#deprecation-warnings)
process.traceDeprecation = true;

// Ensures stdout/err is always flushed before exit. See: https://github.com/nodejs/node/issues/6456
[process.stdout, process.stderr].forEach(function (s) {
    s && s.isTTY && s._handle && s._handle.setBlocking && s._handle.setBlocking(true);
});

Electron.app.on('ready', function() {
    var mainWindow = new BrowserWindow({
            'show': showWindow,
            'webPreferences': {'devTools': showWindow}
        }),
        currWindow = mainWindow,
        pageVisited = null,
        hdrs = {},
        auth = {'user': false, 'pass': null},
        lastStatusCode = null,
        lastContentPath = null,
        lastContentSaved = null,
        lastHeaders = null,
        executeResponse = null,
        cookieResponse = null,
        screenshotResponse = null,
        windowWillUnload = false,
        newWindowName = null,
        windowIdNameMap = {};

    global.setExecutionError = function (error) {
        Logger.error('Script evaluation failed internally: %s', (error ? (error.stack || error) : '').toString());
        executeResponse = {'error': (error ? (error.stack || error) : '').toString()};
    };

    global.setWindowUnloading = function (value) {
        if (value) {
            Logger.info('Page is unloading.');

            pageVisited = null;
            lastStatusCode = null;
        }

        windowWillUnload = value;
    };

    global.setWindowIdName = function (id, name, url) {
        id = id === null ? "" : id.toString();

        if (name === null) {
            Logger.info('Unlinked window named "%s" from id "%s" for %s.', name, id, url);
            if (windowIdNameMap[id]) delete windowIdNameMap[id];
        } else {
            Logger.info('Linked window named "%s" with id "%s" for %s.', name, id, url);
            windowIdNameMap[id] = name;
        }
    };

    var findWindowByName = function (name) {
        var result = [];

        for (var id in windowIdNameMap) {
            if (windowIdNameMap[id] === name) {
                var wnd = BrowserWindow.fromId(parseInt(id));
                if (wnd) result.push(wnd);
            }
        }

        switch (result.length) {
            case 0:
                throw new Error('Window named "' + name + '" not found (possibly name cache not in sync).');
            case 1:
                return result[0];
            default:
                throw new Error('There are ' + result.length + ' windows named "' + name + '".');
        }
    };

    Electron.app.on(
        'browser-window-created',
        /**
         * @param event
         * @param {Electron.BrowserWindow} window
         */
        function (event, window) {
            window.webContents
                .on('login', function (event, request, authInfo, callback) {
                    if (auth.user !== false) {
                        event.preventDefault();
                        callback(auth.user, auth.pass);
                    }
                })
                .on('did-get-response-details', function (event, status, newURL, originalURL, httpResponseCode, requestMethod, referrer, headers, resourceType) {
                    lastStatusCode = httpResponseCode;
                    lastHeaders = headers;
                })
                .on('new-window', function (event, url, frameName) {
                    Logger.info('Creating window "%s" for url "%s".', frameName, url);
                    windowWillUnload = true;
                    pageVisited = null;
                    newWindowName = frameName;
                })
                .on('did-finish-load', function () {
                    Logger.debug('Attaching JS to page...');

                    window.webContents
                        .executeJavaScript(
                            '(function () {\
                                var callGlobalFn = function (name, args) {\
                                    var remote = (require("electron") || {}).remote;\
                                    if (remote) {\
                                        var remoteFn = remote.getGlobal(name);\
                                        if (!remoteFn) throw new Error("Requested global js function not found: " + name);\
                                        remoteFn.apply(remote, args);\
                                    }\
                                };\
                                \
                                var oldOnError = window.onerror;\
                                window.onerror = function (error) {\
                                    callGlobalFn("setExecutionError", [error]);\
                                    if (oldOnError) oldOnError();\
                                };\
                                \
                                var oldOnUnload = window.onbeforeunload;\
                                window.onbeforeunload = function (error) {\
                                    callGlobalFn("setWindowUnloading", [true]);\
                                    if (oldOnUnload) oldOnUnload();\
                                    callGlobalFn("setWindowIdName", [' + window.id + ', null, location.href]);\
                                };\
                                \
                                var oldWndName = window.name;\
                                window.__defineSetter__("name", function (name) {\
                                    oldWndName = name;\
                                    callGlobalFn("setWindowIdName", [' + window.id + ', name, location.href]);\
                                });\
                                window.__defineGetter__("name", function () { return oldWndName; });\
                                \
                                window.name = ' + JSON.stringify(newWindowName) + ';\
                            })();', true)
                        .then(
                            function () {
                                Logger.info('Page finished loading and JS attached successfully.');
                                pageVisited = true;
                            },
                            function (error) {
                                Logger.error('Could not attach JS to page: %s', (error ? (error.stack || error) : '').toString());
                            }
                        )
                    ;
                })
                .on('did-fail-load', function (event, errorCode, errorDescription, validatedURL, isMainFrame) {
                    Logger.warn('Page failed to load (error %s): %s.', errorCode, errorDescription);
                    pageVisited = true;
                })
                .on('crashed', function (event, killed) {
                    Logger.error('Renderer process %s.', killed ? 'was killed' : 'has crashed');
                })
                .on('plugin-crashed', function (event, name, version) {
                    Logger.error('Plugin %s version %s crashed.', name, version);
                })
            ;
        }
    );
    Electron.app.emit('browser-window-created', null, mainWindow);

    //noinspection JSUnusedGlobalSymbols
    var server = DNode(
        {
            reset: function (cb) {
                Logger.info('Resetting page (clearing headers, session and auth).');

                hdrs = {};
                auth = {'user': false, 'pass': ''};

                BrowserWindow.getAllWindows().forEach(function (window) {
                    window.webContents.session.clearStorageData();
                    window.webContents.session.clearAuthCache({type: 'password'});
                });

                cb();
            },

            clearVisitedResponse: function (cb) {
                Logger.debug('clearVisitedResponse()');

                pageVisited = null;
                lastStatusCode = null;

                cb();
            },

            visit: function (url, cb) {
                var extraHeaders = '';
                for (var key in hdrs) extraHeaders += key + ': ' + hdrs[key] + '\n';

                Logger.debug('visit(%s) (extraHeaders: %s)', url, extraHeaders.replace(/\n/g, '\\n') || 'none');

                currWindow.loadURL(url, {'extraHeaders': extraHeaders});

                cb();
            },

            getVisitedResponse: function (cb) {
                Logger.debug('getVisitedResponse() => %s', pageVisited);

                cb(pageVisited);
            },

            getCurrentUrl: function (cb) {
                Logger.debug('getCurrentUrl() => %s', currWindow.webContents.getURL());

                cb(currWindow.webContents.getURL().toString());
            },

            reload: function (cb) {
                Logger.debug('reload()');

                currWindow.webContents.reload();

                cb();
            },

            back: function (cb) {
                Logger.debug('back()');

                currWindow.webContents.goBack();

                cb();
            },

            forward: function (cb) {
                Logger.debug('forward()');

                currWindow.webContents.goForward();

                cb();
            },

            setBasicAuth: function (user, pass, cb) {
                Logger.debug('setBasicAuth(%s, %s)', user, pass);

                auth.user = user;
                auth.pass = pass;

                if (user === false) {
                    currWindow.webContents.session.clearAuthCache({type: 'password'});
                }

                cb();
            },

            switchToWindow: function (name, cb) {
                Logger.debug('switchToWindow(%s)', name);

                currWindow = name === null ? mainWindow : findWindowByName(name);

                cb();
            },

            switchToIFrame: function () {
                // TODO
            },

            setRequestHeader: function (name, value, cb) {
                Logger.debug('setRequestHeader(%s, %s)', name, value);

                hdrs[name] = value;

                cb();
            },

            getResponseHeaders: function (cb) {
                Logger.debug('getResponseHeaders() => %j', lastHeaders);

                cb(lastHeaders);
            },

            setCookie: function (name, value, cb) {
                Logger.debug('setCookie(%s, %s)', name, value);

                cookieResponse = null;

                if (value === null) {
                    currWindow.webContents.session.cookies.remove(
                        currWindow.webContents.getURL(),
                        name,
                        function (error) {
                            cookieResponse = {'set': !error, 'error': (error ? (error.stack || error) : '').toString()};
                        }
                    );
                } else {
                    currWindow.webContents.session.cookies.set(
                        {
                            'url': currWindow.webContents.getURL(),
                            'name': name,
                            'value': QueryString.escape(value)
                        },
                        function (error) {
                            cookieResponse = {'set': !error, 'error': (error ? (error.stack || error) : '').toString()};
                        }
                    );
                }

                cb();
            },

            getCookie: function (name, cb) {
                Logger.debug('getCookie(%s)', name);

                cookieResponse = null;
                currWindow.webContents.session.cookies.get(
                    {
                        'url': currWindow.webContents.getURL(),
                        'name': name
                    },
                    function (error, cookies) {
                        cookieResponse = {
                            'get': cookies.length ? QueryString.unescape(cookies[0].value) : null,
                            'error': (error ? (error.stack || error) : '').toString()
                        };
                    }
                );

                cb();
            },

            getCookieResponse: function (cb) {
                Logger.debug('getCookieResponse() => %j', cookieResponse);

                cb(cookieResponse);
            },

            getStatusCode: function (cb) {
                Logger.debug('getStatusCode() => %s', lastStatusCode);

                cb(lastStatusCode);
            },

            getContent: function (cb) {
                lastContentSaved = null;
                lastContentPath = Temp.path({'suffix': '.data'});
                var started = currWindow.webContents.savePage(lastContentPath, 'HTMLComplete', function (error) {
                    lastContentSaved = error || true;
                });

                Logger.debug('getContent() => %s (saving to %s)', started, lastContentPath);

                cb(started);
            },

            getContentResponse: function (cb) {
                var lastContent = null;

                if (lastContentSaved) {
                    if (lastContentSaved === true) {
                        lastContent = {'content': FS.readFileSync(lastContentPath).toString()};
                    } else {
                        lastContent = {'error': lastContentSaved};
                    }

                    FS.unlink(lastContentPath, function () {
                        Logger.debug('Deleted temporary content file.');
                    });
                }

                Logger.debug('getContentResponse() => %s (reading from %s)', JSON.stringify(lastContent), lastContentPath);

                cb(lastContent);
            },

            evaluateScript: function (script, cb) {
                Logger.debug('evaluateScript(%s)', script);

                executeResponse = null;

                try {
                    global.setWindowUnloading(false);

                    currWindow.webContents
                        .executeJavaScript(script, true)
                        .then(
                            function (result) {
                                Logger.debug('Evaluated script with result: %j', result);
                                executeResponse = {'result': result};
                            },
                            function (error) {
                                Logger.error('Script evaluation failed: %s', (error ? (error.stack || error) : '').toString());
                                executeResponse = {'error': (error ? (error.stack || error) : '').toString()};
                            }
                        );
                } catch (error) {
                    Logger.error('Script evaluation failed prematurely: %s', (error ? (error.stack || error) : '').toString());
                    executeResponse = {'error': (error ? (error.stack || error) : '').toString()};
                }

                cb();
            },

            getEvaluateScriptResponse: function (cb) {
                if (executeResponse) {
                    executeResponse['redirect'] = windowWillUnload;
                }

                Logger.debug('getEvaluateScriptResponse() => %j', executeResponse);

                cb(executeResponse);
            },

            getScreenshot: function (cb) {
                Logger.debug('getScreenshot()');

                screenshotResponse = null;
                currWindow.capturePage(currWindow.getContentBounds(), function (image) {
                    screenshotResponse = {'base64data': image.toPNG().toString('base64')};
                });

                cb();
            },

            getScreenshotResponse: function (cb) {
                Logger.debug('getScreenshotResponse() => %j', screenshotResponse);

                cb(screenshotResponse);
            },

            getWindowNames: function (cb) {
                var windowNames = Object.values(windowIdNameMap);

                Logger.debug('getWindowNames() => %j', windowNames);

                cb(windowNames);
            },

            resizeWindow: function (width, height, name, cb) {
                Logger.debug('resizeWindow(%s, %s, %s)', width, height, name);

                (name === null ? currWindow : findWindowByName(name)).setSize(width, height, false);

                cb();
            },

            maximizeWindow: function (name, cb) {
                Logger.debug('maximizeWindow(%s)', name);

                (name === null ? currWindow : findWindowByName(name)).maximize();

                cb();
            }
        },
        {
            'weak': false
        }
    );

    var address = /(.*):(\d+)/.exec(process.argv[2]);
    if (!address) throw new Error('Could not parse the supplied address, expected "host:port".');
    server.listen(address[1], parseInt(address[2]));
});
