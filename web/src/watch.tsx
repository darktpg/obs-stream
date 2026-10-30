import { StrictMode, useEffect, useState, type FormEvent } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { HlsPlayer } from "@/components/hls-player"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const params = new URLSearchParams(location.search)
const streamId = params.get("s") ?? ""

function statusUrl(token: string) {
  return `hls.php?s=${encodeURIComponent(streamId)}&t=${encodeURIComponent(token)}&f=status`
}

function Watch() {
  const [token, setToken] = useState(params.get("t") ?? "")
  const [input, setInput] = useState("")
  const [state, setState] = useState<"checking" | "password" | "wrong" | "ok">(
    token ? "checking" : "password"
  )
  const [online, setOnline] = useState(false)

  useEffect(() => {
    if (!token) return
    let stop = false
    const poll = async () => {
      try {
        const res = await fetch(statusUrl(token))
        if (stop) return
        if (res.status === 403) {
          setState("wrong")
          return
        }
        if (res.ok) {
          const data = await res.json()
          setOnline(Boolean(data.online))
          setState("ok")
        }
      } catch {
        // Keep the last state during short network problems.
      }
    }
    poll()
    const timer = setInterval(poll, 5000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [token])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setState("checking")
    setToken(input.trim())
  }

  if (state === "password" || state === "wrong") {
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

  if (state === "ok" && online) {
    return (
      <HlsPlayer
        src={`hls.php?s=${encodeURIComponent(streamId)}&t=${encodeURIComponent(token)}&f=index.m3u8`}
        className="fixed inset-0 size-full"
      />
    )
  }
  // Stays transparent in an OBS browser source while nothing is live.
  return null
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Watch />
  </StrictMode>
)
