import { useState, type FormEvent, type ReactNode } from "react"
import { KeyRoundIcon, LockIcon, RadioIcon } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { post, type AppState, type License } from "@/lib/api"

function Shell({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children: ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground [&_svg]:size-4">
            {icon}
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{text}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

function useSubmit(run: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await run()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, submit }
}

export function Setup({ onDone }: { onDone: (s: AppState) => void }) {
  const [password, setPassword] = useState("")
  const [repeat, setRepeat] = useState("")
  const { busy, submit } = useSubmit(async () => {
    if (password !== repeat) throw new Error("Die Passwörter stimmen nicht überein.")
    onDone(await post<AppState>("setup", { password }))
  })
  return (
    <Shell icon={<RadioIcon />} title="OBS Server einrichten" text="Lege das Passwort für das Dashboard fest.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pw">Passwort (mindestens 10 Zeichen)</Label>
          <Input id="pw" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pw2">Passwort wiederholen</Label>
          <Input id="pw2" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy}>Passwort festlegen</Button>
      </form>
    </Shell>
  )
}

export function Login({ onDone }: { onDone: (s: AppState) => void }) {
  const [password, setPassword] = useState("")
  const { busy, submit } = useSubmit(async () => onDone(await post<AppState>("login", { password })))
  return (
    <Shell icon={<LockIcon />} title="OBS Server" text="Melde dich mit deinem Passwort an.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pw">Passwort</Label>
          <Input id="pw" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy}>Anmelden</Button>
      </form>
    </Shell>
  )
}

export function LicenseLock({ license, onDone }: { license: License; onDone: (s: AppState) => void }) {
  const [key, setKey] = useState("")
  const { busy, submit } = useSubmit(async () => onDone(await post<AppState>("license.activate", { key })))
  return (
    <Shell icon={<KeyRoundIcon />} title="Lizenz erforderlich" text="Alle Funktionen und Streams sind gesperrt, bis ein aktiver Lizenzcode eingegeben wird.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {license.message && license.code !== "no_key" && (
          <Alert variant="destructive">
            <AlertDescription>{license.message}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="key">Lizenzcode</Label>
          <Input id="key" autoFocus className="font-mono" value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy}>Lizenz aktivieren</Button>
        {license.portal && (
          <a href={license.portal} target="_blank" rel="noreferrer" className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline">
            Lizenz &amp; Support
          </a>
        )}
      </form>
    </Shell>
  )
}
