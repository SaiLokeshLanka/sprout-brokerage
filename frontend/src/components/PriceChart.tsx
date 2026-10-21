import { ColorType, createChart, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { formatPct } from '../utils/format';
import { hashString, mulberry32 } from '../utils/random';

export type ChartRange = '1D' | '1W' | '1M' | '1Y' | '5Y';

const RANGES: Record<ChartRange, { points: number; stepSec: number; vol: number; drift: number; label: string }> = {
  '1D': { points: 300, stepSec: 60, vol: 0.002, drift: 0, label: 'Today' },
  '1W': { points: 125, stepSec: 900, vol: 0.004, drift: 0.04, label: 'Past week' },
  '1M': { points: 120, stepSec: 21600, vol: 0.006, drift: 0.08, label: 'Past month' },
  '1Y': { points: 250, stepSec: 86400, vol: 0.012, drift: 0.3, label: 'Past year' },
  '5Y': { points: 260, stepSec: 604800, vol: 0.03, drift: 1.2, label: 'Past 5 years' },
};

const UP = '#00b386';
const DOWN = '#eb5b3c';

/** Seeded random walk pinned to a start and end price (a Brownian bridge). */
function generateHistory(symbol: string, range: ChartRange, endPrice: number, openPrice: number) {
  const { points, stepSec, vol, drift } = RANGES[range];
  const rnd = mulberry32(hashString(symbol + range));
  const start = range === '1D' ? openPrice : endPrice / (1 + (rnd() - 0.35) * drift);
  const walk = [0];
  for (let i = 1; i < points; i++) walk.push(walk[i - 1] + (rnd() - 0.5) * vol);
  const last = walk[points - 1];
  const nowSec = Math.floor(Date.now() / 1000);
  const endTime = range === '1D' ? Math.floor(nowSec / 60) * 60 - 60 : nowSec - stepSec;

  return walk.map((w, i) => {
    const t = i / (points - 1);
    const base = start + (endPrice - start) * t;
    return {
      time: (endTime - (points - 1 - i) * stepSec) as UTCTimestamp,
      value: Math.max(0.05, +(base * (1 + w - last * t)).toFixed(2)),
    };
  });
}

export function PriceChart({ symbol, ltp, open }: { symbol: string; ltp: number; open: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const lastTimeRef = useRef(0);
  const ltpRef = useRef(ltp);
  ltpRef.current = ltp;
  const [range, setRange] = useState<ChartRange>('1D');
  const [startPrice, setStartPrice] = useState(0);

  useEffect(() => {
    const chart = createChart(containerRef.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#7c7e8c' },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, borderVisible: false },
      crosshair: { horzLine: { visible: false, labelVisible: false } },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;
    seriesRef.current = chart.addAreaSeries({
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Load history when the stock or range changes.
  useEffect(() => {
    const data = generateHistory(symbol, range, ltpRef.current, open);
    seriesRef.current?.setData(data);
    chartRef.current?.timeScale().fitContent();
    lastTimeRef.current = data[data.length - 1].time;
    setStartPrice(data[0].value);
  }, [symbol, range, open]);

  // Stream live ticks: 1D appends a point per minute, other ranges move the last point.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !lastTimeRef.current) return;
    let t = lastTimeRef.current;
    if (range === '1D') t = Math.max(t, Math.floor(Date.now() / 60000) * 60);
    series.update({ time: t as UTCTimestamp, value: ltp });
    lastTimeRef.current = t;
  }, [ltp, range]);

  const up = ltp >= startPrice;
  useEffect(() => {
    seriesRef.current?.applyOptions({
      lineColor: up ? UP : DOWN,
      topColor: up ? 'rgba(0,179,134,0.22)' : 'rgba(235,91,60,0.22)',
      bottomColor: 'rgba(0,0,0,0)',
    });
  }, [up]);

  const rangePct = startPrice ? ((ltp - startPrice) / startPrice) * 100 : 0;

  return (
    <div className="chart-block">
      {range !== '1D' && startPrice > 0 && (
        <div className="chart-range-change muted small" data-testid="range-change">
          <span className={up ? 'up' : 'down'}>{formatPct(rangePct)}</span> {RANGES[range].label}
        </div>
      )}
      <div className="chart" ref={containerRef} data-testid="price-chart" />
      <div className="range-tabs" role="tablist">
        {(Object.keys(RANGES) as ChartRange[]).map((r) => (
          <button
            key={r}
            role="tab"
            aria-selected={r === range}
            className={`range-tab ${r === range ? (up ? 'active up-bg' : 'active down-bg') : ''}`}
            onClick={() => setRange(r)}
            data-testid={`range-${r}`}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
