/**
 * Topographic contour lines for atlas-style depth. Fine strokes, no fills.
 */
export type TopoBackgroundProps = {
  className?: string;
  /** Line colour opacity (stroke is ink-light #9E9890). Default 0.25. */
  lineOpacity?: number;
};

export function TopoBackground({
  className = "",
  lineOpacity = 0.25,
}: TopoBackgroundProps) {
  return (
    <svg
      className={`pointer-events-none select-none ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1200 280"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden
    >
      <g
        stroke="#9E9890"
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={lineOpacity}
      >
        <path d="M0 42 C180 28 320 58 480 44 C640 30 760 52 920 38 C1020 30 1120 36 1200 32" />
        <path d="M0 78 C200 62 380 92 560 72 C720 56 880 88 1040 70 C1100 64 1160 68 1200 66" />
        <path d="M0 118 C160 98 340 128 520 108 C700 88 860 120 1000 102 C1080 94 1140 100 1200 96" />
        <path d="M0 158 C220 138 400 172 620 148 C780 130 940 164 1100 146 C1140 142 1180 146 1200 144" />
        <path d="M0 198 C140 182 300 210 460 192 C620 174 780 204 940 186 C1040 176 1120 184 1200 178" />
        <path d="M0 238 C190 218 360 248 540 228 C700 212 860 242 1020 224 C1100 216 1160 222 1200 218" />
        <path d="M1200 52 C1040 46 900 62 740 54 C560 44 400 58 240 50 C120 44 40 48 0 52" />
        <path d="M1200 132 C1000 122 820 144 620 130 C420 116 220 138 0 124" />
      </g>
    </svg>
  );
}
