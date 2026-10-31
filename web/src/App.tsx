import { lazy, Suspense, useEffect, useState } from "react"
import { ChartColumnIcon, KeyRoundIcon, LogOutIcon, MonitorPlayIcon, RadioIcon, ServerIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { loadState, post, type AppState } from "@/lib/api"
import { cn } from "@/lib/utils"
import { LicenseLock, Login, Setup } from "@/pages/gate"
import { LicensePage } from "@/pages/license"
import { ServerPage } from "@/pages/server"
import { MonitorPage } from "@/pages/monitor"
import { StreamsPage } from "@/pages/streams"

const StatsPage = lazy(() => import("@/pages/stats").then((m) => ({ default: m.StatsPage })))

const PAGES = [
  { id: "streams", label: "Streams", icon: RadioIcon },
  { id: "monitor", label: "Monitor", icon: MonitorPlayIcon },
  { id: "stats", label: "Statistik", icon: ChartColumnIcon },
  { id: "server", label: "Server", icon: ServerIcon },
  { id: "license", label: "Lizenz & Updates", icon: KeyRoundIcon },
] as const

type PageId = (typeof PAGES)[number]["id"]

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [page, setPage] = useState<PageId>("streams")

  useEffect(() => {
    loadState()
      .then(setState)
      .catch((e) => toast.error(e.message))
  }, [])

  if (!state) return null
  if (state.setup_required) return <Setup onDone={setState} />
  if (!state.authenticated) return <Login onDone={setState} />
  if (!state.license.unlocked) return <LicenseLock license={state.license} onDone={setState} />

  const logout = async () => {
    await post("logout")
    setState(await loadState())
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium">
            <RadioIcon className="size-4 text-primary" /> OBS Server
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {PAGES.map((p) => (
                  <SidebarMenuItem key={p.id}>
                    <SidebarMenuButton isActive={page === p.id} onClick={() => setPage(p.id)}>
                      <p.icon /> {p.label}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center justify-between px-2 text-xs text-muted-foreground">
            Version {state.version}
            <Button variant="ghost" size="icon" aria-label="Abmelden" onClick={logout}>
              <LogOutIcon />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <h1 className="text-sm font-medium">{PAGES.find((p) => p.id === page)?.label}</h1>
        </header>
        <main className={cn("mx-auto w-full p-4", page === "monitor" || page === "stats" ? "max-w-[100rem]" : "max-w-5xl")}>
          {page === "streams" && <StreamsPage />}
          {page === "monitor" && <MonitorPage />}
          {page === "stats" && (
            <Suspense fallback={null}>
              <StatsPage />
            </Suspense>
          )}
          {page === "server" && <ServerPage />}
          {page === "license" && <LicensePage state={state} onState={setState} />}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
