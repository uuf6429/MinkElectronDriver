if (process.argv.length < 3
    || process.argv.length > 4
    || !process.versions['electron']
) {
    throw('Correct usage is: electron ElectronServer.js <port> [debug]');
}

const Electron = require('electron');
const DNode = require('dnode');

var debug = process.argv[3] === 'debug';

Electron.app.on('ready', function(){
    var window = new Electron.BrowserWindow({show: debug});
    var pageVisited = false;
    var setupPageVisited = function () {
        pageVisited = false;
        window.webContents.once('did-finish-load', function () {
            pageVisited = true;
            console.log('Loaded');
        });
    };

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
            }
        }
    );

    server.listen(parseInt(process.argv[2]));
});
