/**
 * Classical 8-point compass rose: eight equal radial spokes and inner ring.
 */
export type CompassRoseProps = {
  size?: number;
  className?: string;
};

export function CompassRose({ size = 80, className = "" }: CompassRoseProps) {
  const c = size / 2;
  const r = size * 0.42;
  const rInner = size * 0.12;

  const points = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return {
      x: c + r * Math.cos(rad),
      y: c + r * Math.sin(rad),
    };
  });

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
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <circle cx={c} cy={c} r={rInner} />
        {points.map((p, i) => (
          <line key={i} x1={c} y1={c} x2={p.x} y2={p.y} />
        ))}
      </g>
    </svg>
  );
}
