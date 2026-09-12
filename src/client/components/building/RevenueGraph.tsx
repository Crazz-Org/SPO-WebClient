/**
 * RevenueGraph — SVG area chart for building revenue history.
 *
 * Pure SVG + React. Uses monotone cubic interpolation (Fritsch-Carlson)
 * for smooth curves that don't overshoot data points.
 */

import { memo, useRef, useState, useEffect } from 'react';
import { formatCurrency } from '@/shared/building-details/property-definitions';
import styles from './RevenueGraph.module.css';

interface RevenueGraphProps {
  data: number[];
  height?: number;
  /** Year of the last data point (current world year minus one, ChartSheet.pas:83-84). */
  endYear?: number;
}

// Layout constants
const PADDING_LEFT = 48;
const PADDING_RIGHT = 12;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 20;
const VIEWBOX_WIDTH = 360;
const POINT_RADIUS = 3.5;
const POINT_RADIUS_HOVER = 5.5;
const TICK_COUNT = 4;

// ---------------------------------------------------------------------------
// Monotone cubic interpolation (Fritsch-Carlson)
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

/** Build an SVG cubic bezier path through points using monotone interpolation. */
export function buildMonotonePath(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  if (points.length === 2) {
    return `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`;
  }

  const n = points.length;
  // Step 1: compute slopes
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    dy.push(points[i + 1].y - points[i].y);
    m.push(dy[i] / dx[i]);
  }

  // Step 2: compute tangents (Fritsch-Carlson monotonicity)
  const tangents: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      tangents.push(0);
    } else {
      tangents.push(3 * (dx[i - 1] + dx[i]) / (
        (2 * dx[i] + dx[i - 1]) / m[i - 1] +
        (dx[i] + 2 * dx[i - 1]) / m[i]
      ));
    }
  }
  tangents.push(m[n - 2]);

  // Step 3: build cubic bezier path
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const segLen = dx[i] / 3;
    const cp1x = points[i].x + segLen;
    const cp1y = points[i].y + tangents[i] * segLen;
    const cp2x = points[i + 1].x - segLen;
    const cp2y = points[i + 1].y - tangents[i + 1] * segLen;
    d += `C${cp1x},${cp1y},${cp2x},${cp2y},${points[i + 1].x},${points[i + 1].y}`;
  }
  return d;
}

/** Compute nice Y-axis tick values spanning [min, max]. */
export function computeYTicks(min: number, max: number, count: number): number[] {
  if (min === max) {
    return min === 0 ? [-1, 0, 1] : [min - 1, min, min + 1];
  }
  const range = max - min;
  const rawStep = range / (count - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  let niceStep: number;
  if (residual <= 1.5) niceStep = magnitude;
  else if (residual <= 3.5) niceStep = 2 * magnitude;
  else if (residual <= 7.5) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;

  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + niceStep * 0.01; v += niceStep) {
    ticks.push(Math.round(v * 1e6) / 1e6); // avoid float drift
  }
  return ticks;
}

/**
 * Points are in thousands of dollars (Kernel/Kernel.pas:4182); `formatCurrency` already
 * picks the K/M/B suffix, matching Voyager's `FormatMoney(val) + 'K'` (PlotterGrid.pas:121-125).
 */
export function formatThousands(v: number): string {
  return formatCurrency(v * 1000);
}

/**
 * Year for each point, ending at `endYear` (PlotterGrid.pas:129). Falls back to a 1-based
 * index when no world date has been received yet.
 */
export function xAxisYears(count: number, endYear: number | undefined): (number | string)[] {
  if (endYear === undefined) {
    return Array.from({ length: count }, (_, i) => i + 1);
  }
  return Array.from({ length: count }, (_, i) => endYear - (count - 1 - i));
}

