# Pick — Design Spec

**Date:** 2026-05-11
**Status:** Approved (brainstorming phase)
**Owner:** Santiago Ferreira (san650)
**Deploy target:** https://pick.42.uy

## 1. Summary

**Pick** is a fully offline, mobile-first Progressive Web App that chooses the first player for a tabletop game by touch. Each player puts a finger on the screen; after about three seconds of stability, one finger is highlighted at random as the chosen first player. The app is stateless: it remembers nothing between rounds or launches.

## 2. Goals and non-goals

**Goals**

- One-screen, zero-configuration first-player picker for in-person tabletop games.
- Works fully offline, including the very first launch from the iOS home screen.
- Feels instant and tactile: no typing, no setup, no logins, no settings.
- Installable to the home screen on iOS with a proper splash and standalone display.

**Non-goals**

- Full turn order (only first player is selected).
- Player names, avatars, or any per-player identity.
- Per-game history, statistics, or a "last winner" log.
- User-tunable settings (timing, colors, sound). Defaults are the product.
- Multi-device sync, accounts, or any backend.
- Tablet-specific layouts or desktop optimization beyond the standard "mobile layout, centered" treatment.

## 3. User flow

1. User taps the **Pick** icon on their home screen. App opens in standalone mode at the `IDLE` screen.
2. Two or more people place fingers on the screen.
3. Each finger renders a visual marker at its location (exact look TBD by frontend-design).
4. After roughly three seconds during which no fingers are added or removed, the app picks one finger uniformly at random and highlights it as the first player.
5. The chosen player keeps their finger on the screen long enough to register the result.
6. Everyone lifts their fingers. The screen returns to `IDLE`, ready for the next round.

## 4. Architecture

**Chosen approach: minimal.** The `simple-website` skill defaults to a five-module structure (commands, history, store, db, app) intended for CRUD apps with undo/redo. Pick has no domain entities, no persisted state, and no operations to undo. Adding those modules would leave them effectively empty. We therefore use a flat structure with the state machine inline in `app.js`.

### 4.1 File layout

```
/
├── index.html              minimal markup; one full-viewport touch zone
├── styles.css              mobile-first; no scroll; safe-area aware
├── app.js                  state machine + pointer event handling + render
├── sw.js                   cache-first service worker, same-origin only
├── manifest.webmanifest    PWA manifest
├── icon.svg                single square-viewBox app icon
├── splash/                 nine iOS startup PNGs (generated from icon.svg)
├── .nojekyll               empty file, lets GitHub Pages serve underscore paths
├── LICENSE                 MIT, 2026
├── README.md               2–4 sentences, deploy link, license note
└── CNAME                   pick.42.uy
```

No build step, no framework, no CDN. Everything is a static file served verbatim.

### 4.2 Storage

The app uses no persistent storage. No `localStorage`, no IndexedDB, no cookies. State lives only in JavaScript variables for the lifetime of the page.

## 5. State machine

Three states, driven by Pointer Events:

```
        pointerdown (1st finger)              pointerup → count==0
IDLE ─────────────────────────→ ACTIVE ──────────────────────────→ IDLE
                                  │                                  ↑
                                  │ stability timer fires            │
                                  │   AND count ≥ 2                  │
                                  ↓                                  │
                                PICKED ──────────────────────────────┘
                                       pointerup → count==0
```

- **`IDLE`** — no pointers down. Blank touch zone with a passive hint such as "place your fingers."
- **`ACTIVE`** — one or more pointers down. Each pointer is rendered. A 3-second stability timer is pending.
- **`PICKED`** — a winner `pointerId` is locked. The winner is highlighted. Other pointers continue to render but cannot change the result.

### 5.1 Stability timer

Only meaningful in `ACTIVE`. Delay: **3000 ms** (the value is a constant in `app.js`, not user-configurable).

- Set fresh when entering `ACTIVE` from `IDLE`.
- Cleared and reset on every `pointerdown` and `pointerup` while still in `ACTIVE`.
- **Not** reset by `pointermove`. A minor wobble would otherwise prevent the pick from ever firing.
- On fire: if active count ≥ 2, pick a winner and transition to `PICKED`. If count < 2, do nothing; the timer is only re-armed by the next pointer change.

### 5.2 During `PICKED`

- Additional `pointerdown` / `pointerup` events update the rendered finger set but do not change the winner or re-trigger any pick.
- Only when the active map becomes empty (count == 0) does the app return to `IDLE`.

## 6. Pointer event handling

The app uses the unified **PointerEvent API**, which covers touch, mouse, and pen with a single code path.

- One full-viewport `<div id="touch-zone">` element captures all input.
- CSS `touch-action: none` on the touch zone prevents the browser from intercepting pinch, scroll, or other gestures.
- Listeners: `pointerdown`, `pointerup`, `pointercancel`, `pointermove`.
- A `Map<pointerId, {x, y}>` tracks active pointers:
  - `pointerdown` → add to map; reset stability timer.
  - `pointermove` → update position only; **does not** reset the timer.
  - `pointerup` → remove from map; reset stability timer; if count == 0 in `ACTIVE` or `PICKED`, transition to `IDLE`.
  - `pointercancel` → handled identically to `pointerup`. Covers OS interruptions such as notifications or incoming calls.
- A `requestAnimationFrame` render loop reads the current state plus the active pointer map and updates the DOM (or canvas; final medium is a frontend-design decision). The state machine and the renderer are decoupled: the renderer only observes.

