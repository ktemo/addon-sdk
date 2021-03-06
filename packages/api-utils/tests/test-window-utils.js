/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var windowUtils = require("window-utils");
var timer = require("timer");
var {Cc,Ci} = require("chrome");
var { Loader } = require("./helpers");

function makeEmptyWindow() {
  var xulNs = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  var blankXul = ('<?xml version="1.0"?>' +
                  '<?xml-stylesheet href="chrome://global/skin/" ' +
                  '                 type="text/css"?>' +
                  '<window xmlns="' + xulNs + '" windowtype="test:window">' +
                  '</window>');
  var url = "data:application/vnd.mozilla.xul+xml," + escape(blankXul);
  var features = ["chrome", "width=10", "height=10"];

  var ww = Cc["@mozilla.org/embedcomp/window-watcher;1"]
           .getService(Ci.nsIWindowWatcher);
  return ww.openWindow(null, url, null, features.join(","), null);
}

exports.testCloseOnUnload = function(test) {
  var timesClosed = 0;
  var fakeWindow = {
    _listeners: [],
    addEventListener: function(name, func, bool) {
      this._listeners.push(func);
    },
    removeEventListener: function(name, func, bool) {
      var index = this._listeners.indexOf(func);
      if (index == -1)
        throw new Error("event listener not found");
      this._listeners.splice(index, 1);
    },
    close: function() {
      timesClosed++;
      this._listeners.forEach(
        function(func) { 
          func({target: fakeWindow.document});
        });
    },
    document: {
      get defaultView() { return fakeWindow; }
    }
  };

  let loader = Loader(module);
  loader.require("window-utils").closeOnUnload(fakeWindow);
  test.assertEqual(fakeWindow._listeners.length, 1,
                   "unload listener added on closeOnUnload()");
  test.assertEqual(timesClosed, 0,
                   "window not closed when registered.");
  loader.require("unload").send();
  test.assertEqual(timesClosed, 1,
                   "window closed on module unload.");
  test.assertEqual(fakeWindow._listeners.length, 0,
                   "unload event listener removed on module unload");

  timesClosed = 0;
  loader.require("window-utils").closeOnUnload(fakeWindow);
  test.assertEqual(timesClosed, 0,
                   "window not closed when registered.");
  fakeWindow.close();
  test.assertEqual(timesClosed, 1,
                   "window closed when close() called.");
  test.assertEqual(fakeWindow._listeners.length, 0,
                   "unload event listener removed on window close");
  loader.require("unload").send();
  test.assertEqual(timesClosed, 1,
                   "window not closed again on module unload.");
  loader.unload();  
};

exports.testWindowWatcher = function(test) {
  var myWindow;
  var finished = false;

  var delegate = {
    onTrack: function(window) {
      if (window == myWindow) {
        test.pass("onTrack() called with our test window");
        timer.setTimeout(function() { myWindow.close(); }, 1);
      }
    },
    onUntrack: function(window) {
      if (window == myWindow) {
        test.pass("onUntrack() called with our test window");
        timer.setTimeout(function() {
                           if (!finished) {
                             finished = true;
                             myWindow = null;
                             wt.unload();
                             test.done();
                           } else
                             test.fail("finishTest() called multiple times.");
                         }, 1);
      }
    }
  };

  // test bug 638007 (new is optional), using new
  var wt = new windowUtils.WindowTracker(delegate);
  myWindow = makeEmptyWindow();
  test.waitUntilDone(5000);
};

exports.testWindowWatcherUntracker = function(test) {
  var myWindow;
  var tracks = 0;
  var unloadCalled = false;

  var delegate = {
    onTrack: function(window) {
      tracks = tracks + 1;
      if (window == myWindow) {
        test.pass("onTrack() called with our test window");
        timer.setTimeout(function() {
          myWindow.close();
        }, 1);
      }
    },
    onUntrack: function(window) {
      tracks = tracks - 1;
      if (window == myWindow && !unloadCalled) {
        unloadCalled = true;
        timer.setTimeout(function() {
          wt.unload();
        }, 1);
      }
      if (0 > tracks) {
        test.fail("WindowTracker onUntrack was called more times than onTrack..");
      }
      else if (0 == tracks) {
        timer.setTimeout(function() {
            myWindow = null;
            test.done();
        }, 1);
      }
    }
  };

  // test bug 638007 (new is optional), not using new
  var wt = windowUtils.WindowTracker(delegate);
  myWindow = makeEmptyWindow();
  test.waitUntilDone(5000);
};

