import type { CardLatencySummary, TaskQueryResult } from '../types'

export const WINDOW_MS = 30 * 60 * 1000
const SAMPLE_COUNT = 30
const BUCKET_MS = WINDOW_MS / SAMPLE_COUNT
const PREFERRED_CRON_SOURCE = '浙江移动'

export const EMPTY_SUMMARY: CardLatencySummary = {
  current: null,
  avg: null,
  lossRate: null,
  samples: [],
  loading: false,
}

function pickValue(row: TaskQueryResult, type: 'tcp_ping' | 'ping') {
  const v = row.task_event_result?.[type]
  return row.success && typeof v === 'number' && Number.isFinite(v) ? v : null
}

function normalizeTs(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1000 : ts
}

function preferCronSource(rows: TaskQueryResult[]) {
  const preferred = rows.filter(row => (row.cron_source || '').includes(PREFERRED_CRON_SOURCE))
  return preferred.length ? preferred : rows
}

export function summarize(rows: TaskQueryResult[], type: 'tcp_ping' | 'ping', now = Date.now()): CardLatencySummary {
  const scoped = preferCronSource(rows.filter(row => {
    const ts = normalizeTs(row.timestamp)
    return ts >= now - WINDOW_MS && ts <= now
  }))
  if (!scoped.length) return EMPTY_SUMMARY

  const start = now - WINDOW_MS
  const buckets = Array.from({ length: SAMPLE_COUNT }, (_, index) => ({
    timestamp: start + index * BUCKET_MS,
    values: [] as number[],
    total: 0,
    failed: 0,
  }))

  for (const row of scoped) {
    const ts = normalizeTs(row.timestamp)
    if (ts < start || ts > now) continue
    const index = Math.min(SAMPLE_COUNT - 1, Math.max(0, Math.floor((ts - start) / BUCKET_MS)))
    const bucket = buckets[index]
    bucket.total++
    const value = pickValue(row, type)
    if (value == null) bucket.failed++
    else bucket.values.push(value)
  }

  const samples = buckets.map(bucket => ({
    timestamp: bucket.timestamp,
    value: bucket.values.length
      ? bucket.values.reduce((sum, value) => sum + value, 0) / bucket.values.length
      : null,
    total: bucket.total,
    failed: bucket.failed,
  }))
  const vals = samples.flatMap(sample => (sample.value == null ? [] : [sample.value]))
  const latest = [...scoped].sort((a, b) => normalizeTs(b.timestamp) - normalizeTs(a.timestamp))[0]
  const current = latest ? pickValue(latest, type) : null
  const total = samples.reduce((sum, sample) => sum + sample.total, 0)
  const failed = samples.reduce((sum, sample) => sum + sample.failed, 0)

  return {
    current,
    latestFailed: Boolean(latest && current == null),
    updatedAt: now,
    avg: vals.length ? vals.reduce((sum, v) => sum + v, 0) / vals.length : null,
    lossRate: total ? (failed / total) * 100 : null,
    samples,
    loading: false,
  }
}

