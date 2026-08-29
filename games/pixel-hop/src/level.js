/**
 * @module level
 * Loads a level from a JSON descriptor and provides tile queries
 * and a tilemap renderer.
 */

import {
  TILE_SIZE, TILE_EMPTY, TILE_SOLID, TILE_PLATFORM, TILE_SPIKE, TILE_GOAL,
  PALETTE
} from './constants.js';
import {
  drawTileSolid, drawTilePlatform, drawTileSpike, drawTileFlag,
  drawGem, drawPrisma
} from './sprites.js';

export class Level {
  /**
   * @param {object} data  Parsed JSON level descriptor
   */
  constructor(data) {
    /** @type {string} */
    this.name = data.name ?? 'Level';
    /** @type {number} */
    this.timeLimit = data.timeLimit ?? 200;
    /** @type {number[][]} */
    this.tiles = data.tiles;
    /** @type {number} */
    this.rows = this.tiles.length;
    /** @type {number} */
    this.cols = this.tiles[0].length;

    // Mutable game objects (managed by Game, but spawned from level data)
    /** @type {Array<{x:number,y:number,collected:boolean}>} */
    this.gems = (data.gems ?? []).map(g => ({ ...g, collected: false }));
    /** @type {Array<{x:number,y:number,collected:boolean}>} */
    this.powerUps = (data.powerUps ?? []).map(p => ({ ...p, collected: false }));
    /** @type {{x:number,y:number}} Player spawn (tile coords) */
    this.playerStart = data.playerStart ?? { x: 1, y: this.rows - 3 };
    /** @type {Array<object>} Enemy spawn descriptors */
    this.enemies = data.enemies ?? [];

    // Animation timer for collectibles
    this._t = 0;
  }

  // ---------------------------------------------------------------------------
  // Tile queries
  // ---------------------------------------------------------------------------

  /**
   * Returns the tile ID at (col, row), or TILE_EMPTY if out of bounds.
   * @param {number} col
   * @param {number} row
   * @returns {number}
   */
  tileAt(col, row) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      return TILE_EMPTY;
    }
    return this.tiles[row][col];
  }

  /**
   * Returns true if the tile blocks horizontal/vertical movement.
   * @param {number} col
   * @param {number} row
   */
  isSolid(col, row) {
    const t = this.tileAt(col, row);
    return t === TILE_SOLID;
  }

  /**
   * Returns true if the tile is a one-way platform.
   * @param {number} col
   * @param {number} row
   */
  isPlatform(col, row) {
    return this.tileAt(col, row) === TILE_PLATFORM;
  }

  /**
   * Returns true if the tile is a spike (lethal to player).
   * @param {number} col
   * @param {number} row
   */
  isSpike(col, row) {
    return this.tileAt(col, row) === TILE_SPIKE;
  }

  /**
   * Returns true if the tile is a solid or one-way platform blocking downward passage.
   * @param {number} col
   * @param {number} row
   */
  isFloor(col, row) {
    return this.isSolid(col, row) || this.isPlatform(col, row);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * Update animations for collectibles.
   * @param {number} dt
   */
  update(dt) {
    this._t += dt;
  }

  /**
   * Render the tilemap and collectibles.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Camera} camera
   */
  draw(ctx, camera) {
    // Determine visible tile range (+ 1 tile margin)
    const minCol = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
    const maxCol = Math.min(this.cols - 1, Math.ceil((camera.x + 640) / TILE_SIZE) + 1);
    const minRow = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
    const maxRow = Math.min(this.rows - 1, Math.ceil((camera.y + 400) / TILE_SIZE) + 1);

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const tile = this.tileAt(c, r);
        if (tile === TILE_EMPTY) continue;
        const px = c * TILE_SIZE;
        const py = r * TILE_SIZE;
        switch (tile) {
          case TILE_SOLID:    drawTileSolid(ctx, px, py);    break;
          case TILE_PLATFORM: drawTilePlatform(ctx, px, py); break;
          case TILE_SPIKE:    drawTileSpike(ctx, px, py);    break;
          case TILE_GOAL:     drawTileFlag(ctx, px, py);     break;
        }
      }
    }

    // Draw gems (with bobbing animation)
    const bob = Math.sin(this._t * 3) * 4;
    for (const gem of this.gems) {
      if (gem.collected) continue;
      const wx = gem.x * TILE_SIZE + TILE_SIZE / 2;
      const wy = gem.y * TILE_SIZE + TILE_SIZE / 2 + bob;
      drawGem(ctx, wx, wy);
    }

    // Draw power-ups (with pulsing animation)
    const pulse = 0.85 + 0.15 * Math.sin(this._t * 4);
    for (const pu of this.powerUps) {
      if (pu.collected) continue;
      const wx = pu.x * TILE_SIZE + TILE_SIZE / 2;
      const wy = pu.y * TILE_SIZE + TILE_SIZE / 2;
      drawPrisma(ctx, wx, wy, TILE_SIZE * pulse);
    }
  }
}


