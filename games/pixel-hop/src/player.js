/**
 * @module player
 * Player entity: physics, input, coyote time, jump buffer,
 * Prisma power-up mode, collision detection with the tilemap.
 */

import {
  TILE_SIZE, GRAVITY, MAX_FALL_SPEED, COYOTE_TIME, JUMP_BUFFER_TIME,
  TILE_SPIKE, TILE_GOAL, FIXED_DT
} from './constants.js';
import * as Input from './input.js';
import { drawPlayer } from './sprites.js';
import { playJump, playDie, playPowerup } from './audio.js';

// Physics constants
const WALK_SPEED      = 220;   // px/s max horizontal speed
const WALK_ACCEL      = 1800;  // px/s² acceleration
const FRICTION        = 1400;  // px/s² deceleration when no input
const JUMP_VELOCITY   = -560;  // px/s initial jump impulse
const JUMP_CUT        = 0.45;  // velocity multiplied on jump-button release
const DOUBLE_JUMP_VEL = -480;  // px/s second jump (prisma mode)

const PLAYER_W = Math.round(TILE_SIZE * 0.72);
const PLAYER_H = Math.round(TILE_SIZE * 1.1);

export class Player {
  /**
   * @param {number} startX  World X (pixel)
   * @param {number} startY  World Y (pixel)
   */
  constructor(startX, startY) {
    this.x = startX;
    this.y = startY;
    this.vx = 0;
    this.vy = 0;

    this.w = PLAYER_W;
    this.h = PLAYER_H;

    /** @type {boolean} On the ground this frame */
    this.onGround = false;

    /** Coyote timer: seconds since last left ground */
    this._coyote = 0;
    /** Jump buffer timer: seconds since jump was requested */
    this._jumpBuf = 0;
    /** Whether the second jump has been used (prisma mode) */
    this._doubleJumpUsed = false;
    /** @type {boolean} Prisma power-up active */
    this.prismaMode = false;
    /** How long prisma mode lasts (seconds) */
    this._prismaTimer = 0;

    /** @type {boolean} Player is alive */
    this.alive = true;
    /** @type {boolean} Player reached the goal */
    this.reachedGoal = false;

    // Animation
    this._walkTimer = 0;
    this._walkFrame = 0;
    this._facingLeft = false;

    // Invincibility frames after taking damage
    this._iframes = 0;
  }

  get centerX() { return this.x + this.w / 2; }
  get centerY() { return this.y + this.h / 2; }
  get right()   { return this.x + this.w; }
  get bottom()  { return this.y + this.h; }

  /**
   * Activate Prisma power-up mode.
   */
  activatePrisma() {
    this.prismaMode = true;
    this._prismaTimer = 15; // 15 seconds
    this._doubleJumpUsed = false;
    playPowerup();
  }

  /**
   * Deactivate Prisma mode (timer expired).
   */
  _deactivatePrisma() {
    this.prismaMode = false;
    this._prismaTimer = 0;
    this._doubleJumpUsed = false;
  }