// test that _unregWindow calls _unregLoadingWindow
exports.testWindowWatcherUnregs4LoadingWindows = function(test) {
  var myWindow;
  var finished = false;
  let browserWindow =  Cc["@mozilla.org/appshell/window-mediator;1"]
      .getService(Ci.nsIWindowMediator)
      .getMostRecentWindow("navigator:browser");
  var counter = 0;

  var delegate = {
    onTrack: function(window) {
      var type = window.document.documentElement.getAttribute("windowtype");
      if (type == "test:window")
        test.fail("onTrack shouldn't have been executed.");
    }
  };
  var wt = new windowUtils.WindowTracker(delegate);

  // make a new window
  myWindow = makeEmptyWindow();

  // make sure that the window hasn't loaded yet
  test.assertNotEqual(
      myWindow.document.readyState,
      "complete",
      "window hasn't loaded yet.");

  // unload WindowTracker
  wt.unload();

  // make sure that the window still hasn't loaded, which means that the onTrack
  // would have been removed successfully assuming that it doesn't execute.
  test.assertNotEqual(
      myWindow.document.readyState,
      "complete",
      "window still hasn't loaded yet.");

  // wait for the window to load and then close it. onTrack wouldn't be called
  // until the window loads, so we must let it load before closing it to be
  // certain that onTrack was removed.
  myWindow.addEventListener("load", function() {
    // allow all of the load handles to execute before closing
    myWindow.setTimeout(function() {
      myWindow.addEventListener("unload", function() {
        // once the window unloads test is done
        test.done();
      }, false);
      myWindow.close();
    }, 0);
  }, false);

  test.waitUntilDone(5000);
}

exports.testWindowWatcherWithoutUntracker = function(test) {
  var myWindow;
  var finished = false;

  var delegate = {
    onTrack: function(window) {
      if (window == myWindow) {
        test.pass("onTrack() called with our test window");
        timer.setTimeout(function() {
          myWindow.close();

          if (!finished) {
              finished = true;
              myWindow = null;
              wt.unload();
              test.done();
            } else {
              test.fail("onTrack() called multiple times.");
            }
        }, 1);
      }
    }
  };

  var wt = new windowUtils.WindowTracker(delegate);
  myWindow = makeEmptyWindow();
  test.waitUntilDone(5000);
};

exports.testActiveWindow = function(test) {
  test.waitUntilDone(5000);

  let testRunnerWindow = Cc["@mozilla.org/appshell/window-mediator;1"]
                         .getService(Ci.nsIWindowMediator)
                         .getMostRecentWindow("test:runner");
  let browserWindow =  Cc["@mozilla.org/appshell/window-mediator;1"]
                      .getService(Ci.nsIWindowMediator)
                      .getMostRecentWindow("navigator:browser");

  test.assertEqual(windowUtils.activeBrowserWindow, browserWindow,
                    "Browser window is the active browser window.");


  let testSteps = [
    function() {
      windowUtils.activeWindow = browserWindow;
      continueAfterFocus(browserWindow);
    },
    function() {
      test.assertEqual(windowUtils.activeWindow, browserWindow,
                       "Correct active window [1]");
      continueAfterFocus(windowUtils.activeWindow = testRunnerWindow);
    },
    function() {
      test.assertEqual(windowUtils.activeWindow, testRunnerWindow,
                       "Correct active window [2]");
      test.assertEqual(windowUtils.activeBrowserWindow, browserWindow,
                       "Correct active browser window [3]");
      continueAfterFocus(windowUtils.activeWindow = browserWindow);
    },
    function() {
      test.assertEqual(windowUtils.activeWindow, browserWindow,
                       "Correct active window [4]");
      continueAfterFocus(windowUtils.activeWindow = testRunnerWindow);
    },
    function() {
      test.assertEqual(windowUtils.activeWindow, testRunnerWindow,
                       "Correct active window [5]");
      test.assertEqual(windowUtils.activeBrowserWindow, browserWindow,
                       "Correct active browser window [6]");
      testRunnerWindow = null;
      browserWindow = null;
      test.done()
    }
  ];

  let nextTest = function() {
    let func = testSteps.shift();
    if (func) {
      func();
    }
  }

  function continueAfterFocus(targetWindow) {

    // Based on SimpleTest.waitForFocus
    var fm = Cc["@mozilla.org/focus-manager;1"].
             getService(Ci.nsIFocusManager);

    var childTargetWindow = {};
    fm.getFocusedElementForWindow(targetWindow, true, childTargetWindow);
    childTargetWindow = childTargetWindow.value;

    var focusedChildWindow = {};
    if (fm.activeWindow) {
      fm.getFocusedElementForWindow(fm.activeWindow, true, focusedChildWindow);
      focusedChildWindow = focusedChildWindow.value;
    }

    var focused = (focusedChildWindow == childTargetWindow);
    if (focused) {
      nextTest();
    } else {
      childTargetWindow.addEventListener("focus", function focusListener() {
        childTargetWindow.removeEventListener("focus", focusListener, true);
        nextTest();
      }, true);
    }

  }

  nextTest();
}
