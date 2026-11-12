"use client";
// Operator app shell (shadcn/ui Sidebar): one navigation for every DockClock surface, dark by default.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, CalendarRange, Gauge, LayoutGrid, Route, ShieldCheck, Truck, Scale } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";

const GROUPS = [
  { label: "Operate", items: [
    { href: "/control", title: "Control room", icon: Gauge, tip: "Everything on one screen: money, pipeline, PayPal, agents" },
    { href: "/dispatch", title: "Dispatch", icon: Route, tip: "Book a load, place the PayPal hold, settle" },
    { href: "/dock", title: "Dock board", icon: CalendarRange, tip: "Doors and trucks live (Bryntum Scheduler)" },
  ] },
  { label: "Finance", items: [
    { href: "/cockpit", title: "Cockpit", icon: LayoutGrid, tip: "Ledgers, review queue, reconciliation (AG Grid)" },
    { href: "/dashboard", title: "Analytics", icon: BarChart3, tip: "AG Studio with the AI analyst" },
  ] },
  { label: "Trust", items: [
    { href: "/judge", title: "Judge mode", icon: Scale, tip: "Eight scenarios with real sandbox calls" },
    { href: "/verify", title: "Verify receipt", icon: ShieldCheck, tip: "Check a Proof-of-Wait against the ledger" },
    { href: "/health", title: "Health", icon: Activity, tip: "Worker, cron, webhooks, queue depth" },
  ] },
];

export function AppShell({ title, sub, aside, children }: { title: string; sub?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  const path = usePathname();
  return (
    <TooltipProvider>
      <div className="dark min-h-svh w-full bg-background text-foreground">
        <SidebarProvider>
          <Sidebar collapsible="icon" variant="inset">
            <SidebarHeader>
              <SidebarMenu><SidebarMenuItem>
                <SidebarMenuButton size="lg" render={<Link href="/" />} tooltip="DockClock home">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-emerald-500 text-emerald-950"><Truck className="size-4" /></span>
                  <span className="grid leading-tight"><b className="text-sm">DockClock</b><span className="text-xs text-muted-foreground">Detention, settled</span></span>
                </SidebarMenuButton>
              </SidebarMenuItem></SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
              {GROUPS.map((g) => (
                <SidebarGroup key={g.label}>
                  <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
                  <SidebarGroupContent><SidebarMenu>
                    {g.items.map((it) => (
                      <SidebarMenuItem key={it.href}>
                        <SidebarMenuButton render={<Link href={it.href} />} isActive={path === it.href} tooltip={it.tip}>
                          <it.icon /><span>{it.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu></SidebarGroupContent>
                </SidebarGroup>
              ))}
            </SidebarContent>
            <SidebarFooter>
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden" title="All PayPal calls go to the sandbox; live is refused">
                <span className="size-2 rounded-full bg-emerald-500" />PayPal sandbox
              </div>
            </SidebarFooter>
          </Sidebar>
          <SidebarInset className="min-w-0">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <h1 className="text-sm font-semibold">{title}</h1>
              <div className="ml-auto flex items-center gap-2">{aside}</div>
            </header>
            <main className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
              {sub && <p className="max-w-3xl text-sm text-muted-foreground">{sub}</p>}
              {children}
            </main>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </TooltipProvider>
  );
}
