import { useEffect, useRef, useState, type FormEvent } from "react"
import { MonitorPlayIcon, PlusIcon, RefreshCwIcon, Trash2Icon, UsersIcon } from "lucide-react"
import { toast } from "sonner"

import { CopyField } from "@/components/copy-field"
import { HlsPlayer } from "@/components/hls-player"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { post, type Stream } from "@/lib/api"

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

function Details({ stream, reload, onClose }: { stream: Stream; reload: () => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{stream.name}</DialogTitle>
          <DialogDescription>Zugangsdaten für diesen Stream</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="obs">
          <TabsList>
            <TabsTrigger value="obs">Senden (OBS)</TabsTrigger>
            <TabsTrigger value="view">Empfangen</TabsTrigger>
            <TabsTrigger value="preview">Vorschau</TabsTrigger>
          </TabsList>
          <TabsContent value="obs" className="flex flex-col gap-3 pt-2">
            <p className="text-xs text-muted-foreground">
              OBS: Einstellungen → Stream → Dienst „Benutzerdefiniert“. Unter Ausgabe H.264, AAC und ein
              Keyframe-Intervall von 1 oder 2 Sekunden wählen.
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
              das Passwort, gib sie also nur an berechtigte Personen weiter. Alternative mit oft stabilerer Wiedergabe:
              Quelle „Medienquelle“, „Lokale Datei“ deaktivieren und die Medienquellen-URL eintragen.
            </p>
            <CopyField label="URL für Browserquelle" value={stream.watch_url} secret />
            <CopyField label="URL für Medienquelle" value={stream.hls_url} secret />
            <CopyField label="Zuschauer-Passwort" value={stream.view_password} secret />
            <div>
              <Rotate stream={stream} what="view" label="Zuschauer-Passwort erneuern" reload={reload} />
            </div>
          </TabsContent>
          <TabsContent value="preview" className="pt-2">
            {stream.online ? (
              <HlsPlayer src={stream.hls_url} controls muted className="aspect-video w-full rounded-lg" />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Dieser Stream ist gerade offline.</p>
            )}
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

export function StreamsPage() {
  const { streams, running, bitrates, reload } = useStreams()
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
                  <TableHead>Codecs</TableHead>
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
                    <TableCell className="text-muted-foreground">{s.tracks.join(", ") || "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.online ? `${((bitrates[s.id] ?? 0) / 1000).toFixed(1)} Mbit/s` : "–"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <UsersIcon className="size-3 text-muted-foreground" /> {s.viewers}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setSelected(s.id)}>
                        Zugangsdaten
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

export function MonitorPage() {
  const { streams } = useStreams()
  const live = streams?.filter((s) => s.online) ?? []
  if (live.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-sm text-muted-foreground">
        <MonitorPlayIcon className="size-6" />
        Gerade ist kein Stream live.
      </div>
    )
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {live.map((s) => (
        <Card key={s.id}>
          <CardHeader>
            <CardTitle>{s.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <HlsPlayer src={s.hls_url} muted controls className="aspect-video w-full rounded-lg" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
