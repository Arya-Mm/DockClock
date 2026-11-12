"use client";
// DockClock ops cockpit (PLAN §7.1): five AG Grid Enterprise grids, each one click from the tab bar.
// Every money value is engine output from the server; the grid formats, groups and aggregates it, never computes it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AllEnterpriseModule } from "ag-grid-enterprise";
import { AgChartsEnterpriseModule } from "ag-charts-enterprise";
import { enableDevValidations, themeQuartz, type CellValueChangedEvent, type ColDef, type GetRowIdParams, type GridApi, type ICellRendererParams, type RowClassRules, type CellClassRules, type ValueFormatterParams, type AutoGroupColumnDef, type CellStyle } from "ag-grid-community";
import { AgGridProvider, AgGridReact } from "ag-grid-react";
import type { CockpitLedgerRow, ReviewRow, AgentRow, ReconRow } from "@/lib/server/cockpit";

if (process.env.NODE_ENV !== "production") enableDevValidations();

// TODO(phase 7): replace AllEnterpriseModule with the fine-grained modules actually used (row grouping, set filter,
// master/detail, pivot, sparklines, side bar) to cut bundle size.
const modules = [AllEnterpriseModule.with(AgChartsEnterpriseModule)];

// DockClock brand on a dense ops grid: road-sign green accent, asphalt header (same tokens as the driver app).
const theme = themeQuartz.withParams({
  accentColor: "#00573F", headerBackgroundColor: "#2B2F33", headerTextColor: "#FFFFFF", headerFontWeight: 700,
  fontFamily: "system-ui, sans-serif", fontSize: 13, spacing: 6, rowHoverColor: "#E8F2EE", selectedRowBackgroundColor: "#D6EAE2",
  oddRowBackgroundColor: "#FAFBFA", borderColor: "#D8DDD9", wrapperBorderRadius: 10,
});

const usd = (p: ValueFormatterParams) => (typeof p.value === "number" ? p.value.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "");
const SANDBOX = "https://www.sandbox.paypal.com";

const ACTION_COLORS: Record<string, [string, string]> = {
  CAPTURE: ["#E3F3EC", "#00573F"], CAPTURE_AND_INVOICE: ["#FFF6D6", "#7A5B00"], VOID: ["#EEF0F2", "#3A3F44"], HOLD_FOR_REVIEW: ["#FDE7E5", "#8C1D15"],
};
/** Custom action-badge renderer (PLAN §7.1). */
function ActionBadge(p: ICellRendererParams<CockpitLedgerRow>) {
  if (!p.value) return null;
  const [bg, fg] = ACTION_COLORS[String(p.value)] ?? ["#EEF0F2", "#3A3F44"];
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 10px", fontWeight: 700, fontSize: 12 }}>{String(p.value).replaceAll("_", " ").toLowerCase()}</span>;
}
function SourceBadge(p: ICellRendererParams<CockpitLedgerRow>) {
  if (!p.data) return null;
  return p.data.synthetic
    ? <span title="Seeded synthetic network: not a real shipment" style={{ border: "1px dashed #7A8086", color: "#5B6167", borderRadius: 6, padding: "1px 6px", fontSize: 11 }}>synthetic</span>
    : <span style={{ background: "#00573F", color: "#fff", borderRadius: 6, padding: "1px 6px", fontSize: 11 }}>live sandbox</span>;
}
function PayPalLink(p: ICellRendererParams) {
  return p.value ? <a href={`${SANDBOX}/activity/payment/${p.value}`} target="_blank" rel="noreferrer" style={{ color: "#00573F", textDecoration: "underline" }}>{String(p.value)}</a> : null;
}

