import { useEffect, useState } from "react"
import { CheckCircle2Icon, XCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { CopyField } from "@/components/copy-field"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { post, type ServerInfo } from "@/lib/api"

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2Icon className="size-4 text-muted-foreground" /> : <XCircleIcon className="size-4 text-destructive" />}
      {label}
    </li>
  )
}

export function ServerPage() {
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [host, setHost] = useState("")
  const [port, setPort] = useState("1935")
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setInfo(await post<ServerInfo>("server"))
  }

  useEffect(() => {
    post<ServerInfo>("server")
      .then((d) => {
        setInfo(d)
        setHost(d.settings.rtmp_host)
        setPort(String(d.settings.rtmp_port))
      })
      .catch((e) => toast.error(e.message))
  }, [])

  const run = async (action: string, body = {}, done = "Erledigt") => {
    setBusy(true)
    try {
      await post(action, body)
      toast.success(done)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!info) return null
  const d = info.diagnostics
  const cronOk = d.cron_ok

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Medienserver</CardTitle>
          <CardDescription>MediaMTX {d.version ?? ""} nimmt RTMP an und remuxt ohne Transcoding.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-col gap-1.5">
            <Check ok={d.running} label={d.running ? "Medienserver läuft" : "Medienserver läuft nicht"} />
            <Check ok={cronOk} label={cronOk ? "Geplante Aufgabe läuft" : "Geplante Aufgabe wurde in den letzten 3 Minuten nicht ausgeführt"} />
            <Check ok={d.binary_found} label={`Programm für Architektur ${d.arch}`} />
            <Check ok={d.exec_available} label="PHP darf Programme starten (exec)" />
            {d.extensions.map((e) => (
              <Check key={e.name} ok={e.ok} label={`PHP-Erweiterung ${e.name} (PHP ${d.php_version})`} />
            ))}
          </ul>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => run("server.start", {}, "Medienserver läuft")}>Starten</Button>
            <Button variant="outline" disabled={busy} onClick={() => run("server.restart", {}, "Medienserver neu gestartet")}>Neu starten</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Einrichtung in Plesk</CardTitle>
          <CardDescription>
            Damit der Medienserver dauerhaft läuft, lege unter „Geplante Aufgaben“ eine Aufgabe an, die jede Minute
            läuft. Gib außerdem TCP-Port {info.settings.rtmp_port} in der Firewall frei.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <CopyField label="PHP-Skript" value={d.cron_file} />
          <CopyField label="Oder als Befehl" value={d.cron_command} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>RTMP-Adresse</CardTitle>
          <CardDescription>Leer lassen, um die Domain des Dashboards zu verwenden.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="host">Hostname</Label>
            <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div className="flex w-28 flex-col gap-1.5">
            <Label htmlFor="port">Port</Label>
            <Input id="port" value={port} onChange={(e) => setPort(e.target.value)} />
          </div>
          <Button disabled={busy} onClick={() => run("server.settings", { rtmp_host: host, rtmp_port: Number(port) }, "Gespeichert")}>
            Speichern
          </Button>
        </CardContent>
      </Card>

      {d.log && (
        <Card>
          <CardHeader>
            <CardTitle>Protokoll</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-60 overflow-auto rounded-lg bg-muted p-3 text-xs">{d.log}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
