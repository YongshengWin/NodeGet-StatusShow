import { useEffect, useMemo, useState } from 'react'
import { taskQuery } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { CardLatencySummary, Node } from '../types'
import { nodeLatencyPreference, scopeNodeLatencyRows } from '../utils/nodeLatency'

import { EMPTY_SUMMARY, WINDOW_MS, summarize } from '../utils/cardLatency'
import { queryCompleteWindow } from '../utils/queryCompleteWindow'

const REFRESH_MS = 20_000
const QUERY_TIMEOUT_MS = 12_000
const PREFERRED_CRON_SOURCE = '浙江移动'

async function queryNode(entry: BackendPool['entries'][number], node: Node) {
  const now = Date.now()
  const window: [number, number] = [now - WINDOW_MS, now]
  const uuid = node.uuid
  const common = [{ uuid }]
  const preference = nodeLatencyPreference(node)

  if (preference && preference.includeInCard !== false) {
    const [tcp, ping] = await Promise.all([
      queryCompleteWindow(
        (conditions) => taskQuery(entry.client, conditions, QUERY_TIMEOUT_MS),
        [...common, { type: 'tcp_ping' }],
        window,
      ),
      queryCompleteWindow(
        (conditions) => taskQuery(entry.client, conditions, QUERY_TIMEOUT_MS),
        [...common, { type: 'ping' }],
        window,
      ),
    ])

    const scopedTcp = scopeNodeLatencyRows(node, tcp, 'tcp_ping')
    const scopedPing = scopeNodeLatencyRows(node, ping, 'ping')
    const tcpSummary = summarize(scopedTcp, 'tcp_ping', now)
    const pingSummary = summarize(scopedPing, 'ping', now)
    const summary = scopedTcp.length ? tcpSummary : pingSummary

    return { ...summary, target: preference.target }
  }

  const tcp = await queryCompleteWindow(
    (conditions) => taskQuery(entry.client, conditions, QUERY_TIMEOUT_MS),
    [...common, { type: 'tcp_ping' }, { cron_source: `tcping-${PREFERRED_CRON_SOURCE}` }],
    window,
  )

  if (tcp.length) return summarize(tcp, 'tcp_ping', now)

  const tcpAll = await queryCompleteWindow(
    (conditions) => taskQuery(entry.client, conditions, QUERY_TIMEOUT_MS),
    [...common, { type: 'tcp_ping' }],
    window,
  )

  if (tcpAll.length) return summarize(tcpAll, 'tcp_ping', now)

  const ping = await queryCompleteWindow(
    (conditions) => taskQuery(entry.client, conditions, QUERY_TIMEOUT_MS),
    [...common, { type: 'ping' }, { cron_source: `ping-${PREFERRED_CRON_SOURCE}` }],
    window,
  )

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
    let inFlight = false

    const fetchOnce = async () => {
      if (inFlight || cancelled) return
      inFlight = true
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
          if (!entry) throw new Error('Backend unavailable')
          return [node.uuid, await queryNode(entry, node)] as const
        }),
      )

      inFlight = false
      if (cancelled) return

      setData(prev => {
        const next: Record<string, CardLatencySummary> = {}
        pairs.forEach((result, index) => {
          const uuid = nodes[index].uuid
          next[uuid] = result.status === 'fulfilled'
            ? { ...result.value[1], loading: false, error: false }
            : { ...(prev[uuid] ?? EMPTY_SUMMARY), loading: false, error: true }
        })
        return next
      })
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
