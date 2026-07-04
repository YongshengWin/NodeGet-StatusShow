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
  const hasSamples = samples.length > 0
  const bars =
    hasSamples
      ? samples.slice(-LATENCY_BAR_COUNT)
      : Array.from({ length: LATENCY_BAR_COUNT }, (_, i) => ({
          timestamp: i,
          value: null,
          total: 0,
          failed: 0,
        }))
  const current = latency?.current ?? null
  const loss = latency?.lossRate ?? null
  const loading = Boolean(latency?.loading && !samples.length)

  return (
    <div className="pt-2.5 border-t border-dashed grid grid-cols-2 gap-3">
      <MiniBars
        label="延迟"
        value={loading ? '…' : current == null ? '—' : `${Math.round(current)} ms`}
        samples={bars}
        colorFor={latencyBarColor}
        empty={!hasSamples}
      />
      <MiniBars
        label="丢包"
        value={loading ? '…' : loss == null ? '—' : `${loss.toFixed(1)}%`}
        samples={bars}
        colorFor={lossBarColor}
        empty={!hasSamples}
      />
    </div>
  )
}

function MiniBars({
  label,
  value,
  samples,
  colorFor,
  empty,
}: {
  label: string
  value: string
  samples: LatencyStripSample[]
  colorFor: (sample: LatencyStripSample) => string
  empty: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{value}</span>
      </div>
      <div className="mt-1.5 flex h-4 gap-0.5" aria-hidden="true">
        {samples.map((sample, index) => (
          <span
            key={`${sample.timestamp}-${index}`}
            className={cn('flex-1 rounded-[2px]', empty ? 'bg-muted' : colorFor(sample))}
          />
        ))}
      </div>
    </div>
  )
}

function latencyBarColor(sample: LatencyStripSample) {
  const value = sample.value
  if (!sample.total) return 'bg-muted'
  if (value == null) return 'bg-muted'
  if (value <= 80) return 'bg-emerald-400'
  if (value <= 180) return 'bg-lime-400'
  if (value <= 350) return 'bg-amber-400'
  return 'bg-rose-500'
}

function lossBarColor(sample: LatencyStripSample) {
  if (!sample.total) return 'bg-muted'
  if (sample.failed > 0) return 'bg-rose-400'
  return 'bg-emerald-400'
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
