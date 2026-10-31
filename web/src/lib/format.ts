import type { Latency } from "@/lib/api"

export const LATENCY: Record<Latency, { label: string; hint: string; expected: string }> = {
  instant: { label: "Sofort", hint: "WebRTC, unter einer Sekunde. Braucht WHIP aus OBS und offenen UDP-Port.", expected: "< 1 s" },
  low: { label: "Niedrig", hint: "HLS mit kleinstem Puffer. Keyframe-Intervall 1 s in OBS nötig.", expected: "ca. 2–4 s" },
  balanced: { label: "Ausgewogen", hint: "HLS mit etwas Reserve gegen kurze Netzprobleme.", expected: "ca. 4–6 s" },
  quality: { label: "Qualität", hint: "HLS mit großem Puffer, am wenigsten Aussetzer.", expected: "ca. 6–10 s" },
}

const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 })

export const fmtNumber = (n: number) => number.format(n)

export function fmtBytes(n: number) {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000
    i++
  }
  return `${number.format(n)} ${units[i]}`
}

export function fmtKbps(kbps: number) {
  return kbps >= 1000 ? `${number.format(kbps / 1000)} Mbit/s` : `${Math.round(kbps)} kbit/s`
}

export function fmtDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ${m % 60} min`
  return `${Math.floor(h / 24)} d ${h % 24} h`
}

export function fmtDate(unix: number) {
  return new Date(unix * 1000).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })
}

export function fmtSince(iso: string | null) {
  if (!iso) return "–"
  const at = new Date(iso).getTime()
  return Number.isNaN(at) ? "–" : fmtDuration((Date.now() - at) / 1000)
}
