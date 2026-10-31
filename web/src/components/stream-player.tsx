import { useEffect, useRef, useState } from "react"
import {
  ActivityIcon,
  MaximizeIcon,
  PictureInPicture2Icon,
  RadioIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { useStreamEngine, type PlaybackStats, type Transport } from "@/hooks/use-stream-engine"
import type { Latency, Stream } from "@/lib/api"
import { fmtKbps, fmtNumber, LATENCY } from "@/lib/format"
import { cn } from "@/lib/utils"

const seconds = (v: number | null) => (v === null ? "–" : `${fmtNumber(v)} s`)

export function playbackRows(stats: PlaybackStats, transport: Transport): [string, string][] {
  return [
    ["Wiedergabe über", transport === "webrtc" ? "WebRTC" : "HLS"],
    ["Latenz", transport === "webrtc" ? (stats.latency === null ? "–" : `${Math.round(stats.latency * 1000)} ms + Encoder`) : seconds(stats.latency)],
    ["Puffer", seconds(stats.buffer)],
    ["Bild", stats.width ? `${stats.width} × ${stats.height}` : "–"],
    ["Bildrate", stats.fps === null ? "–" : `${Math.round(stats.fps)} fps`],
    ["Empfangen", stats.kbps === null ? "–" : fmtKbps(stats.kbps)],
    ["Verworfene Bilder", String(stats.dropped)],
    ...(transport === "webrtc"
      ? ([
          ["Paketlaufzeit", stats.rtt === null ? "–" : `${Math.round(stats.rtt * 1000)} ms`],
          ["Verlorene Pakete", stats.lost === null ? "–" : String(stats.lost)],
        ] as [string, string][])
      : []),
  ]
}

export function StreamPlayer({
  stream,
  latency,
  onLatency,
  onStats,
  compact = false,
  className,
}: {
  stream: Stream
  latency: Latency
  onLatency?: (l: Latency) => void
  onStats?: (stats: PlaybackStats, transport: Transport) => void
  compact?: boolean
  className?: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  // Kept as state: the mode menu must render inside this element to work in fullscreen.
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [muted, setMuted] = useState(true)
  const [volume, setVolume] = useState(1)
  const [overlay, setOverlay] = useState(false)
  // m=1 keeps the monitor out of the viewer numbers.
  const engine = useStreamEngine(video, {
    hlsUrl: `${stream.hls_url}&m=1`,
    whepUrl: stream.whep_url,
    latency,
    instantReady: stream.instant_ready,
  })
  const fellBack = latency === "instant" && engine.transport === "hls"

  useEffect(() => {
    onStats?.(engine.stats, engine.transport)
  }, [engine.stats, engine.transport, onStats])

  useEffect(() => {
    const v = video.current
    if (!v) return
    v.muted = muted
    v.volume = volume
  }, [muted, volume])

  return (
    <div ref={setBox} className={cn("group relative aspect-video overflow-hidden rounded-lg bg-black text-white", className)}>
      <video ref={video} autoPlay playsInline muted className="size-full" />

      <div className="absolute top-2 left-2 flex items-center gap-1.5">
        <Badge>
          <RadioIcon /> Live
        </Badge>
        <Badge variant="secondary">
          {LATENCY[latency].label} · {engine.transport === "webrtc" ? "WebRTC" : "HLS"}
        </Badge>
      </div>
      {fellBack && (
        <p className="absolute top-10 left-2 max-w-sm rounded-md bg-black/70 px-2 py-1 text-xs">
          {stream.instant_ready
            ? "WebRTC ließ sich nicht verbinden, spielt über HLS. Ist der UDP-Port offen?"
            : "Dieser Stream kommt per RTMP mit AAC-Ton, der über WebRTC fehlen würde. Für „Sofort“ in OBS auf WHIP umstellen."}
        </p>
      )}

      {overlay && (
        <dl className="absolute top-10 right-2 grid grid-cols-[auto_auto] gap-x-3 rounded-md bg-black/70 px-2.5 py-1.5 text-xs tabular-nums">
          {playbackRows(engine.stats, engine.transport).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-white/60">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-linear-to-t from-black/80 to-transparent p-2 pt-8 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        <Button variant="ghost" size="icon" className="hover:bg-white/15" aria-label={muted ? "Ton an" : "Ton aus"} onClick={() => setMuted(!muted)}>
          {muted ? <VolumeXIcon /> : <Volume2Icon />}
        </Button>
        {!compact && (
          <Slider className="w-24" aria-label="Lautstärke" min={0} max={100} value={[muted ? 0 : volume * 100]} onValueChange={(v) => {
            const next = (Array.isArray(v) ? v[0] : v) / 100
            setVolume(next)
            setMuted(next === 0)
          }} />
        )}
        <Button variant="ghost" size="sm" className="hover:bg-white/15" onClick={engine.liveEdge} disabled={engine.transport === "webrtc"}>
          Zu Live
        </Button>
        <div className="flex-1" />
        {onLatency && !compact && (
          <Select value={latency} onValueChange={(v) => onLatency(v as Latency)}>
            <SelectTrigger size="sm" className="w-36 border-white/20 bg-transparent text-white" aria-label="Latenzmodus">
              <SelectValue>{LATENCY[latency].label}</SelectValue>
            </SelectTrigger>
            <SelectContent container={box}>
              {(Object.keys(LATENCY) as Latency[]).map((l) => (
                <SelectItem key={l} value={l}>
                  {LATENCY[l].label} ({LATENCY[l].expected})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button variant="ghost" size="icon" className="hover:bg-white/15" aria-label="Statistik im Bild" aria-pressed={overlay} onClick={() => setOverlay(!overlay)}>
          <ActivityIcon />
        </Button>
        <Button variant="ghost" size="icon" className="hover:bg-white/15" aria-label="Bild im Bild" onClick={() => video.current?.requestPictureInPicture?.()}>
          <PictureInPicture2Icon />
        </Button>
        <Button variant="ghost" size="icon" className="hover:bg-white/15" aria-label="Vollbild" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : box?.requestFullscreen())}>
          <MaximizeIcon />
        </Button>
      </div>
    </div>
  )
}
