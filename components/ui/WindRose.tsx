/**
 * Sixteen radial spokes of varying length (wind frequency motif). Lines only.
 */
export type WindRoseProps = {
  size?: number;
  className?: string;
};

const LENGTHS = [0.92, 0.45, 0.72, 0.38, 0.85, 0.5, 0.68, 0.42, 0.88, 0.48, 0.76, 0.4, 0.82, 0.55, 0.7, 0.46];

export function WindRose({ size = 96, className = "" }: WindRoseProps) {
  const c = size / 2;
  const maxR = size * 0.44;

  return (
    <svg
      width={size}
      height={size}
      className={`pointer-events-none shrink-0 select-none ${className}`}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g
        stroke="#2C2A26"
        strokeWidth={1}
        strokeLinecap="round"
        fill="none"
        opacity={0.2}
      >
        {LENGTHS.map((len, i) => {
          const deg = i * 22.5;
          const rad = ((deg - 90) * Math.PI) / 180;
          const r = maxR * len;
          return (
            <line
              key={i}
              x1={c}
              y1={c}
              x2={c + r * Math.cos(rad)}
              y2={c + r * Math.sin(rad)}
            />
          );
        })}
      </g>
    </svg>
  );
}