/** Row detail: the full deterministic audit trail plus every PayPal id as a link. */
function LedgerDetail(p: ICellRendererParams<CockpitLedgerRow>) {
  const r = p.data;
  if (!r) return null;
  return (
    <div style={{ padding: "12px 20px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24, fontSize: 13 }}>
      <div>
        <strong>Audit trail</strong>
        <ol style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.5 }}>{r.auditTrail.split("\n").map((a, i) => <li key={i}>{a}</li>)}</ol>
      </div>
      <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
        <strong>PayPal</strong>
        <span>Authorization: {r.paypalAuthorizationId ? <a href={`${SANDBOX}/activity/payment/${r.paypalAuthorizationId}`} target="_blank" rel="noreferrer">{r.paypalAuthorizationId}</a> : "none"}</span>
        <span>Capture: {r.paypalCaptureId ? <a href={`${SANDBOX}/activity/payment/${r.paypalCaptureId}`} target="_blank" rel="noreferrer">{r.paypalCaptureId}</a> : "none"}</span>
        {r.receiptSlug && <a href={`/r/${r.receiptSlug}`} target="_blank" rel="noreferrer">Proof-of-Wait receipt</a>}
        {r.synthetic && <em style={{ color: "#5B6167" }}>Synthetic network row: no PayPal objects exist for it.</em>}
      </div>
    </div>
  );
}

const getLedgerId = (p: GetRowIdParams<CockpitLedgerRow>) => p.data.loadId;
const getReviewId = (p: GetRowIdParams<ReviewRow>) => p.data.loadId;
const getAgentId = (p: GetRowIdParams<AgentRow>) => String(p.data.seq);
const getReconId = (p: GetRowIdParams<ReconRow>) => p.data.paypalId;

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path, { cache: "no-store" });
  const j = (await r.json()) as { data?: T; error?: { message?: string } };
  if (!r.ok || j.data === undefined) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j.data;
}

// ---------------------------------------------------------------------------------------------------

function LedgerGrid({ rows }: { rows: CockpitLedgerRow[] }) {
  const columnDefs = useMemo<ColDef<CockpitLedgerRow>[]>(() => [
    { field: "facilityName", headerName: "Facility", rowGroup: true, hide: true, filter: "agSetColumnFilter" },
    { field: "carrierName", headerName: "Carrier", rowGroup: true, hide: true, filter: "agSetColumnFilter" },
    { field: "loadId", headerName: "Load", cellRenderer: "agGroupCellRenderer", filter: "agTextColumnFilter", minWidth: 170 },
    { field: "synthetic", headerName: "Source", cellRenderer: SourceBadge, filter: "agSetColumnFilter", width: 120 },
    { field: "action", headerName: "Outcome", cellRenderer: ActionBadge, filter: "agSetColumnFilter", width: 170 },
    { field: "state", filter: "agSetColumnFilter", width: 130 },
    { field: "arrivalClass", headerName: "Arrival", filter: "agSetColumnFilter", width: 110 },
    { field: "dwellMin", headerName: "Dwell (min)", aggFunc: "avg", filter: "agNumberColumnFilter", width: 120, valueFormatter: (p) => (typeof p.value === "number" ? Math.round(p.value).toString() : "") },
    { field: "dwellTrend", headerName: "Facility dwell trend", cellRenderer: "agSparklineCellRenderer", cellRendererParams: { sparklineOptions: { type: "line", stroke: "#00573F", strokeWidth: 2 } }, sortable: false, filter: false, width: 170 },
    { field: "chargeUsd", headerName: "Owed", aggFunc: "sum", valueFormatter: usd, filter: "agNumberColumnFilter" },
    { field: "capturedUsd", headerName: "Captured", aggFunc: "sum", valueFormatter: usd, filter: "agNumberColumnFilter" },
    { field: "releasedUsd", headerName: "Released", aggFunc: "sum", valueFormatter: usd },
    { field: "carrierPayoutUsd", headerName: "Carrier paid", aggFunc: "sum", valueFormatter: usd },
    { field: "leakageUsd", headerName: "Leakage", aggFunc: "sum", valueFormatter: usd, cellStyle: (p) => (typeof p.value === "number" && p.value > 0 ? { color: "#8C1D15", fontWeight: 700 } : null) },
    { field: "paypalCaptureId", headerName: "PayPal capture", cellRenderer: PayPalLink },
  ], []);
  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, resizable: true, filter: true, minWidth: 100 }), []);
  const autoGroupColumnDef = useMemo<AutoGroupColumnDef<CockpitLedgerRow>>(() => ({ headerName: "Facility / carrier", minWidth: 260 }), []);
  return (
    <AgGridReact<CockpitLedgerRow> theme={theme} rowData={rows} columnDefs={columnDefs} defaultColDef={defaultColDef} autoGroupColumnDef={autoGroupColumnDef}
      getRowId={getLedgerId} masterDetail detailCellRenderer={LedgerDetail} detailRowAutoHeight grandTotalRow="bottom" groupDefaultExpanded={0}
      sideBar={["columns", "filters"]} rowGroupPanelShow="always" animateRows />
  );
}

