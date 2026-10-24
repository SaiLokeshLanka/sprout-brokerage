import { ColorType, createChart, DeepPartial, IChartApi, ISeriesApi, LineStyle, SeriesType, TimeChartOptions, UTCTimestamp } from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { bollinger, ema, lastValue, macd, rsi, Series, sma } from '../utils/indicators';
import type { ChartRange } from './PriceChart';

const UP = '#00b386';
const DOWN = '#eb5b3c';
const COLORS = { sma: '#5367ff', ema: '#f5a623', bb: '#9b59b6', rsi: '#5367ff', macd: '#5367ff', signal: '#f5a623' };
/** lightweight-charts shows times in UTC; shift by +5:30 so the axis reads in IST. */
const IST_OFFSET_SEC = 5.5 * 3600;
const RANGES: ChartRange[] = ['1D', '1W', '1M', '1Y', '5Y'];

export type Indicator = 'sma' | 'ema' | 'bb' | 'volume' | 'rsi' | 'macd';
const INDICATORS: { key: Indicator; label: string; title: string }[] = [
  { key: 'sma', label: 'SMA 20', title: 'Simple moving average of the last 20 closes' },
  { key: 'ema', label: 'EMA 50', title: 'Exponential moving average of the last 50 closes (recent prices count more)' },
  { key: 'bb', label: 'Bollinger', title: 'Bollinger Bands: 20-period average ± 2 standard deviations' },
  { key: 'volume', label: 'Volume', title: 'Shares traded in each candle' },
  { key: 'rsi', label: 'RSI 14', title: 'Relative Strength Index (0–100): above 70 overbought, below 30 oversold' },
  { key: 'macd', label: 'MACD', title: 'MACD (12, 26, 9): fast EMA − slow EMA, with its signal line' },
];

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  vol: number;
}

type LoadState = 'loading' | 'ready' | 'empty' | 'error';
type Pane = 'main' | 'rsi' | 'macd';

const timeOf = (c: Candle) => (c.t + IST_OFFSET_SEC) as UTCTimestamp;

/**
 * One point per candle. Where an indicator has no value yet, a "whitespace" point (time only)
 * keeps every chart on the same time slots, so the price, RSI and MACD charts line up.
 */
const toPoints = (candles: Candle[], values: Series) =>
  candles.map((c, i) => (values[i] === null ? { time: timeOf(c) } : { time: timeOf(c), value: values[i] as number }));

const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(2));

const chartOptions = (showTime: boolean, interactive = true): DeepPartial<TimeChartOptions> => ({
  autoSize: true,
  handleScroll: interactive,
  handleScale: interactive,
  layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#7c7e8c', fontSize: 11 },
  grid: { vertLines: { color: 'rgba(124,126,140,0.08)' }, horzLines: { color: 'rgba(124,126,140,0.08)' } },
  rightPriceScale: { borderVisible: false, minimumWidth: 64 },
  timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, visible: showTime },
});

/**
 * Candlestick chart with indicators, like a trading terminal. Indicators are calculated in the
 * browser (utils/indicators.ts) from the candles' closing prices and recalculated on every tick.
 * RSI and MACD are separate small charts below the price, scrolled and zoomed together with it.
 */
