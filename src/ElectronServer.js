if (process.argv.length < 3
    || process.argv.length > 4
    || !process.versions['electron']
) {
    throw('Correct usage is: electron ElectronServer.js <port> [debug]');
}

process.on('uncaughtException', function (err) {
    console.error(err);
});

const Electron = require('electron'),
    DNode = require('dnode'),
    Temp = require('temp'),
    FS = require('fs')
;

var debug = process.argv[3] === 'debug';

Electron.app.on('ready', function(){
    var window = new Electron.BrowserWindow({'show': debug}),
        pageVisited = false,
        auth = {'user': false, 'pass': null},
        lastStatusCode = null,
        lastContentPath = null,
        lastContentSaved = null,
        executeResponse = null,
        cookieResponse = null,
        setupPageVisited = function () {
            pageVisited = false;
            lastStatusCode = null;

            window.webContents.once('did-finish-load', function () {
                pageVisited = true;
                console.log('Loaded');
            });
        }
    ;

    window.webContents
        .on('login', function(event, webContents, request, authInfo, callback) {
            if(auth.user !== false) {
                event.preventDefault();
                callback(auth.user, auth.pass);
            }
        })
        .on('did-get-response-details', function(event, status, newURL, originalURL, httpResponseCode, requestMethod, referrer, headers, resourceType) {
            lastStatusCode = httpResponseCode;
//            lastHeaders = headers;
            //apparently we can't get the last body :(
        })
    ;

    var server = DNode(
        {
            visit: function (url, cb) {
                if (debug) console.log('visit(%s)', url);

                setupPageVisited();
                window.loadURL(url);

                cb();
            },

            visited: function (cb) {
                if (debug) console.log('visited() => %s', pageVisited);

                cb(pageVisited);
            },

            getCurrentUrl: function (cb) {
                if (debug) console.log('getCurrentUrl() => %s', window.webContents.getURL());

                cb(window.webContents.getURL().toString());
            },

            reload: function (cb) {
                if (debug) console.log('reload()');

                setupPageVisited();
                window.webContents.reload();
                cb();
            },

            back: function (cb) {
                if (debug) console.log('back()');

                setupPageVisited();
                window.webContents.goBack();
                cb();
            },

            forward: function (cb) {
                if (debug) console.log('forward()');

                setupPageVisited();
                window.webContents.goForward();
                cb();
            },

            setBasicAuth: function (user, pass, cb) {
                if (debug) console.log('setBasicAuth(%s, %s)', user, pass);

                auth.user = user;
                auth.pass = pass;
                cb();
            },

            switchToWindow: function () {
                // TODO
            },

            switchToIFrame: function () {
                // TODO
            },

            setRequestHeader: function () {
                // TODO
            },

            getResponseHeaders: function () {
                // TODO
            },

            setCookie: function (name, value, cb) {
                if (debug) console.log('setCookie(%s, %s)', name, value);

                cookieResponse = null;
                window.webContents.session.cookies.set( // TODO if value is null call remove cookie?
                    {
                        'url': window.webContents.getURL(),
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
                window.webContents.session.cookies.get(
                    {
                        'url': window.webContents.getURL(),
                        'name': name
                    },
                    function (error, cookies) {
                        cookieResponse = {'get': cookies.length ? cookies[0].value : null, 'error': (error || '').toString()};
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
                var started = window.webContents.savePage(lastContentPath, 'HTMLOnly', function (error) {
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

                window.webContents
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

            getWindowNames: function () {
                // TODO
            },

            getWindowName: function () {
                // TODO
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

    server.listen(parseInt(process.argv[2]));
});