  /**
   * Update player state for one fixed timestep.
   * @param {number}  dt
   * @param {import('./level.js').Level} level
   */
  update(dt, level) {
    if (!this.alive) return;

    // ------------------------------------------------------------------
    // Prisma timer
    // ------------------------------------------------------------------
    if (this.prismaMode) {
      this._prismaTimer -= dt;
      if (this._prismaTimer <= 0) this._deactivatePrisma();
    }

    // Invincibility frames
    if (this._iframes > 0) this._iframes -= dt;

    // ------------------------------------------------------------------
    // Horizontal input
    // ------------------------------------------------------------------
    const left  = Input.isLeft();
    const right = Input.isRight();

    if (left && !right) {
      this.vx -= WALK_ACCEL * dt;
      if (this.vx < -WALK_SPEED) this.vx = -WALK_SPEED;
      this._facingLeft = true;
    } else if (right && !left) {
      this.vx += WALK_ACCEL * dt;
      if (this.vx > WALK_SPEED) this.vx = WALK_SPEED;
      this._facingLeft = false;
    } else {
      // Friction
      if (this.vx > 0) {
        this.vx -= FRICTION * dt;
        if (this.vx < 0) this.vx = 0;
      } else if (this.vx < 0) {
        this.vx += FRICTION * dt;
        if (this.vx > 0) this.vx = 0;
      }
    }

    // ------------------------------------------------------------------
    // Jump buffer: record if jump was just pressed
    // ------------------------------------------------------------------
    if (Input.jumpJustPressed()) {
      this._jumpBuf = JUMP_BUFFER_TIME;
    } else {
      this._jumpBuf = Math.max(0, this._jumpBuf - dt);
    }

    // Coyote time: how long we've been off the ground
    if (this.onGround) {
      this._coyote = COYOTE_TIME;
      this._doubleJumpUsed = false;
    } else {
      this._coyote = Math.max(0, this._coyote - dt);
    }

    // ------------------------------------------------------------------
    // Gravity
    // ------------------------------------------------------------------
    this.vy += GRAVITY * dt;
    if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;

    // ------------------------------------------------------------------
    // Jump logic
    // ------------------------------------------------------------------
    if (this._jumpBuf > 0) {
      if (this._coyote > 0) {
        // Normal jump
        this.vy = JUMP_VELOCITY;
        this._coyote = 0;
        this._jumpBuf = 0;
        playJump();
      } else if (this.prismaMode && !this._doubleJumpUsed && !this.onGround) {
        // Double jump (prisma only)
        this.vy = DOUBLE_JUMP_VEL;
        this._doubleJumpUsed = true;
        this._jumpBuf = 0;
        playJump();
      }
    }

    // Jump-cut: shorten jump if button released early
    if (Input.jumpJustReleased() && this.vy < 0) {
      this.vy *= JUMP_CUT;
    }

    // ------------------------------------------------------------------
    // Move X then resolve, then move Y then resolve
    // ------------------------------------------------------------------
    this.x += this.vx * dt;
    this._resolveX(level);

    this.y += this.vy * dt;
    this.onGround = false;
    this._resolveY(level);

    // ------------------------------------------------------------------
    // World bounds clamp (don't fall off left edge)
    // ------------------------------------------------------------------
    if (this.x < 0) { this.x = 0; this.vx = 0; }

    // ------------------------------------------------------------------
    // Hazard / goal checks on current tile overlaps
    // ------------------------------------------------------------------
    this._checkHazardsAndGoal(level);

    // ------------------------------------------------------------------
    // Walk animation
    // ------------------------------------------------------------------
    if (this.onGround && Math.abs(this.vx) > 10) {
      this._walkTimer += dt;
      if (this._walkTimer > 0.15) {
        this._walkTimer = 0;
        this._walkFrame = 1 - this._walkFrame;
      }
    } else {
      this._walkFrame = 0;
      this._walkTimer = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Tile collision helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve horizontal tile collisions.
   * @param {import('./level.js').Level} level
   */
  _resolveX(level) {
    const left  = this.x;
    const right = this.x + this.w - 1;
    const top   = this.y + 2;          // small top margin
    const bot   = this.y + this.h - 2; // small bottom margin

    const cLeft  = Math.floor(left  / TILE_SIZE);
    const cRight = Math.floor(right / TILE_SIZE);
    const rTop   = Math.floor(top   / TILE_SIZE);
    const rBot   = Math.floor(bot   / TILE_SIZE);

    for (let r = rTop; r <= rBot; r++) {
      if (this.vx < 0 && level.isSolid(cLeft, r)) {
        this.x = (cLeft + 1) * TILE_SIZE;
        this.vx = 0;
        break;
      }
      if (this.vx > 0 && level.isSolid(cRight, r)) {
        this.x = cRight * TILE_SIZE - this.w;
        this.vx = 0;
        break;
      }
    }
  }

  /**
   * Resolve vertical tile collisions.
   * @param {import('./level.js').Level} level
   */
  _resolveY(level) {
    const left  = this.x + 2;
    const right = this.x + this.w - 2;
    const top   = this.y;
    const bot   = this.y + this.h;

    const cLeft  = Math.floor(left  / TILE_SIZE);
    const cRight = Math.floor(right / TILE_SIZE);
    const rTop   = Math.floor(top   / TILE_SIZE);
    const rBot   = Math.floor(bot   / TILE_SIZE);

    if (this.vy < 0) {
      // Moving up — check ceiling (solid only, not platform)
      for (let c = cLeft; c <= cRight; c++) {
        if (level.isSolid(c, rTop)) {
          this.y = (rTop + 1) * TILE_SIZE;
          this.vy = 0;
          break;
        }
      }
    } else {
      // Moving down — check floor
      for (let c = cLeft; c <= cRight; c++) {
        if (level.isSolid(c, rBot)) {
          this.y = rBot * TILE_SIZE - this.h;
          this.vy = 0;
          this.onGround = true;
          break;
        }
        // One-way platform: only land if we were above it last frame
        if (level.isPlatform(c, rBot)) {
          const tileTop = rBot * TILE_SIZE;
          if (this.y + this.h - this.vy * FIXED_DT <= tileTop + 2) {
            this.y = tileTop - this.h;
            this.vy = 0;
            this.onGround = true;
            break;
          }
        }
      }
    }
  }

  /**
   * Check for spike and goal tile overlaps across the player's full AABB.
   * @param {import('./level.js').Level} level
   */
  _checkHazardsAndGoal(level) {
    // Tile columns / rows covered by the player bounding box
    const cL = Math.floor(this.x / TILE_SIZE);
    const cR = Math.floor((this.x + this.w - 1) / TILE_SIZE);
    const rT = Math.floor(this.y / TILE_SIZE);
    const rB = Math.floor((this.y + this.h - 1) / TILE_SIZE);

    for (let r = rT; r <= rB; r++) {
      for (let c = cL; c <= cR; c++) {
        const t = level.tileAt(c, r);
        if (t === TILE_SPIKE && this._iframes <= 0) {
          this._die();
          return;
        }
        if (t === TILE_GOAL) {
          this.reachedGoal = true;
          return;
        }
      }
    }

    // Fall off bottom of map
    if (this.y > level.rows * TILE_SIZE) {
      this._die();
    }
  }

  /**
   * Kill the player.
   */
  _die() {
    if (this._iframes > 0) return;
    this.alive = false;
    playDie();
  }

  /**
   * Called by the game when the player is hit by an enemy.
   * @param {number} lives  Current lives (used to decide die vs hurt)
   * @returns {boolean} true if player died (lost last life)
   */
  hurt() {
    if (this._iframes > 0) return false;
    this._iframes = 1.5;       // 1.5 s of invincibility
    this.prismaMode = false;
    this.vy = JUMP_VELOCITY * 0.5;  // small knockback bounce
    playDie();
    return true;               // consumed a life
  }

  /**
   * Respawn player at a position.
   * @param {number} x
   * @param {number} y
   */
  respawn(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.alive = true;
    this.reachedGoal = false;
    this.prismaMode = false;
    this._prismaTimer = 0;
    this._iframes = 1.0;
    this._coyote = 0;
    this._jumpBuf = 0;
    this._doubleJumpUsed = false;
  }

  /**
   * Draw the player on the canvas.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!this.alive) return;

    // Blink during invincibility
    if (this._iframes > 0 && Math.floor(this._iframes * 10) % 2 === 0) return;

    drawPlayer(
      ctx, this.x, this.y, this.w, this.h,
      this.prismaMode, this._facingLeft, this._walkFrame
    );

    // Prisma mode aura
    if (this.prismaMode) {
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.07 * Math.sin(Date.now() * 0.01);
      ctx.fillStyle = '#E050E0';
      ctx.beginPath();
      ctx.ellipse(
        this.x + this.w / 2, this.y + this.h - 4,
        this.w * 0.6, 5, 0, 0, Math.PI * 2
      );
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }
}


