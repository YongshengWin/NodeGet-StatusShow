import { ArrowDown, ArrowUp, Clock, type LucideIcon } from 'lucide-react'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Progress } from './ui/progress'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { bytes, pct, relativeAge, uptime } from '../utils/format'
import { cpuLabel, deriveUsage, displayName, distroLogo, osLabel, virtLabel } from '../utils/derive'
import { cn, loadColor } from '../utils/cn'
import type { CardLatencySummary, LatencyStripSample, Node } from '../types'
import type { ReactNode } from 'react'

const LATENCY_BAR_COUNT = 30

export function NodeCard({ node, latency }: { node: Node; latency?: CardLatencySummary }) {
  const u = deriveUsage(node)
  const tags = Array.isArray(node.meta?.tags) ? node.meta.tags : []
  const os = osLabel(node)
  const logo = distroLogo(node)
  const virt = virtLabel(node)
  const cpu = cpuLabel(node)

  return (
      <a href={`#${encodeURIComponent(node.uuid)}`} className="block">
        <Card
            className={cn(
                'p-4 transition hover:border-primary/50 hover:shadow-md flex flex-col gap-3',
                !node.online && 'opacity-60',
            )}
        >
          <div className="flex items-center gap-2">
            <StatusDot online={node.online} />
            {logo && (
                <img src={logo} alt="" className="w-5 h-5 shrink-0 object-contain" loading="lazy" />
            )}
            <span className="font-semibold flex-1 min-w-0 truncate" title={displayName(node)}>
            {displayName(node)}
          </span>
            <Flag code={node.meta?.region} className="shrink-0" />
          </div>

          {(os || virt) && (
              <div className="font-mono text-xs text-muted-foreground truncate">
                {[os, virt].filter(Boolean).join(' · ')}
              </div>
          )}

          <div className="flex flex-col gap-2.5">
            <Metric label="CPU" value={u.cpu} sub={cpu || null} subTitle={cpu || undefined} />
            <Metric
                label="内存"
                value={u.mem}
                sub={u.memTotal ? `${bytes(u.memUsed)} / ${bytes(u.memTotal)}` : null}
            />
            <Metric
                label="磁盘"
                value={u.disk}
                sub={u.diskTotal ? `${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}` : null}
            />
          </div>

          <div className="pt-2.5 border-t border-dashed font-mono text-xs text-muted-foreground space-y-1.5">
            <div className="flex items-center gap-3">
              <Stat icon={ArrowDown}>{bytes(u.netIn || 0)}/s</Stat>
              <Stat icon={ArrowUp}>{bytes(u.netOut || 0)}/s</Stat>
            </div>
            <div className="flex items-center gap-3">
              <Stat icon={Clock}>{uptime(u.uptime)}</Stat>
              <span className="ml-auto">{relativeAge(u.ts)}</span>
            </div>
          </div>

          <LatencyStrip latency={latency} />

          {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map(t => (
                    <Badge key={t} variant="outline" className="text-[10px]">
                      {t}
                    </Badge>
                ))}
              </div>
          )}
        </Card>
      </a>
  )
}

