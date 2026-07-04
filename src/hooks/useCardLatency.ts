import { useEffect, useMemo, useState } from 'react'
import { taskQuery } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { CardLatencySummary, Node, TaskQueryResult } from '../types'

const WINDOW_MS = 6 * 60 * 60 * 1000
const REFRESH_MS = 60_000
const QUERY_TIMEOUT_MS = 12_000
const QUERY_LIMIT = 64
const SAMPLE_COUNT = 22

const EMPTY_SUMMARY: CardLatencySummary = {
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

function summarize(rows: TaskQueryResult[], type: 'tcp_ping' | 'ping'): CardLatencySummary {
  const recent = [...rows]
    .sort((a, b) => normalizeTs(a.timestamp) - normalizeTs(b.timestamp))
    .slice(-SAMPLE_COUNT)

  if (!recent.length) return EMPTY_SUMMARY

  const samples = recent.map(row => ({
    timestamp: normalizeTs(row.timestamp),
    value: pickValue(row, type),
  }))
  const vals = samples.flatMap(sample => (sample.value == null ? [] : [sample.value]))

  return {
    avg: vals.length ? vals.reduce((sum, v) => sum + v, 0) / vals.length : null,
    lossRate: ((samples.length - vals.length) / samples.length) * 100,
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
    [...common, { type: 'tcp_ping' }],
    QUERY_TIMEOUT_MS,
  ).catch(() => [])

  if (tcp.length) return summarize(tcp, 'tcp_ping')

  const ping = await taskQuery(
    entry.client,
    [...common, { type: 'ping' }],
    QUERY_TIMEOUT_MS,
  ).catch(() => [])

  return summarize(ping, 'ping')
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
