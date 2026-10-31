import { useCallback, useState } from "react"
import { ExternalLinkIcon, LayoutGridIcon, MonitorPlayIcon, SquareIcon, UsersIcon } from "lucide-react"

import { playbackRows, StreamPlayer } from "@/components/stream-player"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { PlaybackStats, Transport } from "@/hooks/use-stream-engine"
import type { Latency, Stream } from "@/lib/api"
import { fmtBytes, fmtKbps, fmtSince, LATENCY } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStreams } from "@/pages/streams"

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="flex flex-col gap-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function ingestRows(s: Stream, kbps: number): [string, string][] {
  const v = s.media.video
  const a = s.media.audio
  return [
    ["Sendezeit", fmtSince(s.online_since)],
    ["Eingang über", s.source ?? "–"],
    ["Bitrate", fmtKbps(kbps)],
    ["Auflösung", v ? `${v.width} × ${v.height}` : "–"],
    ["Video", v ? [v.codec, v.profile, v.level].filter(Boolean).join(" ") : (s.tracks[0] ?? "–")],
    ["Audio", a ? `${a.codec}, ${a.sample_rate / 1000} kHz${a.channels ? `, ${a.channels} Kanäle` : ""}` : "–"],
    ["Fehlerhafte Bilder", String(s.frames_in_error)],
    ["Empfangen", fmtBytes(s.bytes_in)],
    ["An Wiedergabe gegeben", fmtBytes(s.bytes_out)],
    ["Zuschauer", `${s.viewers}${s.viewers_rtc ? ` (${s.viewers_rtc} per WebRTC)` : ""}`],
  ]
}

function Focus({ stream, kbps, latency, onLatency }: { stream: Stream; kbps: number; latency: Latency; onLatency: (l: Latency) => void }) {
  const [playback, setPlayback] = useState<{ stats: PlaybackStats; transport: Transport } | null>(null)
  const onStats = useCallback((stats: PlaybackStats, transport: Transport) => setPlayback({ stats, transport }), [])

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <StreamPlayer key={stream.id} stream={stream} latency={latency} onLatency={onLatency} onStats={onStats} />
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-medium">{stream.name}</h2>
          <Badge variant="secondary">
            <UsersIcon /> {stream.viewers}
          </Badge>
          <div className="flex-1" />
          <Button variant="outline" size="sm" render={<a href={stream.watch_url} target="_blank" rel="noreferrer" />}>
            <ExternalLinkIcon /> Quelle öffnen
          </Button>
        </div>
      </div>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Eingang</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Rows rows={ingestRows(stream, kbps)} />
          <Separator />
          <p className="text-sm font-medium">Wiedergabe hier</p>
          {playback && <Rows rows={playbackRows(playback.stats, playback.transport)} />}
          <p className="text-xs text-muted-foreground">Dieser Monitor zählt nicht als Zuschauer. Modus hier gilt nur für diese Ansicht.</p>
        </CardContent>
      </Card>
    </div>
  )
}

export function MonitorPage() {
  const { streams, bitrates } = useStreams()
  const [selected, setSelected] = useState<string | null>(null)
  const [layout, setLayout] = useState("focus")
  const [overrides, setOverrides] = useState<Record<string, Latency>>({})
  const all = streams ?? []
  const live = all.filter((s) => s.online)
  const current = live.find((s) => s.id === selected) ?? live[0]

  if (streams && live.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-sm text-muted-foreground">
        <MonitorPlayIcon className="size-6" />
        Gerade ist kein Stream live.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {all.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant={layout === "focus" && s.id === current?.id ? "default" : "outline"}
            disabled={!s.online}
            onClick={() => {
              setSelected(s.id)
              setLayout("focus")
            }}
          >
            <span className={cn("size-1.5 rounded-full", s.online ? "bg-current" : "bg-muted-foreground/40")} />
            {s.name}
          </Button>
        ))}
        <div className="flex-1" />
        <ToggleGroup variant="outline" value={[layout]} onValueChange={(v: string[]) => v[0] && setLayout(v[0])}>
          <ToggleGroupItem value="focus" aria-label="Einzelansicht">
            <SquareIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="Rasteransicht">
            <LayoutGridIcon />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {layout === "focus" && current && (
        <Focus
          stream={current}
          kbps={bitrates[current.id] ?? 0}
          latency={overrides[current.id] ?? current.latency}
          onLatency={(l) => setOverrides({ ...overrides, [current.id]: l })}
        />
      )}
      {layout === "grid" && (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {live.map((s) => (
            <div key={s.id} className="flex flex-col gap-1.5">
              <StreamPlayer stream={s} latency={overrides[s.id] ?? s.latency} compact />
              <p className="flex justify-between text-sm">
                <span>{s.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {LATENCY[overrides[s.id] ?? s.latency].label} · {fmtKbps(bitrates[s.id] ?? 0)} · {s.viewers} Zuschauer
                </span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
