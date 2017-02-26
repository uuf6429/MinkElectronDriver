#!/usr/bin/env node

// this is a nodejs wrapper around our electron-based server
var electronPath = require('electron-prebuilt');
var childProcess = require('child_process');

var args = process.argv.slice(2);
args.unshift(__dirname + '/../');

childProcess.spawn(electronPath, args, {stdio: 'inherit'});
