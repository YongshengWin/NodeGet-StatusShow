import { useEffect, useState } from 'react'
import { taskQuery } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { TaskQueryResult } from '../types'

export const LATENCY_WINDOW_LABEL = '24 小时'

const WINDOW_MS = 24 * 60 * 60 * 1000
const REFRESH_MS = 60_000
const INCREMENTAL_OVERLAP_MS = 2 * 60 * 1000
const FULL_CACHE_TTL_MS = 10 * 60 * 1000
const QUERY_TIMEOUT_MS = 20_000
const QUERY_LIMIT = 20_000

interface LatencyCacheEntry {
  ping: TaskQueryResult[]
  tcp: TaskQueryResult[]
  updatedAt: number
  fullFetchedAt: number
}

const latencyCache = new Map<string, LatencyCacheEntry>()

function normalizeTs(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1000 : ts
}

function rowKey(row: TaskQueryResult) {
  return `${row.task_id}:${row.timestamp}:${row.uuid}:${row.cron_source ?? ''}`
}

function clean(rows: TaskQueryResult[] | undefined): TaskQueryResult[] {
  return (rows ?? [])
    .filter(r => r.cron_source && r.cron_source !== '未知')
    .sort((a, b) => normalizeTs(a.timestamp) - normalizeTs(b.timestamp))
}

function trimWindow(rows: TaskQueryResult[], now: number) {
  const from = now - WINDOW_MS
  const trimmed = clean(rows).filter(r => {
    const ts = normalizeTs(r.timestamp)
    return ts >= from && ts <= now
  })
  return trimmed.length > QUERY_LIMIT ? trimmed.slice(-QUERY_LIMIT) : trimmed
}

function mergeRows(
  current: TaskQueryResult[],
  incoming: TaskQueryResult[] | undefined,
  now: number,
) {
  const map = new Map<string, TaskQueryResult>()
  for (const row of current) map.set(rowKey(row), row)
  for (const row of clean(incoming)) map.set(rowKey(row), row)
  return trimWindow([...map.values()], now)
}

function latestTimestamp(rows: TaskQueryResult[]) {
  let latest = 0
  for (const row of rows) latest = Math.max(latest, normalizeTs(row.timestamp))
  return latest
}

function queryWindow(rows: TaskQueryResult[], now: number, full: boolean): [number, number] {
  if (full) return [now - WINDOW_MS, now]
  const latest = latestTimestamp(rows)
  const from = latest ? latest - INCREMENTAL_OVERLAP_MS : now - INCREMENTAL_OVERLAP_MS
  return [Math.max(now - WINDOW_MS, from), now]
}

export function useNodeLatency(
  pool: BackendPool | null,
  source: string | null,
  uuid: string | null,
) {
  const [pingData, setPingData] = useState<TaskQueryResult[]>([])
  const [tcpData, setTcpData] = useState<TaskQueryResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setPingData([])
    setTcpData([])
    setLoading(false)

    if (!pool || !source || !uuid) return
    const entry = pool.entries.find(e => e.name === source)
    if (!entry) return

    const cacheKey = `${source}:${uuid}`
    const now = Date.now()
    const cached = latencyCache.get(cacheKey)
    let currentPing = cached ? trimWindow(cached.ping, now) : []
    let currentTcp = cached ? trimWindow(cached.tcp, now) : []
    const needsFullFetch = !cached || now - cached.fullFetchedAt > FULL_CACHE_TTL_MS
    let cancelled = false
    let inFlight = false

    if (cached) {
      setPingData(currentPing)
      setTcpData(currentTcp)
      latencyCache.set(cacheKey, {
        ...cached,
        ping: currentPing,
        tcp: currentTcp,
        updatedAt: now,
      })
    }

    const fetchOnce = async (full = false) => {
      if (inFlight) return
      inFlight = true
      const now = Date.now()
      const pingWindow = queryWindow(currentPing, now, full)
      const tcpWindow = queryWindow(currentTcp, now, full)
      setLoading(true)

      try {
        const [ping, tcp] = await Promise.allSettled([
          taskQuery(
            entry.client,
            [{ uuid }, { timestamp_from_to: pingWindow }, { type: 'ping' }, { limit: QUERY_LIMIT }],
            QUERY_TIMEOUT_MS,
          ),
          taskQuery(
            entry.client,
            [{ uuid }, { timestamp_from_to: tcpWindow }, { type: 'tcp_ping' }, { limit: QUERY_LIMIT }],
            QUERY_TIMEOUT_MS,
          ),
        ])

        if (cancelled) return
        const receivedAt = Date.now()

        const pingOk = ping.status === 'fulfilled'
        const tcpOk = tcp.status === 'fulfilled'

        if (pingOk) {
          currentPing = mergeRows(full ? [] : currentPing, ping.value, receivedAt)
          setPingData(currentPing)
        }
        if (tcpOk) {
          currentTcp = mergeRows(full ? [] : currentTcp, tcp.value, receivedAt)
          setTcpData(currentTcp)
        }

        if (pingOk || tcpOk) {
          latencyCache.set(cacheKey, {
            ping: currentPing,
            tcp: currentTcp,
            updatedAt: receivedAt,
            fullFetchedAt: full ? receivedAt : (latencyCache.get(cacheKey)?.fullFetchedAt ?? receivedAt),
          })
        }
      } finally {
        inFlight = false
        if (!cancelled) setLoading(false)
      }
    }

    fetchOnce(needsFullFetch)

    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      fetchOnce(!latencyCache.get(cacheKey))
    }
    const timer = setInterval(refresh, REFRESH_MS)
    document.addEventListener('visibilitychange', refresh)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [pool, source, uuid])

  return { pingData, tcpData, loading }
}
