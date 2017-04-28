'use strict';

module.exports = (function () {
    /**
     * @typedef {Object} Frame
     * @property {String} id
     * @property {String} name
     * @property {String} frameId
     * @property {Electron.WebContents} reference
     */

    const manager = {},
        /** @type {Frame[]} */
        frames = [];

    /**
     * Removes frame.
     * @param {String} id
     */
    manager.unregisterById = function (id) {
        // TODO
    };

    return manager;
})();
