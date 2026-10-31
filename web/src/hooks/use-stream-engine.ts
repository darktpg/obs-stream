import { useEffect, useRef, useState, type RefObject } from "react"
import Hls, { type HlsConfig } from "hls.js"

import type { Latency } from "@/lib/api"

const PRESETS: Record<Exclude<Latency, "instant">, Partial<HlsConfig>> = {
  low: { liveSyncDurationCount: 1, liveMaxLatencyDurationCount: 3, maxLiveSyncPlaybackRate: 1.5, backBufferLength: 0, maxBufferLength: 4 },
  balanced: { liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 5, maxLiveSyncPlaybackRate: 1.25, backBufferLength: 10 },
  // MediaMTX keeps 7 segments, so the sync point has to stay inside that window.
  quality: { liveSyncDurationCount: 4, liveMaxLatencyDurationCount: 6, backBufferLength: 30, maxBufferLength: 30 },
}

const CONNECT_TIMEOUT = 8000
const ICE_TIMEOUT = 1500

export type Transport = "webrtc" | "hls"

export type PlaybackStats = {
  latency: number | null
  buffer: number | null
  fps: number | null
  width: number
  height: number
  dropped: number
  kbps: number | null
  rtt: number | null
  lost: number | null
}

const EMPTY: PlaybackStats = { latency: null, buffer: null, fps: null, width: 0, height: 0, dropped: 0, kbps: null, rtt: null, lost: null }

async function gathered(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ICE_TIMEOUT)
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState !== "complete") return
      clearTimeout(timer)
      resolve()
    })
  })
}

function startWebRtc(video: HTMLVideoElement, url: string, onFail: () => void, onStats: (s: Partial<PlaybackStats>) => void) {
  const pc = new RTCPeerConnection()
  const media = new MediaStream()
  let location: string | null = null
  let closed = false
  let lastBytes = 0
  let lastAt = 0
  const fail = () => {
    if (!closed) onFail()
  }

  pc.addTransceiver("video", { direction: "recvonly" })
  pc.addTransceiver("audio", { direction: "recvonly" })
  pc.ontrack = (e) => {
    media.addTrack(e.track)
    // Asks the browser to play as early as it can instead of smoothing.
    ;(e.receiver as RTCRtpReceiver & { jitterBufferTarget?: number }).jitterBufferTarget = 0
    video.srcObject = media
  }
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") fail()
    if (pc.connectionState === "connected") clearTimeout(timeout)
  }
  const timeout = setTimeout(fail, CONNECT_TIMEOUT)

  const negotiate = async () => {
    await pc.setLocalDescription(await pc.createOffer())
    await gathered(pc)
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription?.sdp,
    })
    if (res.status !== 201) throw new Error(`WHEP ${res.status}`)
    location = res.headers.get("Location")
    if (closed) {
      if (location) fetch(location, { method: "DELETE", keepalive: true }).catch(() => {})
      return
    }
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() })
  }
  negotiate().catch(fail)

  const poll = setInterval(async () => {
    const report = await pc.getStats()
    const out: Partial<PlaybackStats> = {}
    report.forEach((s) => {
      if (s.type === "inbound-rtp" && s.kind === "video") {
        const now = s.timestamp as number
        if (lastAt) out.kbps = (((s.bytesReceived - lastBytes) * 8) / (now - lastAt))
        lastAt = now
        lastBytes = s.bytesReceived
        out.fps = s.framesPerSecond ?? null
        out.lost = s.packetsLost ?? null
        if (s.jitterBufferEmittedCount) out.buffer = s.jitterBufferDelay / s.jitterBufferEmittedCount
      }
      if (s.type === "candidate-pair" && s.nominated && s.currentRoundTripTime != null) out.rtt = s.currentRoundTripTime
    })
    if (out.buffer != null) out.latency = out.buffer + (out.rtt ?? 0) / 2
    onStats(out)
  }, 1000)

  return () => {
    closed = true
    clearTimeout(timeout)
    clearInterval(poll)
    pc.close()
    video.srcObject = null
    if (location) fetch(location, { method: "DELETE", keepalive: true }).catch(() => {})
  }
}

function startHls(video: HTMLVideoElement, url: string, mode: Exclude<Latency, "instant">, onStats: (s: Partial<PlaybackStats>) => void) {
  if (!Hls.isSupported()) {
    video.src = url
    return () => {
      video.removeAttribute("src")
      video.load()
    }
  }
  const hls = new Hls({ ...PRESETS[mode], lowLatencyMode: false })
  let retry: ReturnType<typeof setTimeout>
  let bytes = 0
  hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
    bytes += data.frag.stats.loaded
  })
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (!data.fatal) return
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
    else retry = setTimeout(() => hls.loadSource(url), 2000)
  })
  hls.loadSource(url)
  hls.attachMedia(video)
  const poll = setInterval(() => {
    const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : video.currentTime
    onStats({ latency: hls.latency || null, buffer: Math.max(0, end - video.currentTime), kbps: (bytes * 8) / 3000 })
    bytes = 0
  }, 3000)
  return () => {
    clearTimeout(retry)
    clearInterval(poll)
    hls.destroy()
  }
}

/** Drives one video element over WebRTC or HLS and falls back from the former to the latter. */
export function useStreamEngine(
  ref: RefObject<HTMLVideoElement | null>,
  { hlsUrl, whepUrl, latency, instantReady }: { hlsUrl: string; whepUrl: string; latency: Latency; instantReady: boolean }
) {
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const [stats, setStats] = useState<PlaybackStats>(EMPTY)
  const [autoplayMuted, setAutoplayMuted] = useState(false)
  const frames = useRef({ count: 0, at: 0 })

  const transport: Transport = latency === "instant" && instantReady && failedFor !== whepUrl ? "webrtc" : "hls"
  const preset = latency === "instant" ? "low" : latency

  useEffect(() => {
    const video = ref.current
    if (!video) return
    const merge = (s: Partial<PlaybackStats>) => setStats((prev) => ({ ...prev, ...s }))
    const stop =
      transport === "webrtc"
        ? startWebRtc(video, whepUrl, () => setFailedFor(whepUrl), merge)
        : startHls(video, hlsUrl, preset, merge)

    // Browsers refuse sound without a gesture; a muted picture still beats a blank one.
    const onCanPlay = () => {
      video.play().catch(() => {
        video.muted = true
        setAutoplayMuted(true)
        video.play().catch(() => {})
      })
    }
    video.addEventListener("canplay", onCanPlay)
    const quality = setInterval(() => {
      const q = video.getVideoPlaybackQuality?.()
      const total = q?.totalVideoFrames ?? 0
      const now = performance.now()
      const fps = frames.current.at ? ((total - frames.current.count) * 1000) / (now - frames.current.at) : null
      frames.current = { count: total, at: now }
      merge({ width: video.videoWidth, height: video.videoHeight, dropped: q?.droppedVideoFrames ?? 0, ...(transport === "hls" && fps !== null ? { fps } : {}) })
    }, 1000)
    return () => {
      video.removeEventListener("canplay", onCanPlay)
      clearInterval(quality)
      stop()
      setStats(EMPTY)
    }
  }, [ref, transport, preset, hlsUrl, whepUrl])

  const liveEdge = () => {
    const video = ref.current
    if (video?.seekable.length) video.currentTime = video.seekable.end(video.seekable.length - 1)
  }

  return { transport, stats, autoplayMuted, clearAutoplayMuted: () => setAutoplayMuted(false), liveEdge }
}
