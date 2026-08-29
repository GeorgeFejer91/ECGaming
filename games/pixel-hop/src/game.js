/**
 * @module game
 * Central game-state machine. Orchestrates all subsystems:
 * player, enemies, level, camera, collectibles, HUD, and game screens.
 *
 * States:  'loading' | 'playing' | 'paused' | 'dead' | 'levelComplete' | 'gameOver'
 */

import { CANVAS_W, CANVAS_H, TILE_SIZE, PALETTE, COL } from './constants.js';
import { Camera }       from './camera.js';
import { Level }        from './level.js';
import { Player }       from './player.js';
import { createEnemy }  from './enemy.js';
import * as Input       from './input.js';
import { playGem, playLevelComplete, toggleMute, isMuted } from './audio.js';

// Level JSON file paths
const LEVEL_FILES = [
  'levels/level1.json',
  'levels/level2.json',
];

const STARTING_LIVES = 3;

export class Game {
  /** @param {CanvasRenderingContext2D} ctx */
  constructor(ctx) {
    this._ctx         = ctx;
    this._state       = 'loading';
    this._levelIndex  = 0;
    this._lives       = STARTING_LIVES;
    this._score       = 0;
    this._timeLeft    = 200;
    this._levelData   = [];     // loaded level JSON objects
    this._level       = null;
    this._player      = null;
    this._enemies     = [];
    this._camera      = null;
    this._deathTimer  = 0;
    this._completeTimer = 0;
    this._victory = false;
  }

  // ---------------------------------------------------------------------------
  // Initialise: load all level JSON files, then start
  // ---------------------------------------------------------------------------

  /** Fetch all level files and start the game. */
  async init() {
    const fetches = LEVEL_FILES.map(f =>
      fetch(f).then(r => {
        if (!r.ok) throw new Error(`Cannot load ${f}`);
        return r.json();
      })
    );
    this._levelData = await Promise.all(fetches);
    this._startLevel(0);
  }

  // ---------------------------------------------------------------------------
  // Level management
  // ---------------------------------------------------------------------------

  /**
   * Prepare and start a level.
   * @param {number} index
   */
  _startLevel(index) {
    this._levelIndex = index;
    const data = this._levelData[index];
    this._level   = new Level(data);
    this._camera  = new Camera(this._level.cols, this._level.rows);
    this._timeLeft = this._level.timeLimit;

    // Spawn player
    const sp = this._level.playerStart;
    this._player = new Player(
      sp.x * TILE_SIZE,
      sp.y * TILE_SIZE
    );

    // Snap camera immediately to player
    this._camera.x = Math.max(0,
      this._player.centerX - CANVAS_W / 2
    );
    this._camera.y = Math.max(0,
      this._player.centerY - CANVAS_H / 2
    );

    // Spawn enemies
    this._enemies = this._level.enemies.map(createEnemy);

    this._state = 'playing';
  }

  /**
   * Respawn player after death (keep lives).
   */
  _respawnPlayer() {
    const sp = this._level.playerStart;
    this._player.respawn(sp.x * TILE_SIZE, sp.y * TILE_SIZE);
    this._enemies = this._level.enemies.map(createEnemy);
    // Reset gem/powerup state for this run
    this._level.gems.forEach(g => g.collected = false);
    this._level.powerUps.forEach(p => p.collected = false);
    this._state = 'playing';
  }

  // ---------------------------------------------------------------------------
  // Main update (called with fixed dt)
  // ---------------------------------------------------------------------------

  /**
   * @param {number} dt  Fixed timestep in seconds
   */
  update(dt) {
    // Global input regardless of state
    if (Input.isMute()) toggleMute();

    switch (this._state) {
      case 'playing':       this._updatePlaying(dt); break;
      case 'paused':        this._updatePaused();    break;
      case 'dead':          this._updateDead(dt);    break;
      case 'levelComplete': this._updateComplete(dt);break;
      case 'gameOver':      this._updateGameOver();  break;
    }
  }

  _updatePlaying(dt) {
    if (Input.isPause()) { this._state = 'paused'; return; }

    // Countdown timer
    this._timeLeft -= dt;
    if (this._timeLeft <= 0) {
      this._timeLeft = 0;
      this._loseLife();
      return;
    }

    // Level update
    this._level.update(dt);

    // Player update
    this._player.update(dt, this._level);

    // Enemies update
    for (const e of this._enemies) {
      e.update(dt, this._level);
    }

    // Camera follow player
    this._camera.update(this._player.centerX, this._player.centerY, dt);

    // Collision: player ↔ enemies
    this._checkEnemyCollisions();

    // Collision: player ↔ gems
    this._checkGemCollection();

    // Collision: player ↔ power-ups
    this._checkPowerUpCollection();

    // Player dead?
    if (!this._player.alive) {
      this._loseLife();
      return;
    }

    // Player reached goal?
    if (this._player.reachedGoal) {
      this._state = 'levelComplete';
      this._completeTimer = 3;
      playLevelComplete();
      return;
    }
  }

  _updatePaused() {
    if (Input.isPause() || Input.isRestart()) {
      this._state = 'playing';
    }
  }

