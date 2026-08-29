/**
 * @module main
 * Entry point.  Bootstraps the canvas, starts the fixed-timestep game loop,
 * and delegates all logic to the Game class.
 *
 * Game loop pattern:
 *   - Fixed physics timestep: 1/60 s (FIXED_DT)
 *   - Accumulator absorbs leftover time between rAF frames
 *   - Rendering happens once per rAF frame (after physics updates)
 */

import { Game }      from './game.js';
import { clearFrame } from './input.js';
import { FIXED_DT, CANVAS_W, CANVAS_H } from './constants.js';

// ---------------------------------------------------------------------------
// Canvas setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

canvas.width  = CANVAS_W;
canvas.height = CANVAS_H;

// Crisp pixel rendering
ctx.imageSmoothingEnabled = false;

// ---------------------------------------------------------------------------
// Game instance
// ---------------------------------------------------------------------------

const game = new Game(ctx);

// ---------------------------------------------------------------------------
// Fixed-timestep loop
// ---------------------------------------------------------------------------

let lastTime   = null;
let accumulator = 0;

/** @param {DOMHighResTimeStamp} timestamp */
function loop(timestamp) {
  if (lastTime === null) lastTime = timestamp;
  const elapsed = (timestamp - lastTime) / 1000; // convert ms → s
  lastTime = timestamp;

  // Cap elapsed to avoid spiral of death on tab switch / long pauses
  const dt = Math.min(elapsed, 0.1);
  accumulator += dt;

  // Fixed-step physics updates
  while (accumulator >= FIXED_DT) {
    game.update(FIXED_DT);
    clearFrame();
    accumulator -= FIXED_DT;
  }

  // Render
  game.draw();

  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Async init then start loop
// ---------------------------------------------------------------------------

game.init()
  .then(() => {
    requestAnimationFrame(loop);
  })
  .catch(err => {
    ctx.fillStyle = '#07080F';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#F03030';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Failed to load levels.', CANVAS_W / 2, CANVAS_H / 2 - 20);
    ctx.fillStyle = '#C0D0FF';
    ctx.font = '12px monospace';
    ctx.fillText(err.message, CANVAS_W / 2, CANVAS_H / 2 + 10);
    ctx.fillText('Open index.html via a local server (e.g. npx serve .)', CANVAS_W / 2, CANVAS_H / 2 + 35);
    console.error(err);
  });


