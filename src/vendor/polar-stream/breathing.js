/*
 * Browser-safe Polar H10 ACC decoding and source-timed breathing waveform.
 * Adapted from GeorgeFejer91/Polar-Stream at commit
 * 5300e2c2c9593f405f3b74b21b3330000e90b6f2 (MIT).
 * See THIRD_PARTY_NOTICES.md. This is an experimental respiratory-motion /
 * effort surrogate, not lung volume, airflow, or a clinical measurement.
 */

const SAMPLE_RATE_HZ = 200;

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof DataView)
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Uint8Array.from(value ?? []);
}

function unsigned64Le(bytes, offset) {
  let result = 0n;
  for (let index = 7; index >= 0; index -= 1)
    result = (result << 8n) | BigInt(bytes[offset + index]);
  return result;
}

function signed16Le(bytes, offset) {
  const raw = bytes[offset] | (bytes[offset + 1] << 8);
  return raw & 0x8000 ? raw - 0x10000 : raw;
}

function signedBits(bytes, bitOffset, width) {
  let value = 0;
  for (let shift = 0; shift < width; shift += 1) {
    const absolute = bitOffset + shift;
    value +=
      ((bytes[Math.floor(absolute / 8)] >> (absolute % 8)) & 1) *
      2 ** shift;
  }
  return value >= 2 ** (width - 1) ? value - 2 ** width : value;
}

function decodeCompressed(payload) {
  if (payload.length < 8)
    throw new Error("Compressed accelerometer payload has an invalid length.");
  let xMg = signed16Le(payload, 0);
  let yMg = signed16Le(payload, 2);
  let zMg = signed16Le(payload, 4);
  const samples = [{ xMg, yMg, zMg }];
  let offset = 6;
  while (offset < payload.length) {
    if (offset + 2 > payload.length)
      throw new Error("Compressed accelerometer delta header is truncated.");
    const deltaWidth = payload[offset];
    const sampleCount = payload[offset + 1];
    offset += 2;
    if (deltaWidth < 1 || deltaWidth > 16)
      throw new Error(`Unsupported accelerometer delta width: ${deltaWidth}.`);
    const byteLength = Math.ceil((sampleCount * deltaWidth * 3) / 8);
    if (offset + byteLength > payload.length)
      throw new Error("Compressed accelerometer delta block is truncated.");
    const deltas = payload.subarray(offset, offset + byteLength);
    let bitOffset = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      xMg = Math.max(
        -32768,
        Math.min(32767, xMg + signedBits(deltas, bitOffset, deltaWidth)),
      );
      bitOffset += deltaWidth;
      yMg = Math.max(
        -32768,
        Math.min(32767, yMg + signedBits(deltas, bitOffset, deltaWidth)),
      );
      bitOffset += deltaWidth;
      zMg = Math.max(
        -32768,
        Math.min(32767, zMg + signedBits(deltas, bitOffset, deltaWidth)),
      );
      bitOffset += deltaWidth;
      samples.push({ xMg, yMg, zMg });
    }
    offset += byteLength;
  }
  return samples;
}

export function decodePolarAccelerometer(value) {
  const bytes = bytesFrom(value);
  if (bytes.length < 10)
    throw new Error("Polar PMD frame is shorter than its header.");
  if (bytes[0] !== 0x02) return null;
  const frameType = bytes[9];
  const payload = bytes.subarray(10);
  const compressed = Boolean(frameType & 0x80);
  const baseFrameType = frameType & 0x7f;
  let samples;
  if (!compressed && baseFrameType === 0x01) {
    if (payload.length % 6 !== 0)
      throw new Error("Accelerometer payload has an invalid length.");
    samples = [];
    for (let offset = 0; offset < payload.length; offset += 6) {
      samples.push({
        xMg: signed16Le(payload, offset),
        yMg: signed16Le(payload, offset + 2),
        zMg: signed16Le(payload, offset + 4),
      });
    }
  } else if (compressed && (baseFrameType === 0x00 || baseFrameType === 0x01)) {
    samples = decodeCompressed(payload);
  } else {
    throw new Error("Unsupported PMD accelerometer frame type.");
  }
  return {
    sensorTimestampNs: unsigned64Le(bytes, 1).toString(),
    samples,
  };
}

