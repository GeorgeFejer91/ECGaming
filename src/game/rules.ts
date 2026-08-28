export const worldSpeed = (throttle: number) =>
  8 + Math.max(0, Math.min(1, throttle)) * 6;
export const ringIntervalSeconds = (traffic: number) =>
  10 - Math.max(0, Math.min(1, traffic)) * 7;
export const ringPassed = (
  planeX: number,
  planeY: number,
  ringX: number,
  ringY: number,
  radius = 1.92,
) => Math.hypot(ringX - planeX, ringY - planeY) < radius;
export const applyRingResult = (
  score: number,
  lives: number,
  passed: boolean,
) =>
  passed
    ? { score: score + 1, lives, gameOver: false }
    : { score, lives: Math.max(0, lives - 1), gameOver: lives <= 1 };
