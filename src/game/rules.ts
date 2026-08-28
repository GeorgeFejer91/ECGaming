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

export const aircraftAttitude = (
  horizontalVelocity: number,
  dragBankVelocity = 0,
) => {
  const lateralVelocity = horizontalVelocity + dragBankVelocity;
  return {
    roll: Math.max(-0.48, Math.min(0.48, -lateralVelocity * 0.1)),
    yaw: Math.max(-0.16, Math.min(0.16, -lateralVelocity * 0.035)),
  };
};

/**
 * Maps headset roll to a continuous steering axis. WebXR's positive roll is a
 * right-handed rotation around +Z, so it maps to leftward (-1) steering.
 */
export const headTiltSteering = (
  rollRadians: number,
  deadzoneRadians = (4 * Math.PI) / 180,
  saturationRadians = (28 * Math.PI) / 180,
) => {
  if (!Number.isFinite(rollRadians)) return 0;
  const deadzone = Math.max(0, deadzoneRadians);
  const saturation = Math.max(deadzone + Number.EPSILON, saturationRadians);
  const magnitude = Math.abs(rollRadians);
  if (magnitude <= deadzone) return 0;
  const normalized = Math.min(
    1,
    (magnitude - deadzone) / (saturation - deadzone),
  );
  return -Math.sign(rollRadians) * normalized;
};

export const applyRingResult = (score: number, passed: boolean) => {
  const points = passed ? 1 : 0;
  return { score: score + points, points };
};
