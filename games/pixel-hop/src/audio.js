/**
 * @module audio
 * Web Audio API sound engine.  Generates all sounds procedurally using
 * oscillators — no sample files or external assets.
 *
 * Supported sounds:
 *   jump, gem, stomp, powerup, die, levelComplete
 */

let ctx = null;
let muted = false;

/** Lazily create the AudioContext on first use (browser autoplay policy). */
function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  return ctx;
}

/**
 * Plays a quick square-wave tone.
 * @param {number}  freq        Frequency in Hz
 * @param {number}  duration    Duration in seconds
 * @param {number}  volume      Gain 0–1
 * @param {number}  [freq2]     Optional second frequency (slides to it)
 */
function beep(freq, duration, volume = 0.3, freq2 = null) {
  if (muted) return;
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, c.currentTime);
  if (freq2 !== null) {
    osc.frequency.linearRampToValueAtTime(freq2, c.currentTime + duration);
  }

  gain.gain.setValueAtTime(volume, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);

  osc.connect(gain);
  gain.connect(c.destination);

  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration);
}

/**
 * Plays two square-wave tones simultaneously.
 * @param {number} f1
 * @param {number} f2
 * @param {number} dur
 * @param {number} vol
 */
function chord(f1, f2, dur, vol = 0.2) {
  beep(f1, dur, vol);
  beep(f2, dur, vol);
}

// ---------------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------------

/** Short upward chirp played when the player jumps. */
export function playJump() {
  beep(300, 0.08, 0.25, 600);
}

/** Chime played when collecting a gem. */
export function playGem() {
  beep(880, 0.06, 0.2);
  setTimeout(() => beep(1320, 0.08, 0.2), 60);
}

/** Low thud when stomping an enemy. */
export function playStomp() {
  beep(120, 0.12, 0.3, 60);
}

/** Rising arpeggio when picking up the Prisma power-up. */
export function playPowerup() {
  const notes = [440, 550, 660, 880];
  notes.forEach((n, i) => setTimeout(() => beep(n, 0.07, 0.25), i * 60));
}

/** Descending tone on player death. */
export function playDie() {
  beep(400, 0.08, 0.3, 200);
  setTimeout(() => beep(200, 0.15, 0.3, 80), 100);
}

/** Fanfare for completing a level. */
export function playLevelComplete() {
  const seq = [523, 659, 784, 1047];
  seq.forEach((n, i) => setTimeout(() => beep(n, 0.12, 0.25), i * 100));
}

/** Toggle mute state. */
export function toggleMute() {
  muted = !muted;
  return muted;
}

/** Current mute state. */
export function isMuted() { return muted; }


