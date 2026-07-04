import { useEffect, useMemo, useState } from 'react'
import { taskQuery } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { CardLatencySummary, Node, TaskQueryResult } from '../types'

const WINDOW_MS = 30 * 60 * 1000
const REFRESH_MS = 20_000
const QUERY_TIMEOUT_MS = 12_000
const QUERY_LIMIT = 160
const SAMPLE_COUNT = 30
const BUCKET_MS = WINDOW_MS / SAMPLE_COUNT
const PREFERRED_CRON_SOURCE = '浙江移动'

const EMPTY_SUMMARY: CardLatencySummary = {
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

function summarize(rows: TaskQueryResult[], type: 'tcp_ping' | 'ping', now = Date.now()): CardLatencySummary {
  const scoped = preferCronSource(rows)
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
  const current =
    [...scoped]
      .sort((a, b) => normalizeTs(a.timestamp) - normalizeTs(b.timestamp))
      .reverse()
      .map(row => pickValue(row, type))
      .find(value => value != null) ?? null
  const total = samples.reduce((sum, sample) => sum + sample.total, 0)
  const failed = samples.reduce((sum, sample) => sum + sample.failed, 0)

  return {
    current,
    avg: vals.length ? vals.reduce((sum, v) => sum + v, 0) / vals.length : null,
    lossRate: total ? (failed / total) * 100 : null,
    samples,
    loading: false,
  }
}

async function queryNode(entry: BackendPool['entries'][number], uuid: string) {
  const now = Date.now()
  const window: [number, number] = [now - WINDOW_MS, now]
  const common = [{ uuid }, { timestamp_from_to: window }, { limit: QUERY_LIMIT }]

  const tcp = await taskQuery(
    entry.client,
    [...common, { type: 'tcp_ping' }, { cron_source: `tcping-${PREFERRED_CRON_SOURCE}` }],
    QUERY_TIMEOUT_MS,
  ).catch(() => [])

  if (tcp.length) return summarize(tcp, 'tcp_ping', now)

  const tcpAll = await taskQuery(
    entry.client,
    [...common, { type: 'tcp_ping' }],
    QUERY_TIMEOUT_MS,
  ).catch(() => [])

  if (tcpAll.length) return summarize(tcpAll, 'tcp_ping', now)

  const ping = await taskQuery(
    entry.client,
    [...common, { type: 'ping' }, { cron_source: `ping-${PREFERRED_CRON_SOURCE}` }],
    QUERY_TIMEOUT_MS,
  ).catch(() => [])

  return summarize(ping, 'ping', now)
}

function makeKey(nodes: Node[]) {
  return nodes
    .map(node => `${node.source}:${node.uuid}`)
    .sort()
    .join('|')
}

export function useCardLatency(pool: BackendPool | null, nodes: Node[], enabled: boolean) {
  const [data, setData] = useState<Record<string, CardLatencySummary>>({})
  const nodeKey = useMemo(() => makeKey(nodes), [nodes])

  useEffect(() => {
    setData({})
    if (!enabled || !pool || !nodes.length) return

    let cancelled = false

    const fetchOnce = async () => {
      setData(prev => {
        const next: Record<string, CardLatencySummary> = {}
        for (const node of nodes) {
          next[node.uuid] = { ...(prev[node.uuid] ?? EMPTY_SUMMARY), loading: true }
        }
        return next
      })

      const pairs = await Promise.allSettled(
        nodes.map(async node => {
          const entry = pool.entries.find(e => e.name === node.source)
          if (!entry) return [node.uuid, EMPTY_SUMMARY] as const
          return [node.uuid, await queryNode(entry, node.uuid)] as const
        }),
      )

      if (cancelled) return

      const next: Record<string, CardLatencySummary> = {}
      for (const result of pairs) {
        if (result.status === 'fulfilled') {
          next[result.value[0]] = { ...result.value[1], loading: false }
        }
      }
      setData(next)
    }

    fetchOnce()
    const timer = setInterval(fetchOnce, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled, pool, nodeKey])

  return data
}
