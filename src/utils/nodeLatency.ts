import type { LatencyType, Node, TaskQueryResult } from '../types'

interface NodeLatencyPreference {
  target: string
  sources: Record<LatencyType, string[]>
  aliases?: Partial<Record<LatencyType, Record<string, string>>>
  includeInCard?: boolean
}

const ZHEJIANG_MOBILE_SOURCES: Record<LatencyType, string[]> = {
  ping: ['ping-浙江移动'],
  tcp_ping: ['tcping-浙江移动'],
}

const ZHEJIANG_MOBILE_IPV6_SOURCES: Record<LatencyType, string[]> = {
  ping: [...ZHEJIANG_MOBILE_SOURCES.ping, 'ping-浙江移动-IPv6'],
  tcp_ping: [...ZHEJIANG_MOBILE_SOURCES.tcp_ping, 'tcping-浙江移动-IPv6'],
}

const SG_LEGEND_IPV4_SOURCES: Record<LatencyType, string[]> = {
  ping: [...ZHEJIANG_MOBILE_SOURCES.ping, 'ping-香港'],
  tcp_ping: [...ZHEJIANG_MOBILE_SOURCES.tcp_ping, 'tcping-香港'],
}

const NODE_LATENCY_PREFERENCES: Record<string, NodeLatencyPreference> = {
  'd8adcfef-b086-47b4-ac73-41e1ef08755c': {
    target: 'US-LAX',
    sources: {
      ping: ['ping-US-LAX'],
      // `tcping` is the original name of the verified US-LAX TCP task.
      // Keep it as an alias until its 24-hour history ages out.
      tcp_ping: ['tcping-US-LAX', 'tcping'],
    },
    aliases: {
      tcp_ping: { tcping: 'tcping-US-LAX' },
    },
  },
  // SG-Legend is IPv4-only and also probes a public Hong Kong looking glass.
  '271dda72-8f5b-4b84-a413-8e09b70a1994': {
    target: '浙江移动 / 香港',
    sources: SG_LEGEND_IPV4_SOURCES,
    includeInCard: false,
  },
  // HK-Zouter and JP-Zouter also show dedicated IPv6 probe series.
  '5b74b9ea-9470-4f54-9cee-731a9acd5340': {
    target: '浙江移动',
    sources: ZHEJIANG_MOBILE_IPV6_SOURCES,
    includeInCard: false,
  },
  '6a388a96-983b-4c4b-8a39-a43878c6bf78': {
    target: '浙江移动',
    sources: ZHEJIANG_MOBILE_IPV6_SOURCES,
    includeInCard: false,
  },
}

export function nodeLatencyPreference(node: Pick<Node, 'uuid'> | null | undefined) {
  return node ? NODE_LATENCY_PREFERENCES[node.uuid] : undefined
}

export function scopeNodeLatencyRows(
  node: Pick<Node, 'uuid'> | null | undefined,
  rows: TaskQueryResult[],
  type: LatencyType,
) {
  const preference = nodeLatencyPreference(node)
  if (!preference) return rows

  const sources = preference.sources[type]
  const aliases = preference.aliases?.[type]

  return rows
    .filter(row => sources.includes(row.cron_source ?? ''))
    .map(row => {
      const canonicalSource = aliases?.[row.cron_source ?? '']
      return canonicalSource ? { ...row, cron_source: canonicalSource } : row
    })
}
