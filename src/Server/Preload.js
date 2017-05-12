(function () {
    const remote = require('electron').remote,
        setExecutionError = remote.getGlobal('setExecutionError'),
        setWindowUnloading = remote.getGlobal('setWindowUnloading'),
        setWindowIdName = remote.getGlobal('setWindowIdName'),
        getWindowNameFromId = remote.getGlobal('getWindowNameFromId'),
        setFileFromScript = remote.getGlobal('setFileFromScript'),
        setMouseEventTriggered = remote.getGlobal('setMouseEventTriggered'),
        isWindowNameSet = remote.getGlobal('isWindowNameSet'),
        DELAY_SCRIPT_RESPONSE = remote.getGlobal('DELAY_SCRIPT_RESPONSE'),
        electronWebContents = remote.getCurrentWebContents();

    window.addEventListener('error', function (event) {
        const hasErrorObject = event.error && event.error.toString() !== '{}';
        setExecutionError(hasErrorObject ? event.error.toString() : event.message);
    });

    window.addEventListener('beforeunload', function () {
        setWindowUnloading(true);
    });

    if (!isWindowNameSet(electronWebContents.id)) {
        setWindowIdName(electronWebContents.id, window.name || remote.getGlobal('newWindowName') || '', location.href);
    }
    window.__defineSetter__("name", function (name) {
        setWindowIdName(electronWebContents.id, name || '', location.href);
    });
    window.__defineGetter__("name", function () {
        return getWindowNameFromId(electronWebContents.id);
    });

    window.Electron = {
        'syn': require('syn'),

        'setFileFromScript': function (xpath, value) {
            setFileFromScript(electronWebContents.id, xpath, value);

            return DELAY_SCRIPT_RESPONSE;
        },

        // Thanks to Jason Farrell from Use All Five
        'isVisible': function isVisible(el, t, r, b, l, w, h) {
            const p = el.parentNode,
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

        /**
         * @param {Element|Node} element
         * @returns {boolean}
         * @private
         */
        '_elementInDocument': function (element) {
            while (!!(element = element.parentNode)) {
                if (element === document) {
                    return true;
                }
            }
            return false;
        },

        /**
         * @param {Element|HTMLInputElement|HTMLSelectElement} element
         * @returns {*}
         */
        'getValue': function (element) {
            switch (true) {
                case element.tagName === 'SELECT' && element.multiple:
                    const selected = [];
                    for (let i = 0; i < element.options.length; i++) {
                        if (element.options[i].selected) {
                            selected.push(element.options[i].value);
                        }
                    }
                    return selected;

                case element.tagName === 'INPUT' && element.type === 'checkbox':
                    return element.checked ? element.value : null;

                case element.tagName === 'INPUT' && element.type === 'radio':
                    const name = element.getAttribute('name');
                    if (name) {
                        const radioButtons = window.document.getElementsByName(name);
                        for (let i = 0; i < radioButtons.length; i++) {
                            const radioButton = radioButtons.item(i);
                            if (radioButton.form === element.form && radioButton.checked) {
                                return radioButton.value;
                            }
                        }
                    }
                    return null;

                default:
                    return element.value;
            }
        },

        /**
         * @param {string} xpath
         * @param {HTMLInputElement} element
         * @param {*} value
         * @returns {*}
         */
        'setValue': function (xpath, element, value) {
            switch (true) {
                case element.tagName === 'SELECT':
                    if (value && value.constructor.name === 'Array') {
                        this.deselectAllOptions(element);

                        for (let n = 0; n < value.length; n++) {
                            this.selectOptionOnElement(element, value[n], true);
                        }
                    } else {
                        this.selectOptionOnElement(element, value, false);
                    }
                    break;

                case element.tagName === 'INPUT' && element.type === 'checkbox':
                    if (element.checked === !value) element.click();
                    break;

                case element.tagName === 'INPUT' && element.type === 'radio':
                    this.selectRadioByValue(element, value);
                    break;

                case element.tagName === 'INPUT' && element.type === 'file':
                    this.setFileFromScript(xpath, value);
                    break;

                default:
                    element.value = '';
                    if (value !== null) {
                        // try inserting values via (synthetic) key events
                        const keys = value.toString().split('');
                        for (let i = 0; i < keys.length; i++) {
                            this.syn.key(element, keys[i]);
                        }
                        // if key events failed setting value, set it directly
                        if (element.value !== value) {
                            element.value = value;
                        }
                    }
                    // trigger change event
                    this.syn.trigger(element, 'change', {});
                    break;
            }
        },

        /**
         * @param {HTMLInputElement|HTMLSelectElement} element
         */
        'deselectAllOptions': function (element) {
            if (!element || element.tagName !== 'SELECT')
                throw new Error('Element is not a valid select element.');

            for (let i = 0; i < element.options.length; i++) {
                element.options[i].selected = false;
            }
        },

        /**
         * @param {HTMLInputElement} element
         * @returns {boolean}
         */
        'isSelected': function (element) {
            if (!element || element.tagName !== 'OPTION')
                throw new Error('Element is not a valid option element.');

            let select;
            if (element.parentNode.tagName === 'SELECT') { // select -> option
                select = element.parentNode;
            } else if (element.parentNode.parentNode.tagName === 'SELECT') { // select -> optgroup -> option
                select = element.parentNode.parentNode;
            } else {
                throw new Error('Could not find a containing select element.');
            }

            return select.value === element.value;
        },

        /**
         * @param {HTMLInputElement} element
         * @returns {boolean}
         */
        'isChecked': function (element) {
            if (!element || !((element.type === 'checkbox') || (element.type === 'radio')))
                throw new Error('Element is not a valid checkbox or radio button.');

            return element.checked;
        },

        /**
         * @param {HTMLInputElement} element
         * @param {boolean} checked
         * @returns {boolean}
         */
        'setChecked': function (element, checked) {
            if (!element || !((element.type === 'checkbox') || (element.type === 'radio')))
                throw new Error('Element is not a valid checkbox or radio button.');

            if (element.checked !== checked) element.click();
        },

        /**
         * @param {HTMLInputElement|HTMLSelectElement} element
         * @param {*} value
         * @param {boolean} multiple
         */
        'selectOptionOnElement': function (element, value, multiple) {
            let option = null;

            for (let i = 0; i < element.options.length; i++) {
                if (element.options[i].value === value) {
                    option = element.options[i];
                    break;
                }
            }

            if (!option) {
                throw new Error('Select box "' + (element.name || element.id) + '" does not have an option "' + value + '".');
            }

            if (multiple || !element.multiple) {
                if (!option.selected) {
                    option.selected = true;
                }
            } else {
                this.deselectAllOptions(element);
                option.selected = true;
            }

            this.syn.trigger(element, 'change', {});
        },

        /**
         * @param {HTMLInputElement} element
         * @param {*} value
         * @param {boolean} multiple
         */
        'selectOption': function (element, value, multiple) {
            if (element.tagName === 'INPUT' && element.type === 'radio') {
                this.selectRadioByValue(element, value);
                return;
            }

            if (element.tagName === 'SELECT') {
                this.selectOptionOnElement(element, value, multiple);
                return;
            }

            throw new Error('Element is not a valid select or radio input');
        },

        /**
         * @param {HTMLInputElement} element
         * @param {*} value
         */
        'selectRadioByValue': function (element, value) {
            const name = element.name,
                form = element.form;
            let input = null;

            if (element.value === value) {
                element.click();
                return;
            }

            if (!name) {
                throw new Error('The radio button does not have the value "' + value + '".');
            }

            if (form) {
                const group = form[name];
                for (let i = 0; i < group.length; i++) {
                    if (group[i].value === value) {
                        input = group[i];
                    }
                }
            } else {
                throw new Error('The radio group "' + name + '" is not in a form.');
            }

            if (!input) {
                throw new Error('The radio group "' + name + '" does not have an option "' + value + '".');
            }

            input.click();
        },

        /**
         * @param {String} xpath
         * @returns {Node}
         */
        'getElementByXPath': function (xpath) {
            return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        },

        /**
         * @param {HTMLElement} element
         * @returns {{x: number, y: number}}
         */
        'getElementCenterPos': function (element) {
            const rect = element.getBoundingClientRect();

            return {
                'x': Math.round(rect.left + (rect.width / 2)),
                'y': Math.round(rect.top + (rect.height / 2))
            };
        },

        /**
         * @param {String} rdEventType
         */
        'handleMouseEventOnce': function (rdEventType) {
            const rdEventTypeToJsEventMap = {
                'mouseMoved': 'mousemove',
                'mousePressed': 'mousedown',
                'mouseReleased': 'mouseup'
            };

            if (!rdEventTypeToJsEventMap[rdEventType]) {
                throw new Error('RemoteDebug event named "' + rdEventType + '" is not supported.');
            }

            window.addEventListener(
                rdEventTypeToJsEventMap[rdEventType],
                function (event) {
                    setMouseEventTriggered((event && event.target) ? this.getElementSelector(event.target) : 'unknown');
                },
                {catpure: true, once: true}
            );
        },

        /**
         * @param {HTMLElement} element
         * @returns {String}
         */
        'getElementSelector': function (element){
            if (element.id) {
                return '#' + element.id;
            }

            let parent = element.parentNode;
            let selector = '>' + element.nodeName + ':nth-child(' + this.getElementIndex(element) + ')';

            while (!parent.id && parent.nodeName.toLowerCase() !== 'body') {
                selector = '>' + element.nodeName + ':nth-child(' + this.getElementIndex(parent) + ')' + selector;
                parent = parent.parentNode;
            }

            if (parent.nodeName === 'body') {
                selector = 'body' + selector;
            } else {
                selector = '#' + parent.id + selector;
            }

            return selector;
        },

        /**
         * @param {Node} element
         * @returns {Number}
         */
        'getElementIndex': function(element) {
            let i = 0;
            while (!!(element = element.previousSibling)) i++;
            return i;
        }
    };
})();
