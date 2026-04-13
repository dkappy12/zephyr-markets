export type CalibrationFeatureKey =
  | "wind"
  | "gas"
  | "remit"
  | "shape"
  | "demand"
  | "interconnector";

export type CalibrationSample = {
  y: number;
  x: Record<CalibrationFeatureKey, number>;
};

export type CalibrationResult = {
  multipliers: Record<CalibrationFeatureKey, number>;
  sampleSize: number;
  fallbackUsed: boolean;
  r2: number;
  lambda: number;
};

const KEYS: CalibrationFeatureKey[] = [
  "wind",
  "gas",
  "remit",
  "shape",
  "demand",
  "interconnector",
];

const DEFAULT_MULTIPLIERS: Record<CalibrationFeatureKey, number> = {
  wind: 1,
  gas: 1,
  remit: 1,
  shape: 1,
  demand: 1,
  interconnector: 1,
};

export const MIN_SAMPLE_SIZE = 30;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-10) return null;
    if (pivot !== col) [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

export function calibrateAttributionMultipliers(
  samples: CalibrationSample[],
  lambda = 3,
): CalibrationResult {
  if (samples.length < MIN_SAMPLE_SIZE) {
    return {
      multipliers: { ...DEFAULT_MULTIPLIERS },
      sampleSize: samples.length,
      fallbackUsed: true,
      r2: 0,
      lambda,
    };
  }

  const p = KEYS.length;
  const xtx = Array.from({ length: p }, () => Array(p).fill(0));
  const xty = Array(p).fill(0);
  const yVals = samples.map((s) => s.y);
  const yMean = yVals.reduce((a, b) => a + b, 0) / yVals.length;

  for (const s of samples) {
    const x = KEYS.map((k) => s.x[k] ?? 0);
    for (let i = 0; i < p; i++) {
      xty[i] += x[i] * s.y;
      for (let j = 0; j < p; j++) xtx[i][j] += x[i] * x[j];
    }
  }
  for (let i = 0; i < p; i++) xtx[i][i] += lambda;

  const beta = solveLinearSystem(xtx, xty);
  if (!beta) {
    return {
      multipliers: { ...DEFAULT_MULTIPLIERS },
      sampleSize: samples.length,
      fallbackUsed: true,
      r2: 0,
      lambda,
    };
  }

  const rawMultipliers: Record<CalibrationFeatureKey, number> = {
    wind: clamp(beta[0] ?? 1, -3, 3),
    gas: clamp(beta[1] ?? 1, -3, 3),
    remit: clamp(beta[2] ?? 1, -3, 3),
    shape: clamp(beta[3] ?? 1, -3, 3),
    demand: clamp(beta[4] ?? 1, -3, 3),
    interconnector: clamp(beta[5] ?? 1, -3, 3),
  };

  let ssRes = 0;
  let ssTot = 0;
  for (const s of samples) {
    const pred = KEYS.reduce(
      (sum, k) => sum + (s.x[k] ?? 0) * rawMultipliers[k],
      0,
    );
    ssRes += (s.y - pred) ** 2;
    ssTot += (s.y - yMean) ** 2;
  }
  const r2 = ssTot > 0 ? clamp(1 - ssRes / ssTot, -1, 1) : 0;

  // Hard fallback on obviously poor fit.
  if (!Number.isFinite(r2) || r2 < -0.05) {
    return {
      multipliers: { ...DEFAULT_MULTIPLIERS },
      sampleSize: samples.length,
      fallbackUsed: true,
      r2: Number.isFinite(r2) ? r2 : 0,
      lambda,
    };
  }

  // Blend towards neutral multipliers when sample size is only moderately sufficient.
  const maturity = clamp(
    (samples.length - MIN_SAMPLE_SIZE) / (90 - MIN_SAMPLE_SIZE),
    0,
    1,
  );
  const multipliers: Record<CalibrationFeatureKey, number> = {
    wind: 1 + (rawMultipliers.wind - 1) * maturity,
    gas: 1 + (rawMultipliers.gas - 1) * maturity,
    remit: 1 + (rawMultipliers.remit - 1) * maturity,
    shape: 1 + (rawMultipliers.shape - 1) * maturity,
    demand: 1 + (rawMultipliers.demand - 1) * maturity,
    interconnector: 1 + (rawMultipliers.interconnector - 1) * maturity,
  };

  return {
    multipliers,
    sampleSize: samples.length,
    fallbackUsed: false,
    r2,
    lambda,
  };
}

export function attributionConfidenceFromMetrics(opts: {
  explainedRatio: number;
  residualAbs: number;
  totalPnlAbs: number;
  calibration: CalibrationResult;
}): "High" | "Medium" | "Low" {
  const explained = clamp(opts.explainedRatio, 0, 1);
  const relResidual =
    opts.totalPnlAbs > 1 ? opts.residualAbs / opts.totalPnlAbs : 1;
  if (opts.calibration.fallbackUsed || opts.calibration.sampleSize < MIN_SAMPLE_SIZE) {
    return "Low";
  }
  if (explained >= 0.75 && opts.calibration.r2 >= 0.2 && relResidual <= 0.35) {
    return "High";
  }
  if (explained >= 0.5 && opts.calibration.r2 >= 0.05 && relResidual <= 0.6) {
    return "Medium";
  }
  return "Low";
}
