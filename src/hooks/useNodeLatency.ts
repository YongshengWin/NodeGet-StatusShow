import { useEffect, useState } from 'react'
import { taskQuery } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { TaskQueryResult } from '../types'

export const LATENCY_WINDOW_LABEL = '24 小时'

const WINDOW_MS = 24 * 60 * 60 * 1000
const REFRESH_MS = 60_000
const QUERY_TIMEOUT_MS = 20_000
const QUERY_LIMIT = 20_000

function clean(rows: TaskQueryResult[] | undefined): TaskQueryResult[] {
  return (rows ?? [])
    .filter(r => r.cron_source && r.cron_source !== '未知')
    .sort((a, b) => a.timestamp - b.timestamp)
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

    if (!pool || !source || !uuid) return
    const entry = pool.entries.find(e => e.name === source)
    if (!entry) return

    let cancelled = false

    const fetchOnce = async () => {
      const now = Date.now()
      const window: [number, number] = [now - WINDOW_MS, now]
      setLoading(true)

      const [ping, tcp] = await Promise.allSettled([
        taskQuery(
          entry.client,
          [{ uuid }, { timestamp_from_to: window }, { type: 'ping' }, { limit: QUERY_LIMIT }],
          QUERY_TIMEOUT_MS,
        ),
        taskQuery(
          entry.client,
          [{ uuid }, { timestamp_from_to: window }, { type: 'tcp_ping' }, { limit: QUERY_LIMIT }],
          QUERY_TIMEOUT_MS,
        ),
      ])

      if (cancelled) return
      if (ping.status === 'fulfilled') setPingData(clean(ping.value))
      if (tcp.status === 'fulfilled') setTcpData(clean(tcp.value))
      setLoading(false)
    }

    fetchOnce()
    const timer = setInterval(fetchOnce, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [pool, source, uuid])

  return { pingData, tcpData, loading }
}
