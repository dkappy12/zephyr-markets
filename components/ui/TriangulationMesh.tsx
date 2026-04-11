/**
 * Sparse wireframe triangulation (logo-style mesh). Stroke only, no fill.
 */
export type TriangulationMeshProps = {
  width?: number;
  height?: number;
  /** Overall stroke opacity (ink #2C2A26). Default 0.12. */
  opacity?: number;
  className?: string;
};

export function TriangulationMesh({
  width = 200,
  height = 200,
  opacity = 0.12,
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
        strokeWidth={0.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
      >
        {/* Irregular triangulation */}
        <path d="M8 12 L52 8 L28 48 Z" />
        <path d="M52 8 L88 22 L64 52 Z" />
        <path d="M88 22 L120 14 L104 48 Z" />
        <path d="M28 48 L64 52 L44 88 Z" />
        <path d="M64 52 L104 48 L84 90 Z" />
        <path d="M104 48 L132 38 L118 78 Z" />
        <path d="M44 88 L84 90 L62 124 Z" />
        <path d="M84 90 L118 78 L102 118 Z" />
        <path d="M132 38 L168 52 L148 88 Z" />
        <path d="M118 78 L168 52 L154 96 Z" />
        <path d="M8 140 L48 128 L32 176 Z" />
        <path d="M48 128 L92 138 L72 182 Z" />
        <path d="M92 138 L132 124 L112 172 Z" />
        <path d="M32 176 L72 182 L54 220 Z" />
        <path d="M72 182 L112 172 L96 214 Z" />
      </g>
    </svg>
  );
}
