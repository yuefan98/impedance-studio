import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Dataset, DatasetRow } from "@/lib/types";
import { formatAxisValue, formatNumber } from "./utils";

export function PlotCard({
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
  const width = 500;
  const height = 500;
  const padding = { top: 24, right: 20, bottom: 56, left: 64 };
  const equalAspect = xKey !== "frequency" && !logX;
  const availablePlotWidth = width - padding.left - padding.right;
  const availablePlotHeight = height - padding.top - padding.bottom;
  const squarePlotSize = Math.min(availablePlotWidth, availablePlotHeight);
  const plotArea = {
    x: equalAspect ? padding.left + (availablePlotWidth - squarePlotSize) / 2 : padding.left,
    y: padding.top,
    width: equalAspect ? squarePlotSize : availablePlotWidth,
    height: equalAspect ? squarePlotSize : availablePlotHeight,
  };
  const [hoveredPoint, setHoveredPoint] = useState<PlottedPoint | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const rawSeries = comparisonDatasets.length
    ? comparisonDatasets.map((dataset, index) => ({
        id: dataset.id,
        name: dataset.name,
        kind: dataset.kind,
        rows: dataset.rows,
        color: PLOT_COLORS[index % PLOT_COLORS.length],
      }))
    : [{ id: "active", name: "Active dataset", kind: "EIS", rows, color: PLOT_COLORS[0] }];
  const scaleRows = [...rawSeries.flatMap((series) => series.rows), ...(fitRows ?? [])];
  const domain = getPlotDomain(scaleRows, xKey, yKey, Boolean(logX), equalAspect);
  const series = rawSeries.map((item) => ({
    ...item,
    points: toPoints(item.rows, xKey, yKey, plotArea, domain, Boolean(invertY), Boolean(logX), item.name, item.color),
  }));
  const fitPoints = toPoints(
    fitRows ?? [],
    xKey,
    yKey,
    plotArea,
    domain,
    Boolean(invertY),
    Boolean(logX),
    "fit",
    "#d9572a",
  );
  const allPoints = useMemo(() => [...series.flatMap((item) => item.points), ...fitPoints], [series, fitPoints]);
  const safeFocusedIndex = allPoints.length ? Math.min(focusedIndex, allPoints.length - 1) : 0;
  const inspectedPoint = hoveredPoint ?? allPoints[safeFocusedIndex];
  const xTicks = createTicks(domain.minX, domain.maxX, 5);
  const yTicks = createTicks(domain.minY, domain.maxY, 5);
  const xLabel = xKey === "frequency" ? "Frequency" : "Z' / Ohm";
  const yLabel = yKey === "z_abs" ? "|Z| / Ohm" : "Z'' / Ohm";
  const plotId = useMemo(() => `plot-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`, [title]);

  function handlePointerMove(event: MouseEvent<SVGSVGElement>) {
    if (!allPoints.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    const nearest = allPoints.reduce((best, point) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      return distance < best.distance ? { point, distance } : best;
    }, { point: allPoints[0], distance: Number.POSITIVE_INFINITY });
    setHoveredPoint(nearest.distance < 42 ? nearest.point : null);
  }

  function handlePlotKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (!allPoints.length) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedIndex((index) => Math.min(index + 1, allPoints.length - 1));
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
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
        height={height}
        preserveAspectRatio="xMidYMin meet"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        role="img"
        aria-label={`${title} plot`}
        aria-describedby={`${plotId}-inspector`}
        onMouseLeave={() => setHoveredPoint(null)}
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
            <polyline className="data-line" points={toLine(item.points)} style={{ stroke: item.color }} />
            {item.points.filter((_, index) => index % 10 === 0).map((point) => (
              <circle key={`${item.id}-${point.x}-${point.y}`} cx={point.x} cy={point.y} r="3" style={{ stroke: item.color }} />
            ))}
          </g>
        ))}
        {fitPoints.length > 0 && <polyline className="fit-line" points={toLine(fitPoints)} />}
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
}

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

const PLOT_COLORS = ["#0f8f89", "#d9572a", "#4d70b8", "#8a5fbf", "#557c38", "#b44f82"];

function getPlotDomain(
  rows: DatasetRow[],
  xKey: keyof DatasetRow,
  yKey: keyof DatasetRow,
  logX: boolean,
  equalAspect: boolean,
): PlotDomain {
  const usableRows = rows.length ? rows : [{ frequency: 1, z_real: 0, z_imag: 0, z_abs: 0, phase: 0 }];
  const xs = usableRows.map((row) => transformX(Number(row[xKey]), logX));
  const ys = usableRows.map((row) => Number(row[yKey]));
  const domain = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
  return equalAspect ? padEqualAspectDomain(domain) : padDomain(domain);
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