  _updateDead(dt) {
    this._deathTimer -= dt;
    if (this._deathTimer <= 0) {
      if (this._lives > 0) {
        this._respawnPlayer();
      } else {
        this._state = 'gameOver';
      }
    }
    if (Input.isRestart()) {
      if (this._lives > 0) {
        this._respawnPlayer();
      } else {
        this._fullReset();
      }
    }
  }

  _updateComplete(dt) {
    this._completeTimer -= dt;
    if (this._completeTimer <= 0 || Input.isRestart()) {
      const nextIndex = this._levelIndex + 1;
      if (nextIndex < this._levelData.length) {
        this._startLevel(nextIndex);
      } else {
        // All levels done — game over with victory
        this._state = 'gameOver';
        this._victory = true;
      }
    }
  }

  _updateGameOver() {
    if (Input.isRestart()) {
      this._fullReset();
    }
  }

  /**
   * Reset everything and restart from level 1.
   */
  _fullReset() {
    this._lives  = STARTING_LIVES;
    this._score  = 0;
    this._victory = false;
    this._startLevel(0);
  }

  /**
   * Deduct a life and trigger death state.
   */
  _loseLife() {
    this._lives = Math.max(0, this._lives - 1);
    this._player.alive = false;
    this._state = 'dead';
    this._deathTimer = 2.0;
  }

  // ---------------------------------------------------------------------------
  // Collision helpers
  // ---------------------------------------------------------------------------

  _checkEnemyCollisions() {
    for (const e of this._enemies) {
      if (!e.alive) continue;
      const side = e.overlapWithPlayer(this._player);
      if (side === 'top') {
        // Stomp!
        e.defeat();
        this._score += 200;
        this._player.vy = -300; // bounce up
      } else if (side === 'side') {
        const died = this._player.hurt();
        if (died) {
          this._loseLife();
          return;
        }
      }
    }
  }

  _checkGemCollection() {
    const px = this._player.x, pw = this._player.w;
    const py = this._player.y, ph = this._player.h;

    for (const gem of this._level.gems) {
      if (gem.collected) continue;
      const gx = gem.x * TILE_SIZE + TILE_SIZE * 0.15;
      const gy = gem.y * TILE_SIZE + TILE_SIZE * 0.15;
      const gs = TILE_SIZE * 0.7;

      if (px < gx + gs && px + pw > gx &&
          py < gy + gs && py + ph > gy) {
        gem.collected = true;
        this._score += 100;
        playGem();
      }
    }
  }

