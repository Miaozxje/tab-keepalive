// Runs in the page's MAIN world (registered at document_start for origins
// with keepalive enabled, and injected on demand). Makes the page believe the
// tab is visible, focused and the user is active, without Chrome's debugger.
//
// Only active while this tab's sessionStorage carries the flag below, so
// other tabs on the same origin are unaffected and disabling takes effect
// immediately without a reload.
(() => {
  const FLAG = "__tabKeepaliveActive";
  const INSTALLED = Symbol.for("tab-keepalive.page-active");

  if (window[INSTALLED]) {
    return;
  }

  Object.defineProperty(window, INSTALLED, { value: true });

  const isOn = () => {
    try {
      return sessionStorage.getItem(FLAG) === "1";
    } catch {
      return false;
    }
  };

  function spoofGetter(proto, prop, value) {
    const desc = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc?.get) {
      return;
    }

    Object.defineProperty(proto, prop, {
      ...desc,
      get() {
        return isOn() ? value : desc.get.call(this);
      }
    });
  }

  const hiddenDesc = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "hidden"
  );
  const reallyHidden = () => hiddenDesc.get.call(document);

  // Page Visibility API.
  spoofGetter(Document.prototype, "hidden", false);
  spoofGetter(Document.prototype, "visibilityState", "visible");
  spoofGetter(Document.prototype, "webkitHidden", false);
  spoofGetter(Document.prototype, "webkitVisibilityState", "visible");

  // Focus.
  const originalHasFocus = Document.prototype.hasFocus;
  Document.prototype.hasFocus = function hasFocus() {
    return isOn() ? true : originalHasFocus.call(this);
  };

  // Idle Detection API (what Chrome's idle emulation used to cover).
  spoofGetter(globalThis.IdleDetector?.prototype, "userState", "active");
  spoofGetter(globalThis.IdleDetector?.prototype, "screenState", "unlocked");

  // Swallow "tab hidden" / "window lost focus" notifications. Capture
  // listeners on window run before the page's own document/window listeners.
  const blockVisibility = (event) => {
    if (isOn()) {
      event.stopImmediatePropagation();
    }
  };

  window.addEventListener("visibilitychange", blockVisibility, true);
  window.addEventListener("webkitvisibilitychange", blockVisibility, true);

  window.addEventListener(
    "blur",
    (event) => {
      // Only the window losing focus; element blur is needed by forms.
      if (isOn() && event.target === window) {
        event.stopImmediatePropagation();
      }
    },
    true
  );

  // Background animation frames. Chrome stops requestAnimationFrame in
  // hidden tabs, which freezes games whose loop is driven by it. While the
  // tab is really hidden, run pending callbacks from a Web Worker tick
  // instead: worker timers are not throttled like background-tab timers.
  const TICK_MS = 33;
  const ID_BASE = 1e9;
  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const queue = new Map();
  let nextId = ID_BASE;
  let ticker = null;

  function runFrame(id, time) {
    const entry = queue.get(id);
    if (!entry) {
      return;
    }

    queue.delete(id);
    nativeCancel(entry.nativeId);
    entry.callback(time);
  }

  function onTick() {
    if (!isOn() || !reallyHidden() || queue.size === 0) {
      return;
    }

    // Callbacks queued while running belong to the next tick.
    const time = performance.now();
    for (const id of [...queue.keys()]) {
      try {
        runFrame(id, time);
      } catch (error) {
        setTimeout(() => {
          throw error;
        });
      }
    }
  }

  function ensureTicker() {
    if (ticker) {
      return;
    }

    try {
      const source = `setInterval(() => postMessage(0), ${TICK_MS});`;
      const url = URL.createObjectURL(
        new Blob([source], { type: "text/javascript" })
      );
      ticker = new Worker(url);
      ticker.onmessage = onTick;
    } catch {
      // Worker blocked (e.g. by CSP): throttled main-thread fallback.
      ticker = setInterval(onTick, TICK_MS);
    }
  }

  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (!isOn()) {
      return nativeRequest(callback);
    }

    const id = ++nextId;
    queue.set(id, {
      callback,
      // Visible tab: the native frame runs it and cancels the worker path.
      nativeId: nativeRequest((time) => runFrame(id, time))
    });
    ensureTicker();
    return id;
  };

  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    const entry = queue.get(id);
    if (entry) {
      queue.delete(id);
      nativeCancel(entry.nativeId);
      return;
    }

    nativeCancel(id);
  };
})();
