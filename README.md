# Mink Electron Driver
[![Build Status (Linux / TravisCI)](https://img.shields.io/travis/uuf6429/MinkElectronDriver/master.svg?style=flat-square)](https://travis-ci.org/uuf6429/MinkElectronDriver)
[![Build Status (Windows / AppVeyor)](https://img.shields.io/appveyor/ci/uuf6429/MinkElectronDriver/master.svg?style=flat-square)](https://ci.appveyor.com/project/uuf6429/minkelectrondriver)
[![Minimum PHP Version](https://img.shields.io/badge/php-%3E%3D%205.6-8892BF.svg?style=flat-square)](https://php.net/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://raw.githubusercontent.com/uuf6429/MinkElectronDriver/master/LICENSE)
[![Coverage](https://img.shields.io/codecov/c/github/uuf6429/MinkElectronDriver.svg?style=flat-square)](https://codecov.io/github/uuf6429/MinkElectronDriver?branch=master)
[![Packagist](https://img.shields.io/packagist/v/uuf6429/mink-electron-driver.svg?style=flat-square)](https://packagist.org/packages/uuf6429/mink-electron-driver)

Mink Electron Driver (replaces [JsonWireProtocol](https://github.com/SeleniumHQ/selenium/wiki/JsonWireProtocol) and [PhantomJS](http://phantomjs.org/) with [Electron](http://electron.atom.io/))

Electron is between 2 to 3 times faster than PhantomJS ([source](https://github.com/segmentio/nightmare/issues/484)).

## Table Of Contents

- [Mink Electron Driver](#mink-electron-driver)
  - [Table Of Contents](#table-of-contents)
  - [Features and Advantages](#features-and-advantages)
  - [Requirements](#requirements)
  - [Installation](#installation)
  - [How Does It Work?](#how-does-it-work)

## Features and Advantages
- Fully-featured web browser
- Quite fast, compared to alternatives
- Built with modern components
- Well supported (Electron receives frequent updates)
- Easily understandable codebase (it's either PHP or JS)
- Well tested (in addition to Mink driver tests, there are others)

## Requirements
There a few things which are not taken care of automatically depending on your system.

- Basics
  - PHP (5.5+) and Composer
  - Node.js (4+) and npm
- Linux
  - If run headless (ie, without a desktop) you need to install xvfb
  - Some libraries are required, [more details here](https://electron.atom.io/docs/all/#prerequisites)
- Windows
  - Build Tools may be required. These can be installed [with one npm command](https://github.com/felixrieseberg/windows-build-tools#windows-build-tools)


## Installation

First make sure that the [requirements](#requirements) above are met.

Next, simply install the driver in your Behat project via [Composer](https://getcomposer.org/):
```bash
composer require uuf6429/mink-electron-driver
```

## How Does It Work?
```
       PHP + Mink Driver Interface                    Node.js + Electron API
 ________________  |  ______________________     _____________  |  _______________ 
|  Behat + Mink  |_v_|       Client         |___|    Server   |_V_|   Electron    |
| (Your Project) |---| (ElectronDriver.php) |---| (Server.js) |---| (Web Browser) |
'----------------'   '----------------------' ^ '-------------'   '---------------'
                                              |
                      DNode comm. over UDS (with inet sockets fallback)
```

Since one cannot easily control Node.js from PHP, a client-server approach was taken, with a fast and lightweight transport (unix domain sockets) protocol (dnode).

The driver on the PHP side simply tells the server what to do and it controls the Electron web browser.

The main reason why a client-server approach was taken is that Mink is synchronous by design.
