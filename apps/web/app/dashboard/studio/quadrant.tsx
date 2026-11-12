'use client';
// Custom AG Studio widget (PLAN §7.1): facility quadrant, X = average dwell, Y = recovery rate, bubble = captured $,
// split at the network medians with the four quadrant labels. It needs no field mapping: Studio passes the facility
// scorecard through its `context` property, so the widget always shows the engine's scorecard.
import type { AgCustomWidgetDefinition, AgDefaultRegistry, AgWidgetParams } from 'ag-studio';
import type { StudioFacilityRow } from '@/lib/studio-data';

export interface QuadrantContext { facilities: StudioFacilityRow[] }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
const usd = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const COLORS: Record<string, string> = { FAST_AND_FAIR: '#00573F', SLOW_BUT_PAYS: '#4F8A74', FAST_BUT_DISPUTES: '#C9A400', REVENUE_LEAK: '#B3261E' };

export function FacilityQuadrant(params: AgWidgetParams) {
  const rows = (params.context as QuadrantContext | undefined)?.facilities ?? [];
  if (!rows.length) return <div style={{ padding: 16, color: '#5B6167' }}>No facilities yet.</div>;
  const W = 520, H = 320, P = 44;
  const xs = rows.map((r) => r.avgDwellMin), ys = rows.map((r) => r.recoveryRate), caps = rows.map((r) => r.capturedUsd);
  const x0 = Math.min(...xs) * 0.9, x1 = Math.max(...xs) * 1.1, y0 = Math.max(0, Math.min(...ys) - 0.05), y1 = Math.min(1.05, Math.max(...ys) + 0.05);
  const sx = (v: number) => P + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * P);
  const sy = (v: number) => H - P - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * P);
  const rMax = Math.max(...caps) || 1, r = (v: number) => 6 + 18 * Math.sqrt(v / rMax);
  const mx = sx(median(xs)), my = sy(median(ys));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Facility quadrant: average dwell against recovery rate" style={{ width: '100%', height: '100%' }}>
      <line x1={mx} y1={P / 2} x2={mx} y2={H - P} stroke="#8A8F94" strokeDasharray="4 4" />
      <line x1={P} y1={my} x2={W - P / 2} y2={my} stroke="#8A8F94" strokeDasharray="4 4" />
      <text x={P + 4} y={P / 2 + 12} fontSize={12} fill="#00573F" fontWeight={700}>Fast and fair</text>
      <text x={W - P / 2 - 4} y={P / 2 + 12} fontSize={12} fill="#4F8A74" fontWeight={700} textAnchor="end">Slow but pays</text>
      <text x={P + 4} y={H - P - 6} fontSize={12} fill="#7A5B00" fontWeight={700}>Fast but disputes</text>
      <text x={W - P / 2 - 4} y={H - P - 6} fontSize={12} fill="#B3261E" fontWeight={700} textAnchor="end">Revenue leak</text>
      <text x={W / 2} y={H - 8} fontSize={12} fill="#5B6167" textAnchor="middle">Average dwell (min)</text>
      <text x={12} y={H / 2} fontSize={12} fill="#5B6167" textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>Recovery rate</text>
      {rows.map((f) => (
        <g key={f.facilityId}>
          <circle cx={sx(f.avgDwellMin)} cy={sy(f.recoveryRate)} r={r(f.capturedUsd)} fill={COLORS[f.quadrant] ?? '#5B6167'} fillOpacity={0.75} stroke="#fff" strokeWidth={1.5}>
            <title>{`${f.facilityName}: ${f.avgDwellMin} min avg dwell, ${(f.recoveryRate * 100).toFixed(0)}% recovered, ${usd(f.capturedUsd)} captured, ${usd(f.leakageUsd)} leaked (${f.quadrantLabel})`}</title>
          </circle>
          <text x={sx(f.avgDwellMin)} y={sy(f.recoveryRate) - r(f.capturedUsd) - 3} fontSize={10} fill="#1F2326" textAnchor="middle">{f.facilityName.split(' ')[0]}</text>
        </g>
      ))}
    </svg>
  );
}

// shortcut: the definition is cast because the widget has no field slots and only Studio's default format form;
// a typed custom registry is only worth it once the widget gains mapped fields.
export const facilityQuadrantWidget = {
  id: 'facilityQuadrant',
  label: 'Facility quadrant',
  dataMapping: {},
  form: (params: { createDefaults: (o: { dataMappingItems: unknown[] }) => unknown }) => params.createDefaults({ dataMappingItems: [] }),
  comp: FacilityQuadrant,
  defaultSize: { width: 520, height: 340 },
  minSize: { width: 320, height: 220 },
  ai: { description: 'Facility quadrant of average dwell (x) against recovery rate (y), bubble size = captured dollars, labelled Fast and fair, Slow but pays, Fast but disputes, Revenue leak. Needs no fields.' },
} as unknown as AgCustomWidgetDefinition<AgDefaultRegistry>;
