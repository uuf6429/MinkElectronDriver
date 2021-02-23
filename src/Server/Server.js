'use strict';

const NL = "\n",
    RED = "\e[31m",
    YEL = "\e[33m",
    GRN = "\e[32m",
    RST = "\e[0m",
    showHelp = function(titleMessage, exitCode) {
        if (titleMessage) {
            process.stdout.write(NL + titleMessage + NL);
        }

        process.stdout.write(NL);
        process.stdout.write(YEL + 'Usage:' + RST + NL);
        process.stdout.write('  electron ElectronServer.js \x3Chost:port\x3E \x3Cshow|hide\x3E [log level]' + NL);
        process.stdout.write(NL);
        process.stdout.write(YEL + 'Parameters:' + RST + NL);
        process.stdout.write('  ' + GRN + '\x3Chost:port\x3E' + RST + '   (Required) Specifies the IP / port the server should listen on.' + NL);
        process.stdout.write('  ' + GRN + '\x3Cshow|hide\x3E' + RST + '   (Required) Show or hide Electron window.' + NL);
        process.stdout.write('  ' + GRN + '[log level]' + RST + '   Sets logging verbosity (default is "debug").' + NL);
        process.stdout.write('                See PSR-3 LogLevel constants for available values.' + NL);

        process.exit(exitCode || 0);
    }
;

if (process.argv.length === 2 || (process.argv.length === 3 && ['/?', '-h', 'help', '--help'].indexOf(process.argv[2]) !== -1)) {
    showHelp();
}

if (!process.versions['electron']) {
    showHelp(RED + 'Error: must be executed through Electron not Node.' + RST, 1);
}

if (process.argv.length < 4 || process.argv.length > 5) {
    showHelp(RED + 'Error: Invalid number of arguments.' + RST, 1);
}

const Electron = require('electron'),
    BrowserWindow = Electron.BrowserWindow,
    Path = require('path'),
    DNode = require('dnode'),
    QueryString = require('querystring'),
    Logger = require('./Logger.js'),
    ResponseManager = require('./ResponseManager.js'),
    FrameManager = require('./FrameManager.js');

const showWindow = process.argv[3] === 'show';
Logger.LogLevel = process.argv[4] || Logger.DEBUG;

// Global exception handler
process.on('uncaughtException', function (error) {
    Logger.error('Uncaught exception: %s', (error ? (error.stack || error) : '').toString());
    process.exit(1);
});

// Show stack trace for deprecations (see https://electron.atom.io/blog/2015/11/17/electron-api-changes#deprecation-warnings)
process.traceDeprecation = true;

// Ensures stdout/err is always flushed before exit. See: https://github.com/nodejs/node/issues/6456
[process.stdout, process.stderr].forEach(function (s) {
    s && s.isTTY && s._handle && s._handle['setBlocking'] && s._handle['setBlocking'](true);
});

