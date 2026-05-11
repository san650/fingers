import { createMachine, STATES } from './state-machine.js';
import * as audio from './audio.js';

const PALETTE = [
  '#f4c465', // gold
  '#e36a5a', // ember coral
  '#7ac08c', // jade
  '#c4a3e8', // lavender
  '#7cbed1', // sky cyan
  '#f0a878', // peach
];

const touchZone = document.getElementById('touch-zone');
const hint = document.getElementById('hint');

const machine = createMachine({
  rng: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
  now: () => performance.now(),
});

const fingerEls = new Map(); // pointerId -> HTMLElement

let paletteOffset = Math.floor(Math.random() * PALETTE.length);
let perRoundOrdinal = 0;
const colorAssignment = new Map();
let prevState = STATES.IDLE;

function colorForId(id) {
  if (!colorAssignment.has(id)) {
    colorAssignment.set(id, PALETTE[(paletteOffset + perRoundOrdinal) % PALETTE.length]);
    perRoundOrdinal++;
  }
  return colorAssignment.get(id);
}

function resetRound() {
  colorAssignment.clear();
  perRoundOrdinal = 0;
  paletteOffset = Math.floor(Math.random() * PALETTE.length);
  audio.reset();
}

function ensureFingerEl(id) {
  let el = fingerEls.get(id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'finger';
    el.dataset.pointerId = String(id);
    el.style.setProperty('--c', colorForId(id));
    touchZone.appendChild(el);
    fingerEls.set(id, el);
  }
  return el;
}

function removeFingerEl(id) {
  const el = fingerEls.get(id);
  if (el) {
    el.remove();
    fingerEls.delete(id);
  }
}

function render() {
  const state = machine.getState();
  const pointers = machine.getPointers();
  const winnerId = machine.getWinnerId();

  if (state === STATES.IDLE && prevState !== STATES.IDLE) {
    resetRound();
  }
  if (state === STATES.PICKED && prevState !== STATES.PICKED) {
    audio.playPick();
  }
  prevState = state;

  touchZone.dataset.state = state;

  for (const id of [...fingerEls.keys()]) {
    if (!pointers.has(id)) removeFingerEl(id);
  }
  for (const [id, { x, y }] of pointers) {
    const el = ensureFingerEl(id);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.classList.toggle('winner', state === STATES.PICKED && id === winnerId);
  }

  if (state === STATES.IDLE) {
    hint.dataset.state = 'idle';
    hint.textContent = 'All fingers in.';
  } else if (state === STATES.ACTIVE) {
    if (pointers.size < 2) {
      hint.dataset.state = 'active-needs-more';
      hint.textContent = 'One more.';
    } else {
      hint.dataset.state = 'active-full';
    }
  } else if (state === STATES.PICKED) {
    hint.dataset.state = 'picked';
  }
}

function tickLoop() {
  machine.tick();
  render();
  requestAnimationFrame(tickLoop);
}

touchZone.addEventListener('pointerdown', (e) => {
  touchZone.setPointerCapture?.(e.pointerId);
  audio.resume();
  // Suppress the placement sound once a winner has been chosen — taps during
  // the result screen should not chirp.
  if (machine.getState() !== STATES.PICKED) {
    audio.playTouch(e.pointerId);
  }
  machine.onPointerDown(e.pointerId, e.clientX, e.clientY);
});

touchZone.addEventListener('pointermove', (e) => {
  machine.onPointerMove(e.pointerId, e.clientX, e.clientY);
});

touchZone.addEventListener('pointerup', (e) => {
  machine.onPointerUp(e.pointerId);
});

touchZone.addEventListener('pointercancel', (e) => {
  machine.onPointerCancel(e.pointerId);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    machine.reset();
    for (const id of [...fingerEls.keys()]) removeFingerEl(id);
    resetRound();
  }
});

window.addEventListener('contextmenu', (e) => e.preventDefault());

requestAnimationFrame(tickLoop);
