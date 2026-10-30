import { useEffect, useState, type FormEvent } from "react"
import { ExternalLinkIcon } from "lucide-react"
import { toast } from "sonner"

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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { post, type AppState, type ServerInfo, type UpdateState } from "@/lib/api"

function formatDate(value: string | number | null | undefined) {
  if (!value) return "unbegrenzt"
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value)
  return date.toLocaleDateString("de-DE")
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

export function LicensePage({ state, onState }: { state: AppState; onState: (s: AppState) => void }) {
  const license = state.license
  const [update, setUpdate] = useState<UpdateState>({})
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")

  useEffect(() => {
    post<ServerInfo>("server")
      .then((d) => setUpdate(d.update))
      .catch(() => {})
  }, [])

  const guarded = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const check = () =>
    guarded(async () => {
      const res = await post<{ update: UpdateState }>("update.check")
      setUpdate(res.update)
      if (!res.update.update) toast.success("OBS Server ist aktuell.")
    })

  const install = () =>
    guarded(async () => {
      await post("update.install")
      toast.success("Update installiert. Die Seite wird neu geladen.")
      setTimeout(() => location.reload(), 1500)
    })

  const changePassword = (e: FormEvent) => {
    e.preventDefault()
    guarded(async () => {
      await post("password", { current, password: next })
      setCurrent("")
      setNext("")
      toast.success("Passwort geändert.")
    })
  }

  const available = update.update
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Lizenz</CardTitle>
          <CardDescription>
            <a href={license.portal} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
              Lizenz &amp; Support <ExternalLinkIcon className="size-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {license.grace && (
            <Alert>
              <AlertDescription>
                Der Lizenzserver ist gerade nicht erreichbar. OBS Server läuft bis zu 7 Tage mit der letzten Prüfung weiter.
              </AlertDescription>
            </Alert>
          )}
          <Row label="Status"><Badge>Aktiv</Badge></Row>
          <Row label="Lizenzcode"><span className="font-mono text-xs">{license.key_masked}</span></Row>
          {license.customer && <Row label="Kunde">{license.customer}</Row>}
          <Row label="Gültig bis">{formatDate(license.expires_at)}</Row>
          {license.max_activations != null && (
            <Row label="Aktivierungen">{license.activations ?? 0} von {license.max_activations}</Row>
          )}
          {!!license.features?.length && <Row label="Funktionen">{license.features.join(", ")}</Row>}
          {license.checked_at && <Row label="Zuletzt geprüft">{new Date(license.checked_at * 1000).toLocaleString("de-DE")}</Row>}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" disabled={busy} onClick={() => guarded(async () => onState(await post<AppState>("license.refresh")))}>
              Jetzt prüfen
            </Button>
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="outline" disabled={busy} />}>Lizenz entfernen</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Lizenz entfernen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Der Aktivierungsplatz wird freigegeben. OBS Server ist gesperrt und alle Streams werden getrennt, bis
                    wieder ein aktiver Lizenzcode eingegeben wird.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={() => guarded(async () => onState(await post<AppState>("license.deactivate")))}>
                    Entfernen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Updates</CardTitle>
          <CardDescription>Installiert: Version {state.version}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {available && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <p className="text-sm font-medium">
                {update.code === "rollback_available"
                  ? `Die installierte Version wurde zurückgezogen. Bitte Version ${available.version} installieren.`
                  : `Version ${available.version} ist verfügbar`}
              </p>
              {available.changelog && (
                <pre className="max-h-48 overflow-auto font-sans text-xs whitespace-pre-wrap text-muted-foreground">{available.changelog}</pre>
              )}
              <div>
                <Button disabled={busy} onClick={install}>Update installieren</Button>
              </div>
            </div>
          )}
          <div>
            <Button variant="outline" disabled={busy} onClick={check}>Nach Updates suchen</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Passwort ändern</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cur">Aktuelles Passwort</Label>
              <Input id="cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new">Neues Passwort (mindestens 10 Zeichen)</Label>
              <Input id="new" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
            <div>
              <Button type="submit" variant="outline" disabled={busy}>Passwort ändern</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
