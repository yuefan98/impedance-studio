import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Dataset, DatasetRow } from "@/lib/types";
import { formatAxisValue, formatNumber } from "./utils";

const PLOT_WIDTH = 500;
const PLOT_HEIGHT = 500;
const PLOT_PADDING = { top: 24, right: 20, bottom: 56, left: 64 };
const AVAILABLE_PLOT_WIDTH = PLOT_WIDTH - PLOT_PADDING.left - PLOT_PADDING.right;
const AVAILABLE_PLOT_HEIGHT = PLOT_HEIGHT - PLOT_PADDING.top - PLOT_PADDING.bottom;
const SQUARE_PLOT_SIZE = Math.min(AVAILABLE_PLOT_WIDTH, AVAILABLE_PLOT_HEIGHT);
const PLOT_COLORS = ["#0f8f89", "#d9572a", "#4d70b8", "#8a5fbf", "#557c38", "#b44f82"];

export const PlotCard = memo(function PlotCard({
  title,
  rows,
  comparisonDatasets,
  fitRows,
  xKey,
  yKey,
  invertY,
  logX,
}: {
  title: string;
  rows: DatasetRow[];
  comparisonDatasets: Dataset[];
  fitRows?: DatasetRow[];
  xKey: keyof DatasetRow;
  yKey: keyof DatasetRow;
  invertY?: boolean;
  logX?: boolean;
}) {
  const [hoveredPoint, setHoveredPoint] = useState<PlottedPoint | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const pointerFrame = useRef<number | null>(null);
  const plotData = useMemo(
    () => createPlotData(rows, comparisonDatasets, fitRows, xKey, yKey, Boolean(invertY), Boolean(logX)),
    [comparisonDatasets, fitRows, invertY, logX, rows, xKey, yKey],
  );
  const { allPoints, domain, fitLine, fitPoints, plotArea, series, xTicks, yTicks } = plotData;
  const safeFocusedIndex = allPoints.length ? Math.min(focusedIndex, allPoints.length - 1) : 0;
  const inspectedPoint = hoveredPoint ?? allPoints[safeFocusedIndex];
  const xLabel = xKey === "frequency" ? "Frequency" : "Z' / Ohm";
  const yLabel = yKey === "z_abs" ? "|Z| / Ohm" : "Z'' / Ohm";
  const plotId = useMemo(() => `plot-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, [title]);

  useEffect(() => {
    return () => {
      if (pointerFrame.current !== null) window.cancelAnimationFrame(pointerFrame.current);
    };
  }, []);

  function handlePointerMove(event: MouseEvent<SVGSVGElement>) {
    if (!allPoints.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * PLOT_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * PLOT_HEIGHT;
    if (pointerFrame.current !== null) window.cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = window.requestAnimationFrame(() => {
      pointerFrame.current = null;
      const nearest = nearestPoint(allPoints, x, y);
      setHoveredPoint((current) => (current === nearest ? current : nearest));
    });
  }

  function clearHoveredPoint() {
    if (pointerFrame.current !== null) {
      window.cancelAnimationFrame(pointerFrame.current);
      pointerFrame.current = null;
    }
    setHoveredPoint((current) => (current === null ? current : null));
  }

  function handlePlotKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (!allPoints.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      clearHoveredPoint();
      setFocusedIndex((index) => Math.min(index + 1, allPoints.length - 1));
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      clearHoveredPoint();
      setFocusedIndex((index) => Math.max(index - 1, 0));
    }
  }

  return (
    <article className="plot-card">
      <div className="plot-card-title">
        <strong>{title}</strong>
        <span>{series.length > 1 ? `${series.length} datasets` : "data + fit"}</span>
      </div>
      <ul className="plot-legend" aria-label="Plot legend">
        {series.map((item) => (
          <li className="legend-item" key={item.id}>
            <i aria-hidden="true" style={{ background: item.color }} />
            <span className="legend-copy">
              <strong title={item.name}>{item.name}</strong>
              <small>{item.kind} measured / {item.rows.length} points</small>
            </span>
          </li>
        ))}
        {fitPoints.length > 0 && (
          <li className="legend-item">
            <i aria-hidden="true" className="fit-swatch" />
            <span className="legend-copy">
              <strong>Fitted response</strong>
              <small>{fitPoints.length} points</small>
            </span>
          </li>
        )}
      </ul>
      <svg
        height={PLOT_HEIGHT}
        preserveAspectRatio="xMidYMin meet"
        viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
        width={PLOT_WIDTH}
        role="img"
        aria-label={`${title} plot`}
        aria-describedby={`${plotId}-inspector`}
        onMouseLeave={clearHoveredPoint}
        onMouseMove={handlePointerMove}
        onKeyDown={handlePlotKeyDown}
        tabIndex={0}
      >
        <rect className="plot-frame" x={plotArea.x} y={plotArea.y} width={plotArea.width} height={plotArea.height} />
        {xTicks.map((tick) => {
          const x = scaleValue(tick, domain.minX, domain.maxX, plotArea.x, plotArea.x + plotArea.width);
          return (
            <g key={`x-${tick}`}>
              <line className="grid" x1={x} x2={x} y1={plotArea.y} y2={plotArea.y + plotArea.height} />
              <line className="tick" x1={x} x2={x} y1={plotArea.y + plotArea.height} y2={plotArea.y + plotArea.height + 5} />
              <text className="axis-text" textAnchor="middle" x={x} y={plotArea.y + plotArea.height + 18}>
                {logX ? formatAxisValue(10 ** tick, xKey) : formatNumber(tick)}
              </text>
            </g>
          );
        })}
        {yTicks.map((tick) => {
          const y = scaleY(tick, domain.minY, domain.maxY, plotArea.y, plotArea.height, Boolean(invertY));
          return (
            <g key={`y-${tick}`}>
              <line className="grid" x1={plotArea.x} x2={plotArea.x + plotArea.width} y1={y} y2={y} />
              <line className="tick" x1={plotArea.x - 5} x2={plotArea.x} y1={y} y2={y} />
              <text className="axis-text" textAnchor="end" x={plotArea.x - 10} y={y + 4}>
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}
        <line className="axis-line" x1={plotArea.x} y1={plotArea.y + plotArea.height} x2={plotArea.x + plotArea.width} y2={plotArea.y + plotArea.height} />
        <line className="axis-line" x1={plotArea.x} y1={plotArea.y} x2={plotArea.x} y2={plotArea.y + plotArea.height} />
        <text className="axis-label" textAnchor="middle" x={plotArea.x + plotArea.width / 2} y={plotArea.y + plotArea.height + 28}>
          {xLabel}
        </text>
        <text
          className="axis-label"
          textAnchor="middle"
          transform={`translate(${plotArea.x - 42} ${plotArea.y + plotArea.height / 2}) rotate(-90)`}
        >
          {yLabel}
        </text>
        {series.map((item) => (
          <g key={item.id}>
            <polyline className="data-line" points={item.line} style={{ stroke: item.color }} />
            {item.markers.map((point) => (
              <circle key={`${item.id}-${point.x}-${point.y}`} cx={point.x} cy={point.y} r="3" style={{ stroke: item.color }} />
            ))}
          </g>
        ))}
        {fitPoints.length > 0 && <polyline className="fit-line" points={fitLine} />}
        {inspectedPoint && (
          <g className="hover-layer">
            <line className="hover-line" x1={inspectedPoint.x} x2={inspectedPoint.x} y1={plotArea.y} y2={plotArea.y + plotArea.height} />
            <line className="hover-line" x1={plotArea.x} x2={plotArea.x + plotArea.width} y1={inspectedPoint.y} y2={inspectedPoint.y} />
            <circle className="hover-point" cx={inspectedPoint.x} cy={inspectedPoint.y} r="5" style={{ stroke: inspectedPoint.color }} />
          </g>
        )}
      </svg>
      <div className="plot-footer">
        <output className="plot-tooltip" id={`${plotId}-inspector`}>
          {inspectedPoint
            ? `${inspectedPoint.series}: ${xLabel} ${formatAxisValue(inspectedPoint.xValue, xKey)}, ${yLabel} ${formatNumber(inspectedPoint.yValue)}`
            : "No plot data available"}
        </output>
      </div>
    </article>
  );
});

type PlotArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PlotDomain = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type PlottedPoint = {
  x: number;
  y: number;
  xValue: number;
  yValue: number;
  series: string;
  color: string;
};

function createPlotData(
  rows: DatasetRow[],
  comparisonDatasets: Dataset[],
  fitRows: DatasetRow[] | undefined,
  xKey: keyof DatasetRow,
  yKey: keyof DatasetRow,
  invertY: boolean,
  logX: boolean,
) {
  const equalAspect = xKey !== "frequency" && !logX;
  const plotArea = {
    x: equalAspect ? PLOT_PADDING.left + (AVAILABLE_PLOT_WIDTH - SQUARE_PLOT_SIZE) / 2 : PLOT_PADDING.left,
    y: PLOT_PADDING.top,
    width: equalAspect ? SQUARE_PLOT_SIZE : AVAILABLE_PLOT_WIDTH,
    height: equalAspect ? SQUARE_PLOT_SIZE : AVAILABLE_PLOT_HEIGHT,
  };
  const rawSeries = comparisonDatasets.length
    ? comparisonDatasets.map((dataset, index) => ({
        id: dataset.id,
        name: dataset.name,
        kind: dataset.kind,
        rows: dataset.rows,
        color: PLOT_COLORS[index % PLOT_COLORS.length],
      }))
    : [{ id: "active", name: "Active dataset", kind: "EIS", rows, color: PLOT_COLORS[0] }];
  const scaleRows = rawSeries.flatMap((series) => series.rows).concat(fitRows ?? []);
  const domain = getPlotDomain(scaleRows, xKey, yKey, logX, equalAspect);
  const series = rawSeries.map((item) => {
    const points = toPoints(item.rows, xKey, yKey, plotArea, domain, invertY, logX, item.name, item.color);
    return {
      ...item,
      line: toLine(points),
      markers: points.filter((_, index) => index % 10 === 0),
      points,
    };
  });
  const fitPoints = toPoints(fitRows ?? [], xKey, yKey, plotArea, domain, invertY, logX, "fit", "#d9572a");
  const allPoints = series.flatMap((item) => item.points).concat(fitPoints);

  return {
    allPoints,
    domain,
    fitLine: toLine(fitPoints),
    fitPoints,
    plotArea,
    series,
    xTicks: createTicks(domain.minX, domain.maxX, 5),
    yTicks: createTicks(domain.minY, domain.maxY, 5),
  };
}

function getPlotDomain(
  rows: DatasetRow[],
  xKey: keyof DatasetRow,
  yKey: keyof DatasetRow,
  logX: boolean,
  equalAspect: boolean,
): PlotDomain {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const x = transformX(Number(row[xKey]), logX);
    const y = Number(row[yKey]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const domain = {
    minX: Number.isFinite(minX) ? minX : 0,
    maxX: Number.isFinite(maxX) ? maxX : 1,
    minY: Number.isFinite(minY) ? minY : 0,
    maxY: Number.isFinite(maxY) ? maxY : 1,
  };
  return equalAspect ? padEqualAspectDomain(domain) : padDomain(domain);
}

function nearestPoint(points: PlottedPoint[], x: number, y: number) {
  let nearest = points[0];
  let shortestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distanceX = point.x - x;
    const distanceY = point.y - y;
    const distanceSquared = distanceX * distanceX + distanceY * distanceY;
    if (distanceSquared < shortestDistanceSquared) {
      nearest = point;
      shortestDistanceSquared = distanceSquared;
    }
  }
  return shortestDistanceSquared < 42 * 42 ? nearest : null;
}

function padDomain(domain: PlotDomain): PlotDomain {
  const xSpan = Math.max(domain.maxX - domain.minX, 1e-9);
  const ySpan = Math.max(domain.maxY - domain.minY, 1e-9);
  return {
    minX: domain.minX - xSpan * 0.05,
    maxX: domain.maxX + xSpan * 0.05,
    minY: domain.minY - ySpan * 0.08,
    maxY: domain.maxY + ySpan * 0.08,
  };
}

function padEqualAspectDomain(domain: PlotDomain): PlotDomain {
  const xSpan = Math.max(domain.maxX - domain.minX, 1e-9);
  const ySpan = Math.max(domain.maxY - domain.minY, 1e-9);
  const span = Math.max(xSpan, ySpan) * 1.12;
  const xCenter = (domain.minX + domain.maxX) / 2;
  const yCenter = (domain.minY + domain.maxY) / 2;
  return {
    minX: xCenter - span / 2,
    maxX: xCenter + span / 2,
    minY: yCenter - span / 2,
    maxY: yCenter + span / 2,
  };
}

function toPoints(
  rows: DatasetRow[],
  xKey: keyof DatasetRow,
  yKey: keyof DatasetRow,
  plotArea: PlotArea,
  domain: PlotDomain,
  invertY: boolean,
  logX: boolean,
  series: string,
  color: string,
): PlottedPoint[] {
  return rows.map((row) => {
    const xValue = Number(row[xKey]);
    const yValue = Number(row[yKey]);
    const x = scaleValue(transformX(xValue, logX), domain.minX, domain.maxX, plotArea.x, plotArea.x + plotArea.width);
    const y = scaleY(yValue, domain.minY, domain.maxY, plotArea.y, plotArea.height, invertY);
    return {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      xValue,
      yValue,
      series,
      color,
    };
  });
}

function transformX(value: number, logX: boolean) {
  return logX ? Math.log10(Math.max(value, 1e-12)) : value;
}

function scaleValue(value: number, min: number, max: number, start: number, end: number) {
  return start + ((value - min) / Math.max(max - min, 1e-9)) * (end - start);
}

function scaleY(value: number, min: number, max: number, start: number, height: number, invert: boolean) {
  const ratio = (value - min) / Math.max(max - min, 1e-9);
  return invert ? start + ratio * height : start + height - ratio * height;
}

function createTicks(min: number, max: number, count: number) {
  if (count <= 1) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

function toLine(points: PlottedPoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}