Electron.app.on('ready', function() {
    /**
     * @param {Object} options
     * @returns {Object}
     */
    const setupWindowOptions = function (options) {
        options.show = showWindow;

        options.x = 0;
        options.y = 0;
        options.enableLargerThanScreen = true;

        options.webPreferences = options.webPreferences || {};
        options.webPreferences.devTools = showWindow;
        options.webPreferences.nodeIntegration = false;
        options.webPreferences.preload = Path.resolve(__dirname, 'Preload.js');

        return options;
    };

    /**
     * @param {Object} obj
     * @returns {boolean}
     */
    const isEmptyObject = function (obj) {
        return Object.keys(obj).length === 0 && obj.constructor === Object;
    };

    /**
     * Attempts to serialize an error to a string with as much information as possible.
     * @param {Object} error
     * @returns {String}
     */
    const errorToString = function (error) {
        if (!error) {
            return '';
        }

        let result = (error.stack || error).toString();

        if (result === '[object Object]') {
            result = JSON.stringify(error);
        }

        return result;
    };

    let mainWindow = null,
        currWindow = null,
        currWindowId = null,
        pageVisited = null,
        hdrs = {},
        auth = {'user': false, 'pass': null},
        executeResponse = null,
        cookieResponse = null,
        screenshotResponse = null,
        windowWillUnload = false,
        /** @type {Object.<string, string>} */
        windowIdNameMap = {},
        captureResponse = false,
        bindServerOnce;

    global.newWindowName = '';
    global.DELAY_SCRIPT_RESPONSE = '{%DelayElectronScriptResponse%}';

    /**
     * Sets the executeResponse value to the passed error.
     * @param {Error} error
     */
    global.setExecutionError = function (error) {
        Logger.error('Script evaluation failed internally: %s', errorToString(error));

        executeResponse = {'error': errorToString(error)};
    };

    /**
     * Sets flag indicating that something caused the current page to start unloading.
     * @param {boolean} value
     */
    global.setWindowUnloading = function (value) {
        if (value) {
            Logger.info('Page is unloading.');

            pageVisited = null;
            captureResponse = true;
        } else {
            Logger.debug('Page unload flag cleared.');
        }

        windowWillUnload = value;
    };

    /**
     * Set window name for the particular electron id (url extra info).
     * @param {Number} id
     * @param {String} name
     * @param {String} url
     */
    global.setWindowIdName = function (id, name, url) {
        const sId = id === null ? "" : id.toString();

        if (name === '') {
            name = 'electron_window_' + sId;
        }

        if (name === null) {
            Logger.info('Unlinked window named %j from id %j for %j.', name, sId, url);
            if (windowIdNameMap[sId]) delete windowIdNameMap[sId];
        } else {
            Logger.info('Linked window named %j with id %j for %j.', name, sId, url);
            windowIdNameMap[sId] = name;
        }
    };

    /**
     * Returns window name given electron id.
     * @param {Number} id
     * @returns {String|null}
     */
    global.getWindowNameFromId = function (id) {
        const sId = id === null ? "" : id.toString();

        if (!windowIdNameMap[sId] && !Electron.BrowserWindow.fromId(id)) {
            Logger.warn('Cannot retrieve name of window %j since window is not created yet.', id);
        }

        return windowIdNameMap[sId] || null;
    };

    /**
     * Returns if window name has ever been set for a particular id.
     * @param {Number} id
     * @return {Boolean}
     */
    global.isWindowNameSet = function (id) {
        const sId = id === null ? "" : id.toString();

        return sId !== '' && typeof(windowIdNameMap[sId]) !== 'undefined';
    };

    /**
     * Finds window by its window name. Note that this depends on the windows successfully registering it's id and name
     * when created. Since we keep these details in a hash map, we need to be careful about keeping it up to date.
     * @param {string} name
     * @returns {Electron.BrowserWindow}
     */
    const findWindowByName = function (name) {
        const result = [];

        if (name === 'current' || name === null) {
            return currWindow;
        }

        for (let id in windowIdNameMap) {
            if (windowIdNameMap.hasOwnProperty(id) && windowIdNameMap[id] === name) {
                const wnd = BrowserWindow.fromId(parseInt(id));
                if (wnd && result.indexOf(wnd) === -1) result.push(wnd);
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

    /**
     * Runs some code for an element retrieved from RemoteDebug with an XPath query.
     * It involves a hack: since RD does not support querying via XPath, we assign a random element id and use it
     * to find the element via RD. Afterwards, we restore the original element id (if there was any).
     * @param {Electron.WebContents} webContents
     * @param {string} xpath
     * @param {function(element,function())} onSuccess
     * @param {function(Error,function())} onFailure
     */
    const withElementByXpath = function (webContents, xpath, onSuccess, onFailure) {
        const jsElementVarName = 'Electron.tmpElement',
            randomElementId = 'electronElement' + Math.round(Math.random() * 100000),
            restoreElementId = function () {
                return webContents.executeJavaScript(jsElementVarName + '.id = Electron.tmpOldElementId;');
            };

        webContents
            .executeJavaScript(
                'var xpath = ' + JSON.stringify(xpath) + ';\
                ' + jsElementVarName + ' = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;\
                if (!' + jsElementVarName + ') throw new Error("Could not find find element for XPath: " + xpath);\
                Electron.tmpOldElementId = ' + jsElementVarName + '.id;\
                ' + jsElementVarName + '.id = ' + JSON.stringify(randomElementId) + ';'
            )
            .then(function () {
                webContents.debugger.sendCommand('DOM.getDocument', {}, function (error, res) {
                    if (!isEmptyObject(error)) {
                        const msg = 'Could not get document from RemoteDebug: ' + errorToString(error);
                        onFailure(new Error(msg), restoreElementId);
                        return;
                    }

                    webContents.debugger.sendCommand('DOM.querySelector', {
                        nodeId: res.root.nodeId,
                        selector: '#' + randomElementId
                    }, function (error, res) {
                        if (isEmptyObject(error)) {
                            res.jsElementVarName = jsElementVarName;
                            onSuccess(res, restoreElementId);
                        } else {
                            const msg = 'Could not query document from RemoteDebug: ' + errorToString(error);
                            onFailure(new Error(msg), restoreElementId);
                        }
                    });
                });
            })
            .catch(function (error) {
                const msg = 'Could not query document from RemoteDebug: ' + errorToString(error);
                onFailure(new Error(msg), function () {});
            });
    };

    /**
     * @param {Electron.Debugger} dbg
     * @param {Object} responseParams
     * @param {String|Number} frameId
     * @param {Integer} maxTries
     * @param {Integer} [currTry]
     */
    const retrieveDebuggerResponseBody = function (dbg, responseParams, frameId, maxTries, currTry) {
        currTry = currTry || 1;

        dbg.sendCommand(
            'Network.getResponseBody',
            {'requestId': responseParams.requestId},
            function (error, response) {
                if (isEmptyObject(error)) {
                    ResponseManager.set(frameId, responseParams.response, response);
                } else if (currTry <= maxTries) {
                    Logger.notice('Could not retrieve response body (try %d of %d): %s', currTry, maxTries, errorToString(error));
                    setTimeout(
                        function () {
                            retrieveDebuggerResponseBody(dbg, responseParams, frameId, maxTries, currTry + 1);
                        },
                        5
                    );
                } else {
                    Logger.error('Could not retrieve response body after %d tries: %s, response meta: %j', maxTries, errorToString(error), responseParams);
                }
            }
        );
    };

    /**
     * @param {int} webContentId
     * @param {string} xpath
     * @param {string} value
     * @todo This is a potential security threat. Fix by allowing only registered file paths to be uploaded.
     */
    global.setFileFromScript = function (webContentId, xpath, value) {
        Logger.debug('setFileFromScript(%j, %j, %j)', webContentId, xpath, value);

        try {
            executeResponse = null;
            const webContents = Electron.webContents.fromId(parseInt(webContentId));

            withElementByXpath(
                webContents,
                xpath,
                function (element, onDone) {
                    webContents.debugger.sendCommand('DOM.setFileInputFiles', {
                        nodeId: element.nodeId,
                        files: [value]
                    }, function (error) {
                        if (isEmptyObject(error)) {
                            onDone()
                                .then(function () {
                                    webContents
                                        .executeJavaScript('Electron.syn.trigger(' + element.jsElementVarName + ', "change", {});')
                                        .then(function () {
                                            Logger.info('Value of file input field set successfully successfully.');
                                            executeResponse = {'result': true};
                                        })
                                        .catch(function (error) {
                                            Logger.error('Could not trigger change event: %s', errorToString(error));
                                            executeResponse = {'error': errorToString(error)};
                                        });
                                })
                                .catch(function (error) {
                                    Logger.error('Could not perform RemoteDebug cleanup: %s', errorToString(error));
                                    executeResponse = {'error': errorToString(error)};
                                });
                        } else {
                            Logger.error('Could not set file value from RemoteDebug: %s', errorToString(error));
                            executeResponse = {'error': errorToString(error)};
                            onDone();
                        }
                    });
                },
                function (error, onDone) {
                    Logger.error('Could not set file field value: %s', errorToString(error));
                    executeResponse = {'error': errorToString(error)};
                    onDone();
                }
            );
        } catch (error) {
            Logger.error('Global method "setFileFromScript" failed: %s', errorToString(error));
        }
    };

    Electron.app.on(
        'browser-window-created',
        /**
         * @param event
         * @param {Electron.BrowserWindow} window
         */
        function (event, window) {
            const windowId = window.webContents.id;

            Logger.info('Browser window created with id %j.', windowId);

            window
                .on('closed', function () { // important: we can't use window anymore in here!
                    Logger.info('Window "%s" (id %j) has been closed.', windowIdNameMap[windowId.toString()] || '', windowId);

                    if (windowId === currWindowId) {
                        pageVisited = true;
                        captureResponse = false;
                    }

                    delete windowIdNameMap[windowId.toString()];
                    ResponseManager.remove(windowId);
                })
            ;

            window.webContents
                .on('login', function (event, request, authInfo, callback) {
                    if (auth.user !== false) {
                        event.preventDefault();
                        callback(auth.user, auth.pass);
                    }
                })
                .on('new-window', function (event, url, frameName, disposition, options) {
                    Logger.info('Creating window "%s" for url "%s".', frameName, url);
                    global.setWindowUnloading(true);
                    global.newWindowName = frameName;
                    setupWindowOptions(options);
                })
                .on('will-navigate', function (event, url) {
                    Logger.debug('Event "will-navigate" triggered for url %j.', url);
                    global.setWindowUnloading(true);
                })
                .on('did-finish-load', function () {
                    if (bindServerOnce) {
                        Logger.info('Main page loaded, binding sever...');
                        bindServerOnce();
                        bindServerOnce = null;
                    } else {
                        Logger.info('Page finished loading.');
                        pageVisited = true;
                    }
                })
                .on('did-fail-load', function (event, errorCode, errorDescription, validatedURL, isMainFrame) {
                    Logger.warn('Page failed to load (error %s): %s (validatedURL: "%s", isMainFrame: %s).', errorCode, errorDescription, validatedURL, isMainFrame ? 'yes' : 'no');
                    pageVisited = true;
                })
                .on('crashed', function (event, killed) {
                    Logger.critical('Renderer process %s.', killed ? 'was killed' : 'has crashed');
                })
                .on('plugin-crashed', function (event, name, version) {
                    Logger.critical('Plugin "%s" (version %s) crashed.', name, version);
                })
            ;

            try {
                window.webContents.debugger.attach('1.2');

                window.webContents.debugger.on('message', function (event, message, params) {
                    if (captureResponse && message === 'Network.responseReceived' && params.type === 'Document') {
                        retrieveDebuggerResponseBody(window.webContents.debugger, params, window.webContents.id, 10);
                        captureResponse = false;
                    } else {
                        Logger.debug('Discarded "%s" event.', message);
                    }
                });

                window.webContents.debugger.sendCommand('Network.enable');
            } catch (error) {
                Logger.error('Could not attach debugger: %s', errorToString(error));
            }
        }
    );

    mainWindow = new BrowserWindow(setupWindowOptions({}));
    currWindow = mainWindow;
    currWindowId = currWindow.webContents.id;

    Logger.info('Starting up server...');

    //noinspection JSUnusedGlobalSymbols
    const server = DNode(
        {
            reset: function (cb) {
                Logger.info('Resetting page (clearing headers, session and auth).');

                hdrs = {};
                auth = {'user': false, 'pass': ''};
                currWindow = mainWindow;
                currWindowId = currWindow.webContents.id;
                BrowserWindow.getAllWindows().forEach(function (window) {
                    window.webContents.session.clearStorageData();
                    window.webContents.session.clearAuthCache({type: 'password'});
                });

                cb();
            },

            clearVisitedResponse: function (cb) {
                Logger.debug('clearVisitedResponse()');

                pageVisited = null;
                captureResponse = true;
                ResponseManager.remove(currWindow.webContents.id);

                cb();
            },

            visit: function (url, cb) {
                let extraHeaders = '';
                for (let key in hdrs) extraHeaders += key + ': ' + hdrs[key] + '\n';

                Logger.debug('visit(%j) (winId: %d, extraHeaders: %s)', url, currWindow.webContents.id, extraHeaders.replace(/\n/g, '\\n') || 'none');

                currWindow.loadURL(url, {'extraHeaders': extraHeaders});

                cb();
            },

            getVisitedResponse: function (cb) {
                Logger.debug('getVisitedResponse() => %j', pageVisited);

                cb(pageVisited);
            },

            getCurrentUrl: function (cb) {
                Logger.debug('getCurrentUrl() => %j', currWindow.webContents.getURL());

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
                Logger.debug('setBasicAuth(%j, %j)', user, pass);

                auth.user = user;
                auth.pass = pass;

                if (user === false) {
                    currWindow.webContents.session.clearAuthCache({type: 'password'});
                }

                cb();
            },

            switchToWindow: function (name, cb) {
                Logger.debug('switchToWindow(%j)', name);

                currWindow = name === null ? mainWindow : findWindowByName(name);
                currWindowId = currWindow.webContents.id;

                cb();
            },

            switchToIFrame: function (name, cb) {
                // TODO Currently blocked by https://github.com/electron/electron/issues/5115
            },

            setRequestHeader: function (name, value, cb) {
                Logger.debug('setRequestHeader(%j, %j)', name, value);

                hdrs[name] = value;

                cb();
            },

            getResponseHeaders: function (cb) {
                const response = ResponseManager.get(currWindow.webContents.id);
                const lastHeaders = (response || {}).headers || null;

                Logger.debug('getResponseHeaders() (winId: %d) => %j', currWindow.webContents.id, lastHeaders);

                cb(lastHeaders);
            },

            setCookie: function (name, value, cb) {
                Logger.debug('setCookie(%j, %j)', name, value);

                cookieResponse = null;

                if (value === null) {
                    currWindow.webContents.session.cookies.remove(
                        currWindow.webContents.getURL(),
                        name,
                        function (error) {
                            cookieResponse = {'set': !error, 'error': errorToString(error)};
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
                            cookieResponse = {'set': !error, 'error': errorToString(error)};
                        }
                    );
                }

                cb();
            },

            getCookie: function (name, cb) {
                Logger.debug('getCookie(%j)', name);

                cookieResponse = null;

                currWindow.webContents.session.cookies.get(
                    {
                        'url': currWindow.webContents.getURL(),
                        'name': name
                    },
                    function (error, cookies) {
                        cookieResponse = {
                            'get': cookies.length ? QueryString.unescape(cookies[0].value) : null,
                            'error': errorToString(error)
                        };
                    }
                );

                cb();
            },

            getCookies: function (cb) {
                Logger.debug('getCookies()');

                cookieResponse = null;

                currWindow.webContents.session.cookies.get(
                    {
                        'url': currWindow.webContents.getURL()
                    },
                    function (error, cookies) {
                        cookieResponse = {
                            'all': cookies.map(function (cookie) {
                                cookie.value = QueryString.unescape(cookie.value);
                                return cookie;
                            }),
                            'error': errorToString(error)
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
                const response = ResponseManager.get(currWindow.webContents.id);
                const lastStatus = (response || {}).status || null;

                Logger.debug('getStatusCode() (winId: %d) => %s', currWindow.webContents.id, lastStatus);

                cb(lastStatus);
            },

            getContent: function (cb) {
                const response = ResponseManager.get(currWindow.webContents.id);
                const lastContent = {content: ((response || {}).content || null)};

                Logger.debug('getContent() (winId: %d) => %j', currWindow.webContents.id, lastContent);

                cb(lastContent);
            },

            evaluateScript: function (script, cb) {
                Logger.debug('evaluateScript(%s) (winId: %d)', script, currWindow.webContents.id);

                if (currWindow.webContents.isWaitingForResponse()) {
                    Logger.warn('Window is currently waiting for a response; script execution may fail.');
                }

                executeResponse = null;

                try {
                    global.setWindowUnloading(false);

                    currWindow.webContents
                        .executeJavaScript(script, true)
                        .then(function (result) {
                            if (result !== global.DELAY_SCRIPT_RESPONSE) {
                                Logger.debug('Evaluated script with result: %j', result);
                                executeResponse = {'result': result};
                            } else {
                                Logger.debug('Evaluated script with delayed response.');
                            }
                        })
                        .catch(function (error) {
                            Logger.error('Script evaluation failed: %s', errorToString(error));
                            executeResponse = {'error': errorToString(error)};
                        });
                } catch (error) {
                    Logger.error('Script evaluation failed prematurely: %s', errorToString(error));
                    executeResponse = {'error': errorToString(error)};
                }

                cb();
            },

            getExecutionResponse: function (cb) {
                if (executeResponse) {
                    executeResponse['redirect'] = windowWillUnload;
                }

                Logger.debug('getExecutionResponse() => %j', executeResponse);

                cb(executeResponse);
            },

            getScreenshot: function (cb) {
                Logger.debug('getScreenshot()');

                screenshotResponse = null;

                const origBounds = currWindow.getBounds();

                currWindow.webContents
                    .executeJavaScript('({' +
                        'x: 0, y: 0,' +
                        'width: document.body.scrollWidth + (window.outerWidth - window.innerWidth),' +
                        'height: document.body.scrollHeight + (window.outerHeight - window.innerHeight)' +
                        '})', false, function (tempSize) {
                        currWindow.setBounds(tempSize, false);

                        const tryTakingScreenshot = function (tries) {
                            setTimeout(function () {
                                currWindow.capturePage(
                                    function (image) {
                                        const data = image.toPNG().toString('base64');

                                        if (data) {
                                            screenshotResponse = {'base64data': data};
                                            currWindow.setBounds(origBounds, false);
                                        } else if (tries > 0) {
                                            Logger.warn('Failed to take screen shot, trying again (try %d).', tries);
                                            tryTakingScreenshot(tries - 1);
                                        } else {
                                            screenshotResponse = {'error': 'Gave up trying to take screen shot after several tries.'};
                                            currWindow.setBounds(origBounds, false);
                                        }
                                    }
                                );
                            }, 200);
                        };

                        tryTakingScreenshot(5);
                    });

                cb();
            },

            getScreenshotResponse: function (cb) {
                const b64key = 'base64data',
                    b64Len = (screenshotResponse && screenshotResponse[b64key]) ? screenshotResponse[b64key].length : 0,
                    maxData = 2000,
                    logData = b64Len > maxData
                        ? {'base64data': screenshotResponse[b64key].substr(0, maxData) + '[trimmed ' + (b64Len - maxData) + ' chars]'}
                        : screenshotResponse;

                Logger.debug('getScreenshotResponse() => %j', logData);

                cb(screenshotResponse);
            },

            getWindowNames: function (cb) {
                const windowNames = Object.values(windowIdNameMap);

                Logger.debug('getWindowNames() => %j', windowNames);

                cb(windowNames);
            },

            resizeWindow: function (width, height, name, cb) {
                Logger.debug('resizeWindow(%s, %s, %j)', width, height, name);

                findWindowByName(name).setSize(width, height, false);

                cb();
            },

            maximizeWindow: function (name, cb) {
                Logger.debug('maximizeWindow(%j)', name);

                findWindowByName(name).maximize();

                cb();
            },

            attachFile: function (xpath, path, cb) {
                Logger.debug('attachFile(%j, %j)', xpath, path);

                executeResponse = null;

                /* Unfortunately, electron doesn't expose an easy way to set a file input element's file, and we can't
                 * do it from plain JS due to security restrictions. The solution is a to use RemoteDebug API as
                 * described here: https://github.com/electron/electron/issues/749 (which requires attaching a debugger).
                 */

                withElementByXpath(
                    currWindow.webContents,
                    xpath,
                    function (element, onDone) {
                        currWindow.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
                            nodeId: element.nodeId,
                            files: [path]
                        }, function (error) {
                            if (isEmptyObject(error)) {
                                onDone()
                                    .then(function () {
                                        currWindow.webContents
                                            .executeJavaScript('Electron.syn.trigger(' + element.jsElementVarName + ', "change", {});')
                                            .then(function () {
                                                Logger.info('File was attached to input field successfully.');
                                                executeResponse = {'result': true};
                                            })
                                            .catch(function (error) {
                                                Logger.error('Could not trigger change event: %s', errorToString(error));
                                                executeResponse = {'error': errorToString(error)};
                                            });
                                    })
                                    .catch(function (error) {
                                        Logger.error('Could not perform RemoteDebug cleanup: %s', errorToString(error));
                                        executeResponse = {'error': errorToString(error)};
                                    });
                            } else {
                                Logger.error('Could not attach file from RemoteDebug: %s', errorToString(error));
                                executeResponse = {'error': errorToString(error)};
                                onDone();
                            }
                        });
                    },
                    function (error, onDone) {
                        Logger.error('Could not attach file: %s', errorToString(error));
                        executeResponse = {'error': errorToString(error)};
                        onDone();
                    }
                );

                cb();
            },

            dispatchMouseEvent: function (params, cb) {
                Logger.debug('dispatchMouseEvent(%j)', params);

                executeResponse = null;

                currWindow.webContents.debugger.sendCommand(
                    'Input.dispatchMouseEvent',
                    params,
                    function (error) {
                        if (isEmptyObject(error)) {
                            executeResponse = {'result': true};
                        } else {
                            Logger.error('Could not dispatch mouse event (%j): %s', params, errorToString(error));
                            executeResponse = {'error': errorToString(error)};
                        }
                    }
                );

                cb();
            },

            shutdown: function (cb) {
                Logger.info('Server is shutting down...');

                setTimeout(
                    function () {
                        server.end();
                        process.exit();
                    },
                    10
                );

                cb();
            }
        },
        {
            'weak': false
        }
    );

    bindServerOnce = function() {
        let params = /(.*):(\d+)/.exec(process.argv[2]);
        if (params) {
            params = {
                host: params[1],
                port: params[2]
            };
        } else {
            params = {
                path: process.argv[2]
            };
        }

        server.listen(params);
    };

    /* This will trigger a chain of events that should eventually cause
     * bindServerOnce to be called and cleared (to avoid being called again).
     */
    mainWindow.loadURL('about:blank;');
});
