if (process.argv.length < 3
    || process.argv.length > 4
    || !process.versions['electron']
) {
    throw('Correct usage is: electron ElectronServer.js <host:port> [debug]');
}

process.on('uncaughtException', function (err) {
    console.error(err);
});

const Electron = require('electron'),
    BrowserWindow = Electron.BrowserWindow,
    DNode = require('dnode'),
    Temp = require('temp'),
    FS = require('fs')
;

var debug = process.argv[3] === 'debug';

Electron.app.on('ready', function() {
    var mainWindow = new BrowserWindow({'show': debug}),
        currWindow = mainWindow,
        pageVisited = false,
        hdrs = {},
        auth = {'user': false, 'pass': null},
        lastStatusCode = null,
        lastContentPath = null,
        lastContentSaved = null,
        lastHeaders = null,
        executeResponse = null,
        cookieResponse = null,
        /**
         * @param {Electron.BrowserWindow} window
         */
        setupPageVisited = function (window) {
            pageVisited = false;
            lastStatusCode = null;

            window.webContents.once('did-finish-load', function () {
                pageVisited = true;
                console.log('Loaded');
            });
        }
        ;

    Electron.app.on(
        'browser-window-created',
        /**
         * @param event
         * @param {Electron.BrowserWindow} window
         */
        function (event, window) {
            window.webContents
                .on('login', function (event, webContents, request, authInfo, callback) {
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
                if (debug) console.log('reset()');

                hdrs = {};
                auth = {'user': null, 'pass': ''};

                BrowserWindow.getAllWindows().forEach(function (window) {
                    window.webContents.session.clearStorageData();
                });

                cb();
            },

            visit: function (url, cb) {
                var extraHeaders = '';
                for (var key in hdrs)extraHeaders += key + ': ' + hdrs[key] + '\n';

                if (debug) console.log('visit(%s) (extraHeaders: %s)', url, extraHeaders.replace(/\n/g, '\\n'));

                setupPageVisited(currWindow);
                currWindow.loadURL(url, {'extraHeaders': extraHeaders});

                cb();
            },

            visited: function (cb) {
                if (debug) console.log('visited() => %s', pageVisited);

                cb(pageVisited);
            },

            getCurrentUrl: function (cb) {
                if (debug) console.log('getCurrentUrl() => %s', currWindow.webContents.getURL());

                cb(currWindow.webContents.getURL().toString());
            },

            reload: function (cb) {
                if (debug) console.log('reload()');

                setupPageVisited(currWindow);
                currWindow.webContents.reload();
                cb();
            },

            back: function (cb) {
                if (debug) console.log('back()');

                setupPageVisited(currWindow);
                currWindow.webContents.goBack();
                cb();
            },

            forward: function (cb) {
                if (debug) console.log('forward()');

                setupPageVisited(currWindow);
                currWindow.webContents.goForward();
                cb();
            },

            setBasicAuth: function (user, pass, cb) {
                if (debug) console.log('setBasicAuth(%s, %s)', user, pass);

                auth.user = user;
                auth.pass = pass;
                cb();
            },

            switchToWindow: function (name, cb) {
                if (debug) console.log('switchToWindow(%s)', parseInt(name));

                currWindow = name === null ? mainWindow : BrowserWindow.fromId(parseInt(name));
                cb();
            },

            switchToIFrame: function () {
                // TODO
            },

            setRequestHeader: function (name, value, cb) {
                if (debug) console.log('setRequestHeader(%s, %s)', name, value);

                hdrs[name] = value;

                cb();
            },

            getResponseHeaders: function (cb) {
                if (debug) console.log('getResponseHeaders() => %s', JSON.stringify(lastHeaders));

                cb(lastHeaders);
            },

            setCookie: function (name, value, cb) {
                if (debug) console.log('setCookie(%s, %s)', name, value);

                cookieResponse = null;
                currWindow.webContents.session.cookies.set( // TODO if value is null call remove cookie?
                    {
                        'url': currWindow.webContents.getURL(),
                        'name': name,
                        'value': value
                    },
                    function (error) {
                        cookieResponse = {'set': !error, 'error': (error || '').toString()};
                    }
                );

                cb();
            },

            getCookie: function (name, cb) {
                if (debug) console.log('getCookie(%s)', name);

                cookieResponse = null;
                currWindow.webContents.session.cookies.get(
                    {
                        'url': currWindow.webContents.getURL(),
                        'name': name
                    },
                    function (error, cookies) {
                        cookieResponse = {
                            'get': cookies.length ? cookies[0].value : null,
                            'error': (error || '').toString()
                        };
                    }
                );

                cb();
            },

            getCookieResponse: function (cb) {
                if (debug) console.log('getCookieResponse() => %s', cookieResponse);

                cb(cookieResponse);
            },

            getStatusCode: function (cb) {
                if (debug) console.log('getStatusCode() => %s', lastStatusCode);

                cb(lastStatusCode);
            },

            getContent: function (cb) {
                lastContentSaved = null;
                lastContentPath = Temp.path({'suffix': '.data'});
                var started = currWindow.webContents.savePage(lastContentPath, 'HTMLOnly', function (error) {
                    lastContentSaved = error || true;
                });

                if (debug) console.log('getContent() => %s (saving to %s)', started, lastContentPath);

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

                if (debug) console.log('getContentResponse() => %s (reading from %s)', lastContent, lastContentPath);

                cb(lastContent);
            },

            evaluateScript: function (script, cb) {
                if (debug) console.log('evaluateScript(%s)', script);

                executeResponse = null;

                currWindow.webContents
                    .executeJavaScript(script, true)
                    .then(function (result) {
                        executeResponse = {'result': result};
                    })
                    .catch(function (error) {
                        executeResponse = {'error': error.toString()};
                    })
                ;

                cb();
            },

            getEvaluateScriptResponse: function (cb) {
                if (debug) console.log('getEvaluateScriptResponse() => %s', executeResponse);

                cb(executeResponse);
            },

            getScreenshot: function () {
                // TODO
            },

            getWindowNames: function (cb) {
                var windowNames = BrowserWindow
                    .getAllWindows()
                    .map(function (win) {
                        return win.id.toString();
                    });

                if (debug) console.log('getWindowNames() => %s', windowNames);

                cb(windowNames);
            },

            getWindowName: function (cb) {
                if (debug) console.log('getWindowName() => %s', currWindow.id.toString());

                cb(currWindow.id.toString());
            },

            find: function () {
                // TODO
            },

            getTagName: function () {
                // TODO
            },

            getText: function () {
                // TODO
            },

            getHtml: function () {
                // TODO
            },

            getOuterHtml: function () {
                // TODO
            },

            getAttribute: function () {
                // TODO
            },

            getValue: function () {
                // TODO
            }
        }
    );

    var address = /(.*):(\d+)/.exec(process.argv[2]);
    server.listen(address[1], parseInt(address[2]));
});
