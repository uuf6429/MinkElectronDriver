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
    Path = require('path'),
    DNode = require('dnode'),
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
    var setupWindowOptions = function (options) {
        options.show = showWindow;
        options.webPreferences = options.webPreferences || {};
        options.webPreferences.devTools = showWindow;
        options.webPreferences.nodeIntegration = false;
        options.webPreferences.preload = Path.resolve(__dirname, 'ElectronServerPreload.js');

        return options;
    };

    var mainWindow = new BrowserWindow(setupWindowOptions({})),
        currWindow = mainWindow,
        pageVisited = null,
        hdrs = {},
        auth = {'user': false, 'pass': null},
        lastStatusCode = null,
        lastHeaders = null,
        executeResponse = null,
        cookieResponse = null,
        screenshotResponse = null,
        windowWillUnload = false,
        windowIdNameMap = {},
        attachFileResponse = null;

    global.newWindowName = '';

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
                .on('new-window', function (event, url, frameName, disposition, options) {
                    Logger.info('Creating window "%s" for url "%s".', frameName, url);
                    windowWillUnload = true;
                    pageVisited = null;
                    global.newWindowName = frameName;
                    setupWindowOptions(options);
                })
                .on('did-finish-load', function () {
                    Logger.info('Page finished loading.');
                    pageVisited = true;
                })
                .on('did-fail-load', function (event, errorCode, errorDescription, validatedURL, isMainFrame) {
                    Logger.warn('Page failed to load (error %s): %s (validatedURL: "%s", isMainFrame: %s).', errorCode, errorDescription, validatedURL, isMainFrame ? 'yes' : 'no');
                    pageVisited = true;
                })
                .on('crashed', function (event, killed) {
                    Logger.error('Renderer process %s.', killed ? 'was killed' : 'has crashed');
                })
                .on('plugin-crashed', function (event, name, version) {
                    Logger.error('Plugin %s version %s crashed.', name, version);
                })
            ;

            try {
                window.webContents.debugger.attach('1.2');
                window.webContents.debugger.on('message', function (event, message, params) {
                    if (message == 'Network.responseReceived') { // and is mainframe?
                        window.webContents.debugger.sendCommand(
                            'Network.getResponseBody',
                            {'requestId': params.requestId},
                            function (_, response) {
                                Logger.debug('Read response body.');
                                window._lastContent = {content: response.body};
                            }
                        );
                    }
                });
                window.webContents.debugger.sendCommand('Network.enable');

            } catch (error) {
                Logger.error('Could not attach debugger: %s', (error ? (error.stack || error) : '').toString());
            }
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
                var lastContent = currWindow._lastContent || null;

                Logger.debug('getContent() => %j', lastContent);

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
            },

            attachFile: function (xpath, path, cb) {
                Logger.debug('attachFile(%s, %s)', xpath, path);

                /* This code is arguably quite complex, so it warrants an explanation.
                 * First of all, note that you can't just change a file input's value, for security reasons, even if we
                 * are theoretically privileged from Electron's point of view. The solution is a to use RemoteDebug API
                 * as described here: https://github.com/electron/electron/issues/749 (which requires attaching a debugger).
                 * This unfortunately complicates matters slightly - the protocol does not allow querying by an XPath
                 * query (as far as I can tell). So we do a very simple hack: find the element via JS, record its id
                 * (if it has one), set the id to some random value, reference that random id when doing RemoteDebug calls
                 * and finally restore the id to the initial value. Since this call is pseudo-synchronous, the client (Mink)
                 * won't ever know about this and everyone will be happy. :)
                 */

                attachFileResponse = null;
                var randomFileId = 'electronFile' + Math.round(Math.random() * 100000);
                var restoreFileId = function () {
                    return currWindow.webContents
                        .executeJavaScript(
                            'var element = document.evaluate(' + JSON.stringify(xpath) + ', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;\
                            if (element.tagName != "INPUT" || element.type != "file") throw new Error("Element is not a valid file input field.");\
                            element.id = Electron.tmpFileId;\
                            delete Electron.tmpFileId;'
                        );
                };
                var isEmptyObject = function (obj) {
                    return Object.keys(obj).length === 0 && obj.constructor === Object;
                };

                currWindow.webContents
                    .executeJavaScript(
                        'var element = document.evaluate(' + JSON.stringify(xpath) + ', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;\
                        if (element.tagName != "INPUT" || element.type != "file") throw new Error("Element is not a valid file input field.");\
                        Electron.tmpFileId = element.id;\
                        element.id = ' + JSON.stringify(randomFileId) + ';'
                    )
                    .then(
                        function () {
                            currWindow.webContents.debugger.sendCommand('DOM.getDocument', {}, function (error, res) {
                                if (!isEmptyObject(error)) {
                                    Logger.error('Could not get document from RemoteDebug: %s', (error ? (error.stack || error) : '').toString());
                                    attachFileResponse = {'error': (error ? (error.stack || error) : '').toString()};
                                    return;
                                }

                                currWindow.webContents.debugger.sendCommand('DOM.querySelector', {
                                    nodeId: res.root.nodeId,
                                    selector: '#' + randomFileId
                                }, function (error, res) {
                                    if (!isEmptyObject(error)) {
                                        Logger.error('Could not query document from RemoteDebug: %s', (error ? (error.stack || error) : '').toString());
                                        attachFileResponse = {'error': (error ? (error.stack || error) : '').toString()};
                                        return;
                                    }

                                    currWindow.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
                                        nodeId: res.nodeId,
                                        files: [path]
                                    }, function (error, res) {
                                        if (!isEmptyObject(error)) {
                                            Logger.error('Could not attach file from RemoteDebug: %s', (error ? (error.stack || error) : '').toString());
                                            attachFileResponse = {'error': (error ? (error.stack || error) : '').toString()};
                                            return;
                                        }

                                        restoreFileId()
                                            .then(
                                                function () {
                                                    Logger.info('File was attached to input field successfully.');
                                                    attachFileResponse = true;
                                                },
                                                function (error) {
                                                    Logger.error('Could restore element id after attaching file: %s', (error ? (error.stack || error) : '').toString());
                                                    attachFileResponse = {'error': (error ? (error.stack || error) : '').toString()};
                                                }
                                            );
                                    });
                                });
                            });
                        },
                        function (error) {
                            restoreFileId()
                                .then(
                                    function () {
                                        Logger.error('Could not prepare input field for attaching file: %s', (error ? (error.stack || error) : '').toString());
                                        attachFileResponse = {'error': (error ? (error.stack || error) : '').toString()};
                                    },
                                    function (error2) {
                                        Logger.error(
                                            'Could not restore input field for attaching file (after preparing failed): %s\n%s',
                                            (error2 ? (error2.stack || error2) : '').toString(),
                                            (error ? (error.stack || error) : '').toString()
                                        );
                                        attachFileResponse = {
                                            'error': (error2 ? (error2.stack || error2) : '').toString()
                                            + '\n' + (error ? (error.stack || error) : '').toString()
                                        };
                                    }
                                );
                        }
                    );

                cb();
            },

            getAttachFileResponse: function (cb) {
                Logger.debug('getAttachFileResponse() => %j', attachFileResponse);

                cb(attachFileResponse);
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