export function AdvancedChart({ symbol, ltp }: { symbol: string; ltp: number }) {
  const refs = { main: useRef<HTMLDivElement>(null), rsi: useRef<HTMLDivElement>(null), macd: useRef<HTMLDivElement>(null) };
  const chartsRef = useRef<Partial<Record<Pane, IChartApi>>>({});
  const seriesRef = useRef<Record<string, ISeriesApi<SeriesType>>>({});
  /** Fit all candles into view after the next data load (new stock or range). */
  const fitPending = useRef(true);
  const [range, setRange] = useState<ChartRange>('1D');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [on, setOn] = useState<Record<Indicator, boolean>>(() => {
    try {
      const saved = localStorage.getItem('sprout.chart.indicators');
      if (saved) return JSON.parse(saved);
    } catch {
      // storage unavailable
    }
    return { sma: true, ema: false, bb: false, volume: true, rsi: true, macd: false };
  });

  useEffect(() => {
    try {
      localStorage.setItem('sprout.chart.indicators', JSON.stringify(on));
    } catch {
      // storage unavailable
    }
  }, [on]);

  // Create the three charts and every series once; toggling an indicator only shows or hides it.
  useEffect(() => {
    const main = createChart(refs.main.current!, chartOptions(true));
    // The strips follow the price chart: scroll or zoom the price and they move with it.
    const rsiChart = createChart(refs.rsi.current!, chartOptions(false, false));
    const macdChart = createChart(refs.macd.current!, chartOptions(false, false));
    chartsRef.current = { main, rsi: rsiChart, macd: macdChart };
    const s = seriesRef.current;
    const line = (chart: IChartApi, color: string, extra = {}) =>
      chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });

    s.price = main.addCandlestickSeries({ upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false });
    s.sma = line(main, COLORS.sma);
    s.ema = line(main, COLORS.ema);
    s.bbUpper = line(main, COLORS.bb);
    s.bbMiddle = line(main, COLORS.bb, { lineStyle: LineStyle.Dotted });
    s.bbLower = line(main, COLORS.bb);
    // Volume bars along the bottom fifth of the price chart, on their own hidden scale.
    s.volume = main.addHistogramSeries({ priceScaleId: 'volume', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    main.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    s.rsi = line(rsiChart, COLORS.rsi, { lastValueVisible: true, crosshairMarkerVisible: true });
    s.rsi.createPriceLine({ price: 70, color: DOWN, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: '' });
    s.rsi.createPriceLine({ price: 30, color: UP, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: '' });
    s.macdHist = macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    s.macd = line(macdChart, COLORS.macd, { lastValueVisible: true, crosshairMarkerVisible: true });
    s.signal = line(macdChart, COLORS.signal);

    main.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r) [rsiChart, macdChart].forEach((c) => c.timeScale().setVisibleLogicalRange(r));
    });
    return () => {
      [main, rsiChart, macdChart].forEach((c) => c.remove());
      chartsRef.current = {};
      seriesRef.current = {};
    };
    // The refs are stable; the charts are created once.
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    api
      .get<{ candles: Candle[] }>(`/market/candles/${symbol}?range=${range}&format=ohlc`, { auth: false })
      .then((res) => {
        if (cancelled) return;
        setCandles(res.candles.map((c) => ({ ...c, o: c.o / 100, h: c.h / 100, l: c.l / 100, c: c.c / 100 })));
        setLoadState(res.candles.length ? 'ready' : 'empty');
        fitPending.current = true;
      })
      .catch(() => !cancelled && setLoadState('error'));
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

  // Live price: 1D starts a new candle each minute; longer ranges move the latest candle.
  useEffect(() => {
    setCandles((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      const minute = Math.floor(Date.now() / 60_000) * 60;
      if (range === '1D' && minute > last.t) return [...prev, { t: minute, o: last.c, h: Math.max(last.c, ltp), l: Math.min(last.c, ltp), c: ltp, vol: 0 }];
      if (last.c === ltp) return prev;
      return [...prev.slice(0, -1), { ...last, c: ltp, h: Math.max(last.h, ltp), l: Math.min(last.l, ltp) }];
    });
  }, [ltp, range]);

  const ind = useMemo(() => {
    const closes = candles.map((c) => c.c);
    return { sma: sma(closes, 20), ema: ema(closes, 50), bb: bollinger(closes, 20, 2), rsi: rsi(closes, 14), macd: macd(closes) };
  }, [candles]);

  // Push data into the visible series.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s.price) return;
    s.price.setData(candles.map((c) => ({ time: timeOf(c), open: c.o, high: c.h, low: c.l, close: c.c })));
    const show = (key: string, visible: boolean, data: () => unknown[]) => {
      s[key].applyOptions({ visible });
      (s[key] as ISeriesApi<'Line'>).setData(visible ? (data() as never[]) : []);
    };
    const bars = (values: Series) =>
      toPoints(candles, values).map((p) => (p.value !== undefined ? { ...p, color: p.value >= 0 ? 'rgba(0,179,134,0.5)' : 'rgba(235,91,60,0.5)' } : p));
    show('sma', on.sma, () => toPoints(candles, ind.sma));
    show('ema', on.ema, () => toPoints(candles, ind.ema));
    show('bbUpper', on.bb, () => toPoints(candles, ind.bb.upper));
    show('bbMiddle', on.bb, () => toPoints(candles, ind.bb.middle));
    show('bbLower', on.bb, () => toPoints(candles, ind.bb.lower));
    show('volume', on.volume, () =>
      candles.map((c) => ({ time: timeOf(c), value: c.vol, color: c.c >= c.o ? 'rgba(0,179,134,0.35)' : 'rgba(235,91,60,0.35)' })),
    );
    show('rsi', on.rsi, () => toPoints(candles, ind.rsi));
    show('macd', on.macd, () => toPoints(candles, ind.macd.macd));
    show('signal', on.macd, () => toPoints(candles, ind.macd.signal));
    show('macdHist', on.macd, () => bars(ind.macd.histogram));
    const { main, rsi: rsiChart, macd: macdChart } = chartsRef.current;
    main?.priceScale('right').applyOptions({ scaleMargins: { top: 0.06, bottom: on.volume ? 0.22 : 0.06 } });
    if (fitPending.current && candles.length) {
      main?.timeScale().fitContent();
      fitPending.current = false;
    }
    // A strip that was just switched on starts at the same bars as the price chart.
    const visible = main?.timeScale().getVisibleLogicalRange();
    if (visible) [rsiChart, macdChart].forEach((c) => c?.timeScale().setVisibleLogicalRange(visible));
  }, [candles, ind, on]);

  // Only the bottom chart shows the time axis.
  useEffect(() => {
    const { main, rsi: r, macd: m } = chartsRef.current;
    main?.applyOptions({ timeScale: { visible: !on.rsi && !on.macd } });
    r?.applyOptions({ timeScale: { visible: on.rsi && !on.macd } });
    m?.applyOptions({ timeScale: { visible: on.macd } });
  }, [on.rsi, on.macd]);

  const legend: { key: Indicator; text: string; color: string }[] = [
    { key: 'sma', text: `SMA 20 ${fmt(lastValue(ind.sma))}`, color: COLORS.sma },
    { key: 'ema', text: `EMA 50 ${fmt(lastValue(ind.ema))}`, color: COLORS.ema },
    { key: 'bb', text: `BB ${fmt(lastValue(ind.bb.lower))} – ${fmt(lastValue(ind.bb.upper))}`, color: COLORS.bb },
    { key: 'rsi', text: `RSI 14 ${fmt(lastValue(ind.rsi))}`, color: COLORS.rsi },
    { key: 'macd', text: `MACD ${fmt(lastValue(ind.macd.macd))} / signal ${fmt(lastValue(ind.macd.signal))}`, color: COLORS.macd },
  ];

  return (
    <div className="chart-block advanced" data-testid="advanced-chart">
      <div className="indicator-chips" role="group" aria-label="Indicators">
        {INDICATORS.map((i) => (
          <button
            key={i.key}
            type="button"
            className={`chip small ${on[i.key] ? 'active' : ''}`}
            aria-pressed={on[i.key]}
            title={i.title}
            onClick={() => setOn((prev) => ({ ...prev, [i.key]: !prev[i.key] }))}
            data-testid={`indicator-${i.key}`}
          >
            {i.label}
          </button>
        ))}
      </div>
      <div className="indicator-legend small" data-testid="indicator-legend">
        {legend
          .filter((l) => on[l.key])
          .map((l) => (
            <span key={l.key} style={{ color: l.color }} data-testid={`ind-${l.key}-value`}>
              {l.text}
            </span>
          ))}
      </div>
      <div className="chart-wrap">
        <div className="chart advanced-chart" ref={refs.main} data-testid="candle-chart" data-state={loadState} data-candles={candles.length} />
        {loadState === 'error' && <div className="chart-overlay">Couldn't load the chart</div>}
        {loadState === 'empty' && <div className="chart-overlay">No trades yet today</div>}
      </div>
      <div className="indicator-pane" ref={refs.rsi} hidden={!on.rsi} data-testid="rsi-pane" />
      <div className="indicator-pane" ref={refs.macd} hidden={!on.macd} data-testid="macd-pane" />
      <div className="range-tabs" role="tablist">
        {RANGES.map((r) => (
          <button
            key={r}
            role="tab"
            aria-selected={r === range}
            className={`range-tab ${r === range ? 'active up-bg' : ''}`}
            onClick={() => setRange(r)}
            data-testid={`adv-range-${r}`}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
