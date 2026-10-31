import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { toast } from "sonner"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { post, type StatRow, type StatSession, type StatsReport } from "@/lib/api"
import { fmtBytes, fmtDate, fmtDuration, fmtKbps, fmtNumber, fmtSince } from "@/lib/format"
import { Tile } from "@/pages/streams"

const RANGES = {
  "24h": { label: "24 h", seconds: 86400, key: "hours" },
  "7d": { label: "7 Tage", seconds: 604800, key: "hours" },
  "30d": { label: "30 Tage", seconds: 2592000, key: "days" },
  "90d": { label: "90 Tage", seconds: 7776000, key: "days" },
  "1y": { label: "1 Jahr", seconds: 31536000, key: "days" },
} as const
type Range = keyof typeof RANGES

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
const CLIENTS: Record<string, string> = {
  obs_browser: "OBS-Browserquelle",
  obs_media: "OBS-Medienquelle",
  browser: "Browser",
  mobile: "Mobilgerät",
  webrtc: "WebRTC (Sofort)",
}

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((n, r) => n + f(r), 0)
const max = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((n, r) => Math.max(n, f(r)), 0)
const end = (s: StatSession) => s.end ?? s.last ?? s.start
const length = (s: StatSession) => end(s) - s.start
const hours = (s: number) => `${fmtNumber(s / 3600)} h`

function tally<T>(rows: T[], key: (r: T) => string | null, weight: (r: T) => number = () => 1) {
  const out = new Map<string, number>()
  for (const r of rows) {
    const k = key(r)
    if (k) out.set(k, (out.get(k) ?? 0) + weight(r))
  }
  return [...out].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

function Chart({ title, description, children, empty }: { title: string; description?: string; children: ReactNode; empty: boolean }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {empty ? <p className="py-14 text-center text-sm text-muted-foreground">Noch keine Daten in diesem Zeitraum.</p> : children}
      </CardContent>
    </Card>
  )
}

function config(label: string): ChartConfig {
  return { value: { label, color: "var(--chart-2)" } }
}

function TimeArea({ data, label, format }: { data: { label: string; value: number }[]; label: string; format: (n: number) => string }) {
  return (
    <ChartContainer config={config(label)} className="aspect-auto h-48 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={format} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => format(Number(v))} />} />
        <Area dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} fill="var(--color-value)" fillOpacity={0.15} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  )
}

function Bars({ data, label, format, horizontal = false }: { data: { label: string; value: number }[]; label: string; format: (n: number) => string; horizontal?: boolean }) {
  if (horizontal) {
    return (
      <ChartContainer config={config(label)} className="aspect-auto w-full" style={{ height: Math.max(96, data.length * 34) }}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8 }}>
          <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={130} />
          <XAxis type="number" hide />
          <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(v) => format(Number(v))} />} />
          <Bar dataKey="value" fill="var(--color-value)" radius={4} barSize={16} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    )
  }
  return (
    <ChartContainer config={config(label)} className="aspect-auto h-48 w-full">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={format} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(v) => format(Number(v))} />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

function Heatmap({ heat }: { heat: StatsReport["heat"] }) {
  const peak = Math.max(1, ...Object.values(heat).flatMap((d) => Object.values(d)))
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[36rem] grid-cols-[2rem_repeat(24,1fr)] gap-0.5 text-xs text-muted-foreground">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center">{h % 3 === 0 ? h : ""}</span>
        ))}
        {WEEKDAYS.map((day, d) => (
          <div key={day} className="contents">
            <span>{day}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const v = heat[d]?.[h] ?? 0
              return (
                <div
                  key={h}
                  title={`${day} ${h}:00 – ${hours(v)} Sendezeit`}
                  className="aspect-square rounded-sm"
                  style={{ background: v ? `color-mix(in srgb, var(--chart-2) ${15 + (v / peak) * 85}%, var(--muted))` : "var(--muted)" }}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{children}</div>
    </section>
  )
}

function Gauge({ label, value, used }: { label: string; value: string; used: number | null }) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      {used !== null && <Progress value={Math.min(100, used)} aria-label={label} />}
    </div>
  )
}

