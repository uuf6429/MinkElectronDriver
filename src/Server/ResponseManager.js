'use strict';

module.exports = (function () {
    /**
     * @typedef {Object} Response
     * @property {String} url
     * @property {Integer} status
     * @property {String} statusText
     * @property {Object.<string, *>} headers
     * @property {String} content
     * @property {Number} createdAt
     */
    /**
     * @typedef {Object} CRDResponseMeta
     * @property {String} url
     * @property {Integer} status
     * @property {String} statusText
     * @property {Object.<string, *>} headers
     */
    /**
     * @typedef {Object} CRDResponseBody
     * @property {Boolean} [base64Encoded]
     * @property {String} body
     */

    const GC_INT = 30000,   // clean up old responses every 30s
        GC_TTL = 300000;    // remove responses older than 5min

    const manager = {},
        Logger = require('./Logger'),
        /**
         * @type {Object.<string, Response>}
         */
        responses = {};

    /**
     * @param {CRDResponseBody} response
     * @returns {String}
     */
    const getDecodedBody = function (response) {
        if (!response.base64Encoded) {
            return response.body;
        }

        if (typeof Buffer.from === 'function') {
            return Buffer.from(response.body, 'base64').toString();
        } else {
            return new Buffer(response.body, 'base64').toString();
        }
    };

    /**
     * Remove old responses.
     */
    manager.gc = function () {
        const timeThreshold = Date.now() - GC_TTL,
            clearedKeys = [];

        for (let key in responses) {
            if (responses.hasOwnProperty(key) && responses[key].createdAt < timeThreshold) {
                clearedKeys.push(key);
                this.remove(key);
            }
        }

        if (clearedKeys.length) {
            Logger.info('ResponseManager GC: cleared response for %s %s.', clearedKeys.length > 1 ? 'frames' : 'frame', clearedKeys.join(', '));
        } else {
            Logger.info('ResponseManager GC: no expired responses found.');
        }
    };

    /**
     * Get response for a frame id.
     * @param {string|number} frameId
     * @returns {Response|null}
     */
    manager.get = function (frameId) {
        return responses[frameId.toString()] || null;
    };

    /**
     * Set response for a frame id.
     * @param {string|number} frameId
     * @param {CRDResponseMeta} meta
     * @param {CRDResponseBody} body
     */
    manager.set = function (frameId, meta, body) {
        responses[frameId.toString()] = {
            url: meta.url,
            status: meta.status,
            statusText: meta.statusText,
            headers: meta.headers,
            content: getDecodedBody(body),
            createdAt: Date.now()
        };

        Logger.debug('ResponseManager: Response for frame %s set to: %j', frameId, {meta: meta, body: body});
    };

    /**
     * Removes response for a frame id.
     * @param {string|number} frameId
     */
    manager.remove = function (frameId) {
        delete responses[frameId.toString()];
    };

    setInterval(function () {
        manager.gc();
    }, GC_INT);

    return manager;
})();
