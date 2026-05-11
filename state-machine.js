export const STATES = Object.freeze({
  IDLE: 'idle',
  ACTIVE: 'active',
  PICKED: 'picked',
});

export const STABILITY_MS = 3000;
export const RESULT_HOLD_MS = 600;
export const MIN_FINGERS = 2;

export function createMachine({ rng, now }) {
  let state = STATES.IDLE;
  const pointers = new Map(); // id -> {x, y}
  let timerExpiresAt = null;
  let winnerId = null;
  let pickedAt = null;

  function armStabilityTimer() {
    timerExpiresAt = now() + STABILITY_MS;
  }

  function maybeReturnToIdle() {
    if (state !== STATES.PICKED) return;
    if (pointers.size !== 0) return;
    if (now() < pickedAt + RESULT_HOLD_MS) return;
    state = STATES.IDLE;
    winnerId = null;
    pickedAt = null;
  }

  return {
    getState: () => state,
    getPointers: () => pointers,
    getWinnerId: () => winnerId,

    onPointerDown(id, x, y) {
      pointers.set(id, { x, y });
      if (state === STATES.IDLE) {
        state = STATES.ACTIVE;
        armStabilityTimer();
      } else if (state === STATES.ACTIVE) {
        armStabilityTimer();
      }
      // PICKED: pointer is tracked for rendering only.
    },

    onPointerMove(id, x, y) {
      if (!pointers.has(id)) return;
      pointers.set(id, { x, y });
      // Does NOT reset the stability timer (spec Section 5.1).
    },

    onPointerUp(id) {
      pointers.delete(id);
      if (state === STATES.ACTIVE) {
        if (pointers.size === 0) {
          state = STATES.IDLE;
          timerExpiresAt = null;
        } else {
          armStabilityTimer();
        }
      } else if (state === STATES.PICKED) {
        maybeReturnToIdle();
      }
    },

    onPointerCancel(id) {
      this.onPointerUp(id);
    },

    tick() {
      if (state === STATES.ACTIVE) {
        if (timerExpiresAt !== null && now() >= timerExpiresAt) {
          if (pointers.size >= MIN_FINGERS) {
            const ids = [...pointers.keys()];
            const r = rng();
            const idx = Math.min(Math.floor(r * ids.length), ids.length - 1);
            winnerId = ids[idx];
            state = STATES.PICKED;
            pickedAt = now();
            timerExpiresAt = null;
          } else {
            timerExpiresAt = null;
          }
        }
      } else if (state === STATES.PICKED) {
        maybeReturnToIdle();
      }
    },

    reset() {
      state = STATES.IDLE;
      pointers.clear();
      timerExpiresAt = null;
      winnerId = null;
      pickedAt = null;
    },
  };
}
