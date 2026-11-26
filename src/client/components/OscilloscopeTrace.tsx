interface LatencyPoint {
  id: string;
  status: "up" | "degraded" | "down";
  totalMs: number;
}

interface OscilloscopeTraceProps {
  points: LatencyPoint[];
  status?: "up" | "degraded" | "down" | "paused" | "pending";
  width?: number;
  height?: number;
  showGrid?: boolean;
  responsive?: boolean;
  className?: string;
}

export function OscilloscopeTrace({
  points,
  status = "up",
  width = 160,
  height = 36,
  showGrid = false,
  responsive = false,
  className = ""
}: OscilloscopeTraceProps) {
  const strokeColor =
    status === "down"
      ? "#f43f5e"
      : status === "degraded"
      ? "#f59e0b"
      : status === "paused" || status === "pending"
      ? "#64748b"
      : "#22d3ee";

  const padX = 4;
  const padY = 6;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  let pathD = "";
  let fillD = "";
  const coords: Array<{ x: number; y: number; status: "up" | "degraded" | "down" }> = [];

  if (points.length >= 2) {
    const values = points.map((p) => Math.max(1, p.totalMs));
    const minV = Math.min(...values);
    const maxV = Math.max(...values, minV + 10);
    const span = Math.max(10, maxV - minV);

    points.forEach((pt, idx) => {
      const x = padX + (idx / (points.length - 1)) * innerW;
      const norm = (Math.max(1, pt.totalMs) - minV) / span;
      const y = padY + innerH - (0.18 + norm * 0.72) * innerH;
      coords.push({ x, y, status: pt.status });
    });

    pathD = coords
      .map((c, idx) => `${idx === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(" ");
    fillD = `${pathD} L${coords[coords.length - 1].x.toFixed(1)},${height} L${coords[0].x.toFixed(1)},${height} Z`;
  } else if (points.length === 1) {
    const midY = height * 0.58;
    const peakY = status === "down" ? height * 0.2 : height * 0.24;
    const dipY = height * 0.78;
    const x1 = width * 0.28;
    const x2 = width * 0.36;
    const x3 = width * 0.44;
    const x4 = width * 0.52;
    const x5 = width * 0.6;
    pathD = `M${padX},${midY} L${x1},${midY} L${x2},${peakY} L${x3},${dipY} L${x4},${midY - 3} L${x5},${midY} L${width - padX},${midY}`;
    fillD = `${pathD} L${width - padX},${height} L${padX},${height} Z`;
    coords.push({ x: x2, y: peakY, status: points[0].status });
  } else {
    const midY = height * 0.55;
    pathD = `M${padX},${midY} L${width - padX},${midY}`;
  }

  const gradId = `scope-fill-${status}-${width}-${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={responsive ? "100%" : width}
      height={height}
      preserveAspectRatio={responsive ? "none" : "xMidYMid meet"}
      aria-hidden="true"
      className={`block max-w-full ${className}`}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.22" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {showGrid && (
        <g stroke="#1e3048" strokeWidth="0.75">
          <line
            x1="0"
            y1={height * 0.5}
            x2={width}
            y2={height * 0.5}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={width * 0.25}
            y1="0"
            x2={width * 0.25}
            y2={height}
            strokeOpacity="0.45"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={width * 0.5}
            y1="0"
            x2={width * 0.5}
            y2={height}
            strokeOpacity="0.45"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={width * 0.75}
            y1="0"
            x2={width * 0.75}
            y2={height}
            strokeOpacity="0.45"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}

      {fillD && <path d={fillD} fill={`url(#${gradId})`} />}

      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth={showGrid ? 1.8 : 1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {!responsive &&
        coords.map((c, idx) => {
          const isLast = idx === coords.length - 1;
          if (!isLast && c.status === "up") return null;
          const dotFill =
            c.status === "down"
              ? "#f43f5e"
              : c.status === "degraded"
              ? "#f59e0b"
              : "#10b981";
          return (
            <circle
              key={idx}
              cx={c.x}
              cy={c.y}
              r={isLast ? 2.5 : 2}
              fill={dotFill}
              stroke="#070d14"
              strokeWidth="1"
            />
          );
        })}
    </svg>
  );
}
