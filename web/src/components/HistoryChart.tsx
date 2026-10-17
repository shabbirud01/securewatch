import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatDateTime } from '../format';

export interface ChartPoint {
  /** When the scan ran, in milliseconds. */
  t: number;
  /** null breaks the line, e.g. a failed scan has no grade. */
  value: number | null;
  /** Marks a failed scan with a dot on the baseline. */
  failed?: boolean;
  /** Tooltip text, e.g. "Grade B · 84/100". */
  label: string;
}

interface HistoryChartProps {
  title: string;
  /** Oldest first. */
  points: ChartPoint[];
  yDomain: [number, number];
  yTicks: { value: number; label: string }[];
  /** Draw steps: a value holds until the next scan (right for grades). */
  step?: boolean;
  /** A labelled reference line, e.g. the 30-day warning level. */
  threshold?: { value: number; label: string };
}

const TOP = 10;
const PLOT_HEIGHT = 140;
const AXIS_BAND = 24; // room for the time labels under the plot
const LEFT = 44; // room for the y-axis labels
const RIGHT = 10;

/**
 * A small single-series line chart in plain SVG. Hovering, or focusing it and using the
 * arrow keys, moves a crosshair to the nearest scan and shows its value. The same
 * numbers are always in the table view below the charts, so the tooltip never gates them.
 */
export function HistoryChart({ title, points, yDomain, yTicks, step = false, threshold }: HistoryChartProps) {
  const [container, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();

  const plotWidth = Math.max(0, width - LEFT - RIGHT);
  const first = points[0]?.t ?? 0;
  const last = points.at(-1)?.t ?? 0;
  const x = (t: number) => LEFT + (last === first ? plotWidth / 2 : ((t - first) / (last - first)) * plotWidth);
  const [yMin, yMax] = yDomain;
  const y = (value: number) => TOP + (1 - (value - yMin) / (yMax - yMin)) * PLOT_HEIGHT;
  const baseline = TOP + PLOT_HEIGHT;

  const latest = points.findLast((point) => point.value !== null);
  const activePoint = active === null ? undefined : points[active];

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    // The crosshair finds the nearest scan in time: nobody has to land exactly on the line.
    const pointerX = event.clientX - event.currentTarget.getBoundingClientRect().left;
    let nearest = 0;
    points.forEach((point, i) => {
      if (Math.abs(x(point.t) - pointerX) < Math.abs(x(points[nearest]!.t) - pointerX)) nearest = i;
    });
    setActive(nearest);
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    const lastIndex = points.length - 1;
    const move = (by: number) => setActive((i) => Math.min(lastIndex, Math.max(0, (i ?? lastIndex) + by)));
    if (event.key === 'ArrowLeft') move(-1);
    else if (event.key === 'ArrowRight') move(1);
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(lastIndex);
    else return;
    event.preventDefault();
  }

  return (
    <figure className="rounded-xl border border-line bg-surface p-4">
      <figcaption id={titleId} className="mb-3 text-sm font-medium">
        {title}
      </figcaption>
      <div ref={container} className="relative">
        {width > 0 && points.length > 0 && (
          <svg
            width={width}
            height={TOP + PLOT_HEIGHT + AXIS_BAND}
            role="img"
            aria-labelledby={titleId}
            tabIndex={0}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(points.length - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={onKeyDown}
            className="block touch-none rounded outline-none focus-visible:outline-2 focus-visible:outline-series-1"
          >
            {/* Recessive hairline grid with the y-axis labels */}
            {yTicks.map((tick) => (
              <g key={tick.value}>
                <line x1={LEFT} x2={LEFT + plotWidth} y1={y(tick.value)} y2={y(tick.value)} className="stroke-grid" />
                <text x={LEFT - 8} y={y(tick.value)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                  {tick.label}
                </text>
              </g>
            ))}

            {threshold && threshold.value > yMin && threshold.value < yMax && (
              <g>
                <line x1={LEFT} x2={LEFT + plotWidth} y1={y(threshold.value)} y2={y(threshold.value)} className="stroke-warning" />
                <text x={LEFT + plotWidth} y={y(threshold.value) - 5} textAnchor="end" className="fill-ink-2 text-[11px]">
                  {threshold.label}
                </text>
              </g>
            )}

            <path
              d={linePath(points, x, y, step)}
              fill="none"
              className="stroke-series-1"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Failed scans: a dot on the baseline (the line itself has a gap there) */}
            {points.map(
              (point, i) =>
                point.failed && (
                  <circle key={i} cx={x(point.t)} cy={baseline} r={4} className="fill-critical stroke-surface" strokeWidth={2} />
                ),
            )}

            {/* End dot on the most recent value; the 2px surface ring keeps it legible on the line */}
            {latest && latest.value !== null && (
              <circle cx={x(latest.t)} cy={y(latest.value)} r={4} className="fill-series-1 stroke-surface" strokeWidth={2} />
            )}

            {activePoint && (
              <g>
                <line x1={x(activePoint.t)} x2={x(activePoint.t)} y1={TOP} y2={baseline} className="stroke-axis" />
                {activePoint.value !== null && (
                  <circle cx={x(activePoint.t)} cy={y(activePoint.value)} r={5} className="fill-series-1 stroke-surface" strokeWidth={2} />
                )}
              </g>
            )}

            <text x={LEFT} y={baseline + 17} className="fill-muted text-[11px]">
              {formatTick(first, last - first)}
            </text>
            {last !== first && (
              <text x={LEFT + plotWidth} y={baseline + 17} textAnchor="end" className="fill-muted text-[11px]">
                {formatTick(last, last - first)}
              </text>
            )}
          </svg>
        )}

        {activePoint && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-sm"
            style={{ left: clamp(x(activePoint.t), 80, width - 80), transform: 'translateX(-50%)' }}
          >
            {/* The value leads; the date is secondary */}
            <div className="font-semibold whitespace-nowrap">{activePoint.label}</div>
            <div className="whitespace-nowrap text-ink-2">{formatDateTime(activePoint.t)}</div>
          </div>
        )}
      </div>
    </figure>
  );
}

/** SVG path through the points. A null value ends the current segment, leaving a gap. */
function linePath(points: ChartPoint[], x: (t: number) => number, y: (value: number) => number, step: boolean): string {
  let path = '';
  let drawing = false;
  for (const point of points) {
    if (point.value === null) {
      drawing = false;
      continue;
    }
    const px = x(point.t);
    const py = y(point.value);
    if (!drawing) path += `M${px},${py}`;
    else path += step ? `H${px}V${py}` : `L${px},${py}`; // a step holds the old value until this scan
    drawing = true;
  }
  return path;
}

const timeOnly = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/** Axis label: times of day for a short range, dates for a longer one. */
function formatTick(t: number, range: number): string {
  return (range < 2 * 86_400_000 ? timeOnly : dayMonth).format(t);
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Measures an element's width, and follows it when the window is resized. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
