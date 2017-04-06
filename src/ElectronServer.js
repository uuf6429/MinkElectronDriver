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
    QueryString = require('querystring'),
    Logger = require('./Logger.js'),
    UuidV4 = require('uuid/v4'),
    ResponseManager = {
        responses: {},
        create: function () {
            var id = UuidV4();

            this.responses[id] = {payload: null, id: id, created: Date.now()};

            return id;
        },
        get: function (id) {
            if (this.responses[id] === undefined) {
                throw new Error('Payload ' + id + ' does not exist (or has been consumed already).');
            }

            var data = this.responses[id].payload;

            if (data !== null) {
                delete this.responses[id];
            }

            return data;
        },
        set: function (id, payload) {
            if (payload === null) {
                throw new Error('Data for payload ' + id + ' cannot be set to null.');
            }

            if (this.responses[id].payload !== null) {
                throw new Error('Data for payload ' + id + ' has already been set.');
            }

            this.responses[id].payload = payload;
        }
    };

var showWindow = process.argv[3] === 'show';
Logger.LogLevel = process.argv[4] || Logger.WARNING;

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

    /**
     * @param obj
     * @returns {boolean}
     */
    var isEmptyObject = function (obj) {
        return Object.keys(obj).length === 0 && obj.constructor === Object;
    };

    var mainWindow = new BrowserWindow(setupWindowOptions({})),
        currWindow = mainWindow,
        pageVisited = null,
        hdrs = {},
        auth = {'user': false, 'pass': null},
        executeResponse = null,
        cookieResponse = null,
        screenshotResponse = null,
        windowWillUnload = false,
        windowIdNameMap = {},
        captureResponse = false,
        lastResponses = {};

    global.newWindowName = '';
    global.DELAY_SCRIPT_RESPONSE = '{%DelayElectronScriptResponse%}';

    /**
     * Sets the executeResponse value to the passed error.
     * @param {Error} error
     */
    global.setExecutionError = function (error) {
        Logger.error('Script evaluation failed internally: %s', (error ? (error.stack || error) : '').toString());
        executeResponse = {'error': (error ? (error.stack || error) : '').toString()};
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
     *
     * @param {?integer} id
     * @param {string} name
     * @param {string} url
     */
    global.setWindowIdName = function (id, name, url) {
        var sId = id === null ? "" : id.toString();

        if (name === null) {
            Logger.info('Unlinked window named "%s" from id "%s" for %s.', name, sId, url);
            if (windowIdNameMap[sId]) delete windowIdNameMap[sId];
        } else {
            Logger.info('Linked window named "%s" with id "%s" for %s.', name, sId, url);
            windowIdNameMap[sId] = name;
        }
    };

    /**
     * Finds window by its window name. Note that this depends on the windows successfully registering it's id and name
     * when created. Since we keep these details in a hash map, we need to be careful about keeping it up to date.
     * @param {string} name
     * @returns {Electron.BrowserWindow}
     */
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

    /**
     * Runs some code for an element retrieved from RemoteDebug with an XPath query.
     * It involves a hack: since RD does not support querying via XPath, we assign a random element id and use it
     * to find the element via RD. Afterwards, we restore the original element id (if there was any).
     * @param {Electron.BrowserWindow} window
     * @param {string} xpath
     * @param {function(element,function())} onSuccess
     * @param {function(Error,function())} onFailure
     */
    var withElementByXpath = function (window, xpath, onSuccess, onFailure) {
        var jsElementVarName = 'Electron.tmpElement';
        var randomElementId = 'electronElement' + Math.round(Math.random() * 100000);
        var restoreElementId = function () {
            return currWindow.webContents.executeJavaScript(jsElementVarName + '.id = Electron.tmpOldElementId;');
        };

        currWindow.webContents
            .executeJavaScript(
                'var xpath = ' + JSON.stringify(xpath) + ';\
                ' + jsElementVarName + ' = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;\
                if (!' + jsElementVarName + ') throw new Error("Could not find find element for XPath: " + xpath);\
                Electron.tmpOldElementId = ' + jsElementVarName + '.id;\
                ' + jsElementVarName + '.id = ' + JSON.stringify(randomElementId) + ';'
            )
            .then(function () {
                currWindow.webContents.debugger.sendCommand('DOM.getDocument', {}, function (error, res) {
                    if (!isEmptyObject(error)) {
                        var msg = 'Could not get document from RemoteDebug: ' + (error ? (error.stack || error) : '').toString();
                        onFailure(new Error(msg), restoreElementId);
                        return;
                    }

                    currWindow.webContents.debugger.sendCommand('DOM.querySelector', {
                        nodeId: res.root.nodeId,
                        selector: '#' + randomElementId
                    }, function (error, res) {
                        if (isEmptyObject(error)) {
                            res.jsElementVarName = jsElementVarName;
                            onSuccess(res, restoreElementId);
                        } else {
                            var msg = 'Could not query document from RemoteDebug: ' + (error ? (error.stack || error) : '').toString();
                            onFailure(new Error(msg), restoreElementId);
                        }
                    });
                });
            })
            .catch(function (error) {
                var msg = 'Could not query document from RemoteDebug: ' + (error ? (error.stack || error) : '').toString();
                onFailure(new Error(msg), function () {});
            });
    };

    global.setFileFromScript = function (windowId, xpath, value) {
        Logger.debug('setFileFromScript(%j, %j, %j)', windowId, xpath, value);

        executeResponse = null;
        var window = BrowserWindow.fromId(parseInt(windowId));
        withElementByXpath(
            window,
            xpath,
            function (element, onDone) {
                window.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
                    nodeId: element.nodeId,
                    files: [value]
                }, function (error) {
                    if (isEmptyObject(error)) {
                        onDone()
                            .then(function(){
                                window.webContents
                                    .executeJavaScript('Electron.syn.trigger(' + element.jsElementVarName + ', "change", {});')
                                    .then(function () {
                                        Logger.info('Value of file input field set successfully successfully.');
                                        executeResponse = {'result': true};
                                    })
                                    .catch(function (error) {
                                        Logger.error('Could trigger change event: %s', (error ? (error.stack || error) : '').toString());
                                        executeResponse = {'error': (error ? (error.stack || error) : '').toString()};
                                    });
                            })
                            .catch(function (error) {
                                Logger.error('Could perform RemoteDebug cleanup: %s', (error ? (error.stack || error) : '').toString());
                                executeResponse = {'error': (error ? (error.stack || error) : '').toString()};
                            });
                    } else {
                        Logger.error('Could not set file value from RemoteDebug: %s', (error ? (error.stack || error) : '').toString());
                        executeResponse = {'error': (error ? (error.stack || error) : '').toString()};
                        onDone();
                    }
                });
            },
            function (error, onDone) {
                Logger.error('Could not set file field value: %s', (error ? (error.stack || error) : '').toString());
                executeResponse = {'error': (error ? (error.stack || error) : '').toString()};
                onDone();
            }
        );
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
                .on('new-window', function (event, url, frameName, disposition, options) {
                    Logger.info('Creating window "%s" for url "%s".', frameName, url);
                    global.setWindowUnloading(true);
                    global.newWindowName = frameName;
                    setupWindowOptions(options);
                })
                .on('closed', function () {
                    Logger.info('Window "%s" (id %d) has been closed.', windowIdNameMap[window.id] || '', window.id);
                    delete windowIdNameMap[window.id];
                    delete lastResponses[window.id];
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
                    Logger.critical('Renderer process %s.', killed ? 'was killed' : 'has crashed');
                })
                .on('plugin-crashed', function (event, name, version) {
                    Logger.critical('Plugin "%s" (version %s) crashed.', name, version);
                })
            ;

            var getDecodedBody = function (response) {
                if (!response['base64Encoded']) {
                    return response.body;
                }

                if (typeof Buffer.from === 'function') {
                    return Buffer.from(response.body, 'base64').toString();
                } else {
                    return new Buffer(response.body, 'base64').toString();
                }
            };

            try {
                window.webContents.debugger.attach('1.2');

                window.webContents.debugger.on('message', function (event, message, params) {
                    if (captureResponse && message === 'Network.responseReceived' && params.type === 'Document') {
                        window.webContents.debugger.sendCommand(
                            'Network.getResponseBody',
                            {'requestId': params.requestId},
                            function (_, response) {
                                lastResponses[window.id] = {
                                    url: params.response.url,
                                    status: params.response.status,
                                    statusText: params.response.statusText,
                                    headers: params.response.headers,
                                    content: getDecodedBody(response)
                                };

                                Logger.debug('Last response for window %s set to: %j', window.id, lastResponses[window.id]);
                            }
                        );

                        captureResponse = false;
                    } else {
                        Logger.debug('Discarded "%s" event with params: %j', message, params);
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

            visit: function (url, cb) {
                Logger.info('Navigating to url: %s.', url);

                hdrs = {};
                auth = {'user': false, 'pass': ''};

                BrowserWindow.getAllWindows().forEach(function (window) {
                    window.webContents.session.clearStorageData();
                    window.webContents.session.clearAuthCache({type: 'password'});
                });

                cb();
            },

            getPayload: function(payload_id, cb) {
                var response = {};

                try {
                    response.payload = ResponseManager.get(payload_id);
                } catch (error) {
                    response.error = (error ? (error.stack || error) : '').toString();
                }

                // TODO also add redirect?

                Logger.debug('getPayload(%j) => %j', payload_id, response);

                cb(response);
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
