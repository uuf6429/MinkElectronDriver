module.exports = (function() {
    /**
     * @typedef {Object} Response
     * @property {string} url
     * @property {integer} status
     * @property {string} statusText
     * @property {Object.<string, *>} headers
     * @property {string} content
     * @property {number} createdAt
     */
    /**
     * @typedef {Object} CRDResponseMeta
     * @property {string} url
     * @property {integer} status
     * @property {string} statusText
     * @property {Object.<string, *>} headers
     */
    /**
     * @typedef {Object} CRDResponseBody
     * @property {bool} base64Encoded
     * @property {string} body
     */

    const GC_INT = 30000,   // clean up old responses every 30s
          GC_TTL = 300000;  // remove responses older than 5min

    var manager = {},
        /**
         * @type {Object.<string, Response>}
         */
        responses = {};

    /**
     * @param {CRDResponseBody} response
     * @returns {String}
     */
    var getDecodedBody = function (response) {
        if (!response['base64Encoded']) {
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
        var timeThreshold = Date.now() - GC_TTL;
        for (var key in responses) {
            if (responses.hasOwnProperty(key) && responses[key].createdAt < timeThreshold) {
                delete responses[key];
            }
        }
    };

    /**
     * Get response for a frame id.
     * @param {string|number} frameId
     * @returns {Response|null}
     */
    manager.get = function(frameId){
        return responses[frameId.toString()] || null;
    };

    /**
     * Set response for a frame id.
     * @param {string|number} frameId
     * @param {CRDResponseMeta} meta
     * @param {CRDResponseBody} body
     */
    manager.set = function(frameId, meta, body){
        responses[frameId.toString()] = {
            url: meta.url,
            status: meta.status,
            statusText: meta.statusText,
            headers: meta.headers,
            content: getDecodedBody(body),
            createdAt: Date.now()
        };
    };

    /**
     * Removes response for a frame id.
     * @param {string|number} frameId
     */
    manager.remove = function(frameId){
        delete responses[frameId.toString()];
    };

    setInterval(function () {
        manager.gc();
    }, GC_INT);

    return manager;
})();
