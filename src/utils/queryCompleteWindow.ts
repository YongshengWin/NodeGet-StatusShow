import type { TaskQueryCondition, TaskQueryResult } from '../types'

// Split saturated windows instead of silently accepting truncated history.
export async function queryCompleteWindow(
  query: (conditions: TaskQueryCondition[]) => Promise<TaskQueryResult[]>,
  conditions: TaskQueryCondition[],
  window: [number, number],
  limit = 1000,
): Promise<TaskQueryResult[]> {
  const rows = await query([...conditions, { timestamp_from_to: window }, { limit }])
  if (rows.length < limit) return rows
  if (window[1] - window[0] <= 1000) throw new Error('History query remains truncated')
  const midpoint = Math.floor((window[0] + window[1]) / 2)
  const left = await queryCompleteWindow(query, conditions, [window[0], midpoint], limit)
  const right = await queryCompleteWindow(query, conditions, [midpoint, window[1]], limit)
  return [...new Map([...left, ...right].map(row => [
    `${row.uuid}:${row.task_id}:${row.timestamp}:${row.cron_source ?? ''}`, row,
  ])).values()]
}
