/**
 * @module enemy
 * Enemy base class and two concrete variants:
 *   - GroundEnemy  : patrols back and forth on a platform
 *   - JumpEnemy    : bounces up and down periodically
 *
 * Stomp from above defeats enemies (+200 score).
 * Side collision costs the player a life.
 */

import { TILE_SIZE, GRAVITY, MAX_FALL_SPEED } from './constants.js';
import { drawEnemyGround, drawEnemyJump } from './sprites.js';
import { playStomp } from './audio.js';

// ---------------------------------------------------------------------------
// Base Enemy class
// ---------------------------------------------------------------------------

export class Enemy {
  /**
   * @param {number} x  World X (pixel)
   * @param {number} y  World Y (pixel)
   * @param {number} w  Width  (pixel)
   * @param {number} h  Height (pixel)
   */
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.w = w;
    this.h = h;
    /** @type {boolean} */
    this.alive = true;
    this._squishTimer = 0;  // death animation
  }

  get right()   { return this.x + this.w; }
  get bottom()  { return this.y + this.h; }
  get centerX() { return this.x + this.w / 2; }
  get centerY() { return this.y + this.h / 2; }

  /**
   * Horizontal tile collision.
   * @param {import('./level.js').Level} level
   */
  _resolveX(level) {
    const top = this.y + 2;
    const bot = this.y + this.h - 2;
    const rTop = Math.floor(top / TILE_SIZE);
    const rBot = Math.floor(bot / TILE_SIZE);

    if (this.vx < 0) {
      const cLeft = Math.floor(this.x / TILE_SIZE);
      for (let r = rTop; r <= rBot; r++) {
        if (level.isSolid(cLeft, r)) {
          this.x = (cLeft + 1) * TILE_SIZE;
          this.vx = -this.vx;
          return;
        }
      }
    } else {
      const cRight = Math.floor((this.x + this.w - 1) / TILE_SIZE);
      for (let r = rTop; r <= rBot; r++) {
        if (level.isSolid(cRight, r)) {
          this.x = cRight * TILE_SIZE - this.w;
          this.vx = -this.vx;
          return;
        }
      }
    }
  }

  /**
   * Vertical tile collision (with floor detection).
   * @param {import('./level.js').Level} level
   * @returns {boolean} true if on ground
   */
  _resolveY(level) {
    const left  = this.x + 2;
    const right = this.x + this.w - 2;
    const cLeft  = Math.floor(left  / TILE_SIZE);
    const cRight = Math.floor(right / TILE_SIZE);

    if (this.vy > 0) {
      const rBot = Math.floor((this.y + this.h) / TILE_SIZE);
      for (let c = cLeft; c <= cRight; c++) {
        if (level.isSolid(c, rBot) || level.isPlatform(c, rBot)) {
          this.y = rBot * TILE_SIZE - this.h;
          this.vy = 0;
          return true;
        }
      }
    } else if (this.vy < 0) {
      const rTop = Math.floor(this.y / TILE_SIZE);
      for (let c = cLeft; c <= cRight; c++) {
        if (level.isSolid(c, rTop)) {
          this.y = (rTop + 1) * TILE_SIZE;
          this.vy = 0;
          break;
        }
      }
    }
    return false;
  }

  /**
   * Checks if this enemy's AABB overlaps with the player.
   * Returns the collision side from the player's perspective.
   * @param {import('./player.js').Player} player
   * @returns {'none'|'top'|'side'}
   */
  overlapWithPlayer(player) {
    const px = player.x + 2, pr = player.right  - 2;
    const py = player.y,     pb = player.bottom;
    const ex = this.x,       er = this.right;
    const ey = this.y + 4,   eb = this.bottom;

    if (pr <= ex || px >= er || pb <= ey || py >= eb) return 'none';

    // Player stomps from above if his bottom overlaps the top quarter
    const topQuarter = ey + (eb - ey) * 0.4;
    if (player.vy > 0 && pb < topQuarter + 8) return 'top';
    return 'side';
  }

  /**
   * Defeat this enemy (stomped from above).
   */
  defeat() {
    this.alive = false;
    playStomp();
  }
}

// ---------------------------------------------------------------------------
// Ground Patrol Enemy
// ---------------------------------------------------------------------------

export class GroundEnemy extends Enemy {
  /**
   * @param {number} x        World X
   * @param {number} y        World Y
   * @param {number} [speed]  Walk speed in px/s
   */
  constructor(x, y, speed = 80) {
    super(x, y, Math.round(TILE_SIZE * 0.9), Math.round(TILE_SIZE * 0.8));
    this.vx = speed;
    this._speed = speed;
    this._walkTimer = 0;
    this._walkFrame = 0;
  }

  /**
   * @param {number} dt
   * @param {import('./level.js').Level} level
   */
  update(dt, level) {
    if (!this.alive) return;

    // Gravity
    this.vy += GRAVITY * dt;
    if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;

    // Move X
    this.x += this.vx * dt;
    this._resolveX(level);

    // Turn around at ledge edge
    const nextCol = Math.floor((this.x + (this.vx > 0 ? this.w + 2 : -2)) / TILE_SIZE);
    const footRow = Math.floor((this.y + this.h + 2) / TILE_SIZE);
    if (!level.isSolid(nextCol, footRow) && !level.isPlatform(nextCol, footRow)) {
      this.vx = -this.vx;
    }

    // Move Y
    this.y += this.vy * dt;
    this._resolveY(level);

    // Walk animation
    this._walkTimer += dt;
    if (this._walkTimer > 0.2) {
      this._walkTimer = 0;
      this._walkFrame = 1 - this._walkFrame;
    }
  }

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    if (!this.alive) return;
    drawEnemyGround(ctx, this.x, this.y, this.w, this.h,
                    this._walkFrame, this.vx < 0);
  }
}

// ---------------------------------------------------------------------------
// Jumping Enemy
// ---------------------------------------------------------------------------

export class JumpEnemy extends Enemy {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    super(x, y, Math.round(TILE_SIZE * 0.8), Math.round(TILE_SIZE * 0.75));
    this._onGround = false;
    this._jumpTimer = 0;
    this._jumpInterval = 1.2;  // jump every 1.2 s
    this._jumpForce = -480;
  }

  /**
   * @param {number} dt
   * @param {import('./level.js').Level} level
   */
  update(dt, level) {
    if (!this.alive) return;

    // Gravity
    this.vy += GRAVITY * dt;
    if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;

    // Auto-jump timer
    this._jumpTimer += dt;
    if (this._onGround && this._jumpTimer >= this._jumpInterval) {
      this.vy = this._jumpForce;
      this._onGround = false;
      this._jumpTimer = 0;
    }

    // Move Y
    this.y += this.vy * dt;
    this._onGround = this._resolveY(level);

    // Small horizontal drift toward spawn — keep it simple: no drift
  }

  /** @param {CanvasRenderingContext2D} ctx */
  draw(ctx) {
    if (!this.alive) return;
    drawEnemyJump(ctx, this.x, this.y, this.w, this.h, !this._onGround);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an enemy from a spawn descriptor object.
 * @param {object} desc
 * @param {string} desc.type   'ground' | 'jump'
 * @param {number} desc.x      Tile column
 * @param {number} desc.y      Tile row
 * @param {number} [desc.speed]
 * @returns {Enemy}
 */
export function createEnemy(desc) {
  const wx = desc.x * TILE_SIZE;
  const wy = desc.y * TILE_SIZE;
  switch (desc.type) {
    case 'jump':   return new JumpEnemy(wx, wy);
    case 'ground':
    default:       return new GroundEnemy(wx, wy, desc.speed ?? 80);
  }
}