function LatencyStrip({ latency }: { latency?: CardLatencySummary }) {
  const samples = latency?.samples ?? []
  const hasSamples = samples.some(sample => sample.total > 0)
  const loading = !latency || Boolean(latency.loading && !hasSamples)
  const failed = Boolean(latency?.error)
  const bars = samples.length ? samples.slice(-LATENCY_BAR_COUNT) : []
  const missing = bars.filter(sample => !sample.total).length
  const status = failed
    ? hasSamples ? '刷新失败 · 显示上次数据' : '获取失败'
    : loading ? '正在加载监测数据…'
      : !hasSamples ? '最近 30 分钟暂无监测数据'
        : missing ? `${missing} 分钟无数据 · 斜纹为缺失` : ''

  return (
    <div className="pt-2.5 border-t border-dashed space-y-1.5">
      {latency?.target && <div className="text-[10px] text-muted-foreground">监测目标：{latency.target}</div>}
      <div className="grid grid-cols-2 gap-3">
        <MiniBars
          label="最新延迟"
          value={failed && !hasSamples ? '获取失败' : loading ? '…' : latency?.latestFailed ? '探测失败' : latency?.current == null ? '—' : `${Math.round(latency.current)} ms`}
          samples={bars}
          colorFor={latencyBarColor}
          loading={loading && !failed}
        />
        <MiniBars
          label="30 分钟丢包率"
          value={failed && !hasSamples ? '获取失败' : loading ? '…' : latency?.lossRate == null ? '—' : `${latency.lossRate.toFixed(1)}%`}
          samples={bars}
          colorFor={lossBarColor}
          loading={loading && !failed}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>30 分钟前</span>
        <span>{failed && latency?.updatedAt ? `截至 ${formatSampleTime(latency.updatedAt)}` : '现在'}</span>
      </div>
      {status && <div role="status" className={cn('text-[10px]', failed ? 'text-amber-500' : 'text-muted-foreground')}>{status}</div>}
    </div>
  )
}

function formatSampleTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function sampleDescription(sample: LatencyStripSample) {
  const time = `${formatSampleTime(sample.timestamp)}–${formatSampleTime(sample.timestamp + 60_000)}`
  if (!sample.total) return `${time}：这分钟没有监测数据`
  const delay = sample.value == null ? '无成功样本' : `${Math.round(sample.value)} ms`
  return `${time}：平均延迟 ${delay}；丢包率 ${((sample.failed / sample.total) * 100).toFixed(1)}%；样本 ${sample.total} 次，失败 ${sample.failed} 次`
}

function MiniBars({ label, value, samples, colorFor, loading }: {
  label: string
  value: string
  samples: LatencyStripSample[]
  colorFor: (sample: LatencyStripSample) => string
  loading: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{value}</span>
      </div>
      {samples.length ? (
        <div className="mt-1.5 flex h-4 gap-0.5" role="group" aria-label={`${label}，最近 30 分钟，每格一分钟`}>
          {samples.map((sample, index) => (
            <span
              key={index}
              title={sampleDescription(sample)}
              aria-label={sampleDescription(sample)}
              className={cn('min-w-0 flex-1 rounded-[2px]', colorFor(sample))}
              style={!sample.total ? { backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 2px, currentColor 2px 3px)', opacity: 0.3 } : undefined}
            />
          ))}
        </div>
      ) : (
        <div className={cn('mt-1.5 h-4 rounded bg-muted', loading && 'animate-pulse')} aria-hidden="true" />
      )}
    </div>
  )
}

function latencyBarColor(sample: LatencyStripSample) {
  if (!sample.total) return 'bg-muted text-muted-foreground'
  const value = sample.value
  if (value == null) return 'bg-rose-500'
  if (value <= 80) return 'bg-emerald-400'
  if (value <= 180) return 'bg-lime-400'
  if (value <= 350) return 'bg-amber-400'
  return 'bg-rose-500'
}

function lossBarColor(sample: LatencyStripSample) {
  if (!sample.total) return 'bg-muted text-muted-foreground'
  const rate = sample.failed / sample.total
  if (rate === 0) return 'bg-emerald-400'
  if (rate <= 0.1) return 'bg-lime-400'
  if (rate <= 0.5) return 'bg-amber-400'
  return 'bg-rose-500'
}

function Stat({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
      <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3" />
        {children}
    </span>
  )
}

function Metric({
                  label,
                  value,
                  sub,
                  subTitle,
                }: {
  label: string
  value: number | undefined
  sub?: string | null
  subTitle?: string
}) {
  return (
      <div className="min-w-0">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono">{pct(value)}</span>
        </div>
        <Progress value={value} indicatorClassName={loadColor(value)} className="mt-1 h-1.5" />
        {sub && (
            <div
                className="font-mono text-[11px] text-muted-foreground mt-1 truncate"
                title={subTitle}
            >
              {sub}
            </div>
        )}
      </div>
  )
}
