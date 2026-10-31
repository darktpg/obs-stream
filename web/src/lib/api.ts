export type License = {
  unlocked: boolean
  code?: string
  message?: string
  grace?: boolean
  key_masked?: string
  customer?: string | null
  expires_at?: string | number | null
  features?: string[]
  activations?: number | null
  max_activations?: number | null
  checked_at?: number | null
  portal?: string
}

export type AppState = {
  version: string
  setup_required: boolean
  authenticated: boolean
  csrf: string
  license: License
}

export type Latency = "instant" | "low" | "balanced" | "quality"

export type Stream = {
  id: string
  name: string
  created_at: number
  view_password: string
  rtmp_server: string
  stream_key: string
  watch_url: string
  hls_url: string
  whep_url: string
  whip_url: string
  latency: Latency
  idle_color: string
  online: boolean
  online_since: string | null
  tracks: string[]
  bytes_in: number
  bytes_out: number
  frames_in_error: number
  viewers: number
  viewers_rtc: number
  instant_ready: boolean
  source: string | null
  media: {
    video: { codec: string; width: number; height: number; profile: string | null; level: string | null } | null
    audio: { codec: string; sample_rate: number; channels: number | null } | null
  }
}

export type StatRow = {
  t: number
  live: number
  in: number
  out: number
  viewer_s: number
  peak_v: number
  peak_kbps: number
  errors: number
  started: number
  unique?: number
}

export type StatSession = {
  stream: string
  name: string
  start: number
  end?: number
  last?: number
  bytes: number
  peak_v: number
  viewer_s: number
  peak_kbps: number
  errors: number
  source: string | null
  video: Stream["media"]["video"]
  audio: Stream["media"]["audio"]
}

export type StatsReport = {
  now: number
  collecting_since: number | null
  recent: { t: number; kbps: number; viewers: number }[]
  hours: StatRow[]
  days: StatRow[]
  heat: Record<string, Record<string, number>>
  clients: Record<string, number>
  sessions: StatSession[]
  open: StatSession[]
  streams: { id: string; name: string; created_at: number; latency: Latency }[]
  counters: { total: Record<string, number>; days: Record<string, Record<string, number>> }
  server: {
    running: boolean
    mtx_version: string | null
    mtx_started: string | null
    load: number[] | null
    cpus: number | null
    memory: { total: number; available: number } | null
    disk_free: number | null
    disk_total: number | null
    data_bytes: number
    php_version: string
    app_version: string
    cron_ran_at: number | null
    update_available: string | null
  }
  license: {
    expires_at: string | number | null
    activations: number | null
    max_activations: number | null
    checked_at: number | null
  }
}

export type UpdateInfo = {
  version: string
  name?: string
  changelog?: string
  published_at?: string
  size?: number
}

export type UpdateState = {
  checked_at?: number
  code?: string
  update?: UpdateInfo | null
}

export type ServerInfo = {
  diagnostics: {
    running: boolean
    version: string | null
    arch: string
    binary_found: boolean
    exec_available: boolean
    extensions: { name: string; ok: boolean }[]
    php_version: string
    cron_command: string
    cron_file: string
    cron_ok: boolean
    webrtc_port: number
    log: string
  }
  settings: { rtmp_host: string; rtmp_port: number; base_url: string }
  update: UpdateState
}

let csrf = ""

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function parse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.error ?? `Serverfehler (${res.status})`, res.status)
  return data as T
}

export async function loadState(): Promise<AppState> {
  const state = await parse<AppState>(await fetch("api.php?action=state"))
  csrf = state.csrf
  return state
}

export async function post<T = { ok: true }>(action: string, body: object = {}): Promise<T> {
  const res = await fetch(`api.php?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify(body),
  })
  const data = await parse<T>(res)
  const next = (data as Partial<AppState>).csrf
  if (next) csrf = next
  return data
}
