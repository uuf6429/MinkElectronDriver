(function () {
    var remote = require('electron').remote,
        setExecutionError = remote.getGlobal('setExecutionError'),
        setWindowUnloading = remote.getGlobal('setWindowUnloading'),
        setWindowIdName = remote.getGlobal('setWindowIdName'),
        setFileFromScript = remote.getGlobal('setFileFromScript'),
        DELAY_SCRIPT_RESPONSE = remote.getGlobal('DELAY_SCRIPT_RESPONSE'),
        electronWindow = remote.getCurrentWindow();

    window.onerror = function (error) {
        setExecutionError(error);
        return true;
    };

    var oldOnUnload = window.onbeforeunload;
    window.onbeforeunload = function (error) {
        setWindowUnloading(true);
        if (oldOnUnload) oldOnUnload();
        setWindowIdName(electronWindow.id, null, location.href);
    };

    var oldWndName = window.name || remote.getGlobal('newWindowName');
    window.__defineSetter__("name", function (name) {
        oldWndName = name;
        setWindowIdName(electronWindow.id, name, location.href);
    });
    window.__defineGetter__("name", function () {
        return oldWndName;
    });
    setWindowIdName(electronWindow.id, oldWndName, location.href);

    window.Electron = {
        'syn': require('syn'),

        'setFileFromScript': function (xpath, value) {
            setFileFromScript(electronWindow.id, xpath, value);
            return DELAY_SCRIPT_RESPONSE;
        },

        // Thanks to Jason Farrell from Use All Five
        'isVisible': function isVisible(el, t, r, b, l, w, h) {
            var p = el.parentNode,
                VISIBLE_PADDING = 2;

            if (!this._elementInDocument(el)) {
                return false;
            }

            if (9 === p.nodeType) {
                return true;
            }

            if (
                '0' === this._getStyle(el, 'opacity') ||
                'none' === this._getStyle(el, 'display') ||
                'hidden' === this._getStyle(el, 'visibility')
            ) {
                return false;
            }

            if (
                'undefined' === typeof(t) ||
                'undefined' === typeof(r) ||
                'undefined' === typeof(b) ||
                'undefined' === typeof(l) ||
                'undefined' === typeof(w) ||
                'undefined' === typeof(h)
            ) {
                t = el.offsetTop;
                l = el.offsetLeft;
                b = t + el.offsetHeight;
                r = l + el.offsetWidth;
                w = el.offsetWidth;
                h = el.offsetHeight;
            }
            if (p) {
                if (('hidden' === this._getStyle(p, 'overflow') || 'scroll' === this._getStyle(p, 'overflow'))) {
                    if (
                        l + VISIBLE_PADDING > p.offsetWidth + p.scrollLeft ||
                        l + w - VISIBLE_PADDING < p.scrollLeft ||
                        t + VISIBLE_PADDING > p.offsetHeight + p.scrollTop ||
                        t + h - VISIBLE_PADDING < p.scrollTop
                    ) {
                        return false;
                    }
                }
                if (el.offsetParent === p) {
                    l += p.offsetLeft;
                    t += p.offsetTop;
                }

                return this.isVisible(p, t, r, b, l, w, h);
            }
            return true;
        },

        '_getStyle': function (el, property) {
            if (window.getComputedStyle) {
                return document.defaultView.getComputedStyle(el, null)[property];
            }
            if (el.currentStyle) {
                return el.currentStyle[property];
            }
        },

        '_elementInDocument': function (element) {
            while (element = element.parentNode) {
                if (element === document) {
                    return true;
                }
            }
            return false;
        }
    }
})();
