/**
 * Barely visible classical margin marks (ink-light, fine strokes).
 */
export type ManuscriptMarginaliaProps = {
  className?: string;
};

export function ManuscriptMarginalia({
  className = "",
}: ManuscriptMarginaliaProps) {
  return (
    <svg
      className={`pointer-events-none select-none ${className}`}
      width={24}
      height={280}
      viewBox="0 0 24 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g
        stroke="#9E9890"
        strokeWidth={0.5}
        strokeLinecap="round"
        opacity={0.08}
      >
        <path d="M12 8 L18 14 L12 20 L6 14 Z" />
        <path d="M8 48 L16 48" />
        <path d="M12 44 L12 52" />
        <path d="M6 88 L18 88 M12 82 L12 94" />
        <path d="M8 128 C12 124 16 128 12 132 C8 136 16 140 12 144" />
        <path d="M10 176 L14 180 L10 184" />
        <path d="M6 220 L18 228 M6 228 L18 220" />
        <circle cx={12} cy={256} r={3} />
        <path d="M9 268 L15 274 M15 268 L9 274" opacity={0.7} />
      </g>
    </svg>
  );
}