export function defaultBreathingSettings() {
  return {
    axes: [true, false, true],
    calibrationWindowSeconds: 12,
    minimumAxisRangeG: 0.01,
    volumeFilterTauSeconds: 0.18,
    staleTimeoutSeconds: 0.5,
    invertDirection: false,
    adaptiveBounds: false,
    adaptiveWindowSeconds: 20,
    lowerQuantile: 0.05,
    upperQuantile: 0.95,
    phaseDerivativeTauSeconds: 0.4,
    phaseEnterThresholdPerSecond: 0.03,
    phaseHoldThresholdPerSecond: 0.025,
    phaseConfirmationSeconds: 0.4,
    phaseMinimumDwellSeconds: 0.4,
  };
}

const finiteClamped = (value, fallback, low, high) => {
  const number = Number(value);
  return Math.max(
    low,
    Math.min(high, Number.isFinite(number) ? number : fallback),
  );
};

function settingsFrom(value = {}) {
  const settings = { ...defaultBreathingSettings(), ...value };
  const axes = Array.isArray(settings.axes)
    ? settings.axes.slice(0, 3).map(Boolean)
    : [true, false, true];
  while (axes.length < 3) axes.push(false);
  settings.axes = axes.filter(Boolean).length >= 2 ? axes : [true, false, true];
  settings.calibrationWindowSeconds = finiteClamped(
    settings.calibrationWindowSeconds,
    12,
    1,
    60,
  );
  settings.minimumAxisRangeG = finiteClamped(
    settings.minimumAxisRangeG,
    0.01,
    0.001,
    0.25,
  );
  settings.volumeFilterTauSeconds = finiteClamped(
    settings.volumeFilterTauSeconds,
    0.18,
    0.01,
    5,
  );
  settings.staleTimeoutSeconds = finiteClamped(
    settings.staleTimeoutSeconds,
    0.5,
    0.25,
    30,
  );
  settings.adaptiveWindowSeconds = finiteClamped(
    settings.adaptiveWindowSeconds,
    20,
    5,
    300,
  );
  settings.lowerQuantile = finiteClamped(settings.lowerQuantile, 0.05, 0, 0.4);
  settings.upperQuantile = finiteClamped(settings.upperQuantile, 0.95, 0.6, 1);
  settings.phaseDerivativeTauSeconds = finiteClamped(
    settings.phaseDerivativeTauSeconds,
    0.4,
    0.01,
    5,
  );
  settings.phaseEnterThresholdPerSecond = finiteClamped(
    settings.phaseEnterThresholdPerSecond,
    0.03,
    0.001,
    5,
  );
  settings.phaseHoldThresholdPerSecond = Math.min(
    finiteClamped(settings.phaseHoldThresholdPerSecond, 0.025, 0, 5),
    settings.phaseEnterThresholdPerSecond,
  );
  settings.phaseConfirmationSeconds = finiteClamped(
    settings.phaseConfirmationSeconds,
    0.4,
    0,
    5,
  );
  settings.phaseMinimumDwellSeconds = finiteClamped(
    settings.phaseMinimumDwellSeconds,
    0.4,
    0,
    5,
  );
  settings.invertDirection = Boolean(settings.invertDirection);
  settings.adaptiveBounds = settings.adaptiveBounds === true;
  return settings;
}

const dot = (left, right) =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
const subtract = (left, right) => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
];
const quantile = (sorted, fraction) => {
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
};
const inverseLerp = (low, high, value) =>
  Math.abs(high - low) < 1e-8
    ? 0.5
    : Math.max(0, Math.min(1, (value - low) / (high - low)));

export class PolarBreathingProcessor {
  constructor(settings = {}) {
    this.reset(settings);
  }

  reset(settings = this.settings) {
    this.settings = settingsFrom(settings);
    this.samplesSeen = 0;
    this.calibration = [];
    this.center = [0, 0, 0];
    this.axis = [1, 0, 0];
    this.boundMin = -0.02;
    this.boundMax = 0.02;
    this.calibrationSpan = 0.04;
    this.pcaDominance01 = 0;
    this.calibrated = false;
    this.filtered = null;
    this.motionFiltered = null;
    this.motionDeltaEmaG = 0;
    this.lastSourceNs = null;
    this.lastAnchorNs = null;
    this.lastProcessedNs = null;
    this.watermarkNs = null;
    this.lastVolume = 0.5;
    this.lastProjection = null;
    this.derivative = 0;
    this.phase = 0;
    this.activeSinceNs = null;
    this.candidate = 0;
    this.candidateSinceNs = null;
    this.adaptiveProjections = [];
    this.lastAdaptiveUpdateNs = null;
    this.lost = false;
    this.diagnostics = {
      accepted: 0,
      lateDropped: 0,
      forwardGaps: 0,
      resets: 0,
    };
  }

  applySettings(settings) {
    const next = settingsFrom(settings);
    if (JSON.stringify(next) !== JSON.stringify(this.settings)) this.reset(next);
  }