export function StatsPage() {
  const [data, setData] = useState<StatsReport | null>(null)
  const [range, setRange] = useState<Range>("7d")

  useEffect(() => {
    const load = () => post<StatsReport>("stats").then(setData).catch((e) => toast.error(e.message))
    load()
    const timer = setInterval(load, 15000)
    return () => clearInterval(timer)
  }, [])

  const view = useMemo(() => {
    if (!data) return null
    const r = RANGES[range]
    const from = data.now - r.seconds
    const rows: StatRow[] = data[r.key].filter((x) => x.t >= from)
    const days = data.days.filter((x) => x.t >= from)
    const sessions = [...data.open, ...data.sessions].filter((s) => end(s) >= from)
    const label = (t: number) =>
      new Date(t * 1000).toLocaleString("de-DE", r.key === "hours" ? { weekday: "short", hour: "2-digit" } : { day: "2-digit", month: "2-digit" })
    return { rows, days, sessions, label, bucket: r.key === "hours" ? 3600 : 86400 }
  }, [data, range])

  if (!data || !view) return null
  const { rows, days, sessions, label, bucket } = view
  const s = data.server

  const live = sum(rows, (r) => r.live)
  const viewerSeconds = sum(rows, (r) => r.viewer_s)
  const bytesIn = sum(rows, (r) => r.in)
  const bytesOut = sum(rows, (r) => r.out)
  const errors = sum(rows, (r) => r.errors)
  const durations = sessions.map(length)
  const sorted = [...durations].sort((a, b) => a - b)
  const longest = sessions.reduce<StatSession | null>((b, x) => (!b || length(x) > length(b) ? x : b), null)
  const biggest = sessions.reduce<StatSession | null>((b, x) => (!b || x.peak_v > b.peak_v ? x : b), null)
  const avgKbps = live ? (bytesIn * 8) / live / 1000 : 0
  const totalLive = sum(data.days, (r) => r.live)
  const activeDays = days.filter((d) => d.live > 0).length
  const today = data.days[data.days.length - 1]
  const denied = (name: string) => sum(Object.entries(data.counters.days), ([, c]) => c[name] ?? 0)
  const expires = data.license.expires_at
  const expiresAt = typeof expires === "number" ? expires : expires ? new Date(expires).getTime() / 1000 : null
  const licenseDays = expiresAt ? Math.ceil((expiresAt - data.now) / 86400) : null
  const memUsed = s.memory ? s.memory.total - s.memory.available : null
  const diskUsed = s.disk_total && s.disk_free ? s.disk_total - s.disk_free : null
  const loadPct = s.load && s.cpus ? (s.load[0] / s.cpus) * 100 : null

  const series = (f: (r: StatRow) => number) => rows.map((r) => ({ label: label(r.t), value: f(r) }))
  const perStream = data.streams
    .map((st) => {
      const own = sessions.filter((x) => x.stream === st.id)
      return {
        ...st,
        count: own.length,
        time: sum(own, length),
        bytes: sum(own, (x) => x.bytes),
        peak: max(own, (x) => x.peak_v),
        viewer_s: sum(own, (x) => x.viewer_s),
        kbps: max(own, (x) => x.peak_kbps),
        errors: sum(own, (x) => x.errors),
        last: own.length ? Math.max(...own.map(end)) : null,
      }
    })
    .sort((a, b) => b.time - a.time)
  const weekday = WEEKDAYS.map((d, i) => ({ label: d, value: sum(Object.values(data.heat[i] ?? {}), (v) => v) }))
  const hourOfDay = Array.from({ length: 24 }, (_, h) => ({
    label: String(h),
    value: sum(Object.values(data.heat), (d) => d[h] ?? 0),
  }))
  const durationBuckets = [
    ["< 5 min", 0, 300],
    ["5–30 min", 300, 1800],
    ["30–60 min", 1800, 3600],
    ["1–2 h", 3600, 7200],
    ["2–4 h", 7200, 14400],
    ["> 4 h", 14400, Infinity],
  ].map(([l, a, b]) => ({ label: l as string, value: durations.filter((d) => d >= (a as number) && d < (b as number)).length }))
  const asBars = (t: { name: string; value: number }[]) => t.map((x) => ({ label: x.name, value: x.value }))
  const resolutions = asBars(tally(sessions, (x) => (x.video ? `${x.video.width} × ${x.video.height}` : null), length))
  const videoCodecs = asBars(tally(sessions, (x) => x.video?.codec ?? null, length))
  const audioCodecs = asBars(tally(sessions, (x) => x.audio?.codec ?? null, length))
  const ingest = asBars(tally(sessions, (x) => x.source, length))
  const clients = Object.entries(data.clients)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ label: CLIENTS[k] ?? k, value: v }))
    .sort((a, b) => b.value - a.value)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {data.collecting_since ? `Daten seit ${fmtDate(data.collecting_since)}. ` : "Die Erfassung läuft ab jetzt. "}
          Heatmap und Client-Anteile zeigen die gesamte Laufzeit.
        </p>
        <ToggleGroup variant="outline" value={[range]} onValueChange={(v: string[]) => v[0] && setRange(v[0] as Range)}>
          {(Object.keys(RANGES) as Range[]).map((r) => (
            <ToggleGroupItem key={r} value={r}>{RANGES[r].label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <Group title="Sendebetrieb">
        <Tile label="Gerade live" value={String(data.open.length)} hint={`von ${data.streams.length} Streams`} />
        <Tile label="Sendezeit" value={fmtDuration(live)} />
        <Tile label="Sendungen" value={String(sessions.length)} />
        <Tile label="Ø Sendungsdauer" value={fmtDuration(sum(durations, (d) => d) / (durations.length || 1))} />
        <Tile label="Median Dauer" value={fmtDuration(sorted[Math.floor(sorted.length / 2)] ?? 0)} />
        <Tile label="Längste Sendung" value={fmtDuration(longest ? length(longest) : 0)} hint={longest?.name} />
        <Tile label="Aktive Tage" value={String(activeDays)} />
        <Tile label="Sendezeit gesamt" value={fmtDuration(totalLive)} hint="seit Erfassungsbeginn" />
        <Tile label="Ø pro aktivem Tag" value={fmtDuration(live / (activeDays || 1))} />
        <Tile label="Sendezeit heute" value={fmtDuration(today?.live ?? 0)} />
        <Tile label="Sendungen heute" value={String(today?.started ?? 0)} />
        <Tile label="Letzte Sendung" value={data.sessions[0]?.end ? fmtDate(data.sessions[0].end) : "–"} hint={data.sessions[0]?.name} />
      </Group>

      <Group title="Zuschauer">
        <Tile label="Zuschauerstunden" value={hours(viewerSeconds)} />
        <Tile label="Höchststand" value={String(max(rows, (r) => r.peak_v))} hint={biggest?.peak_v ? biggest.name : undefined} />
        <Tile label="Ø gleichzeitig" value={fmtNumber(viewerSeconds / (live || 1))} hint="während Sendezeit" />
        <Tile label="Eindeutige heute" value={String(today?.unique ?? 0)} />
        <Tile label="Bester Tag" value={String(max(days, (d) => d.unique ?? 0))} hint="eindeutige Zuschauer" />
        <Tile label="Ø Spitze je Sendung" value={fmtNumber(sum(sessions, (x) => x.peak_v) / (sessions.length || 1))} />
      </Group>

      <Group title="Daten und Qualität">
        <Tile label="Empfangen" value={fmtBytes(bytesIn)} />
        <Tile label="Medienserver-Ausgang" value={fmtBytes(bytesOut)} />
        <Tile label="Ø Bitrate" value={fmtKbps(avgKbps)} />
        <Tile label="Spitzenbitrate" value={fmtKbps(max(rows, (r) => r.peak_kbps))} />
        <Tile label="Fehlerhafte Bilder" value={String(errors)} />
        <Tile label="Fehler pro Sendestunde" value={fmtNumber(errors / (live / 3600 || 1))} />
      </Group>

      <Group title="Sicherheit und System">
        <Tile label="Falsche Passwörter" value={String(denied("view_denied"))} hint="letzte 31 Tage" />
        <Tile label="Abgelehnte Sender" value={String(denied("publish_denied"))} hint="letzte 31 Tage" />
        <Tile label="Medienserver läuft seit" value={fmtSince(s.mtx_started)} hint={s.mtx_version ?? undefined} />
        <Tile label="Letzter Cron-Lauf" value={s.cron_ran_at ? fmtDate(s.cron_ran_at) : "–"} />
        <Tile label="Lizenz läuft noch" value={licenseDays === null ? "unbefristet" : `${licenseDays} Tage`} />
        <Tile label="Aktivierungen" value={data.license.activations != null ? `${data.license.activations} / ${data.license.max_activations ?? "∞"}` : "–"} />
      </Group>

      <div className="grid gap-4 lg:grid-cols-2">
        <Chart title="Letzte Stunde: Bitrate" description="Summe aller Streams" empty={!data.recent.length}>
          <TimeArea label="Bitrate" format={fmtKbps} data={data.recent.map((r) => ({ label: new Date(r.t * 1000).toLocaleTimeString("de-DE", { timeStyle: "short" }), value: r.kbps }))} />
        </Chart>
        <Chart title="Letzte Stunde: Zuschauer" empty={!data.recent.length}>
          <TimeArea label="Zuschauer" format={fmtNumber} data={data.recent.map((r) => ({ label: new Date(r.t * 1000).toLocaleTimeString("de-DE", { timeStyle: "short" }), value: r.viewers }))} />
        </Chart>
        <Chart title="Spitzenbitrate" empty={!rows.length}>
          <TimeArea label="Bitrate" format={fmtKbps} data={series((r) => r.peak_kbps)} />
        </Chart>
        <Chart title="Zuschauer-Höchststand" empty={!rows.length}>
          <TimeArea label="Zuschauer" format={fmtNumber} data={series((r) => r.peak_v)} />
        </Chart>
        <Chart title="Sendezeit" empty={!rows.length}>
          <Bars label="Sendezeit" format={hours} data={series((r) => r.live)} />
        </Chart>
        <Chart title="Empfangene Daten" empty={!rows.length}>
          <Bars label="Daten" format={fmtBytes} data={series((r) => r.in)} />
        </Chart>
        <Chart title="Zuschauerstunden" empty={!rows.length}>
          <Bars label="Zuschauerstunden" format={(n) => hours(n)} data={series((r) => r.viewer_s)} />
        </Chart>
        <Chart title="Auslastung der Sendezeit" description={`Anteil des Zeitraums je ${bucket === 3600 ? "Stunde" : "Tag"}, mehrere Streams addieren sich`} empty={!rows.length}>
          <TimeArea label="Auslastung" format={(n) => `${fmtNumber(n)} %`} data={series((r) => (r.live / bucket) * 100)} />
        </Chart>
        <Chart title="Eindeutige Zuschauer pro Tag" empty={!days.length}>
          <Bars label="Eindeutige" format={fmtNumber} data={days.map((d) => ({ label: label(d.t), value: d.unique ?? 0 }))} />
        </Chart>
        <Chart title="Gestartete Sendungen" empty={!rows.length}>
          <Bars label="Sendungen" format={fmtNumber} data={series((r) => r.started)} />
        </Chart>
        <Chart title="Fehlerhafte Bilder" empty={!rows.length}>
          <Bars label="Bilder" format={fmtNumber} data={series((r) => r.errors)} />
        </Chart>
        <Chart title="Sendungsdauer" description="Anzahl Sendungen je Länge" empty={!sessions.length}>
          <Bars label="Sendungen" format={fmtNumber} data={durationBuckets} />
        </Chart>
      </div>

      <Chart title="Wann gesendet wird" description="Sendezeit nach Wochentag und Stunde" empty={!Object.keys(data.heat).length}>
        <Heatmap heat={data.heat} />
      </Chart>

      <div className="grid gap-4 lg:grid-cols-2">
        <Chart title="Sendezeit nach Wochentag" empty={!Object.keys(data.heat).length}>
          <Bars label="Sendezeit" format={hours} data={weekday} />
        </Chart>
        <Chart title="Sendezeit nach Tageszeit" empty={!Object.keys(data.heat).length}>
          <Bars label="Sendezeit" format={hours} data={hourOfDay} />
        </Chart>
        <Chart title="Womit zugeschaut wird" description="Anteil an der Zuschauzeit" empty={!clients.length}>
          <Bars horizontal label="Zuschauzeit" format={(n) => hours(n)} data={clients} />
        </Chart>
        <Chart title="Eingang" description="Sendezeit je Protokoll" empty={!ingest.length}>
          <Bars horizontal label="Sendezeit" format={hours} data={ingest} />
        </Chart>
        <Chart title="Auflösungen" description="Sendezeit je Auflösung" empty={!resolutions.length}>
          <Bars horizontal label="Sendezeit" format={hours} data={resolutions} />
        </Chart>
        <Chart title="Codecs" description="Sendezeit je Video- und Audio-Codec" empty={!videoCodecs.length && !audioCodecs.length}>
          <Bars horizontal label="Sendezeit" format={hours} data={[...videoCodecs, ...audioCodecs]} />
        </Chart>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Streams im Vergleich</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stream</TableHead>
                <TableHead className="text-right">Sendungen</TableHead>
                <TableHead className="text-right">Sendezeit</TableHead>
                <TableHead className="text-right">Daten</TableHead>
                <TableHead className="text-right">Spitze Zuschauer</TableHead>
                <TableHead className="text-right">Zuschauerstunden</TableHead>
                <TableHead className="text-right">Spitzenbitrate</TableHead>
                <TableHead className="text-right">Fehler</TableHead>
                <TableHead className="text-right">Zuletzt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perStream.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtDuration(p.time)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBytes(p.bytes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.peak}</TableCell>
                  <TableCell className="text-right tabular-nums">{hours(p.viewer_s)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtKbps(p.kbps)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.errors}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.last ? fmtDate(p.last) : "–"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Server</CardTitle>
          <CardDescription>
            OBS Server {s.app_version} · PHP {s.php_version}
            {s.update_available ? ` · Update ${s.update_available} verfügbar` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Gauge label="CPU-Last (1 min)" value={s.load ? `${fmtNumber(s.load[0])}${s.cpus ? ` / ${s.cpus} Kerne` : ""}` : "–"} used={loadPct} />
          <Gauge label="Arbeitsspeicher" value={s.memory && memUsed !== null ? `${fmtBytes(memUsed)} / ${fmtBytes(s.memory.total)}` : "–"} used={s.memory && memUsed !== null ? (memUsed / s.memory.total) * 100 : null} />
          <Gauge label="Festplatte" value={s.disk_total && diskUsed !== null ? `${fmtBytes(diskUsed)} / ${fmtBytes(s.disk_total)}` : "–"} used={s.disk_total && diskUsed !== null ? (diskUsed / s.disk_total) * 100 : null} />
          <Gauge label="Statistikdaten" value={fmtBytes(s.data_bytes)} used={null} />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Letzte Sendungen</CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Noch keine Sendungen in diesem Zeitraum.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stream</TableHead>
                  <TableHead>Beginn</TableHead>
                  <TableHead className="text-right">Dauer</TableHead>
                  <TableHead>Eingang</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead className="text-right">Daten</TableHead>
                  <TableHead className="text-right">Spitze</TableHead>
                  <TableHead className="text-right">Fehler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.slice(0, 50).map((x) => (
                  <TableRow key={`${x.stream}-${x.start}`}>
                    <TableCell className="font-medium">{x.name}{x.end ? "" : " (live)"}</TableCell>
                    <TableCell className="tabular-nums">{fmtDate(x.start)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDuration(length(x))}</TableCell>
                    <TableCell>{x.source ?? "–"}</TableCell>
                    <TableCell className="text-muted-foreground">{[x.video && `${x.video.height}p ${x.video.codec}`, x.audio?.codec].filter(Boolean).join(" · ") || "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBytes(x.bytes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{x.peak_v}</TableCell>
                    <TableCell className="text-right tabular-nums">{x.errors}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
