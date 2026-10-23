import { ColorType, createChart, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { formatPct } from '../utils/format';

export type ChartRange = '1D' | '1W' | '1M' | '1Y' | '5Y';

const RANGE_LABELS: Record<ChartRange, string> = {
  '1D': 'Today',
  '1W': 'Past week',
  '1M': 'Past month',
  '1Y': 'Past year',
  '5Y': 'Past 5 years',
};

const UP = '#00b386';
const DOWN = '#eb5b3c';

interface CandlesResponse {
  points: { t: number; v: number }[]; // t = unix seconds, v = paise
}

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

export function PriceChart({ symbol, ltp }: { symbol: string; ltp: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const lastTimeRef = useRef(0);
  const [range, setRange] = useState<ChartRange>('1D');
  const [startPrice, setStartPrice] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>('loading');

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
    seriesRef.current = chart.addAreaSeries({ lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Load history from the server whenever the stock or range changes.
  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    api
      .get<CandlesResponse>(`/market/candles/${symbol}?range=${range}`, { auth: false })
      .then(({ points }) => {
        if (cancelled || !seriesRef.current) return;
        const data = points.map((p) => ({ time: p.t as UTCTimestamp, value: p.v / 100 }));
        seriesRef.current.setData(data);
        chartRef.current?.timeScale().fitContent();
        lastTimeRef.current = data.length ? data[data.length - 1].time : 0;
        setStartPrice(data.length ? data[0].value : 0);
        setLoadState(data.length ? 'ready' : 'empty');
      })
      .catch(() => !cancelled && setLoadState('error'));
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

  // Stream live prices: 1D appends a point per minute, longer ranges move the last point.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || loadState === 'loading' || loadState === 'error') return;
    if (range !== '1D' && !lastTimeRef.current) return;
    let t = lastTimeRef.current;
    if (range === '1D') t = Math.max(t, Math.floor(Date.now() / 60_000) * 60);
    series.update({ time: t as UTCTimestamp, value: ltp });
    lastTimeRef.current = t;
  }, [ltp, range, loadState]);

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
      {range !== '1D' && loadState === 'ready' && (
        <div className="chart-range-change muted small" data-testid="range-change">
          <span className={up ? 'up' : 'down'}>{formatPct(rangePct)}</span> {RANGE_LABELS[range]}
        </div>
      )}
      <div className="chart-wrap">
        <div className="chart" ref={containerRef} data-testid="price-chart" data-state={loadState} />
        {loadState === 'error' && <div className="chart-overlay">Couldn't load the chart</div>}
        {loadState === 'empty' && <div className="chart-overlay">No trades yet today</div>}
      </div>
      <div className="range-tabs" role="tablist">
        {(Object.keys(RANGE_LABELS) as ChartRange[]).map((r) => (
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
