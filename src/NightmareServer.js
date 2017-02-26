if (process.argv.length != 3) {
    throw('Correct usage is: node NightmareServer.js <port>');
}

/*
var Nightmare = require('nightmare'),
    DNode = require('dnode');
require('nightmare-upload')(Nightmare);
require('nightmare-wait-for-url');

var nightmare = Nightmare(null),
    currentUrl = '';

nightmare
    .on('did-navigate', function (event, url) {
        currentUrl = url;
    });

var server = DNode({
    visit: function (url, cb) {
        nightmare
            .goto(url)
            .waitForUrl(url)
            .then(function () {
                cb();
            });
    },
    getCurrentUrl: function (cb) {
        cb(currentUrl.toString());
    }
});
server.listen(parseInt(process.argv[2]));
*/


const BrowserWindow = require('electron');
var window = new BrowserWindow({width: 800, height: 600});

var server = DNode({
    visit: function (url, cb) {
        window.loadURL(url);
        cb();
    },
    getCurrentUrl: function (cb) {
        cb(window.webContents.getURL());
    }
});
server.listen(parseInt(process.argv[2]));