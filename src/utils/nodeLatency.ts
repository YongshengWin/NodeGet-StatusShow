import type { LatencyType, Node, TaskQueryResult } from '../types'

interface NodeLatencyPreference {
  target: string
  sources: Record<LatencyType, string[]>
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
  const canonicalSource = `${type === 'tcp_ping' ? 'tcping' : 'ping'}-${preference.target}`

  return rows
    .filter(row => sources.includes(row.cron_source ?? ''))
    .map(row =>
      row.cron_source === canonicalSource
        ? row
        : { ...row, cron_source: canonicalSource },
    )
}
