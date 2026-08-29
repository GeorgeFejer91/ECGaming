/**
 * @module constants
 * Global constants: tile sizes, physics values, and the custom 16-color palette.
 * All graphics are drawn procedurally – no external image assets.
 */

/** Logical tile size in canvas pixels (each "pixel" is drawn 2× via CSS scaling). */
export const TILE_SIZE = 32;

/** Canvas render resolution */
export const CANVAS_W = 640;
export const CANVAS_H = 400;

/** Gravitational acceleration (pixels/s²) */
export const GRAVITY = 1400;

/** Maximum fall speed (pixels/s) */
export const MAX_FALL_SPEED = 800;

/** Coyote-time window in seconds */
export const COYOTE_TIME = 0.1;

/** Jump-buffer window in seconds */
export const JUMP_BUFFER_TIME = 0.1;

/** Fixed physics timestep */
export const FIXED_DT = 1 / 60;

// ---------------------------------------------------------------------------
// Tile IDs
// ---------------------------------------------------------------------------
export const TILE_EMPTY    = 0;
export const TILE_SOLID    = 1;   // full solid block
export const TILE_PLATFORM = 2;   // one-way platform (can jump through)
export const TILE_SPIKE    = 3;   // instant-kill hazard
export const TILE_GOAL     = 4;   // level exit flag tile

// ---------------------------------------------------------------------------
// Own 16-colour palette — inspired by the 8-bit era, entirely original
// ---------------------------------------------------------------------------
/** @type {string[]} */
export const PALETTE = [
  '#07080F', // 0  near-black
  '#1A1A3D', // 1  deep night blue
  '#2D3778', // 2  royal blue
  '#5060C8', // 3  cornflower
  '#8090FF', // 4  sky blue
  '#C0D0FF', // 5  pale blue
  '#FFFFFF', // 6  white
  '#808080', // 7  mid grey
  '#404040', // 8  dark grey
  '#C07030', // 9  golden brown
  '#F0A000', // 10 amber / gold
  '#F03030', // 11 red
  '#F07800', // 12 orange
  '#30C040', // 13 green
  '#18F0A0', // 14 mint / cyan-green
  '#E050E0', // 15 magenta / prisma
];

// Convenient named colour aliases (indexes into PALETTE)
export const COL = {
  BLACK:      0,
  NIGHT:      1,
  ROYAL:      2,
  CORN:       3,
  SKY:        4,
  PALE:       5,
  WHITE:      6,
  GREY:       7,
  DARK:       8,
  BROWN:      9,
  GOLD:       10,
  RED:        11,
  ORANGE:     12,
  GREEN:      13,
  MINT:       14,
  PRISMA:     15,
};

/** Returns the hex colour string for a palette index. */
export function col(index) {
  return PALETTE[index & 0xf];
}