## 7. Pick algorithm

Uniform-random selection over active pointer IDs at the moment the stability timer fires:

```js
const ids = [...activePointers.keys()];
const r = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const winnerId = ids[Math.floor(r * ids.length)];
```

`crypto.getRandomValues` is used instead of `Math.random` because the entire purpose of the app is fairness, and unbiased randomness is trivially available in the browser.

### 7.1 Result lifetime guarantee

The result is shown for **a minimum of 600 ms** even if all fingers lift immediately after the pick. Without this floor, a reflexive lift would dismiss the result before anyone could perceive it. Implementation: when entering `PICKED`, record `pickedAt`; a `pointerup` that would otherwise transition to `IDLE` is held until `now - pickedAt ≥ 600` (then it transitions; further releases during the hold are coalesced). New `pointerdown` events arriving during the hold update the rendered finger set per Section 5.2 but do not change the winner or affect the hold.

### 7.2 Winner indicator behavior

- The winner indicator follows the winner's finger position while the winner's `pointerId` remains in the active map.
- If the winner lifts before the others, the indicator disappears with that finger. We do not preserve a "ghost" highlight at the last known position.
- Non-winner fingers continue to render normally during `PICKED`.

## 8. Edge cases and lifecycle

- **Below minimum (1 finger).** The app stays in `ACTIVE`; the stability timer fires, fails the count check, and does not re-arm until the next pointer change. A hint ("add another player" or equivalent) is rendered whenever `state === ACTIVE && activeCount < 2`.
- **Tab or app backgrounded** (`document.visibilityState === "hidden"`). Hard reset: clear all active pointers, clear any pending timer, transition to `IDLE`. The app comes back fresh — appropriate for a tabletop device that may have changed hands.
- **Cold launch / reload.** Always starts in `IDLE`. No state is restored because no state is persisted.
- **`pointercancel`.** Treated identically to `pointerup`. Prevents stale pointer entries from system interruptions.

## 9. PWA shell and deployment

### 9.1 `manifest.webmanifest`

- `name`: `"Pick"`
- `short_name`: `"Pick"`
- `description`: one line, derived from the summary above
- `display`: `"standalone"`
- `orientation`: `"any"` — the device is typically lying flat on a table and may be viewed from any angle.
- `start_url`: `"./"`
- `scope`: `"./"`
- `theme_color` / `background_color`: matched to the final visual design (placeholder values until frontend-design lands).
- `icons`: a single entry referencing `icon.svg`. The `purpose: "any maskable"` flag is a checkpoint after the `frontend-design` pass — it is only set if the final mark survives the maskable safe zone. Scaffolding ships with `purpose: "any"` and the maskable upgrade is revisited once the final icon exists.

### 9.2 `sw.js`

Cache-first, same-origin only. The `SHELL` array contains:

- `./`
- `./index.html`
- `./styles.css`
- `./app.js`
- `./manifest.webmanifest`
- `./icon.svg`
- The nine `splash/*.png` paths.

Cache name is versioned (`pick-v1`) so future bumps invalidate cleanly. The `fetch` handler tries the cache first and falls back to the network. No offline fallback page is needed: the only page is the shell, which is always cached.

### 9.3 `index.html`

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` so the iPhone 12 safe areas are exposed.
- Apple PWA meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`.
- Nine `<link rel="apple-touch-startup-image">` entries, one per generated splash PNG.
- `<link rel="manifest" href="manifest.webmanifest">`.
- Inline service worker registration at the bottom of `<body>`.

### 9.4 `styles.css`

- Full-viewport touch zone (`100vh` / `100dvh`).
- `overscroll-behavior: none` on the body.
- `touch-action: none` on the touch zone.
- Safe-area inset padding (`env(safe-area-inset-*)`) for any hint or label text so the iPhone 12 camera area never clips it.
- Mobile layout centered in a column on wider viewports (the skill's standard treatment).

### 9.5 Icon and splash

- `icon.svg`: a single square-viewBox SVG. A minimal placeholder mark is shipped initially; `frontend-design` will replace it with the final mark.
- Nine iOS startup PNGs generated from `icon.svg` plus the chosen `background_color` using the bundled `scripts/generate-splash.py` from the `simple-website` skill.

### 9.6 Deployment

- `CNAME` contains the single line `pick.42.uy` (bare domain, no protocol, no trailing slash).
- `.nojekyll` is empty and present at the root so GitHub Pages serves files starting with `_`.
- `LICENSE`: MIT, year 2026.
- `README.md`: 2–4 sentences, link to https://pick.42.uy, MIT license note. No dev or build instructions.
- The user enables GitHub Pages manually after the initial commit.

## 10. Out of scope (explicit YAGNI list)

The following are intentionally not part of this design:

- Full turn order (2nd, 3rd, …).
- Player names, identities, or color preferences.
- Round history, undo/redo, or any persistence.
- User-tunable settings (timing, sound, theme, vibration).
- Sound effects or haptic feedback.
- Onboarding, tutorial overlay, or first-run experience beyond the passive hint.
- A separate "settings" or "about" screen.
- Analytics, telemetry, error reporting.
- Internationalization. English-only for v1; the only visible text is a short hint.

If any of these are wanted later, they require their own brainstorm and spec.

## 11. Open questions

None at the close of this brainstorming session. Visual design (colors, finger marker shape, hint typography, exact placeholder copy, icon mark) is deferred to a `frontend-design` pass before scaffolding.
