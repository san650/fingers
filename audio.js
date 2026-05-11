// Minor pentatonic on A — every combination is consonant, every finger gets a
// unique note in the order it arrives.
const PENTATONIC = [
  220.00, // A3
  261.63, // C4
  293.66, // D4
  329.63, // E4
  392.00, // G4
  440.00, // A4
];

// Major triad on C — picked sound, played with a small strum.
const CHORD = [261.63, 329.63, 392.00];

let ctx = null;
const noteIndexById = new Map();
let noteCounter = 0;

function ensureContext() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

export function resume() {
  const c = ensureContext();
  if (c && c.state === 'suspended') c.resume();
}

export function playTouch(id) {
  const c = ensureContext();
  if (!c) return;
  if (!noteIndexById.has(id)) {
    noteIndexById.set(id, noteCounter++ % PENTATONIC.length);
  }
  const freq = PENTATONIC[noteIndexById.get(id)];
  const t = c.currentTime;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.18, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0008, t + 0.45);
  osc.connect(env).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.5);
}

export function playPick() {
  const c = ensureContext();
  if (!c) return;
  const t = c.currentTime;
  CHORD.forEach((freq, i) => {
    const when = t + i * 0.04; // light strum
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 0.985, when);
    osc.frequency.linearRampToValueAtTime(freq, when + 0.08);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(0.14, when + 0.025);
    env.gain.exponentialRampToValueAtTime(0.0008, when + 1.2);
    osc.connect(env).connect(c.destination);
    osc.start(when);
    osc.stop(when + 1.3);
  });
}

export function reset() {
  noteIndexById.clear();
  noteCounter = 0;
}
