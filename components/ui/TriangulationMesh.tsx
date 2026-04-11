/**
 * Sparse wireframe triangulation (logo-style mesh). Stroke only, no fill.
 */
export type TriangulationMeshProps = {
  width?: number;
  height?: number;
  /** Overall stroke opacity (ink #2C2A26). Default 0.12. */
  opacity?: number;
  /** Stroke width in user units (viewBox 180×240). Default 1. */
  strokeWidth?: number;
  className?: string;
};

/** Irregular triangle wireframes as closed polygons (explicit edges render reliably). */
const TRIANGLES: string[] = [
  "8,12 52,8 28,48",
  "52,8 88,22 64,52",
  "88,22 120,14 104,48",
  "28,48 64,52 44,88",
  "64,52 104,48 84,90",
  "104,48 132,38 118,78",
  "44,88 84,90 62,124",
  "84,90 118,78 102,118",
  "132,38 168,52 148,88",
  "118,78 168,52 154,96",
  "8,140 48,128 32,176",
  "48,128 92,138 72,182",
  "92,138 132,124 112,172",
  "32,176 72,182 54,220",
  "72,182 112,172 96,214",
];

export function TriangulationMesh({
  width = 200,
  height = 200,
  opacity = 0.12,
  strokeWidth: strokeW = 1,
  className = "",
}: TriangulationMeshProps) {
  return (
    <svg
      width={width}
      height={height}
      className={`pointer-events-none shrink-0 select-none ${className}`}
      viewBox="0 0 180 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g
        stroke="#2C2A26"
        strokeWidth={strokeW}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={opacity}
      >
        {TRIANGLES.map((points, i) => (
          <polygon key={i} points={points} />
        ))}
      </g>
    </svg>
  );
}
