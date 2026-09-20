import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarize, WINDOW_MS } from '../src/utils/cardLatency.ts'
import { queryCompleteWindow } from '../src/utils/queryCompleteWindow.ts'
const now = 1_800_000_000_000
const row = (timestamp, value, id = timestamp) => ({ uuid: 'node', task_id: id, timestamp, success: value != null, cron_source: 'tcping-浙江移动', task_event_result: { tcp_ping: value } })
test('missing minutes are not packet loss; latest failed probe stays failed', () => {
  const result = summarize([row(now - 10000, null), row(now - 20000, 100), row(now - WINDOW_MS - 1, 900)], 'tcp_ping', now)
  assert.equal(result.samples.length, 30)
  assert.equal(result.samples.filter(s => !s.total).length, 29)
  assert.equal(result.lossRate, 50)
  assert.equal(result.current, null)
  assert.equal(result.latestFailed, true)
})
test('all 30 minutes and second timestamps are retained', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row((now - WINDOW_MS + i * 60000 + 1000) / 1000, 20))
  const result = summarize(rows, 'tcp_ping', now)
  assert.equal(result.samples.filter(s => s.total === 1).length, 30)
  assert.equal(result.lossRate, 0)
})
test('saturated history splits windows and deduplicates boundary records', async () => {
  const rows = Array.from({ length: 9 }, (_, i) => row(i * 1000, 10))
  const query = async conditions => {
    const [from, to] = conditions.find(c => c.timestamp_from_to).timestamp_from_to
    return rows.filter(r => r.timestamp >= from && r.timestamp <= to).slice(-4)
  }
  const result = await queryCompleteWindow(query, [{ uuid: 'node' }], [0, 8000], 4)
  assert.equal(result.length, 9)
})
test('query failures propagate instead of becoming empty history', async () => {
  await assert.rejects(queryCompleteWindow(async () => { throw new Error('offline') }, [], [0, 8000]), /offline/)
})
test('unrecoverable truncation reports an error', async () => {
  await assert.rejects(queryCompleteWindow(async () => [row(0, 10), row(0, 20, 1)], [], [0, 1000], 2), /truncated/)
})
