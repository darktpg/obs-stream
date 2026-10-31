import { useEffect, useRef, useState, type FormEvent } from "react"
import { PlusIcon, RefreshCwIcon, Settings2Icon, Trash2Icon, TriangleAlertIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"

import { CopyField } from "@/components/copy-field"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { post, type Latency, type Stream } from "@/lib/api"
import { fmtKbps, LATENCY } from "@/lib/format"

export function useStreams() {
  const [streams, setStreams] = useState<Stream[] | null>(null)
  const [running, setRunning] = useState(true)
  const [bitrates, setBitrates] = useState<Record<string, number>>({})
  const last = useRef<{ at: number; bytes: Record<string, number> } | null>(null)

  const reload = async () => {
    try {
      const data = await post<{ streams: Stream[]; server_running: boolean }>("streams")
      const now = Date.now()
      const bytes = Object.fromEntries(data.streams.map((s) => [s.id, s.bytes_in]))
      const prev = last.current
      if (prev) {
        const seconds = (now - prev.at) / 1000
        setBitrates(
          Object.fromEntries(
            data.streams.map((s) => [s.id, Math.max(0, ((s.bytes_in - (prev.bytes[s.id] ?? s.bytes_in)) * 8) / seconds / 1000)])
          )
        )
      }
      last.current = { at: now, bytes }
      setStreams(data.streams)
      setRunning(data.server_running)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  useEffect(() => {
    reload()
    const timer = setInterval(reload, 4000)
    return () => clearInterval(timer)
  }, [])

  return { streams, running, bitrates, reload }
}

function Rotate({ stream, what, label, reload }: { stream: Stream; what: "publish" | "view"; label: string; reload: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        <RefreshCwIcon /> {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Die bisherigen Daten funktionieren danach nicht mehr und müssen überall ersetzt werden.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={() => post("streams.rotate", { id: stream.id, what }).then(reload)}>
            Neu erzeugen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Playback({ stream, reload }: { stream: Stream; reload: () => void }) {
  const save = async (latency: Latency, idle_color: string) => {
    try {
      await post("streams.configure", { id: stream.id, latency, idle_color })
      reload()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }
  const testing = stream.idle_color !== ""

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Latenz</Label>
        <ToggleGroup
          variant="outline"
          value={[stream.latency]}
          onValueChange={(v: string[]) => v[0] && save(v[0] as Latency, stream.idle_color)}
        >
          {(Object.keys(LATENCY) as Latency[]).map((l) => (
            <ToggleGroupItem key={l} value={l}>
              {LATENCY[l].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {LATENCY[stream.latency].hint} Erwartet: {LATENCY[stream.latency].expected}. Gilt sofort für die Browserquelle, die URL bleibt gleich. Die Medienquelle puffert selbst und folgt dieser Einstellung nicht.
        </p>
        {stream.latency === "instant" && stream.online && !stream.instant_ready && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>
              Dieser Stream kommt per RTMP mit AAC-Ton. WebRTC kann AAC nicht übertragen, daher spielt die Quelle über
              HLS, damit der Ton erhalten bleibt. Stelle OBS auf WHIP um (Tab „Senden“).
            </AlertDescription>
          </Alert>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="idle-test">Testfarbe, wenn kein Stream läuft</Label>
          <Switch id="idle-test" checked={testing} onCheckedChange={(on: boolean) => save(stream.latency, on ? "#00ff00" : "")} />
        </div>
        <p className="text-xs text-muted-foreground">
          Aus: Die Browserquelle ist ohne Stream vollständig transparent. An: Sie zeigt diese Farbe, damit du Größe und Position prüfen kannst.
        </p>
        {testing && (
          <input
            type="color"
            aria-label="Testfarbe"
            className="h-9 w-16 cursor-pointer rounded-md border bg-transparent p-1"
            defaultValue={stream.idle_color}
            onBlur={(e) => save(stream.latency, e.target.value)}
          />
        )}
      </div>
    </div>
  )
}

function Details({ stream, reload, onClose }: { stream: Stream; reload: () => void; onClose: () => void }) {
  const [name, setName] = useState(stream.name)
  const rename = async () => {
    if (!name.trim() || name === stream.name) return
    await post("streams.rename", { id: stream.id, name }).catch((err) => toast.error(err.message))
    reload()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{stream.name}</DialogTitle>
          <DialogDescription>Zugangsdaten und Wiedergabe für diesen Stream</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="obs">
          <TabsList>
            <TabsTrigger value="obs">Senden</TabsTrigger>
            <TabsTrigger value="view">Empfangen</TabsTrigger>
            <TabsTrigger value="playback">Wiedergabe</TabsTrigger>
            <TabsTrigger value="general">Allgemein</TabsTrigger>
          </TabsList>
          <TabsContent value="obs" className="flex flex-col gap-3 pt-2">
            <p className="text-xs font-medium">Für den Modus „Sofort“: WHIP</p>
            <p className="text-xs text-muted-foreground">
              OBS 30 oder neuer: Einstellungen → Stream → Dienst „WHIP“, URL einfügen, Bearer-Token leer lassen. OBS sendet
              dann Opus-Ton und schaltet B-Frames ab, beides braucht WebRTC. Unter Ausgabe ein Keyframe-Intervall von 1 Sekunde wählen.
            </p>
            <CopyField label="WHIP-URL" value={stream.whip_url} secret />
            <Separator />
            <p className="text-xs font-medium">Klassisch: RTMP</p>
            <p className="text-xs text-muted-foreground">
              Dienst „Benutzerdefiniert“, H.264, AAC und Keyframe-Intervall 1 oder 2 Sekunden. Läuft nur über HLS, also
              mit einigen Sekunden Verzögerung.
            </p>
            <CopyField label="Server" value={stream.rtmp_server} />
            <CopyField label="Streamschlüssel" value={stream.stream_key} secret />
            <div>
              <Rotate stream={stream} what="publish" label="Streamschlüssel erneuern" reload={reload} />
            </div>
          </TabsContent>
          <TabsContent value="view" className="flex flex-col gap-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Zweite Person: In OBS eine Quelle „Browser“ anlegen, URL einfügen, Größe 1920 × 1080 und „Audio über OBS steuern“ aktivieren, sonst landet der Ton nicht im OBS-Mix. Die URL enthält
              das Passwort, gib sie also nur an berechtigte Personen weiter. Alternative mit oft stabilerer Wiedergabe, aber ohne „Sofort“:
              Quelle „Medienquelle“, „Lokale Datei“ deaktivieren und die Medienquellen-URL eintragen.
            </p>
            <CopyField label="URL für Browserquelle" value={stream.watch_url} secret />
            <CopyField label="URL für Medienquelle" value={stream.hls_url} secret />
            <CopyField label="Zuschauer-Passwort" value={stream.view_password} secret />
            <div>
              <Rotate stream={stream} what="view" label="Zuschauer-Passwort erneuern" reload={reload} />
            </div>
          </TabsContent>
          <TabsContent value="playback" className="pt-2">
            <Playback stream={stream} reload={reload} />
          </TabsContent>
          <TabsContent value="general" className="flex flex-col gap-1.5 pt-2">
            <Label htmlFor="stream-name">Name</Label>
            <div className="flex gap-2">
              <Input id="stream-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
              <Button variant="outline" onClick={rename} disabled={!name.trim() || name === stream.name}>
                Umbenennen
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function Delete({ stream, reload }: { stream: Stream; reload: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="icon" aria-label="Löschen" />}>
        <Trash2Icon />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>„{stream.name}“ löschen?</AlertDialogTitle>
          <AlertDialogDescription>Ein laufender Stream wird sofort getrennt.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={() => post("streams.delete", { id: stream.id }).then(reload)}>Löschen</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xl font-medium tabular-nums">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  )
}

export function StreamsPage() {
  const { streams, running, bitrates, reload } = useStreams()
  const live = streams?.filter((s) => s.online) ?? []
  const [name, setName] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const current = streams?.find((s) => s.id === selected)

  const create = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await post("streams.create", { name })
      setName("")
      await reload()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!running && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Der Medienserver läuft nicht. Unter „Server“ findest du Start und Einrichtung.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Streams" value={String(streams?.length ?? 0)} />
        <Tile label="Gerade live" value={String(live.length)} />
        <Tile label="Zuschauer jetzt" value={String(live.reduce((n, s) => n + s.viewers, 0))} />
        <Tile label="Eingang jetzt" value={fmtKbps(live.reduce((n, s) => n + (bitrates[s.id] ?? 0), 0))} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Neuer Stream</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="flex gap-2">
            <Input placeholder="Name, z. B. Kamera Bühne" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={!name.trim()}>
              <PlusIcon /> Anlegen
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Alle Streams</CardTitle>
        </CardHeader>
        <CardContent>
          {streams && streams.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Noch keine Streams angelegt.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Eingang</TableHead>
                  <TableHead>Latenz</TableHead>
                  <TableHead className="text-right">Bitrate</TableHead>
                  <TableHead className="text-right">Zuschauer</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {streams?.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      {s.online ? <Badge>Live</Badge> : <Badge variant="secondary">Offline</Badge>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.online ? [s.source, s.media.video && `${s.media.video.height}p`, ...s.tracks].filter(Boolean).join(" · ") : "–"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{LATENCY[s.latency].label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.online ? fmtKbps(bitrates[s.id] ?? 0) : "–"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <UsersIcon className="size-3 text-muted-foreground" /> {s.viewers}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setSelected(s.id)}>
                        <Settings2Icon /> Verwalten
                      </Button>
                      <Delete stream={s} reload={reload} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {current && <Details stream={current} reload={reload} onClose={() => setSelected(null)} />}
    </div>
  )
}