  alpha(deltaSeconds, tauSeconds) {
    return Math.max(
      0,
      Math.min(1, deltaSeconds / Math.max(1e-6, tauSeconds + deltaSeconds)),
    );
  }

  sourceTimes(samples, newest, interpolate = true) {
    const end = BigInt(newest);
    if (interpolate && this.lastAnchorNs !== null && end > this.lastAnchorNs) {
      const anchorDelta = end - this.lastAnchorNs;
      const count = BigInt(samples.length);
      return samples.map(
        (_, index) =>
          this.lastAnchorNs +
          (anchorDelta * BigInt(index + 1)) / count,
      );
    }
    const step = 1_000_000_000n / BigInt(SAMPLE_RATE_HZ);
    return samples.map(
      (_, index) => end - BigInt(samples.length - 1 - index) * step,
    );
  }

  pca(samples) {
    const count = samples.length;
    const center = [0, 0, 0];
    for (const sample of samples)
      for (let index = 0; index < 3; index += 1)
        center[index] += sample[index] / count;
    const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
    for (const sample of samples) {
      const delta = subtract(sample, center);
      for (let row = 0; row < 3; row += 1)
        for (let column = 0; column < 3; column += 1)
          covariance[row][column] +=
            (delta[row] * delta[column]) / count;
    }
    let dominantDimension = 0;
    for (let index = 1; index < 3; index += 1)
      if (
        covariance[index][index] >
        covariance[dominantDimension][dominantDimension]
      )
        dominantDimension = index;
    let axis = [0, 0, 0];
    axis[dominantDimension] = 1;
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const next = covariance.map((row) => dot(row, axis));
      const magnitude = Math.sqrt(dot(next, next));
      if (magnitude < 1e-10) return null;
      axis = next.map((value) => value / magnitude);
    }
    const signIndex = axis.reduce((best, value, index) =>
      Math.abs(value) > Math.abs(axis[best]) ? index : best,
    0);
    if (axis[signIndex] < 0) axis = axis.map((value) => -value);
    if (this.settings.invertDirection) axis = axis.map((value) => -value);
    const trace = covariance[0][0] + covariance[1][1] + covariance[2][2];
    const eigenvalue = dot(
      axis,
      covariance.map((row) => dot(row, axis)),
    );
    const projections = samples
      .map((sample) => dot(subtract(sample, center), axis))
      .sort((left, right) => left - right);
    const low = quantile(projections, this.settings.lowerQuantile);
    const high = quantile(projections, this.settings.upperQuantile);
    const dominance =
      trace > 1e-10
        ? Math.max(0, Math.min(1, eigenvalue / trace))
        : 0;
    if (
      !Number.isFinite(low) ||
      high - low < this.settings.minimumAxisRangeG ||
      dominance < 0.05
    )
      return null;
    return { center, axis, low, high, dominance };
  }

  classifyDerivative(derivative, timeNs) {
    const enter = this.settings.phaseEnterThresholdPerSecond;
    const hold = this.settings.phaseHoldThresholdPerSecond;
    let requested = this.phase;
    if (derivative >= enter) requested = 1;
    else if (derivative <= -enter) requested = -1;
    else if (Math.abs(derivative) <= hold) requested = 0;
    if (requested === this.phase) {
      this.candidate = requested;
      this.candidateSinceNs = null;
      return;
    }
    if (this.candidate !== requested || this.candidateSinceNs === null) {
      this.candidate = requested;
      this.candidateSinceNs = timeNs;
      return;
    }
    const confirmed =
      Number(timeNs - this.candidateSinceNs) / 1e9 >=
      this.settings.phaseConfirmationSeconds;
    const dwell =
      this.activeSinceNs === null ||
      Number(timeNs - this.activeSinceNs) / 1e9 >=
        this.settings.phaseMinimumDwellSeconds;
    if (confirmed && dwell) {
      this.phase = requested;
      this.activeSinceNs = timeNs;
      this.candidateSinceNs = null;
    }
  }

  updateAdaptiveBounds(timeNs, projection) {
    const last = this.adaptiveProjections.at(-1);
    if (!last || timeNs - last.timeNs >= 50_000_000n)
      this.adaptiveProjections.push({ timeNs, projection });
    const cutoff =
      timeNs - BigInt(Math.round(this.settings.adaptiveWindowSeconds * 1e9));
    while (
      this.adaptiveProjections.length &&
      this.adaptiveProjections[0].timeNs < cutoff
    )
      this.adaptiveProjections.shift();
    if (!this.settings.adaptiveBounds || this.adaptiveProjections.length < 80)
      return;
    const elapsedNs =
      this.lastAdaptiveUpdateNs === null
        ? 500_000_000n
        : timeNs - this.lastAdaptiveUpdateNs;
    if (elapsedNs < 500_000_000n) return;
    this.lastAdaptiveUpdateNs = timeNs;
    const projections = this.adaptiveProjections
      .map((entry) => entry.projection)
      .sort((left, right) => left - right);
    const lower = quantile(projections, this.settings.lowerQuantile);
    const upper = quantile(projections, this.settings.upperQuantile);
    const span = upper - lower;
    if (
      span < this.settings.minimumAxisRangeG ||
      span < this.calibrationSpan * 0.5 ||
      span > this.calibrationSpan * 2
    )
      return;
    const alpha = 1 - Math.exp(-0.5 * (Number(elapsedNs) / 1e9));
    this.boundMin += (lower - this.boundMin) * alpha;
    this.boundMax += (upper - this.boundMax) * alpha;
  }

  pushTimed(samples, sensorTimestampNs) {
    if (!Array.isArray(samples) || !samples.length || sensorTimestampNs == null)
      return null;
    const nominalPeriodNs = 1_000_000_000n / BigInt(SAMPLE_RATE_HZ);
    const nominalFirst =
      BigInt(sensorTimestampNs) -
      nominalPeriodNs * BigInt(samples.length - 1);
    const boundaryGapNs =
      this.lastSourceNs === null ? 0n : nominalFirst - this.lastSourceNs;
    const boundaryForward =
      this.lastSourceNs !== null && nominalFirst > this.lastSourceNs;
    const boundaryGap =
      boundaryForward &&
      boundaryGapNs >
        BigInt(Math.round(this.settings.staleTimeoutSeconds * 1e9));
    const times = this.sourceTimes(
      samples,
      sensorTimestampNs,
      this.lastSourceNs === null || (boundaryForward && !boundaryGap),
    );
    const newest = times.at(-1);
    if (this.watermarkNs !== null && newest < this.watermarkNs - 250_000_000n) {
      const resets = this.diagnostics.resets + 1;
      this.reset(this.settings);
      this.diagnostics.resets = resets;
    }
    if (this.watermarkNs !== null && newest <= this.watermarkNs) {
      this.diagnostics.lateDropped += samples.length;
      return this.snapshot(newest, false);
    }
    let hadForwardGap = false;
    if (this.lastSourceNs !== null) {
      const gap = Number(times[0] - this.lastSourceNs) / 1e9;
      if (gap < -0.25) {
        const resets = this.diagnostics.resets + 1;
        this.reset(this.settings);
        this.diagnostics.resets = resets;
      } else if (boundaryGap) {
        this.lost = true;
        hadForwardGap = true;
        this.phase = 0;
        this.activeSinceNs = null;
        this.candidateSinceNs = null;
        this.lastProjection = null;
        this.derivative = 0;
        this.diagnostics.forwardGaps += 1;
      }
    }
    const accepted = [];
    const presentationPoints = [];
    for (let index = 0; index < samples.length; index += 1) {
      const timeNs = times[index];
      if (this.watermarkNs !== null && timeNs <= this.watermarkNs) {
        this.diagnostics.lateDropped += 1;
        continue;
      }
      accepted.push({
        values: [
          samples[index].xMg / 1000,
          samples[index].yMg / 1000,
          samples[index].zMg / 1000,
        ],
        timeNs,
      });
    }
    if (!accepted.length) return this.snapshot(newest, false);
    this.watermarkNs = accepted.at(-1).timeNs;
    this.lastSourceNs = this.watermarkNs;
    this.lastAnchorNs = newest;
    this.lost = hadForwardGap;
    for (const entry of accepted) {
      const current = entry.values.map((value, index) =>
        this.settings.axes[index] ? value : 0,
      );
      const deltaSeconds =
        this.lastProcessedNs == null
          ? 1 / SAMPLE_RATE_HZ
          : Math.max(1e-6, Number(entry.timeNs - this.lastProcessedNs) / 1e9);
      const alpha = this.alpha(
        deltaSeconds,
        this.settings.volumeFilterTauSeconds,
      );
      if (this.motionFiltered === null)
        this.motionFiltered = [...entry.values];
      else {
        const previous = [...this.motionFiltered];
        this.motionFiltered = this.motionFiltered.map(
          (value, index) => value + (entry.values[index] - value) * alpha,
        );
        const delta = subtract(this.motionFiltered, previous);
        const motionAlpha = this.alpha(deltaSeconds, 0.5);
        this.motionDeltaEmaG +=
          motionAlpha *
          (Math.sqrt(dot(delta, delta)) - this.motionDeltaEmaG);
      }
      this.filtered =
        this.filtered === null
          ? current
          : this.filtered.map(
              (value, index) => value + (current[index] - value) * alpha,
            );
      this.lastProcessedNs = entry.timeNs;
      this.samplesSeen += 1;
      if (!this.calibrated) {
        this.calibration.push({ timeNs: entry.timeNs, value: [...this.filtered] });
        const calibrationWindowNs = BigInt(
          Math.round(this.settings.calibrationWindowSeconds * 1e9),
        );
        while (
          this.calibration.length &&
          entry.timeNs - this.calibration[0].timeNs >
            calibrationWindowNs + 10_000_000n
        )
          this.calibration.shift();
        if (
          this.calibration.length >= 8 &&
          entry.timeNs - this.calibration[0].timeNs >= calibrationWindowNs
        ) {
          const result = this.pca(
            this.calibration.map((sample) => sample.value),
          );
          if (result) {
            this.center = result.center;
            this.axis = result.axis;
            this.boundMin = result.low;
            this.boundMax = result.high;
            this.calibrationSpan = Math.max(1e-8, result.high - result.low);
            this.pcaDominance01 = result.dominance;
            this.calibrated = true;
            this.lastProjection = dot(
              subtract(this.filtered, this.center),
              this.axis,
            );
            this.activeSinceNs = entry.timeNs;
          }
        }
      }
      if (this.calibrated) {
        const projection = dot(
          subtract(this.filtered, this.center),
          this.axis,
        );
        this.updateAdaptiveBounds(entry.timeNs, projection);
        this.lastVolume = inverseLerp(
          this.boundMin,
          this.boundMax,
          projection,
        );
        if (!hadForwardGap && this.lastProjection !== null) {
          const rawDerivative =
            (projection - this.lastProjection) /
            Math.max(1e-8, this.calibrationSpan) /
            deltaSeconds;
          this.derivative +=
            this.alpha(
              deltaSeconds,
              this.settings.phaseDerivativeTauSeconds,
            ) *
            (rawDerivative - this.derivative);
          this.classifyDerivative(this.derivative, entry.timeNs);
        }
        if (!hadForwardGap) this.lastProjection = projection;
        presentationPoints.push({
          sourceTimestampNs: String(entry.timeNs),
          volume01: this.lastVolume,
        });
      }
    }
    this.diagnostics.accepted += accepted.length;
    return this.snapshot(newest, true, presentationPoints);
  }

  snapshot(timeNs, accepted, presentationPoints = []) {
    const threshold = Math.max(this.settings.minimumAxisRangeG * 0.1, 0.001);
    const motionRatio = this.motionDeltaEmaG / threshold;
    const motionScore = Math.max(
      0,
      Math.min(1, 1 / (1 + motionRatio * motionRatio)),
    );
    const ready = this.calibrated && !this.lost && motionScore >= 0.35;
    const rangeScore = Math.max(
      0,
      Math.min(
        1,
        this.calibrationSpan / (this.settings.minimumAxisRangeG * 2),
      ),
    );
    const confidence01 = ready
      ? Math.max(
          0,
          Math.min(1, rangeScore * motionScore * this.pcaDominance01),
        )
      : 0;
    const calibration01 = this.calibrated
      ? 1
      : this.calibration.length < 2
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              Number(
                this.calibration.at(-1).timeNs -
                  this.calibration[0].timeNs,
              ) /
                (this.settings.calibrationWindowSeconds * 1e9),
            ),
          );
    return {
      calibrated: this.calibrated,
      ready,
      lost: this.lost,
      accepted,
      phase: ready ? this.phase : 0,
      volume01: this.lastVolume,
      magnitudeG: this.lastProjection ?? 0,
      derivativePerSecond: this.derivative,
      sensorTimestampNs: String(timeNs),
      presentationPoints: presentationPoints.slice(-512),
      values: {
        acc_breathing_magnitude: this.calibrated
          ? (this.lastProjection ?? 0)
          : undefined,
        breathing_volume: this.calibrated ? this.lastVolume : undefined,
        breathing_axis_range: this.calibrated
          ? this.boundMax - this.boundMin
          : undefined,
        breathing_signal_ready: ready ? 1 : 0,
        breathing_signal_confidence: confidence01,
        breathing_calibration: calibration01,
        breathing_phase: ready ? this.phase : 0,
      },
      diagnostics: {
        ...this.diagnostics,
        motionScore,
        pcaDominance01: this.pcaDominance01,
        confidence01,
      },
    };
  }
}
