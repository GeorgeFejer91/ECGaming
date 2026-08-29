/**
 * @module camera
 * Smooth side-scrolling camera that follows the player horizontally.
 * The camera is clamped so it never shows outside the level bounds.
 */

import { CANVAS_W, CANVAS_H, TILE_SIZE } from './constants.js';

export class Camera {
  /**
   * @param {number} levelCols  Total tile columns in the level
   * @param {number} levelRows  Total tile rows in the level
   */
  constructor(levelCols, levelRows) {
    /** @type {number} Current camera X offset (canvas pixels) */
    this.x = 0;
    /** @type {number} Current camera Y offset (canvas pixels, usually 0 for pure H-scroll) */
    this.y = 0;
    this._levelW = levelCols * TILE_SIZE;
    this._levelH = levelRows * TILE_SIZE;
  }

  /**
   * Smoothly move the camera toward the target position (player centre).
   * @param {number} targetX  World X of target (e.g. player centre)
   * @param {number} targetY  World Y of target
   * @param {number} dt       Delta time in seconds
   */
  update(targetX, targetY, dt) {
    const smoothing = 8;  // higher = snappier

    // Desired camera top-left so that the target is centred on screen
    const desiredX = targetX - CANVAS_W / 2;
    const desiredY = targetY - CANVAS_H / 2;

    this.x += (desiredX - this.x) * smoothing * dt;
    this.y += (desiredY - this.y) * smoothing * dt;

    // Clamp to level bounds
    this.x = Math.max(0, Math.min(this.x, this._levelW - CANVAS_W));
    this.y = Math.max(0, Math.min(this.y, this._levelH - CANVAS_H));
  }

  /**
   * Apply the camera transform to the canvas context.
   * Call before drawing world objects; call restore() afterwards.
   * @param {CanvasRenderingContext2D} ctx
   */
  apply(ctx) {
    ctx.save();
    ctx.translate(-Math.round(this.x), -Math.round(this.y));
  }

  /**
   * Restore the canvas transform after drawing.
   * @param {CanvasRenderingContext2D} ctx
   */
  restore(ctx) {
    ctx.restore();
  }

  /**
   * Convert screen coordinates to world coordinates.
   * @param {number} sx
   * @param {number} sy
   * @returns {{x:number, y:number}}
   */
  screenToWorld(sx, sy) {
    return { x: sx + this.x, y: sy + this.y };
  }
}