// ---------------------------------------------------------------------------------------------------

const UNDO_MS = 8_000;

function ReviewGrid({ initial }: { initial: ReviewRow[] }) {
  const apiRef = useRef<GridApi<ReviewRow> | null>(null);
  const [pending, setPending] = useState<{ loadId: string; decision: "APPROVE" | "REJECT"; at: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Row whose decision is inside its undo window: live refresh must not overwrite it with the server's PENDING.
  const holdRef = useRef<string | null>(null);
  const columnDefs = useMemo<ColDef<ReviewRow>[]>(() => [
    { field: "loadId", headerName: "Load", width: 170 },
    { field: "facilityName", headerName: "Facility", filter: "agSetColumnFilter" },
    { field: "carrierName", headerName: "Carrier", filter: "agSetColumnFilter" },
    { field: "state", width: 140, cellStyle: (p): CellStyle | null => (p.value === "PAID_OUT" ? { color: "#00573F", fontWeight: 700 } : p.value === "VOIDED" ? { color: "#5B6167" } : null) },
    { field: "holdUsd", headerName: "Hold", valueFormatter: usd, width: 110 },
    { field: "decision", headerName: "Decision (edit)", editable: (p) => p.data?.state === "NEEDS_REVIEW", cellEditor: "agSelectCellEditor",
      cellEditorParams: { values: ["PENDING", "APPROVE", "REJECT"] }, width: 160,
      cellStyle: (p) => (p.data?.state === "NEEDS_REVIEW" ? { background: "#FFF6D6", fontWeight: 700 } : null) },
    { field: "flags", headerName: "Why held", flex: 2, tooltip: (p) => p.data?.audit ?? "" },
    { field: "captureId", headerName: "Capture", cellRenderer: PayPalLink },
    { field: "payoutBatchId", headerName: "Payout batch" },
  ], []);

  const refresh = useCallback(async () => {
    const rows = await getJson<ReviewRow[]>("/api/cockpit/review");
    const api = apiRef.current;
    if (!api) return;
    // Live row update via transactions: update known rows, add new ones (getRowId keeps identity).
    const known = new Set<string>(); api.forEachNode((n) => { if (n.data) known.add(n.data.loadId); });
    const fresh = rows.filter((r) => r.loadId !== holdRef.current);
    api.applyTransactionAsync({ update: fresh.filter((r) => known.has(r.loadId)), add: fresh.filter((r) => !known.has(r.loadId)) });
  }, []);
  // Poll while money is in flight (capture -> webhook -> payout), so the row turns PAID_OUT without a reload.
  useEffect(() => { const t = setInterval(() => { void refresh().catch(() => {}); }, 4_000); return () => clearInterval(t); }, [refresh]);

  const commit = useCallback(async (loadId: string, decision: "APPROVE" | "REJECT") => {
    setPending(null);
    holdRef.current = null;
    try {
      const r = await fetch(`/api/cockpit/review/${encodeURIComponent(loadId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      const j = (await r.json()) as { data?: { row: ReviewRow; steps: { do: string; status: string; debugId: string | null; paypalId: string | null }[] }; error?: { message?: string; debugId?: string } };
      if (!r.ok || !j.data) throw new Error(`${j.error?.message ?? r.status}${j.error?.debugId ? ` (debug_id ${j.error.debugId})` : ""}`);
      const d = j.data;
      apiRef.current?.applyTransaction({ update: [d.row] });
      setLog((l) => [`${loadId} ${decision}: ${d.steps.map((s) => `${s.do} ${s.status}${s.paypalId ? ` ${s.paypalId}` : ""}${s.debugId ? ` debug_id ${s.debugId}` : ""}`).join(", ")}`, ...l].slice(0, 6));
    } catch (e) {
      setLog((l) => [`${loadId} ${decision} failed: ${(e as Error).message}`, ...l].slice(0, 6));
      void refresh().catch(() => {});
    }
  }, [refresh]);

  const onCellValueChanged = useCallback((e: CellValueChangedEvent<ReviewRow>) => {
    if (e.colDef.field !== "decision" || !e.data || (e.newValue !== "APPROVE" && e.newValue !== "REJECT")) return;
    const loadId = e.data.loadId, decision = e.newValue as "APPROVE" | "REJECT";
    // Undo window before any money moves: the POST only fires after UNDO_MS.
    if (timer.current) clearTimeout(timer.current);
    holdRef.current = loadId;
    setPending({ loadId, decision, at: Date.now() });
    timer.current = setTimeout(() => void commit(loadId, decision), UNDO_MS);
  }, [commit]);

  const undo = () => {
    if (timer.current) clearTimeout(timer.current);
    holdRef.current = null;
    if (pending) apiRef.current?.getRowNode(pending.loadId)?.setDataValue("decision", "PENDING");
    setPending(null);
  };
  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, resizable: true, filter: true, minWidth: 100 }), []);

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr auto", gap: 8, height: "100%" }}>
      <div style={{ minHeight: 40, display: "flex", alignItems: "center", gap: 12 }}>
        {pending ? (
          <div role="status" style={{ background: "#FFF6D6", border: "1px solid #E5C54A", borderRadius: 8, padding: "6px 12px", display: "flex", gap: 12, alignItems: "center" }}>
            <span><strong>{pending.decision === "APPROVE" ? "Capturing" : "Voiding"}</strong> {pending.loadId} in {Math.ceil(UNDO_MS / 1000)} s. Money has not moved yet.</span>
            <button onClick={undo} style={{ fontWeight: 700, border: "2px solid #2B2F33", borderRadius: 6, padding: "2px 12px", background: "#fff" }}>Undo</button>
          </div>
        ) : <span style={{ color: "#5B6167" }}>Set Decision to APPROVE to capture from the PayPal hold, or REJECT to void it. You get {UNDO_MS / 1000} s to undo.</span>}
      </div>
      <AgGridReact<ReviewRow> theme={theme} rowData={initial} columnDefs={columnDefs} defaultColDef={defaultColDef} getRowId={getReviewId}
        onGridReady={(e) => { apiRef.current = e.api; }} onCellValueChanged={onCellValueChanged} singleClickEdit stopEditingWhenCellsLoseFocus
        overlayNoRowsTemplate="No loads waiting for review. Loads with paper-only evidence land here." />
      {log.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#3A3F44" }}>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------

const agentRowClass: RowClassRules<AgentRow> = { "dc-blocked": (p) => p.data?.verdict === "BLOCKED", "dc-escalated": (p) => p.data?.verdict === "ESCALATED" };

function HashCell(p: ICellRendererParams<AgentRow>) {
  if (!p.data) return null;
  return <span title={`hash ${p.data.hash}\nprev ${p.data.prevHash}`} style={{ fontFamily: "ui-monospace, monospace" }}>{p.data.chainOk ? "✓" : "✗"} {p.data.hash.slice(0, 12)}…</span>;
}

function AgentGrid({ initial }: { initial: AgentRow[] }) {
  const apiRef = useRef<GridApi<AgentRow> | null>(null);
  const [check, setCheck] = useState("");
  const columnDefs = useMemo<ColDef<AgentRow>[]>(() => [
    { field: "agent", rowGroup: true, hide: true, filter: "agSetColumnFilter" },
    { field: "seq", width: 90, sort: "desc" },
    { field: "action", filter: "agSetColumnFilter", width: 150 },
    { field: "verdict", filter: "agSetColumnFilter", width: 120 },
    { field: "cents", headerName: "Amount", valueFormatter: (p) => (typeof p.value === "number" ? (p.value / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }) : ""), aggFunc: "sum", width: 120 },
    { field: "reasons", headerName: "Blocked reasons", flex: 2, filter: "agTextColumnFilter", tooltip: (p) => p.data?.reasons ?? "" },
    { field: "mandateId", headerName: "Mandate", filter: "agSetColumnFilter", width: 130 },
    { field: "offerId", headerName: "Offer", width: 130 },
    { field: "source", headerName: "Decided by", filter: "agSetColumnFilter", width: 120 },
    { field: "hash", headerName: "Hash (verify)", cellRenderer: HashCell, width: 190 },
    { field: "createdAt", headerName: "At", width: 190 },
  ], []);
  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, resizable: true, filter: true, minWidth: 90 }), []);
  const autoGroupColumnDef = useMemo<AutoGroupColumnDef<AgentRow>>(() => ({ headerName: "Agent", minWidth: 200 }), []);
  const verify = async () => {
    setCheck("Verifying…");
    try {
      const c = await getJson<{ ok: boolean; rows: number; brokenAtSeq: number | null; reason: string | null; headHash: string }>("/api/agents/verify");
      setCheck(c.ok ? `Chain intact: ${c.rows} rows, head ${c.headHash.slice(0, 16)}…` : `Chain broken at seq ${c.brokenAtSeq}: ${c.reason}`);
      apiRef.current?.setGridOption("rowData", await getJson<AgentRow[]>("/api/cockpit/agents"));
    } catch (e) { setCheck(`Verify failed: ${(e as Error).message}`); }
  };
  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: 8, height: "100%" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={verify} style={btn}>Verify hash chain</button>
        <span role="status">{check}</span>
      </div>
      <AgGridReact<AgentRow> theme={theme} rowData={initial} columnDefs={columnDefs} defaultColDef={defaultColDef} autoGroupColumnDef={autoGroupColumnDef}
        getRowId={getAgentId} rowClassRules={agentRowClass} groupDefaultExpanded={1} onGridReady={(e) => { apiRef.current = e.api; }} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------

const reconCell: CellClassRules<ReconRow> = { "dc-mismatch": (p) => p.data?.status === "AMOUNT_DIFF" || p.data?.status === "MISSING_IN_PAYPAL", "dc-lag": (p) => p.data?.status === "PENDING_SEARCH_LAG" };

function ReconGrid() {
  const [rows, setRows] = useState<ReconRow[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => { setErr(""); try { setRows(await getJson<ReconRow[]>("/api/cockpit/recon")); } catch (e) { setErr((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  const columnDefs = useMemo<ColDef<ReconRow>[]>(() => [
    { field: "status", filter: "agSetColumnFilter", cellClassRules: reconCell, width: 190 },
    { field: "loadId", headerName: "Load", width: 170 },
    { field: "operation", filter: "agSetColumnFilter", width: 140 },
    { field: "paypalId", headerName: "PayPal transaction", cellRenderer: PayPalLink, width: 200 },
    { field: "ledgerUsd", headerName: "DockClock ledger", valueFormatter: usd, cellClassRules: reconCell },
    { field: "paypalUsd", headerName: "PayPal Transaction Search", valueFormatter: usd, cellClassRules: reconCell },
    { field: "at", headerName: "Captured at", width: 200 },
    { field: "debugId", headerName: "debug_id", width: 150 },
  ], []);
  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, resizable: true, filter: true, minWidth: 100 }), []);
  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: 8, height: "100%" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={load} style={btn}>Re-run against PayPal</button>
        <span role="status">{err ? `PayPal Transaction Search failed: ${err}` : rows ? `${rows.length} captures compared. Search can lag PayPal by up to 3 h.` : "Comparing with PayPal…"}</span>
      </div>
      <AgGridReact<ReconRow> theme={theme} rowData={rows ?? undefined} columnDefs={columnDefs} defaultColDef={defaultColDef} getRowId={getReconId} loading={rows === null && !err} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------

/** Pivot mode: facility × week, captured vs claimed (leakage). */
function PivotGrid({ rows }: { rows: CockpitLedgerRow[] }) {
  const columnDefs = useMemo<ColDef<CockpitLedgerRow>[]>(() => [
    { field: "facilityName", headerName: "Facility", rowGroup: true, enableRowGroup: true },
    { field: "week", pivot: true, enablePivot: true },
    { field: "synthetic", headerName: "Synthetic", enableRowGroup: true, enablePivot: true, filter: "agSetColumnFilter" },
    { field: "capturedUsd", headerName: "Captured", aggFunc: "sum", enableValue: true, valueFormatter: usd },
    { field: "claimedUsd", headerName: "Claimed", aggFunc: "sum", enableValue: true, valueFormatter: usd },
    { field: "leakageUsd", headerName: "Leakage", aggFunc: "sum", enableValue: true, valueFormatter: usd },
  ], []);
  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, resizable: true, filter: true, minWidth: 120 }), []);
  const autoGroupColumnDef = useMemo<AutoGroupColumnDef<CockpitLedgerRow>>(() => ({ headerName: "Facility", minWidth: 240, pinned: "left" }), []);
  return <AgGridReact<CockpitLedgerRow> theme={theme} rowData={rows} columnDefs={columnDefs} defaultColDef={defaultColDef} autoGroupColumnDef={autoGroupColumnDef}
    getRowId={getLedgerId} pivotMode sideBar={["columns", "filters"]} grandTotalRow="bottom" />;
}

// ---------------------------------------------------------------------------------------------------

const btn: React.CSSProperties = { fontWeight: 700, background: "#00573F", color: "#fff", border: 0, borderRadius: 8, padding: "8px 14px", cursor: "pointer" };
const TABS = [["ledger", "Settlement ledger"], ["review", "Review queue"], ["agents", "Agent actions"], ["recon", "Reconciliation"], ["pivot", "Leakage pivot"]] as const;
type Tab = (typeof TABS)[number][0];

export function Cockpit({ ledger, review, agents, licenseKey }: { ledger: CockpitLedgerRow[]; review: ReviewRow[]; agents: AgentRow[]; licenseKey?: string }) {
  const [tab, setTab] = useState<Tab>("ledger");
  const live = ledger.filter((r) => !r.synthetic).length;
  const waiting = review.filter((r) => r.state === "NEEDS_REVIEW").length;
  return (
    <AgGridProvider modules={modules} licenseKey={licenseKey}>
      <style>{`.dc-blocked{background:#FDE7E5!important;color:#8C1D15}.dc-escalated{background:#FFF6D6!important}.dc-mismatch{background:#FDE7E5;color:#8C1D15;font-weight:700}.dc-lag{background:#FFF6D6}`}</style>
      <main style={{ display: "grid", gridTemplateRows: "auto auto 1fr", height: "100dvh", padding: 16, gap: 12, background: "#F2F4F3" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 20 }}>DockClock cockpit</strong>
          <span style={{ border: "1px dashed #7A8086", borderRadius: 6, padding: "2px 8px", fontSize: 12, color: "#3A3F44" }} title="Seeded loads are synthetic and badged in every grid">
            Synthetic network: {ledger.length - live} seeded loads, {live} live sandbox loads
          </span>
          <a href="/dashboard" style={{ marginLeft: "auto", color: "#00573F", fontWeight: 700 }}>AG Studio dashboard</a>
          <a href="/verify" style={{ color: "#00573F", fontWeight: 700 }}>Ledger verify</a>
        </header>
        <nav role="tablist" aria-label="Cockpit grids" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              style={{ padding: "8px 14px", borderRadius: 8, border: "2px solid #2B2F33", background: tab === id ? "#2B2F33" : "#fff", color: tab === id ? "#fff" : "#2B2F33", fontWeight: 700, cursor: "pointer", minHeight: 40 }}>
              {label}{id === "review" && waiting ? ` (${waiting})` : ""}
            </button>
          ))}
        </nav>
        <section role="tabpanel" style={{ minHeight: 0 }}>
          {tab === "ledger" && <LedgerGrid rows={ledger} />}
          {tab === "review" && <ReviewGrid initial={review} />}
          {tab === "agents" && <AgentGrid initial={agents} />}
          {tab === "recon" && <ReconGrid />}
          {tab === "pivot" && <PivotGrid rows={ledger} />}
        </section>
      </main>
    </AgGridProvider>
  );
}
