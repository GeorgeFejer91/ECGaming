/**
 * @module sprites
 * Procedural pixel-art sprite renderer.
 *
 * Every graphic in the game is drawn directly onto the canvas from small
 * pixel matrices — no external image files are used.
 * Colour indices reference the custom 16-colour PALETTE from constants.js.
 */

import { PALETTE, TILE_SIZE } from './constants.js';

// ---------------------------------------------------------------------------
// Low-level pixel-matrix renderer
// ---------------------------------------------------------------------------

/**
 * Draws a pixel matrix scaled to fit a given rectangle on the canvas.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[][]} matrix  - 2-D array of palette indices; -1 = transparent
 * @param {number} x           - Canvas X (top-left)
 * @param {number} y           - Canvas Y (top-left)
 * @param {number} w           - Target draw width  (default: TILE_SIZE)
 * @param {number} h           - Target draw height (default: TILE_SIZE)
 * @param {boolean} [flipX]    - Mirror horizontally
 */
export function drawPixels(ctx, matrix, x, y, w = TILE_SIZE, h = TILE_SIZE, flipX = false) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const pw = w / cols;
  const ph = h / rows;

  ctx.save();
  if (flipX) {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    x = 0;
    y = 0;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = matrix[r][c];
      if (idx < 0) continue;          // transparent
      ctx.fillStyle = PALETTE[idx & 0xf];
      ctx.fillRect(
        (flipX ? 0 : x) + c * pw,
        (flipX ? 0 : y) + r * ph,
        pw, ph
      );
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Sprite definitions (pixel matrices, 8×8 unless stated)
// ---------------------------------------------------------------------------

// Solid ground tile (stone / brick look)
const TILE_SOLID_MAT = [
  [ 9, 9, 9, 9, 9, 9, 9, 9],
  [ 9,10,10, 9,10,10, 9, 9],
  [ 9,10,10, 9,10,10, 9, 9],
  [ 8, 8, 8, 8, 8, 8, 8, 8],
  [ 9, 9,10,10, 9, 9,10, 9],
  [ 9, 9,10,10, 9, 9,10, 9],
  [ 9, 9,10,10, 9, 9,10, 9],
  [ 8, 8, 8, 8, 8, 8, 8, 8],
];

// One-way platform tile (wooden plank look)
const TILE_PLATFORM_MAT = [
  [-1,-1,-1,-1,-1,-1,-1,-1],
  [-1,-1,-1,-1,-1,-1,-1,-1],
  [-1,-1,-1,-1,-1,-1,-1,-1],
  [ 9,10, 9,10, 9,10, 9,10],
  [ 9, 9,10, 9,10, 9, 9, 9],
  [ 8, 8, 8, 8, 8, 8, 8, 8],
  [-1,-1,-1,-1,-1,-1,-1,-1],
  [-1,-1,-1,-1,-1,-1,-1,-1],
];

// Gem / collectible (diamond shape, cyan/mint)
const GEM_MAT = [
  [-1,-1, 4, 4,-1,-1,-1,-1],
  [-1, 4, 5,14, 4,-1,-1,-1],
  [ 4, 5,14,14, 5, 4,-1,-1],
  [ 4,14,14,14,14, 4,-1,-1],
  [-1, 4,14,14, 4,-1,-1,-1],
  [-1,-1, 4, 4,-1,-1,-1,-1],
  [-1,-1,-1,-1,-1,-1,-1,-1],
  [-1,-1,-1,-1,-1,-1,-1,-1],
];

// Spike hazard tile (pointing up)
const SPIKE_MAT = [
  [-1, 8,-1,-1,-1, 8,-1,-1],
  [-1, 8, 8,-1, 8, 8,-1,-1],
  [-1, 7, 8,-1, 7, 8,-1,-1],
  [ 8, 7, 8, 8, 7, 8, 8, 8],
  [ 8, 7, 7, 7, 7, 7, 7, 8],
  [ 8, 8, 8, 8, 8, 8, 8, 8],
  [-1,-1,-1,-1,-1,-1,-1,-1],
  [-1,-1,-1,-1,-1,-1,-1,-1],
];

// Goal flag (pole + flag)
const FLAG_MAT = [
  [-1,-1,13,13,13,-1,-1,-1],
  [-1,-1,13, 6, 6,13,-1,-1],
  [-1,-1,13, 6, 6,-1,-1,-1],
  [-1,-1,13,-1,-1,-1,-1,-1],
  [-1,-1,13,-1,-1,-1,-1,-1],
  [-1,-1,13,-1,-1,-1,-1,-1],
  [-1,-1,13,-1,-1,-1,-1,-1],
  [ 8, 8,13, 8, 8, 8, 8, 8],
];

// Prisma power-up (magenta crystal)
const PRISMA_MAT = [
  [-1,-1,15,15,-1,-1,-1,-1],
  [-1,15, 6,15,15,-1,-1,-1],
  [15, 6,15,15, 6,15,-1,-1],
  [15,15,15,15,15,15,-1,-1],
  [-1,15,15,15,15,-1,-1,-1],
  [-1,-1,15,15,-1,-1,-1,-1],
  [-1,-1,-1,-1,-1,-1,-1,-1],
  [-1,-1,-1,-1,-1,-1,-1,-1],
];

// ---------------------------------------------------------------------------
// Player sprites (8×12 logical pixels, drawn at variable size)
// Normal mode: cornflower/blue
// ---------------------------------------------------------------------------

// Normal mode — idle / walking frames
const PLAYER_NORMAL = [
  [-1,-1, 3, 3, 3,-1,-1,-1],  // hair
  [-1, 3, 5, 5, 5, 3,-1,-1],  // face
  [-1, 3, 5,11, 5, 3,-1,-1],  // face w/ eye
  [-1, 3, 3, 3, 3, 3,-1,-1],  // chin
  [-1, 3, 2, 3, 2, 3,-1,-1],  // body
  [ 3, 2, 2, 2, 2, 2, 3,-1],  // body wide
  [ 3, 2, 2, 2, 2, 2, 3,-1],  // body wide
  [-1, 3, 3, 3, 3, 3,-1,-1],  // waist
  [-1, 2, 9,-1, 9, 2,-1,-1],  // legs apart
  [-1, 2, 9,-1, 9, 2,-1,-1],  // legs apart
  [-1, 2, 9,-1, 9, 2,-1,-1],  // legs
  [-1, 9, 9,-1, 9, 9,-1,-1],  // feet
];

// Prisma mode — alternate palette (magenta/mint)
const PLAYER_PRISMA = [
  [-1,-1,15,15,15,-1,-1,-1],
  [-1,15, 5, 5, 5,15,-1,-1],
  [-1,15, 5,10, 5,15,-1,-1],
  [-1,15,15,15,15,15,-1,-1],
  [-1,14,15,14,15,14,-1,-1],
  [15,14,14,14,14,14,15,-1],
  [15,14,14,14,14,14,15,-1],
  [-1,15,15,15,15,15,-1,-1],
  [-1,14,15,-1,15,14,-1,-1],
  [-1,14,15,-1,15,14,-1,-1],
  [-1,14,15,-1,15,14,-1,-1],
  [-1,15,15,-1,15,15,-1,-1],
];

// Walk frame 2 (legs swapped – reuse matrix with slight offset)
const PLAYER_WALK2_NORMAL = [
  [-1,-1, 3, 3, 3,-1,-1,-1],
  [-1, 3, 5, 5, 5, 3,-1,-1],
  [-1, 3, 5,11, 5, 3,-1,-1],
  [-1, 3, 3, 3, 3, 3,-1,-1],
  [-1, 3, 2, 3, 2, 3,-1,-1],
  [ 3, 2, 2, 2, 2, 2, 3,-1],
  [ 3, 2, 2, 2, 2, 2, 3,-1],
  [-1, 3, 3, 3, 3, 3,-1,-1],
  [-1, 9, 2,-1, 2, 9,-1,-1],
  [-1, 9, 2,-1, 2, 9,-1,-1],
  [-1, 9, 2,-1, 2, 9,-1,-1],
  [-1, 9, 9,-1, 9, 9,-1,-1],
];

// ---------------------------------------------------------------------------
// Ground enemy (patrol) — orange/red crab-like creature
// ---------------------------------------------------------------------------
const ENEMY_GROUND = [
  [-1, 8,-1,-1,-1,-1, 8,-1],
  [ 8,12,12,12,12,12,12, 8],
  [ 8,12,11,12,11,12,12, 8],
  [ 8,12,12,12,12,12,12, 8],
  [-1, 8,12,12,12,12, 8,-1],
  [-1,-1, 8, 8, 8, 8,-1,-1],
  [-1, 8,-1,-1,-1,-1, 8,-1],
  [-1, 8,-1,-1,-1,-1, 8,-1],
];

// Ground enemy walk frame 2
const ENEMY_GROUND2 = [
  [-1, 8,-1,-1,-1,-1, 8,-1],
  [ 8,12,12,12,12,12,12, 8],
  [ 8,12,11,12,11,12,12, 8],
  [ 8,12,12,12,12,12,12, 8],
  [-1, 8,12,12,12,12, 8,-1],
  [-1,-1, 8, 8, 8, 8,-1,-1],
  [ 8,-1,-1,-1,-1,-1,-1, 8],
  [ 8,-1,-1,-1,-1,-1,-1, 8],
];

// Jumping enemy — green bouncy slime
const ENEMY_JUMP = [
  [-1,-1,13,13,13,13,-1,-1],
  [-1,13,14,14,14,13,-1,-1],
  [13,14,14,11,14,14,13,-1],
  [13,14,14,14,14,14,13,-1],
  [13,13,14,14,14,13,13,-1],
  [-1,13,13,13,13,13,-1,-1],
  [-1,-1,-1,-1,-1,-1,-1,-1],
  [-1,-1,-1,-1,-1,-1,-1,-1],
];

// Jumping enemy squished frame (on ground)
const ENEMY_JUMP_SQUAT = [
  [-1,-1,-1,-1,-1,-1,-1,-1],
  [-1,13,14,14,14,13,-1,-1],
  [13,14,14,11,14,14,13,-1],
  [13,14,14,14,14,14,13,-1],
  [13,13,14,14,14,13,13,-1],
  [-1,13,13,13,13,13,-1,-1],
  [-1,-1,-1,-1,-1,-1,-1,-1],
  [-1,-1,-1,-1,-1,-1,-1,-1],
];

// ---------------------------------------------------------------------------
// Public draw functions
// ---------------------------------------------------------------------------

/**
 * Draw a solid ground tile.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 */
export function drawTileSolid(ctx, x, y) {
  ctx.fillStyle = PALETTE[9];
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  drawPixels(ctx, TILE_SOLID_MAT, x, y, TILE_SIZE, TILE_SIZE);
}

/**
 * Draw a one-way platform tile.
 */
export function drawTilePlatform(ctx, x, y) {
  drawPixels(ctx, TILE_PLATFORM_MAT, x, y, TILE_SIZE, TILE_SIZE);
}

/**
 * Draw a spike hazard tile.
 */
export function drawTileSpike(ctx, x, y) {
  drawPixels(ctx, SPIKE_MAT, x, y, TILE_SIZE, TILE_SIZE);
}

/**
 * Draw the goal flag tile.
 */
export function drawTileFlag(ctx, x, y) {
  drawPixels(ctx, FLAG_MAT, x, y, TILE_SIZE, TILE_SIZE);
}

/**
 * Draw a collectible gem.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x   Canvas X (centre)
 * @param {number} y   Canvas Y (centre)
 * @param {number} size  Draw size (default TILE_SIZE * 0.7)
 */
export function drawGem(ctx, x, y, size = TILE_SIZE * 0.7) {
  drawPixels(ctx, GEM_MAT, x - size / 2, y - size / 2, size, size);
}

/**
 * Draw the Prisma power-up crystal.
 */
export function drawPrisma(ctx, x, y, size = TILE_SIZE * 0.8) {
  drawPixels(ctx, PRISMA_MAT, x - size / 2, y - size / 2, size, size);
}

/**
 * Draw the player.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x          Canvas X of left edge
 * @param {number} y          Canvas Y of top edge
 * @param {number} w          Draw width
 * @param {number} h          Draw height
 * @param {boolean} prismaMode
 * @param {boolean} facingLeft
 * @param {number}  walkFrame  0 or 1
 */
export function drawPlayer(ctx, x, y, w, h, prismaMode, facingLeft, walkFrame) {
  let mat;
  if (prismaMode) {
    mat = PLAYER_PRISMA;
  } else {
    mat = walkFrame === 1 ? PLAYER_WALK2_NORMAL : PLAYER_NORMAL;
  }
  drawPixels(ctx, mat, x, y, w, h, facingLeft);
}

/**
 * Draw a ground patrol enemy.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} walkFrame 0 or 1
 * @param {boolean} facingLeft
 */
export function drawEnemyGround(ctx, x, y, w, h, walkFrame, facingLeft) {
  const mat = walkFrame === 1 ? ENEMY_GROUND2 : ENEMY_GROUND;
  drawPixels(ctx, mat, x, y, w, h, facingLeft);
}

/**
 * Draw a jumping enemy.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {boolean} isAirborne
 */
export function drawEnemyJump(ctx, x, y, w, h, isAirborne) {
  const mat = isAirborne ? ENEMY_JUMP : ENEMY_JUMP_SQUAT;
  drawPixels(ctx, mat, x, y, w, h);
}


