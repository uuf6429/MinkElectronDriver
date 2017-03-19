var remote = require("electron").remote,
    setExecutionError = remote.getGlobal('setExecutionError'),
    setWindowUnloading = remote.getGlobal('setWindowUnloading'),
    setWindowIdName = remote.getGlobal('setWindowIdName');

window.onerror = function (error) {
    setExecutionError(error);
    return true;
};

var oldOnUnload = window.onbeforeunload;
window.onbeforeunload = function (error) {
    setWindowUnloading(true);
    if (oldOnUnload) oldOnUnload();
    setWindowIdName(remote.getCurrentWindow().id, null, location.href);
};

var oldWndName = window.name || remote.getGlobal('newWindowName');
window.__defineSetter__("name", function (name) {
    oldWndName = name;
    setWindowIdName(remote.getCurrentWindow().id, name, location.href);
});
window.__defineGetter__("name", function () {
    return oldWndName;
});
setWindowIdName(remote.getCurrentWindow().id, oldWndName, location.href);