export const RevenueGraph = memo(function RevenueGraph({ data, height = 160, endYear }: RevenueGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [pathLength, setPathLength] = useState(0);
  const pathRef = useRef<SVGPathElement>(null);

  // Measure path length for draw-in animation
  useEffect(() => {
    if (pathRef.current) {
      setPathLength(pathRef.current.getTotalLength());
    }
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>No revenue data available</div>
      </div>
    );
  }

  // Compute bounds
  const dataMin = Math.min(...data);
  const dataMax = Math.max(...data);
  const yTicks = computeYTicks(dataMin, dataMax, TICK_COUNT);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];

  const chartW = VIEWBOX_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const chartH = height - PADDING_TOP - PADDING_BOTTOM;

  // Map data → SVG coordinates
  const yRange = yMax - yMin || 1;
  const toX = (i: number) => PADDING_LEFT + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW);
  const toY = (v: number) => PADDING_TOP + chartH - ((v - yMin) / yRange) * chartH;
  const zeroY = toY(0);

  const points: Point[] = data.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const linePath = buildMonotonePath(points);

  // Area paths (close to zero-line, then along bottom/top)
  const crossesZero = dataMin < 0 && dataMax > 0;
  const allNegative = dataMax <= 0;

  // Build area fill: line path → horizontal to right → down to zero → left to start
  const firstPt = points[0];
  const lastPt = points[points.length - 1];
  const clampedZeroY = Math.max(PADDING_TOP, Math.min(PADDING_TOP + chartH, zeroY));

  // Positive area: from line down to zero line (clipped above zero)
  const posAreaPath = `${linePath}L${lastPt.x},${clampedZeroY}L${firstPt.x},${clampedZeroY}Z`;
  // Negative area: from line up to zero line (clipped below zero)
  const negAreaPath = posAreaPath; // same shape, clipped differently

  // Current value (last data point)
  const currentValue = data[data.length - 1];
  const currentValueClass = currentValue > 0
    ? styles.currentValuePositive
    : currentValue < 0
      ? styles.currentValueNegative
      : styles.currentValueNeutral;

  return (
    <div className={styles.container} ref={containerRef}>
      <div className={styles.header}>
        <span className={styles.title}>Revenue History</span>
        <span className={`${styles.currentValue} ${currentValueClass}`}>
          {formatThousands(currentValue)}
        </span>
      </div>

      <div className={styles.chartArea}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Revenue history chart with ${data.length} data points`}
        >
          <defs>
            {/* Clip to chart area only above zero */}
            <clipPath id="clip-positive">
              <rect
                x={PADDING_LEFT}
                y={PADDING_TOP}
                width={chartW}
                height={Math.max(0, clampedZeroY - PADDING_TOP)}
              />
            </clipPath>
            {/* Clip to chart area only below zero */}
            <clipPath id="clip-negative">
              <rect
                x={PADDING_LEFT}
                y={clampedZeroY}
                width={chartW}
                height={Math.max(0, PADDING_TOP + chartH - clampedZeroY)}
              />
            </clipPath>
          </defs>

          {/* Grid lines */}
          {yTicks.map((tick) => {
            const y = toY(tick);
            return (
              <line
                key={`grid-${tick}`}
                x1={PADDING_LEFT}
                y1={y}
                x2={VIEWBOX_WIDTH - PADDING_RIGHT}
                y2={y}
                className={tick === 0 && crossesZero ? styles.zeroLine : styles.gridLine}
              />
            );
          })}

          {/* Zero line (if not in grid ticks but data crosses zero) */}
          {crossesZero && !yTicks.includes(0) && (
            <line
              x1={PADDING_LEFT}
              y1={zeroY}
              x2={VIEWBOX_WIDTH - PADDING_RIGHT}
              y2={zeroY}
              className={styles.zeroLine}
            />
          )}

          {/* Area fills */}
          {!allNegative && (
            <path
              d={posAreaPath}
              className={styles.areaPositive}
              clipPath="url(#clip-positive)"
            />
          )}
          {(crossesZero || allNegative) && (
            <path
              d={negAreaPath}
              className={styles.areaNegative}
              clipPath="url(#clip-negative)"
            />
          )}

          {/* Main line */}
          <path
            ref={pathRef}
            d={linePath}
            className={`${styles.line} ${pathLength > 0 ? styles.lineAnimated : ''}`}
            style={pathLength > 0 ? {
              strokeDasharray: pathLength,
              strokeDashoffset: 0,
              '--path-length': pathLength,
            } as React.CSSProperties : undefined}
          />

          {/* Y-axis labels */}
          {yTicks.map((tick) => (
            <text
              key={`y-${tick}`}
              x={PADDING_LEFT - 6}
              y={toY(tick)}
              className={styles.axisLabel}
              textAnchor="end"
            >
              {formatThousands(tick)}
            </text>
          ))}

          {/* X-axis labels (show a subset to avoid crowding) */}
          {data.map((_, i) => {
            // Show first, last, and evenly spaced labels
            const showLabel = data.length <= 6
              || i === 0
              || i === data.length - 1
              || (data.length > 6 && i % Math.ceil(data.length / 6) === 0);
            if (!showLabel) return null;
            return (
              <text
                key={`x-${i}`}
                x={toX(i)}
                y={PADDING_TOP + chartH + 4}
                className={`${styles.axisLabel} ${styles.axisLabelX}`}
              >
                {xAxisYears(data.length, endYear)[i]}
              </text>
            );
          })}

          {/* Data points */}
          {points.map((pt, i) => (
            <circle
              key={`pt-${i}`}
              cx={pt.x}
              cy={pt.y}
              r={hoveredIndex === i ? POINT_RADIUS_HOVER : POINT_RADIUS}
              className={styles.dataPoint}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          ))}
        </svg>

        {/* Tooltip */}
        {hoveredIndex !== null && (
          <div
            className={styles.tooltip}
            style={{
              left: `${(toX(hoveredIndex) / VIEWBOX_WIDTH) * 100}%`,
              top: `${(toY(data[hoveredIndex]) / height) * 100}%`,
            }}
          >
            {formatThousands(data[hoveredIndex])}
          </div>
        )}
      </div>
    </div>
  );
});
