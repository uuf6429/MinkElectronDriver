'use strict';

module.exports = (function (Registry, Utils) {
    //noinspection JSUnusedGlobalSymbols
    const Electron = require('electron'),
        BrowserWindow = Electron.BrowserWindow,
        QueryString = require('querystring'),
        Logger = require('./Logger.js'),
        ResponseManager = require('./ResponseManager'),
        api = {
            /**
             * Resets page custom headers, cookies and authentication.
             */
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

            /**
             * Clear navigation flag (ideally after `getVisitedResponse` returns a satisfactory result).
             */
            clearVisitedResponse: function () {
                Logger.debug('clearVisitedResponse()');

                Registry.pageVisited = null;
                Registry.captureResponse = true;
                ResponseManager.remove(Registry.currWindow.webContents.id);
            },

            /**
             * Navigate to a particular URL. Poll `getVisitedResponse` to know when navigation was completed.
             * @param {String} url
             */
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

            /**
             * Returns information about page navigation. If null, it usually means navigation is still in progress.
             * @returns {null|Boolean}
             */
            getVisitedResponse: function () {
                Logger.debug('getVisitedResponse() => %j', Registry.pageVisited);

                return Registry.pageVisited;
            },

            /**
             * Returns URL of the current window/frame.
             * @returns {String}
             */
            getCurrentUrl: function () {
                Logger.debug('getCurrentUrl() => %j', Registry.currWindow.webContents.getURL());

                return Registry.currWindow.webContents.getURL().toString();
            },

            /**
             * Reload the current window/frame. Poll `getVisitedResponse` to know when navigation was completed.
             */
            reload: function () {
                Logger.debug('reload()');

                Registry.currWindow.webContents.reload();
            },

            /**
             * Go to previous page of the current window/frame. Poll `getVisitedResponse` to know when navigation was completed.
             */
            back: function () {
                Logger.debug('back()');

                Registry.currWindow.webContents.goBack();
            },

            /**
             * Go to next page of the current window/frame. Poll `getVisitedResponse` to know when navigation was completed.
             */
            forward: function () {
                Logger.debug('forward()');

                Registry.currWindow.webContents.goForward();
            },

            /**
             * Set basic authentication for the following requests that might need it.
             * If `user` is false, authentication is cleared.
             * @param {String|Boolean} user
             * @param {String|Boolean} pass
             */
            setBasicAuth: function (user, pass) {
                Logger.debug('setBasicAuth(%j, %j)', user, pass);

                Registry.auth.user = user;
                Registry.auth.pass = pass;

                if (user === false) {
                    Registry.currWindow.webContents.session.clearAuthCache({type: 'password'});
                }
            },

            /**
             * Switch to window by its name. Switches to main window if `name` is `null`.
             * @param {String|null} name
             */
            switchToWindow: function (name) {
                Logger.debug('switchToWindow(%j)', name);

                Registry.currWindow = name === null ? Registry.mainWindow : Utils.findWindowByName(name);
                Registry.currWindowId = Registry.currWindow.webContents.id;
            },

            /**
             * Switch to frame by its name. Switches to main frame if `name` is `null`.
             * @param {String|null} name
             * @todo Currently blocked by https://github.com/electron/electron/issues/5115
             */
            switchToIFrame: function (name) {
            },

            /**
             * Set custom request header to be used for the following requests.
             * @param {String} name
             * @param {String} value
             */
            setRequestHeader: function (name, value) {
                Logger.debug('setRequestHeader(%j, %j)', name, value);

                Registry.hdrs[name] = value;
            },

            /**
             * Returns headers of the last response, or `null` if none available.
             * @returns {Object.<String, String>|null}
             */
            getResponseHeaders: function () {
                const response = ResponseManager.get(Registry.currWindow.webContents.id);
                const lastHeaders = (response || {}).headers || null;

                Logger.debug('getResponseHeaders() (winId: %d) => %j', Registry.currWindow.webContents.id, lastHeaders);

                return lastHeaders;
            },

            /**
             * Sets or clears, (when value is null), the value of a cookie.
             * @param {String} name
             * @param {String|null} value
             */
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

            /**
             * Starts a request to read details of a cookie.
             * @param {String} name
             */
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

            /**
             * Starts a request to read all cookies.
             */
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

            /**
             * Returns response for a getCookie(s) request, or null if not available yet.
             * @returns {null|{all, error: (*|String)}|*|{set: boolean, error: (*|String)}|{get: any, error: (*|String)}}
             */
            getCookieResponse: function () {
                Logger.debug('getCookieResponse() => %j', Registry.cookieResponse);

                return Registry.cookieResponse;
            },

            /**
             * Returns the status code of the last completed request.
             * @returns {Integer|null}
             */
            getStatusCode: function () {
                const response = ResponseManager.get(Registry.currWindow.webContents.id);
                const lastStatus = (response || {}).status || null;

                Logger.debug('getStatusCode() (winId: %d) => %s', Registry.currWindow.webContents.id, lastStatus);

                return lastStatus;
            },

            /**
             * Returns the body of the lat completed request.
             * @returns {{content: (String|null)}}
             */
            getContent: function () {
                const response = ResponseManager.get(Registry.currWindow.webContents.id);
                const lastContent = {content: ((response || {}).content || null)};

                Logger.debug('getContent() (winId: %d) => %j', Registry.currWindow.webContents.id, lastContent);

                return lastContent;
            },

            /**
             * Execute some JS code within the context of the current window or frame.
             * @param {String} script
             */
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

            /**
             * Returns response of the code executed in evaluateScript(), or null if not available yet.
             * @returns {null|{result: boolean}|*|{error: (*|String)}|{result: any}}
             */
            getExecutionResponse: function () {
                if (Registry.executeResponse) {
                    Registry.executeResponse['redirect'] = Registry.windowWillUnload;
                }

                Logger.debug('getExecutionResponse() => %j', Registry.executeResponse);

                return Registry.executeResponse;
            },

            /**
             * Starts a request to take a screen shot of the current window or frame.
             */
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

            /**
             * Returns the response of the last screen shot request, or null if not available yet.
             * @returns {{error: string}|*|{error: string}|null|{base64data: String}}
             */
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

            /**
             * Returns array of names of the currently open windows.
             * @returns {Array}
             */
            getWindowNames: function () {
                const windowNames = Object.values(Registry.windowIdNameMap);

                Logger.debug('getWindowNames() => %j', windowNames);

                return windowNames;
            },

            /**
             * Resizes a window given its name.
             * @param {Integer} width
             * @param {Integer} height
             * @param {String} name
             */
            resizeWindow: function (width, height, name) {
                Logger.debug('resizeWindow(%s, %s, %j)', width, height, name);

                Utils.findWindowByName(name).setSize(width, height, false);
            },

            /**
             * Maximizes a window given its name
             * @param {String} name
             */
            maximizeWindow: function (name) {
                Logger.debug('maximizeWindow(%j)', name);

                Utils.findWindowByName(name).maximize();
            },

            /**
             * Sets a file element's path.
             * @param {String} xpath
             * @param {String} path
             */
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
                            nodeId: element['nodeId'],
                            files: [path]
                        }, function (error) {
                            if (Utils.isEmptyObject(error)) {
                                onDone()
                                    .then(function () {
                                        Registry.currWindow.webContents
                                            .executeJavaScript('Electron.syn.trigger(' + element['jsElementVarName'] + ', "change", {});')
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

            /**
             * Sends mouse event to the current window.
             * @param {Object} params
             */
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

            /**
             * Shuts the server down gracefully (action is not immediate).
             */
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
