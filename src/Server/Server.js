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
    Logger = require('./Logger.js'),
    ResponseManager = require('./ResponseManager.js');

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
    const Registry = {
            mainWindow: null,
            currWindow: null,
            currWindowId: null,
            pageVisited: null,
            hdrs: {},
            auth: {'user': false, 'pass': null},
            executeResponse: null,
            cookieResponse: null,
            screenshotResponse: null,
            windowWillUnload: false,
            /** @type {Object.<string, string>} */
            windowIdNameMap: {},
            captureResponse: false,
            bindServerOnce: null,
            stopServer: null
        },
        Utils = {
            /**
             * @param {Object} options
             * @returns {Object}
             */
            setupWindowOptions: function (options) {
                options.show = showWindow;

                options.x = 0;
                options.y = 0;
                options.enableLargerThanScreen = true;

                options.webPreferences = options.webPreferences || {};
                options.webPreferences.devTools = showWindow;
                options.webPreferences.nodeIntegration = false;
                options.webPreferences.preload = Path.resolve(__dirname, 'Preload.js');

                return options;
            },

            /**
             * @param {Object} obj
             * @returns {boolean}
             */
            isEmptyObject: function (obj) {
                return Object.keys(obj).length === 0 && obj.constructor === Object;
            },

            /**
             * Attempts to serialize an error to a string with as much information as possible.
             * @param {Object} error
             * @returns {String}
             */
            errorToString: function (error) {
                if (!error) {
                    return '';
                }

                let result = (error.stack || error).toString();

                if (result === '[object Object]') {
                    result = JSON.stringify(error);
                }

                return result;
            },

            /**
             * Finds window by its window name. Note that this depends on the windows successfully registering it's id and name
             * when created. Since we keep these details in a hash map, we need to be careful about keeping it up to date.
             * @param {string} name
             * @returns {Electron.BrowserWindow}
             */
            findWindowByName: function (name) {
                const result = [];

                if (name === 'current' || name === null) {
                    return Registry.currWindow;
                }

                for (let id in Registry.windowIdNameMap) {
                    if (Registry.windowIdNameMap.hasOwnProperty(id) && Registry.windowIdNameMap[id] === name) {
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
            },

            /**
             * Runs some code for an element retrieved from RemoteDebug with an XPath query.
             * It involves a hack: since RD does not support querying via XPath, we assign a random element id and use it
             * to find the element via RD. Afterwards, we restore the original element id (if there was any).
             * @param {Electron.WebContents} webContents
             * @param {string} xpath
             * @param {function(element,function())} onSuccess
             * @param {function(Error,function())} onFailure
             */
            withElementByXpath: function (webContents, xpath, onSuccess, onFailure) {
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
                            if (!Utils.isEmptyObject(error)) {
                                const msg = 'Could not get document from RemoteDebug: ' + Utils.errorToString(error);
                                onFailure(new Error(msg), restoreElementId);
                                return;
                            }

                            webContents.debugger.sendCommand('DOM.querySelector', {
                                nodeId: res.root.nodeId,
                                selector: '#' + randomElementId
                            }, function (error, res) {
                                if (Utils.isEmptyObject(error)) {
                                    res.jsElementVarName = jsElementVarName;
                                    onSuccess(res, restoreElementId);
                                } else {
                                    const msg = 'Could not query document from RemoteDebug: ' + Utils.errorToString(error);
                                    onFailure(new Error(msg), restoreElementId);
                                }
                            });
                        });
                    })
                    .catch(function (error) {
                        const msg = 'Could not query document from RemoteDebug: ' + Utils.errorToString(error);
                        onFailure(new Error(msg), function () {
                        });
                    });
            },

            /**
             * @param {Electron.Debugger} dbg
             * @param {Object} responseParams
             * @param {String|Number} frameId
             * @param {Integer} maxTries
             * @param {Integer} [currTry]
             */
            retrieveDebuggerResponseBody: function (dbg, responseParams, frameId, maxTries, currTry) {
                currTry = currTry || 1;

                dbg.sendCommand(
                    'Network.getResponseBody',
                    {'requestId': responseParams.requestId},
                    function (error, response) {
                        if (Utils.isEmptyObject(error)) {
                            ResponseManager.set(frameId, responseParams.response, response);
                        } else if (currTry <= maxTries) {
                            Logger.notice('Could not retrieve response body (try %d of %d): %s', currTry, maxTries, Utils.errorToString(error));
                            setTimeout(
                                function () {
                                    Utils.retrieveDebuggerResponseBody(dbg, responseParams, frameId, maxTries, currTry + 1);
                                },
                                5
                            );
                        } else {
                            Logger.error('Could not retrieve response body after %d tries: %s, response meta: %j', maxTries, Utils.errorToString(error), responseParams);
                        }
                    }
                );
            }
        };

    global.newWindowName = '';
    global.DELAY_SCRIPT_RESPONSE = '{%DelayElectronScriptResponse%}';

    /**
     * Sets the executeResponse value to the passed error.
     * @param {Error} error
     */
    global.setExecutionError = function (error) {
        Logger.error('Script evaluation failed internally: %s', Utils.errorToString(error));

        Registry.executeResponse = {'error': Utils.errorToString(error)};
    };

    /**
     * Sets flag indicating that something caused the current page to start unloading.
     * @param {boolean} value
     */
    global.setWindowUnloading = function (value) {
        if (value) {
            Logger.info('Page is unloading.');

            Registry.pageVisited = null;
            Registry.captureResponse = true;
        } else {
            Logger.debug('Page unload flag cleared.');
        }

        Registry.windowWillUnload = value;
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
            if (Registry.windowIdNameMap[sId]) delete Registry.windowIdNameMap[sId];
        } else {
            Logger.info('Linked window named %j with id %j for %j.', name, sId, url);
            Registry.windowIdNameMap[sId] = name;
        }
    };

    /**
     * Returns window name given electron id.
     * @param {Number} id
     * @returns {String|null}
     */
    global.getWindowNameFromId = function (id) {
        const sId = id === null ? "" : id.toString();

        if (!Registry.windowIdNameMap[sId] && !Electron.BrowserWindow.fromId(id)) {
            Logger.warn('Cannot retrieve name of window %j since window is not created yet.', id);
        }

        return Registry.windowIdNameMap[sId] || null;
    };

    /**
     * Returns if window name has ever been set for a particular id.
     * @param {Number} id
     * @return {Boolean}
     */
    global.isWindowNameSet = function (id) {
        const sId = id === null ? "" : id.toString();

        return sId !== '' && typeof(Registry.windowIdNameMap[sId]) !== 'undefined';
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
            Registry.executeResponse = null;
            const webContents = Electron.webContents.fromId(parseInt(webContentId));

            Utils.withElementByXpath(
                webContents,
                xpath,
                function (element, onDone) {
                    webContents.debugger.sendCommand('DOM.setFileInputFiles', {
                        nodeId: element.nodeId,
                        files: [value]
                    }, function (error) {
                        if (Utils.isEmptyObject(error)) {
                            onDone()
                                .then(function () {
                                    webContents
                                        .executeJavaScript('Electron.syn.trigger(' + element.jsElementVarName + ', "change", {});')
                                        .then(function () {
                                            Logger.info('Value of file input field set successfully successfully.');
                                            Registry.executeResponse = {'result': true};
                                        })
                                        .catch(function (error) {
                                            Logger.error('Could not trigger change event: %s', Utils.errorToString(error));
                                            Registry.executeResponse = {'error': Utils.errorToString(error)};
                                        });
                                })
                                .catch(function (error) {
                                    Logger.error('Could not perform RemoteDebug cleanup: %s', Utils.errorToString(error));
                                    Registry.executeResponse = {'error': Utils.errorToString(error)};
                                });
                        } else {
                            Logger.error('Could not set file value from RemoteDebug: %s', Utils.errorToString(error));
                            Registry.executeResponse = {'error': Utils.errorToString(error)};
                            onDone();
                        }
                    });
                },
                function (error, onDone) {
                    Logger.error('Could not set file field value: %s', Utils.errorToString(error));
                    Registry.executeResponse = {'error': Utils.errorToString(error)};
                    onDone();
                }
            );
        } catch (error) {
            Logger.error('Global method "setFileFromScript" failed: %s', Utils.errorToString(error));
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
                    Logger.info('Window "%s" (id %j) has been closed.', Registry.windowIdNameMap[windowId.toString()] || '', windowId);

                    if (windowId === Registry.currWindowId) {
                        Registry.pageVisited = true;
                        Registry.captureResponse = false;
                    }

                    delete Registry.windowIdNameMap[windowId.toString()];
                    ResponseManager.remove(windowId);
                })
            ;

            window.webContents
                .on('login', function (event, request, authInfo, callback) {
                    if (Registry.auth.user !== false) {
                        event.preventDefault();
                        callback(Registry.auth.user, Registry.auth.pass);
                    }
                })
                .on('new-window', function (event, url, frameName, disposition, options) {
                    Logger.info('Creating window "%s" for url "%s".', frameName, url);
                    global.setWindowUnloading(true);
                    global.newWindowName = frameName;
                    Utils.setupWindowOptions(options);
                })
                .on('will-navigate', function (event, url) {
                    Logger.debug('Event "will-navigate" triggered for url %j.', url);
                    global.setWindowUnloading(true);
                })
                .on('did-finish-load', function () {
                    if (Registry.bindServerOnce) {
                        Logger.info('Main page loaded, binding sever...');
                        Registry.bindServerOnce();
                        Registry.bindServerOnce = null;
                    } else {
                        Logger.info('Page finished loading.');
                        Registry.pageVisited = true;
                    }
                })
                .on('did-fail-load', function (event, errorCode, errorDescription, validatedURL, isMainFrame) {
                    Logger.warn('Page failed to load (error %s): %s (validatedURL: "%s", isMainFrame: %s).', errorCode, errorDescription, validatedURL, isMainFrame ? 'yes' : 'no');
                    Registry.pageVisited = true;
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
                    if (Registry.captureResponse && message === 'Network.responseReceived' && params.type === 'Document') {
                        Utils.retrieveDebuggerResponseBody(window.webContents.debugger, params, window.webContents.id, 10);
                        Registry.captureResponse = false;
                    } else {
                        Logger.debug('Discarded "%s" event.', message);
                    }
                });

                window.webContents.debugger.sendCommand('Network.enable');
            } catch (error) {
                Logger.error('Could not attach debugger: %s', Utils.errorToString(error));
            }
        }
    );

    Registry.mainWindow = new BrowserWindow(Utils.setupWindowOptions({}));
    Registry.currWindow = Registry.mainWindow;
    Registry.currWindowId = Registry.currWindow.webContents.id;

    Logger.info('Starting up server...');

    //noinspection JSUnusedGlobalSymbols
    const Server = DNode(require('./API.js')(Registry, Utils), {'weak': false});

    Registry.bindServerOnce = function () {
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

        Server.listen(params);
    };

    Registry.stopServer = function(){
        Server.end();
    };

    /* This will trigger a chain of events that should eventually cause
     * bindServerOnce to be called and cleared (to avoid being called again).
     */
    Registry.mainWindow.loadURL('about:blank;');
});
