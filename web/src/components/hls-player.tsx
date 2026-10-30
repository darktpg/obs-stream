import { useEffect, useRef } from "react"
import Hls from "hls.js"

import { cn } from "@/lib/utils"

export function HlsPlayer({
  src,
  muted = false,
  controls = false,
  className,
}: {
  src: string
  muted?: boolean
  controls?: boolean
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    if (!Hls.isSupported()) {
      video.src = src
      return
    }
    const hls = new Hls({ liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 5, lowLatencyMode: false })
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
      else setTimeout(() => hls.loadSource(src), 2000)
    })
    hls.loadSource(src)
    hls.attachMedia(video)
    return () => hls.destroy()
  }, [src])

  return <video ref={ref} autoPlay playsInline muted={muted} controls={controls} className={cn("bg-black", className)} />
}