  _checkPowerUpCollection() {
    const px = this._player.x, pw = this._player.w;
    const py = this._player.y, ph = this._player.h;

    for (const pu of this._level.powerUps) {
      if (pu.collected) continue;
      const gx = pu.x * TILE_SIZE;
      const gy = pu.y * TILE_SIZE;
      const gs = TILE_SIZE;

      if (px < gx + gs && px + pw > gx &&
          py < gy + gs && py + ph > gy) {
        pu.collected = true;
        this._player.activatePrisma();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /** Draw everything for the current frame. */
  draw() {
    const ctx = this._ctx;
    this._drawBackground(ctx);

    if (this._state === 'loading') {
      this._drawLoading(ctx);
      return;
    }

    // World
    this._camera.apply(ctx);
    this._level.draw(ctx, this._camera);
    for (const e of this._enemies) e.draw(ctx);
    this._player.draw(ctx);
    this._camera.restore(ctx);

    // HUD (screen-space)
    this._drawHUD(ctx);

    // Overlays
    if (this._state === 'paused')        this._drawPauseOverlay(ctx);
    if (this._state === 'dead')          this._drawDeadOverlay(ctx);
    if (this._state === 'levelComplete') this._drawCompleteOverlay(ctx);
    if (this._state === 'gameOver')      this._drawGameOverScreen(ctx);
  }

  // ---------------------------------------------------------------------------
  // Background
  // ---------------------------------------------------------------------------

  _drawBackground(ctx) {
    // Sky gradient via solid colour layers (parallax)
    ctx.fillStyle = PALETTE[COL.NIGHT];
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Stars (static, derived from palette index seed)
    ctx.fillStyle = PALETTE[COL.PALE];
    const stars = [
      [40,20],[90,45],[150,15],[220,60],[300,30],[380,50],[450,18],
      [510,40],[570,25],[620,55],[60,80],[130,70],[250,85],[420,75],
      [550,65],[180,35],[330,70],[480,30],[600,80],[20,90],
    ];
    for (const [sx, sy] of stars) {
      ctx.fillRect(sx, sy, 2, 2);
    }

    // Distant mountains (parallax: move at 0.2× camera speed)
    if (this._camera) {
      const offX = -this._camera.x * 0.2;
      ctx.fillStyle = PALETTE[COL.ROYAL];
      this._drawMountains(ctx, offX, CANVAS_H * 0.55, 180, 110);
      ctx.fillStyle = PALETTE[COL.CORN];
      this._drawMountains(ctx, offX + 60, CANVAS_H * 0.65, 120, 80);
    }
  }

  /**
   * Draw a row of triangular mountain silhouettes.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} offsetX
   * @param {number} baseY
   * @param {number} spacing
   * @param {number} height
   */
  _drawMountains(ctx, offsetX, baseY, spacing, height) {
    const count = Math.ceil(CANVAS_W / spacing) + 2;
    const start = Math.floor(-offsetX / spacing) - 1;
    ctx.beginPath();
    for (let i = start; i < start + count; i++) {
      const mx = i * spacing + (offsetX % spacing);
      ctx.moveTo(mx, baseY);
      ctx.lineTo(mx + spacing / 2, baseY - height);
      ctx.lineTo(mx + spacing, baseY);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  _drawHUD(ctx) {
    const pad = 8;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, CANVAS_W, 36);

    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = PALETTE[COL.GOLD];
    ctx.fillText(`SCORE ${String(this._score).padStart(6,'0')}`, pad, 22);

    // Lives (right-aligned just before the CANVAS centre)
    ctx.fillStyle = PALETTE[COL.RED];
    ctx.textAlign = 'right';
    ctx.fillText(`♥ ×${this._lives}`, CANVAS_W / 2 - 120, 22);
    ctx.textAlign = 'left';

    // Level name (centred)
    ctx.fillStyle = PALETTE[COL.PALE];
    ctx.textAlign = 'center';
    ctx.fillText(this._level?.name ?? '', CANVAS_W / 2, 22);
    ctx.textAlign = 'left';

    // Timer
    const t = Math.ceil(this._timeLeft);
    ctx.fillStyle = t < 30 ? PALETTE[COL.RED] : PALETTE[COL.WHITE];
    ctx.fillText(`TIME ${String(t).padStart(3,'0')}`, CANVAS_W - 100, 22);

    // Mute indicator
    if (isMuted()) {
      ctx.fillStyle = PALETTE[COL.GREY];
      ctx.fillText('M', CANVAS_W - 20, 22);
    }

    // Prisma power-up timer bar
    if (this._player?.prismaMode) {
      const ratio = this._player._prismaTimer / 15;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(pad, 30, 120, 6);
      ctx.fillStyle = PALETTE[COL.PRISMA];
      ctx.fillRect(pad, 30, 120 * ratio, 6);
    }
  }

  // ---------------------------------------------------------------------------
  // Overlay screens
  // ---------------------------------------------------------------------------

  _drawLoading(ctx) {
    this._centreText(ctx, 'LOADING…', CANVAS_H / 2, PALETTE[COL.GOLD], '24px');
  }

  _drawPauseOverlay(ctx) {
    this._dimOverlay(ctx);
    this._centreText(ctx, 'PAUSED', CANVAS_H / 2 - 20, PALETTE[COL.GOLD], '28px');
    this._centreText(ctx, 'Press P or Enter to continue', CANVAS_H / 2 + 20, PALETTE[COL.PALE], '16px');
  }

  _drawDeadOverlay(ctx) {
    this._dimOverlay(ctx);
    this._centreText(ctx, this._lives > 0 ? 'YOU DIED!' : 'GAME OVER',
                     CANVAS_H / 2 - 20, PALETTE[COL.RED], '28px');
    this._centreText(ctx,
      this._lives > 0
        ? `Lives remaining: ${this._lives}  –  Press Enter to retry`
        : 'Press Enter to restart',
      CANVAS_H / 2 + 20, PALETTE[COL.PALE], '14px');
  }

  _drawCompleteOverlay(ctx) {
    this._dimOverlay(ctx);
    this._centreText(ctx, 'LEVEL COMPLETE!', CANVAS_H / 2 - 20, PALETTE[COL.MINT], '28px');
    this._centreText(ctx, `Score: ${this._score}  –  Press Enter to continue`,
                     CANVAS_H / 2 + 20, PALETTE[COL.PALE], '14px');
  }

  _drawGameOverScreen(ctx) {
    this._dimOverlay(ctx, 0.85);
    if (this._victory) {
      this._centreText(ctx, 'YOU WIN!', CANVAS_H / 2 - 40, PALETTE[COL.GOLD], '32px');
      this._centreText(ctx, `Final Score: ${this._score}`, CANVAS_H / 2, PALETTE[COL.MINT], '20px');
    } else {
      this._centreText(ctx, 'GAME OVER', CANVAS_H / 2 - 40, PALETTE[COL.RED], '32px');
      this._centreText(ctx, `Score: ${this._score}`, CANVAS_H / 2, PALETTE[COL.PALE], '20px');
    }
    this._centreText(ctx, 'Press Enter to play again', CANVAS_H / 2 + 40, PALETTE[COL.GREY], '16px');
  }

  // ---------------------------------------------------------------------------
  // Overlay helpers
  // ---------------------------------------------------------------------------

  _dimOverlay(ctx, alpha = 0.6) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  _centreText(ctx, text, y, colour, size = '18px') {
    ctx.font = `bold ${size} monospace`;
    ctx.fillStyle = colour;
    ctx.textAlign = 'center';
    ctx.fillText(text, CANVAS_W / 2, y);
    ctx.textAlign = 'left';
  }
}


