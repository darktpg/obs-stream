import { useState } from "react"
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState(!secret)

  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-1.5">
        <Input readOnly value={value} type={shown ? "text" : "password"} className="font-mono text-xs" />
        {secret && (
          <Button variant="outline" size="icon" aria-label="Anzeigen" onClick={() => setShown(!shown)}>
            {shown ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        )}
        <Button variant="outline" size="icon" aria-label="Kopieren" onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  )
}
