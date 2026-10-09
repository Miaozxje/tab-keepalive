# Tab Always Alive v3.0.0

A local-only Chrome extension that combines multiple generic session keepalive
mechanisms and tries to diagnose what kind of session expiration the site uses.

## Popup

The popup has a single ON/OFF button for the current tab and a status line
(**Activated** in green / **Inactive** in red). Opening the popup does not
change anything; keepalive only starts or stops when the button is pressed.

The popup no longer exposes strategy options: every enabled tab always uses
the three default mechanisms below. The optional mechanisms further down are
still implemented in the service worker but cannot be turned on from the UI.

## Default keepalive mechanisms

Always used:

1. In-page active/focus (no debugger)
    - Makes `document.hidden`, `document.visibilityState`, `document.hasFocus()`
      and the Idle Detection API report a visible, focused, active tab.
    - Swallows `visibilitychange` and window `blur` events.
    - Keeps `requestAnimationFrame` loops running while the tab is really
      hidden (Chrome normally stops them), by running pending callbacks from a
      Web Worker tick (~30 fps). Worker timers are not throttled like
      background-tab timers. This is what H5 games such as Võ Lâm Idle need:
      their whole game loop is a `requestAnimationFrame` chain.
    - Only affects the enabled tab: it is gated by a flag in that tab's
      `sessionStorage`, so other tabs on the same site are untouched.
    - Registered at `document_start`, so reload the page once after enabling
      to also block listeners the site registers early.
    - Ordinary `setTimeout`/`setInterval` in the page are still throttled.

2. DOM activity
    - Pointer/mouse/focus events.
    - Tiny scroll followed by exact scroll-position restoration.

3. Authenticated current-page GET
    - A real same-origin GET request to the URL already loaded.
    - Uses the page's normal cookies.
    - Does not call third-party servers.

Always applied while keepalive is enabled: the tab is marked
`autoDiscardable: false`, so Memory Saver does not discard it. The flag is
restored when keepalive is disabled. For best results also add the site to
Memory Saver's "Always keep these sites active" list and turn off Energy Saver.

## Optional debugger-based mechanisms

Disabled by default because they attach Chrome's debugger, which makes Chrome
show its "started debugging this browser" banner (see below):

1. Chrome idle/focus emulation
    - Uses the Chrome DevTools Protocol to report the user as active/unlocked.
    - Enables focus emulation for the tab.

2. Browser-level input
    - Mouse movement.
    - Shift key down/up.
    - Does not click or type text.

## Optional aggressive mechanisms

Disabled by default:

### Replay observed safe GET XHRs

While the DevTools connection is active, the extension remembers recent
same-origin XHR requests that used HTTP GET and excludes URLs containing common
destructive action words such as logout, delete, revoke, payment, etc.

When enabled, it can replay up to two successful observed GET XHRs using
Chrome's Network.replayXHR facility.

This can help applications where only authenticated API traffic refreshes the
server-side session.

It is still considered aggressive because HTTP GET is _supposed_ to be
side-effect-free, but poorly designed sites can violate that convention.

### Periodic background reload

Reloads the page at the selected interval, but only when:

- the tab is not the active tab, or
- Chrome is not the focused macOS application.

This is intentionally disabled by default because a reload can discard
unsaved page state.

### Prevent computer sleep

Uses Chrome's power API to keep the Mac/system awake while enabled.
The display can still turn off.

## Session diagnostics

The service worker still computes one of these assessments for each enabled
tab (stored in the tab's state; no longer shown in the popup):

- **Sliding session detected**
    - The extension observed a cookie expiry or JWT expiry move forward.

- **Fixed expiry detected**
    - A JWT-like token expiry remained unchanged over multiple keepalive pulses.

- **Keepalive ineffective / possible absolute TTL**
    - The page/request still reached an authentication failure or login page while
      keepalive was running.

- **Likely absolute/fixed TTL**
    - Authentication failure occurred close to a repeatedly observed fixed token
      expiry, or repeated sessions expired after approximately the same duration.

- **No renewal evidence yet**
    - Keepalive is running successfully, but there is no generic browser-visible
      proof that the server extended the session.

The extension never stores JWT/token values in its diagnostics. It only keeps
metadata such as token expiry/issued-at timestamps.

## Active tab indicators

- The toolbar icon glows green (with an "ON" badge) while you are on a tab
  that has keepalive enabled, and is grey on other tabs.
- The tab title is prefixed with 🟢 so the kept-alive tab is visible in the
  tab strip. The prefix is removed when keepalive is disabled. If the site
  keeps forcing its own title back, the extension stops re-adding the prefix
  instead of fighting it (which would freeze the tab).

## Chrome debugger warning

If you enable idle/focus emulation, browser-level input or XHR replay, Chrome
will show a banner similar to:

    "Tab Always Alive started debugging this browser"

This is expected because those mechanisms use Chrome's Debugger/DevTools API,
and an extension cannot hide the banner. Do not click Cancel if those
mechanisms should remain active.

## Installation

1. Extract this archive somewhere permanent.
2. Open `chrome://extensions/`.
3. Remove the previous unpacked Tab Always Alive version.
4. Enable Developer mode.
5. Click **Load unpacked**.
6. Select the `tab-keepalive-v3` directory.
7. For Incognito use, open the extension's Details page and enable
   **Allow in Incognito**.
8. Open the page you want kept alive and enable the extension.

## Fundamental limit

A server can intentionally enforce an absolute maximum session/token lifetime
that cannot be renewed by additional browser activity or requests.

No site-independent extension can legitimately turn such a fixed server-side
deadline into a sliding one. In that case v3's goal is to identify the evidence
rather than falsely report that the keepalive is working.
