import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react"
import { createRoot } from "react-dom/client"
import { Volume2Icon } from "lucide-react"

import "./index.css"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useStreamEngine } from "@/hooks/use-stream-engine"
import type { Latency } from "@/lib/api"

const POLL = 2000
const params = new URLSearchParams(location.search)
const streamId = params.get("s") ?? ""
const modeParam = params.get("mode") as Latency | null
const bgParam = params.get("bg")
// A browser source must never cover the scene with a form.
const inObs = "obsstudio" in window

type Status = { online: boolean; latency: Latency; idle_color: string; instant_ready: boolean }

function url(token: string, file: string) {
  return `hls.php?s=${encodeURIComponent(streamId)}&t=${encodeURIComponent(token)}&f=${file}`
}

function Player({ token, status }: { token: string; status: Status }) {
  const video = useRef<HTMLVideoElement>(null)
  const engine = useStreamEngine(video, {
    hlsUrl: url(token, "index.m3u8"),
    whepUrl: url(token, "whep"),
    latency: modeParam ?? status.latency,
    instantReady: status.instant_ready,
  })
  return (
    <>
      <video ref={video} autoPlay playsInline className="fixed inset-0 size-full" />
      {engine.autoplayMuted && (
        <Button
          className="fixed right-4 bottom-4"
          onClick={() => {
            if (video.current) video.current.muted = false
            engine.clearAutoplayMuted()
          }}
        >
          <Volume2Icon /> Ton einschalten
        </Button>
      )}
    </>
  )
}

function Watch() {
  const [token, setToken] = useState(params.get("t") ?? "")
  const [input, setInput] = useState("")
  const [state, setState] = useState<"checking" | "password" | "wrong" | "ok">(token ? "checking" : "password")
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    if (!token) return
    let stop = false
    const poll = async () => {
      try {
        const res = await fetch(url(token, "status"))
        if (stop) return
        if (res.status === 403) {
          setState("wrong")
          setStatus(null)
          return
        }
        if (res.ok) {
          setStatus(await res.json())
          setState("ok")
        }
      } catch {
        // Keep the last state during short network problems.
      }
    }
    poll()
    const timer = setInterval(poll, POLL)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [token])

  const idle = bgParam ? `#${bgParam.replace(/^#/, "")}` : status?.idle_color
  useEffect(() => {
    const color = status?.online ? "" : (idle ?? "")
    // watch.html forces transparency, so the override needs the same priority.
    document.documentElement.style.setProperty("background", color || "transparent", "important")
  }, [status?.online, idle])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setState("checking")
    setToken(input.trim())
  }

  if ((state === "password" || state === "wrong") && !inObs) {
    return (
      <form onSubmit={submit} className="flex min-h-svh items-center justify-center bg-background p-4">
        <div className="flex w-full max-w-xs flex-col gap-3">
          <h1 className="text-sm font-medium text-foreground">Passwort für diesen Stream</h1>
          <Input type="password" autoFocus value={input} onChange={(e) => setInput(e.target.value)} />
          {state === "wrong" && (
            <p className="text-xs text-destructive">Das Passwort ist falsch oder der Stream ist gesperrt.</p>
          )}
          <Button type="submit">Ansehen</Button>
        </div>
      </form>
    )
  }

  if (state === "ok" && status?.online) return <Player token={token} status={status} />
  // Nothing rendered: transparent in an OBS browser source, or the chosen test color.
  return null
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Watch />
  </StrictMode>
)
