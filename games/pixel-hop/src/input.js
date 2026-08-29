/**
 * @module input
 * Keyboard input handler.  Tracks which keys are currently held and provides
 * one-frame "just pressed" detection used by the player and game modules.
 */

/** @type {Set<string>} Keys currently held down */
const held = new Set();

/** @type {Set<string>} Keys pressed this frame (cleared each update call) */
const justPressedSet = new Set();

/** @type {Set<string>} Keys released this frame */
const justReleasedSet = new Set();

window.addEventListener('keydown', (e) => {
  if (!held.has(e.code)) {
    justPressedSet.add(e.code);
  }
  held.add(e.code);
  // Prevent default browser scroll for arrow / space keys during gameplay
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  held.delete(e.code);
  justReleasedSet.add(e.code);
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns true while the key is held. */
export function isHeld(code) { return held.has(code); }

/** Returns true only on the first frame the key was pressed. */
export function justPressed(code) { return justPressedSet.has(code); }

/** Returns true only on the first frame the key was released. */
export function justReleased(code) { return justReleasedSet.has(code); }

/**
 * Must be called once per game-loop frame (after processing input) to reset
 * the just-pressed / just-released sets.
 */
export function clearFrame() {
  justPressedSet.clear();
  justReleasedSet.clear();
}

// Convenience: directional / action helpers
export function isLeft()  { return held.has('ArrowLeft')  || held.has('KeyA'); }
export function isRight() { return held.has('ArrowRight') || held.has('KeyD'); }
export function isJump()  {
  return held.has('Space') || held.has('ArrowUp') || held.has('KeyW');
}
export function jumpJustPressed() {
  return justPressedSet.has('Space') ||
         justPressedSet.has('ArrowUp') ||
         justPressedSet.has('KeyW') ||
         justPressedSet.has('ECGJump');
}
export function jumpJustReleased() {
  return justReleasedSet.has('Space') ||
         justReleasedSet.has('ArrowUp') ||
         justReleasedSet.has('KeyW');
}

/** Queue one full-height jump request from the ECGaming heartbeat adapter. */
export function queueJump() {
  justPressedSet.add('ECGJump');
}
export function isPause()   { return justPressedSet.has('KeyP'); }
export function isMute()    { return justPressedSet.has('KeyM'); }
export function isRestart() { return justPressedSet.has('Enter'); }

