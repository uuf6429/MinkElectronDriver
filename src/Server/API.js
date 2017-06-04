'use strict';

module.exports = (function (Registry, Utils) {
    //noinspection JSUnusedGlobalSymbols
    const Electron = require('electron'),
        BrowserWindow = Electron.BrowserWindow,
        QueryString = require('querystring'),
        Logger = require('./Logger.js'),
        ResponseManager = require('./ResponseManager'),
        api = {
            reset: function () {
                Logger.info('Resetting page (clearing headers, session and auth).');

                Registry.hdrs = {};
                Registry.auth = {'user': false, 'pass': ''};
                Registry.currWindow = Registry.mainWindow;
                Registry.currWindowId = Registry.currWindow.webContents.id;
                BrowserWindow.getAllWindows().forEach(function (window) {
                    window.webContents.session.clearStorageData();
                    window.webContents.session.clearAuthCache({type: 'password'});
                });
            },

            clearVisitedResponse: function () {
                Logger.debug('clearVisitedResponse()');

                Registry.pageVisited = null;
                Registry.captureResponse = true;
                ResponseManager.remove(Registry.currWindow.webContents.id);
            },

            visit: function (url) {
                let extraHeaders = '';
                for (let key in Registry.hdrs) {
                    if (Registry.hdrs.hasOwnProperty(key)) {
                        extraHeaders += key + ': ' + Registry.hdrs[key] + '\n';
                    }
                }

                Logger.debug('visit(%j) (winId: %d, extraHeaders: %s)', url, Registry.currWindow.webContents.id, extraHeaders.replace(/\n/g, '\\n') || 'none');

                Registry.currWindow.loadURL(url, {'extraHeaders': extraHeaders});
            },

            getVisitedResponse: function () {
                Logger.debug('getVisitedResponse() => %j', Registry.pageVisited);

                return Registry.pageVisited;
            },

            getCurrentUrl: function () {
                Logger.debug('getCurrentUrl() => %j', Registry.currWindow.webContents.getURL());

                return Registry.currWindow.webContents.getURL().toString();
            },

            reload: function () {
                Logger.debug('reload()');

                Registry.currWindow.webContents.reload();
            },

            back: function () {
                Logger.debug('back()');

                Registry.currWindow.webContents.goBack();
            },

            forward: function () {
                Logger.debug('forward()');

                Registry.currWindow.webContents.goForward();
            },

            setBasicAuth: function (user, pass) {
                Logger.debug('setBasicAuth(%j, %j)', user, pass);

                Registry.auth.user = user;
                Registry.auth.pass = pass;

                if (user === false) {
                    Registry.currWindow.webContents.session.clearAuthCache({type: 'password'});
                }
            },

            switchToWindow: function (name) {
                Logger.debug('switchToWindow(%j)', name);

                Registry.currWindow = name === null ? Registry.mainWindow : Utils.findWindowByName(name);
                Registry.currWindowId = Registry.currWindow.webContents.id;
            },

            switchToIFrame: function (name) {
                // TODO Currently blocked by https://github.com/electron/electron/issues/5115
            },

            setRequestHeader: function (name, value) {
                Logger.debug('setRequestHeader(%j, %j)', name, value);

                Registry.hdrs[name] = value;
            },

            getResponseHeaders: function () {
                const response = ResponseManager.get(Registry.currWindow.webContents.id);
                const lastHeaders = (response || {}).headers || null;

                Logger.debug('getResponseHeaders() (winId: %d) => %j', Registry.currWindow.webContents.id, lastHeaders);

                return lastHeaders;
            },

            setCookie: function (name, value) {
                Logger.debug('setCookie(%j, %j)', name, value);

                Registry.cookieResponse = null;

                if (value === null) {
                    Registry.currWindow.webContents.session.cookies.remove(
                        Registry.currWindow.webContents.getURL(),
                        name,
                        function (error) {
                            Registry.cookieResponse = {'set': !error, 'error': Utils.errorToString(error)};
                        }
                    );
                } else {
                    Registry.currWindow.webContents.session.cookies.set(
                        {
                            'url': Registry.currWindow.webContents.getURL(),
                            'name': name,
                            'value': QueryString.escape(value)
                        },
                        function (error) {
                            Registry.cookieResponse = {'set': !error, 'error': Utils.errorToString(error)};
                        }
                    );
                }
            },

            getCookie: function (name) {
                Logger.debug('getCookie(%j)', name);

                Registry.cookieResponse = null;

                Registry.currWindow.webContents.session.cookies.get(
                    {
                        'url': Registry.currWindow.webContents.getURL(),
                        'name': name
                    },
                    function (error, cookies) {
                        Registry.cookieResponse = {
                            'get': cookies.length ? QueryString.unescape(cookies[0].value) : null,
                            'error': Utils.errorToString(error)
                        };
                    }
                );
            },

            getCookies: function () {
                Logger.debug('getCookies()');

                Registry.cookieResponse = null;

                Registry.currWindow.webContents.session.cookies.get(
                    {
                        'url': Registry.currWindow.webContents.getURL()
                    },
                    function (error, cookies) {
                        Registry.cookieResponse = {
                            'all': cookies.map(function (cookie) {
                                cookie.value = QueryString.unescape(cookie.value);
                                return cookie;
                            }),
                            'error': Utils.errorToString(error)
                        };
                    }
                );
            },

            getCookieResponse: function () {
                Logger.debug('getCookieResponse() => %j', Registry.cookieResponse);

                return Registry.cookieResponse;
            },

            getStatusCode: function () {
                const response = ResponseManager.get(Registry.currWindow.webContents.id);
                const lastStatus = (response || {}).status || null;

                Logger.debug('getStatusCode() (winId: %d) => %s', Registry.currWindow.webContents.id, lastStatus);

                return lastStatus;
            },

            getContent: function () {
                const response = ResponseManager.get(Registry.currWindow.webContents.id);
                const lastContent = {content: ((response || {}).content || null)};

                Logger.debug('getContent() (winId: %d) => %j', Registry.currWindow.webContents.id, lastContent);

                return lastContent;
            },

            evaluateScript: function (script) {
                Logger.debug('evaluateScript(%s) (winId: %d)', script, Registry.currWindow.webContents.id);

                if (Registry.currWindow.webContents.isWaitingForResponse()) {
                    Logger.warn('Window is currently waiting for a response; script execution may fail.');
                }

                Registry.executeResponse = null;

                try {
                    global.setWindowUnloading(false);

                    Registry.currWindow.webContents
                        .executeJavaScript(script, true)
                        .then(function (result) {
                            if (result !== global.DELAY_SCRIPT_RESPONSE) {
                                Logger.debug('Evaluated script with result: %j', result);
                                Registry.executeResponse = {'result': result};
                            } else {
                                Logger.debug('Evaluated script with delayed response.');
                            }
                        })
                        .catch(function (error) {
                            Logger.error('Script evaluation failed: %s', Utils.errorToString(error));
                            Registry.executeResponse = {'error': Utils.errorToString(error)};
                        });
                } catch (error) {
                    Logger.error('Script evaluation failed prematurely: %s', Utils.errorToString(error));
                    Registry.executeResponse = {'error': Utils.errorToString(error)};
                }
            },

            getExecutionResponse: function () {
                if (Registry.executeResponse) {
                    Registry.executeResponse['redirect'] = Registry.windowWillUnload;
                }

                Logger.debug('getExecutionResponse() => %j', Registry.executeResponse);

                return Registry.executeResponse;
            },

            getScreenshot: function () {
                Logger.debug('getScreenshot()');

                Registry.screenshotResponse = null;

                const origBounds = Registry.currWindow.getBounds();

                Registry.currWindow.webContents
                    .executeJavaScript('Electron.getCanvasBounds()', false, function (tempSize) {
                        Registry.currWindow.setBounds(tempSize, false);

                        const tryTakingScreenshot = function (tries) {
                            setTimeout(function () {
                                Registry.currWindow.capturePage(
                                    function (image) {
                                        const data = image.toPNG().toString('base64');

                                        if (data) {
                                            Registry.screenshotResponse = {'base64data': data};
                                            Registry.currWindow.setBounds(origBounds, false);
                                        } else if (tries > 0) {
                                            Logger.warn('Failed to take screen shot, trying again (try %d).', tries);
                                            tryTakingScreenshot(tries - 1);
                                        } else {
                                            Registry.screenshotResponse = {'error': 'Gave up trying to take screen shot after several tries.'};
                                            Registry.currWindow.setBounds(origBounds, false);
                                        }
                                    }
                                );
                            }, 200);
                        };

                        tryTakingScreenshot(5);
                    })
                    .catch(function (error) {
                        Logger.error('Could not retrieve canvas bounds: %s', Utils.errorToString(error));
                        Registry.screenshotResponse = {'error': 'Could not retrieve canvas bounds.'};
                        Registry.currWindow.setBounds(origBounds, false);
                    });
            },

            getScreenshotResponse: function () {
                const b64key = 'base64data',
                    b64Len = (Registry.screenshotResponse && Registry.screenshotResponse[b64key]) ? Registry.screenshotResponse[b64key].length : 0,
                    maxData = 2000,
                    logData = b64Len > maxData
                        ? {'base64data': Registry.screenshotResponse[b64key].substr(0, maxData) + '[trimmed ' + (b64Len - maxData) + ' chars]'}
                        : Registry.screenshotResponse;

                Logger.debug('getScreenshotResponse() => %j', logData);

                return Registry.screenshotResponse;
            },

            getWindowNames: function () {
                const windowNames = Object.values(Registry.windowIdNameMap);

                Logger.debug('getWindowNames() => %j', windowNames);

                return windowNames;
            },

            resizeWindow: function (width, height, name) {
                Logger.debug('resizeWindow(%s, %s, %j)', width, height, name);

                Utils.findWindowByName(name).setSize(width, height, false);
            },

            maximizeWindow: function (name) {
                Logger.debug('maximizeWindow(%j)', name);

                Utils.findWindowByName(name).maximize();
            },

            attachFile: function (xpath, path) {
                Logger.debug('attachFile(%j, %j)', xpath, path);

                Registry.executeResponse = null;

                /* Unfortunately, electron doesn't expose an easy way to set a file input element's file, and we can't
                 * do it from plain JS due to security restrictions. The solution is a to use RemoteDebug API as
                 * described here: https://github.com/electron/electron/issues/749 (which requires attaching a debugger).
                 */

                Utils.withElementByXpath(
                    Registry.currWindow.webContents,
                    xpath,
                    function (element, onDone) {
                        Registry.currWindow.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
                            nodeId: element.nodeId,
                            files: [path]
                        }, function (error) {
                            if (Utils.isEmptyObject(error)) {
                                onDone()
                                    .then(function () {
                                        Registry.currWindow.webContents
                                            .executeJavaScript('Electron.syn.trigger(' + element.jsElementVarName + ', "change", {});')
                                            .then(function () {
                                                Logger.info('File was attached to input field successfully.');
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
                                Logger.error('Could not attach file from RemoteDebug: %s', Utils.errorToString(error));
                                Registry.executeResponse = {'error': Utils.errorToString(error)};
                                onDone();
                            }
                        });
                    },
                    function (error, onDone) {
                        Logger.error('Could not attach file: %s', Utils.errorToString(error));
                        Registry.executeResponse = {'error': Utils.errorToString(error)};
                        onDone();
                    }
                );
            },

            dispatchMouseEvent: function (params) {
                Logger.debug('dispatchMouseEvent(%j)', params);

                Registry.executeResponse = null;

                Registry.currWindow.webContents.debugger.sendCommand(
                    'Input.dispatchMouseEvent',
                    params,
                    function (error) {
                        if (Utils.isEmptyObject(error)) {
                            Registry.executeResponse = {'result': true};
                        } else {
                            Logger.error('Could not dispatch mouse event (%j): %s', params, Utils.errorToString(error));
                            Registry.executeResponse = {'error': Utils.errorToString(error)};
                        }
                    }
                );
            },

            shutdown: function () {
                Logger.info('Server is shutting down...');

                setTimeout(
                    function () {
                        Registry.stopServer();
                        process.exit();
                    },
                    10
                );
            }
        };

    return new Proxy(api, {
        has: function (target, property) {
            return target[property] !== undefined;
        },
        get: function (target, property) {
            if (target[property] === undefined) {
                if (typeof property !== 'symbol') {
                    throw new Error('API does not supported method "' + property + '".');
                } else {
                    // if property is a symbol, ignore it
                }
            } else {
                return function () {
                    const args = [].slice.call(arguments),
                        cbfunc = args.pop(),
                        result = target[property].apply(target, args);

                    (result === undefined) ? cbfunc() : cbfunc.apply(target, [result]);
                };
            }
        }
    });
});
