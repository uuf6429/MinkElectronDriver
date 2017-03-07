if (process.argv.length < 3
    || process.argv.length > 4
    || !process.versions['electron']
) {
    throw('Correct usage is: electron ElectronServer.js <host:port> [show]');
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
        log: function(level, message, context) {
            context = context || {};
            context.srcTime = Date.now() / 1000;
            process.stdout.write(JSON.stringify({
                    'level': level,
                    'message': message,
                    'context': context
                }) + '\n');
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
    }
;

var showWindow = process.argv[3] === 'show';

// Global exception handler
process.on('uncaughtException', function (error) {
    Logger.error('Uncaught exception: %s', (error ? (error.stack || error) : '').toString());
});

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
        /**
         * @param {Electron.BrowserWindow} window
         */
        setupPageVisited = function (window) {
            pageVisited = null;
            lastStatusCode = null;

            window.webContents.once('did-finish-load', function () {
                pageVisited = true;

                Logger.debug('Enabling page error capture...');

                window.webContents
                    .executeJavaScript('(function () {\
                        var oldOnError = window.onerror;\
                        window.onerror = function (error) {\
                            var remote = require("electron").remote;\
                            var setErrorFn = remote.getGlobal("setExecutionError");\
                            if (setErrorFn) setErrorFn(error);\
                            if (oldOnError) oldOnError();\
                        };\
                    })();', true);

                Logger.info('Page finished loading.');
            });
        }
    ;

    global.setExecutionError = function (error) {
        Logger.error('Script evaluation failed internally: %s', (error ? (error.stack || error) : '').toString());
        executeResponse = {'error': (error ? (error.stack || error) : '').toString()};
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
            ;
        }
    );
    Electron.app.emit('browser-window-created', null, mainWindow);

    //noinspection JSUnusedGlobalSymbols
    var server = DNode(
        {
            reset: function (cb) {
                Logger.debug('reset()');

                hdrs = {};
                auth = {'user': false, 'pass': ''};

                BrowserWindow.getAllWindows().forEach(function (window) {
                    window.webContents.session.clearStorageData();
                    window.webContents.session.clearAuthCache({ type: 'password' });
                });

                cb();
            },

            visit: function (url, cb) {
                var extraHeaders = '';
                for (var key in hdrs) extraHeaders += key + ': ' + hdrs[key] + '\n';

                Logger.debug('visit(%s) (extraHeaders: %s)', url, extraHeaders.replace(/\n/g, '\\n') || 'none');

                setupPageVisited(currWindow);
                currWindow.loadURL(url, {'extraHeaders': extraHeaders});

                cb();
            },

            visited: function (cb) {
                Logger.debug('visited() => %s', pageVisited);

                cb(pageVisited);
            },

            getCurrentUrl: function (cb) {
                Logger.debug('getCurrentUrl() => %s', currWindow.webContents.getURL());

                cb(currWindow.webContents.getURL().toString());
            },

            reload: function (cb) {
                Logger.debug('reload()');

                setupPageVisited(currWindow);
                currWindow.webContents.reload();

                cb();
            },

            back: function (cb) {
                Logger.debug('back()');

                setupPageVisited(currWindow);
                currWindow.webContents.goBack();

                cb();
            },

            forward: function (cb) {
                Logger.debug('forward()');

                setupPageVisited(currWindow);
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
                Logger.debug('switchToWindow(%s)', parseInt(name));

                currWindow = name === null ? mainWindow : BrowserWindow.fromId(parseInt(name));

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
                            'value': value
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
                var started = currWindow.webContents.savePage(lastContentPath, 'HTMLOnly', function (error) {
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

                    FS.unlink(lastContentPath);
                }

                Logger.debug('getContentResponse() => %s (reading from %s)', JSON.stringify(lastContent), lastContentPath);

                cb(lastContent);
            },

            evaluateScript: function (script, cb) {
                Logger.debug('evaluateScript(%s)', script);

                executeResponse = null;

                try {
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
                var windowNames = BrowserWindow
                    .getAllWindows()
                    .map(function (win) {
                        return win.id.toString();
                    });

                Logger.debug('getWindowNames() => %j', windowNames);

                cb(windowNames);
            },

            getWindowName: function (cb) {
                Logger.debug('getWindowName() => %s', currWindow.id.toString());

                cb(currWindow.id.toString());
            },

            resizeWindow: function (width, height, name, cb) {
                Logger.debug('resizeWindow(%s, %s, %s)', width, height, name);

                (name === null ? currWindow : BrowserWindow.fromId(parseInt(name))).setSize(width, height, false);

                cb();
            },

            maximizeWindow: function (name, cb) {
                Logger.debug('maximizeWindow(%s)', name);

                (name === null ? currWindow : BrowserWindow.fromId(parseInt(name))).maximize();

                cb();
            }
        }
    );

    var address = /(.*):(\d+)/.exec(process.argv[2]);
    server.listen(address[1], parseInt(address[2]));
});
