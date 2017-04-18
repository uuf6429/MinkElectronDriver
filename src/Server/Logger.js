'use strict';

module.exports = (function () {
    const Util = require('util'),
        logger = {};

    // See PSR-3 LogLevel constants.
    Object.defineProperty(logger, 'EMERGENCY', {get:function(){return 'emergency';}});
    Object.defineProperty(logger, 'ALERT', {get:function(){return 'alert';}});
    Object.defineProperty(logger, 'CRITICAL', {get:function(){return 'critical';}});
    Object.defineProperty(logger, 'ERROR', {get:function(){return 'error';}});
    Object.defineProperty(logger, 'WARNING', {get:function(){return 'warning';}});
    Object.defineProperty(logger, 'NOTICE', {get:function(){return 'notice';}});
    Object.defineProperty(logger, 'INFO', {get:function(){return 'info';}});
    Object.defineProperty(logger, 'DEBUG', {get:function(){return 'debug';}});

    /**
     * @type {String[]}
     */
    const levelMap = [
        logger.DEBUG,
        logger.INFO,
        logger.NOTICE,
        logger.WARNING,
        logger.ERROR,
        logger.CRITICAL,
        logger.ALERT,
        logger.EMERGENCY
    ];

    let logLevel = 0;

    /**
     * @param {String} level
     * @param {any[]} fmtArgs
     * @param {Object} [context]
     */
    const log = function (level, fmtArgs, context) {
        let targetLevel = levelMap.indexOf(level);

        if (targetLevel === -1) {
            throw new Error('Logging failed; "' + level + '" is not a valid log level.');
        }

        if (logLevel <= targetLevel) {
            context = context || {};
            context.srcTime = Date.now() / 1000;
            process.stdout.write(JSON.stringify({
                    'level': level,
                    'message': Util.format.apply(null, fmtArgs),
                    'context': context
                }) + '\n');
        }
    };

    /**
     * @param {String} level
     * @param {String} message
     * @param {Object} context
     */
    logger.log = function (level, message, context) {
        log(level, [message], context);
    };

    /**
     * @param {String} msg
     * @param {...*} [args]
     */
    logger.emergency = function (msg, ...args) {
        log(logger.EMERGENCY, arguments);
    };

    /**
     * @param {String} msg
     * @param {...*} [args]
     */
    logger.alert = function (msg, ...args) {
        log(logger.ALERT, arguments);
    };

    /**
     * @param {String} msg
     * @param {...*} [args]
     */
    logger.critical = function (msg, ...args) {
        log(logger.CRITICAL, arguments);
    };

    /**
     * @param {String} msg
     * @param {...*} [args]
     */
    logger.error = function (msg, ...args) {
        log(logger.ERROR, arguments);
    };

    /**
     * @param {String} msg
     * @param {...*} [args]
     */
    logger.warn = function (msg, ...args) {
        log(logger.WARNING, arguments);
    };

    /**
     * @param {String} msg
     * @param {...*} [args]
     */
    logger.notice = function (msg, ...args) {
        log(logger.NOTICE, arguments);
    };

    /**
     * @param {String} msg
     * @param {...*} [args]
     */
    logger.info = function (msg, ...args) {
        log(logger.INFO, arguments);
    };

    /**
     * @param {String} msg
     * @param {...*} [args]
     */
    logger.debug = function (msg, ...args) {
        log(logger.DEBUG, arguments);
    };

    Object.defineProperty(logger, 'LogLevel', {
        /**
         * @returns {String|undefined}
         */
        get: function () {
            return levelMap[logLevel];
        },
        /**
         * @param {String} level
         */
        set: function (level) {
            let targetLevel = levelMap.indexOf(level);

            if (targetLevel === -1) {
                throw new Error('Cannot set log level; "' + level + '" is not a valid log level.');
            }

            logLevel = targetLevel;
        }
    });

    return logger;
})();
