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
      viewBox="0 0 1200 320"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden
    >
      <g
        stroke="#9E9890"
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={lineOpacity}
      >
        {/* Meandering terrain-style contours — varied elevation, dips, overlaps */}
        <path d="M0 38 C140 8 220 72 380 28 C520 4 640 58 780 22 C920 6 1040 48 1200 18" />
        <path d="M0 58 C200 22 340 98 520 48 C680 12 760 88 920 42 C1000 22 1080 52 1200 32" />
        <path d="M1200 48 C1020 78 880 18 700 62 C520 98 360 28 180 68 C90 88 40 58 0 72" />
        <path d="M0 92 C160 52 300 132 480 78 C620 38 740 118 900 72 C1020 38 1120 98 1200 58" />
        <path d="M0 118 C220 78 400 168 600 98 C760 42 880 152 1040 88 C1120 58 1180 108 1200 92" />
        <path d="M1200 108 C1000 148 820 68 620 128 C440 178 280 88 120 138 C60 158 20 118 0 132" />
        <path d="M0 158 C180 118 320 208 500 142 C660 88 780 198 940 128 C1060 78 1140 168 1200 118" />
        <path d="M0 188 C240 138 420 238 640 162 C800 108 920 228 1080 152 C1140 122 1180 182 1200 158" />
        <path d="M1200 178 C960 228 780 128 560 198 C380 252 220 158 80 208 C40 218 12 188 0 198" />
        <path d="M0 228 C200 178 380 268 580 198 C740 148 860 258 1020 208 C1100 182 1160 232 1200 208" />
        <path d="M0 268 C260 218 480 298 720 232 C880 188 1000 278 1200 242" />
        <path d="M1200 88 C1050 58 920 118 760 78 C600 38 440 108 280 68 C140 38 60 98 0 78" />
      </g>
    </svg>
  );
}
