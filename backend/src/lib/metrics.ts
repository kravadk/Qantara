/**
 * In-process metrics registry (zero-dependency, Prometheus text exposition).
 *
 * Records HTTP request counts, per-route latency histograms, error counts, and
 * arbitrary gauges. Rendered alongside the operational gauges at GET /v1/metrics.
 */

type Labels = Record<string, string>;

const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

interface CounterSeries {
  labels: Labels;
  value: number;
}

interface HistogramSeries {
  labels: Labels;
  buckets: number[]; // per-bucket counts aligned with LATENCY_BUCKETS_MS
  sum: number;
  count: number;
}

const counters = new Map<string, Map<string, CounterSeries>>();
const histograms = new Map<string, Map<string, HistogramSeries>>();
const gauges = new Map<string, Map<string, CounterSeries>>();

function seriesKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

export function incCounter(name: string, labels: Labels = {}, by = 1): void {
  let series = counters.get(name);
  if (!series) counters.set(name, (series = new Map()));
  const key = seriesKey(labels);
  const existing = series.get(key);
  if (existing) existing.value += by;
  else series.set(key, { labels, value: by });
}

export function setGauge(name: string, value: number, labels: Labels = {}): void {
  let series = gauges.get(name);
  if (!series) gauges.set(name, (series = new Map()));
  series.set(seriesKey(labels), { labels, value });
}

export function observeLatency(name: string, ms: number, labels: Labels = {}): void {
  let series = histograms.get(name);
  if (!series) histograms.set(name, (series = new Map()));
  const key = seriesKey(labels);
  let h = series.get(key);
  if (!h) {
    h = { labels, buckets: new Array(LATENCY_BUCKETS_MS.length).fill(0), sum: 0, count: 0 };
    series.set(key, h);
  }
  h.sum += ms;
  h.count += 1;
  for (let i = 0; i < LATENCY_BUCKETS_MS.length; i += 1) {
    if (ms <= LATENCY_BUCKETS_MS[i]) h.buckets[i] += 1;
  }
}

function renderLabels(labels: Labels, extra?: Labels): string {
  const merged = { ...labels, ...extra };
  const keys = Object.keys(merged);
  if (keys.length === 0) return '';
  return `{${keys
    .sort()
    .map((k) => `${k}="${String(merged[k]).replace(/"/g, '\\"')}"`)
    .join(',')}}`;
}

export function renderRequestMetrics(): string {
  const lines: string[] = [];

  for (const [name, series] of counters) {
    lines.push(`# TYPE ${name} counter`);
    for (const s of series.values()) lines.push(`${name}${renderLabels(s.labels)} ${s.value}`);
  }

  for (const [name, series] of gauges) {
    lines.push(`# TYPE ${name} gauge`);
    for (const s of series.values()) lines.push(`${name}${renderLabels(s.labels)} ${s.value}`);
  }

  for (const [name, series] of histograms) {
    lines.push(`# TYPE ${name} histogram`);
    for (const h of series.values()) {
      for (let i = 0; i < LATENCY_BUCKETS_MS.length; i += 1) {
        lines.push(
          `${name}_bucket${renderLabels(h.labels, { le: String(LATENCY_BUCKETS_MS[i] / 1000) })} ${h.buckets[i]}`,
        );
      }
      lines.push(`${name}_bucket${renderLabels(h.labels, { le: '+Inf' })} ${h.count}`);
      lines.push(`${name}_sum${renderLabels(h.labels)} ${(h.sum / 1000).toFixed(3)}`);
      lines.push(`${name}_count${renderLabels(h.labels)} ${h.count}`);
    }
  }

  return lines.length ? `${lines.join('\n')}\n` : '';
}

/** Reset all series — test helper only. */
export function resetMetrics(): void {
  counters.clear();
  histograms.clear();
  gauges.clear();
}
