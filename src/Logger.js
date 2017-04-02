module.exports = (function() {
    const Util = require('util');

    var logger = {};

    // See PSR-3 LogLevel constants.
    Object.defineProperty(logger, 'EMERGENCY', {get:function(){return 'emergency';}});
    Object.defineProperty(logger, 'ALERT', {get:function(){return 'alert';}});
    Object.defineProperty(logger, 'CRITICAL', {get:function(){return 'critical';}});
    Object.defineProperty(logger, 'ERROR', {get:function(){return 'error';}});
    Object.defineProperty(logger, 'WARNING', {get:function(){return 'warning';}});
    Object.defineProperty(logger, 'NOTICE', {get:function(){return 'notice';}});
    Object.defineProperty(logger, 'INFO', {get:function(){return 'info';}});
    Object.defineProperty(logger, 'DEBUG', {get:function(){return 'debug';}});

    var levelMap = [
        logger.DEBUG,
        logger.INFO,
        logger.NOTICE,
        logger.WARNING,
        logger.ERROR,
        logger.CRITICAL,
        logger.ALERT,
        logger.EMERGENCY
    ];

    var logLevel = 0;

    const log = function (level, fmtArgs, context) {
        var targetLevel = levelMap.indexOf(level);

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

    logger.log = function (level, message, context) {
        log(level, [message], context);
    };

    logger.emergency = function () {
        log(logger.EMERGENCY, arguments);
    };

    logger.alert = function () {
        log(logger.ALERT, arguments);
    };

    logger.critical = function () {
        log(logger.CRITICAL, arguments);
    };

    logger.error = function () {
        log(logger.ERROR, arguments);
    };

    logger.warn = function () {
        log(logger.WARNING, arguments);
    };

    logger.notice = function () {
        log(logger.NOTICE, arguments);
    };

    logger.info = function () {
        log(logger.INFO, arguments);
    };

    logger.debug = function () {
        log(logger.DEBUG, arguments);
    };

    Object.defineProperty(logger, 'LogLevel', {
        get: function () {
            return levelMap[logLevel];
        },
        set: function (level) {
            var targetLevel = levelMap.indexOf(level);

            if (targetLevel === -1) {
                throw new Error('Cannot set log level; "' + level + '" is not a valid log level.');
            }

            logLevel = targetLevel;
        }
    });

    return logger;
})();
