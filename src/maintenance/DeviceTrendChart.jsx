import React, { useId } from 'react';

export const TREND_METRICS = [
  { id: 'cpu', title: 'CPU 使用率', unit: '%' },
  { id: 'memory', title: '内存使用率', unit: '%' },
  { id: 'temperature', title: '设备温度', unit: '°C' },
  { id: 'disk-space', title: '硬盘空间使用率', unit: '%' },
  { id: 'internet', title: '网络延迟', unit: 'ms' },
];

const WIDTH = 1000;
const HEIGHT = 300;
const MINUTE = 60_000;
const DAY = 86_400_000;
const finiteNumber = value => typeof value === 'number' && Number.isFinite(value);
const coordinate = value => Number(value.toFixed(3));
const formatValue = value => Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));

function getSeries(samples, metric, endTime, duration) {
  const validValue = value => finiteNumber(value) && value >= 0 && (metric.unit !== '%' || value <= 100);
  // A sample without a timestamp cannot be located on the axis. Keep it as a
  // segment boundary rather than discarding it and joining its neighbours.
  const groups = [[]];
  let latest = null;
  for (const sample of Array.isArray(samples) ? samples : []) {
    if (!finiteNumber(sample?.timestamp)) {
      if (groups.at(-1).length) groups.push([]);
      continue;
    }
    groups.at(-1).push(sample);
    if (validValue(sample.value) && (latest === null || sample.timestamp > latest)) latest = sample.timestamp;
  }
  const end = finiteNumber(endTime) ? endTime : latest;
  if (end === null) return { segments: [], current: null, peak: null };

  const start = end - duration;
  const segments = [];
  let current = null;
  let currentTime = -Infinity;
  let peak = null;
  for (const group of groups) {
    let segment = [];
    const finish = () => {
      if (segment.length) segments.push(segment);
      segment = [];
    };
    for (const sample of group.toSorted((a, b) => a.timestamp - b.timestamp)) {
      if (sample.timestamp < start || sample.timestamp > end) continue;
      if (!validValue(sample.value)) {
        finish();
        continue;
      }
      segment.push({ x: coordinate((sample.timestamp - start) / duration * WIDTH), value: sample.value });
      if (sample.timestamp >= currentTime) {
        currentTime = sample.timestamp;
        current = sample.value;
      }
      peak = peak === null ? sample.value : Math.max(peak, sample.value);
    }
    finish();
  }
  return { segments, current, peak };
}

export default function DeviceTrendChart({ metric = 'cpu', samples = [], endTime, windowDays = 7 }) {
  const id = useId();
  const selected = TREND_METRICS.find(item => item.id === metric) || TREND_METRICS[0];
  const days = Number.isSafeInteger(windowDays) && windowDays > 0 ? windowDays : 7;
  const isNetwork = selected.id === 'internet';
  const duration = isNetwork ? days * DAY : MINUTE;
  const period = isNetwork ? `最近 ${days} 天` : '最近 60 秒';
  const { segments, current, peak } = getSeries(samples, selected, endTime, duration);
  const hasSamples = peak !== null;
  const maximum = selected.unit === '%' ? 100 : Math.max(100, peak ?? 0);
  const y = value => coordinate((1 - value / maximum) * HEIGHT);
  const measurement = value => value === null ? '—' : `${formatValue(value)} ${selected.unit}`;
  const description = `${selected.title}，${period}，单位 ${selected.unit}。${hasSamples
    ? `当前值 ${measurement(current)}，峰值 ${measurement(peak)}。仅显示真实样本，缺失处断开。`
    : '暂无数据，等待设备接入。当前值与峰值暂不提供。'}`;

  return <section className="device-trend" aria-label="性能趋势" data-metric={selected.id}>
    <header className="device-trend-header">
      <div className="device-trend-heading">
        <h2>{selected.title}</h2>
        <p className="device-trend-subtitle">{period}</p>
      </div>
      <span className="device-trend-status">{hasSamples ? '已收到检测数据' : '等待设备接入'}</span>
    </header>

    <div className="device-trend-chart">
      <div className="device-trend-y-labels" aria-hidden="true">
        <span>{formatValue(maximum)} {selected.unit}</span>
        <span>{formatValue(maximum / 2)}</span>
        <span>0</span>
      </div>
      <div className="device-trend-canvas">
        <svg className="device-trend-plot" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none"
          role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
          <title id={`${id}-title`}>{`${selected.title}${period}趋势`}</title>
          <desc id={`${id}-description`}>{description}</desc>
          <g className="device-trend-grid" aria-hidden="true">
            {[0, 75, 150, 225, 300].map(position => <line key={`y-${position}`} x1="0" y1={position} x2={WIDTH} y2={position} vectorEffect="non-scaling-stroke" />)}
            {[0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map(position => <line key={`x-${position}`} x1={position} y1="0" x2={position} y2={HEIGHT} vectorEffect="non-scaling-stroke" />)}
          </g>
          {segments.map((segment, index) => {
            if (segment.length === 1) return <circle key={index} className="device-trend-point" data-trend-point
              cx={segment[0].x} cy={y(segment[0].value)} r="3" />;
            const points = segment.map(point => `${point.x},${y(point.value)}`).join(' ');
            return <g key={index}>
              <polygon className="device-trend-area" data-trend-area
                points={`${segment[0].x},${HEIGHT} ${points} ${segment.at(-1).x},${HEIGHT}`} />
              <polyline className="device-trend-line" data-trend-line points={points} fill="none" vectorEffect="non-scaling-stroke" />
            </g>;
          })}
        </svg>
        {!hasSamples && <div className="device-trend-empty"><strong>暂无数据</strong><span>等待设备接入</span></div>}
      </div>
    </div>
    <div className="device-trend-time-axis" aria-hidden="true">
      <span>{isNetwork ? `${days}天前` : '60 秒前'}</span>
      <span>{isNetwork ? `${formatValue(days / 2)}天前` : '30 秒前'}</span>
      <span>{isNetwork ? '现在' : '0 秒'}</span>
    </div>
    <dl className="device-trend-summary">
      <div data-trend-stat="current"><dt>当前值</dt><dd>{measurement(current)}</dd></div>
      <div data-trend-stat="peak"><dt>峰值</dt><dd>{measurement(peak)}</dd></div>
    </dl>
    <p className="device-trend-note">{hasSamples
      ? '仅展示已收到的检测数据；缺失时段不连线。'
      : '检测接口尚未接入，当前没有实测数据。'}</p>
  </section>;
}
