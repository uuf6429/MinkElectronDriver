var Nightmare = require('nightmare');
require('nightmare-upload')(Nightmare);

var nightmare = Nightmare();

var n = nightmare
    .goto('http://google.com/');


console.log('before');

    n.done(function () {
        console.log('args', arguments);
    });

console.log('after');
