// The built-in DockClock report as AG Studio state: a network page (KPIs, leakage by facility, the facility quadrant
// custom widget, a ledger grid) and an agents page (blocked actions by reason). Field ids are 'source.field' (./data.ts).
import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const count = (id: string) => ({ id, aggregation: 'count' as const });
const kpi = (text: string, value: { id: string; aggregation?: 'sum' | 'avg' | 'count' }) => ({ type: 'value' as const, dataMapping: { value: [value] }, format: title(text) });

const network: AgPageState = {
  id: 'network',
  widgets: {
    'kpi-captured': kpi('Captured from PayPal holds', sum('ledger.capturedUsd')),
    'kpi-paid': kpi('Paid to carriers', sum('ledger.carrierPayoutUsd')),
    'kpi-leak': kpi('Leakage', sum('ledger.leakageUsd')),
    'kpi-loads': kpi('Stops', count('ledger.loadId')),
    'leak-by-facility': {
      type: 'bar-chart-grouped',
      dataMapping: { categoryKey: [{ id: 'ledger.facilityName' }], valueKey: [sum('ledger.leakageUsd'), sum('ledger.capturedUsd')] },
      sort: [{ field: sum('ledger.leakageUsd'), direction: 'desc' }],
      format: title('Leakage vs captured by facility'),
    },
    // Custom widget type (./quadrant.tsx): not in the default registry union, so cast.
    quadrant: { type: 'facilityQuadrant', dataMapping: {}, format: title('Facility quadrant: dwell vs recovery (bubble = captured $)') } as never,
    ledger: {
      type: 'grid',
      dataMapping: { cols: [{ id: 'ledger.facilityName' }, { id: 'ledger.source' }, sum('ledger.capturedUsd'), sum('ledger.claimedUsd'), sum('ledger.leakageUsd')] },
      sort: [{ field: sum('ledger.leakageUsd'), direction: 'desc' }],
      format: title('Ledger by facility'),
    },
  },
  widgetLayout: {
    'kpi-captured': at(0, 0, 6, 7), 'kpi-paid': at(6, 0, 6, 7), 'kpi-leak': at(12, 0, 6, 7), 'kpi-loads': at(18, 0, 6, 7),
    'leak-by-facility': at(0, 7, 12, 22), quadrant: at(12, 7, 12, 22), ledger: at(0, 29, 24, 20),
  },
};

const agents: AgPageState = {
  id: 'agents',
  widgets: {
    'kpi-actions': kpi('Agent actions logged', count('agentActions.seq')),
    'blocked-by-reason': {
      type: 'bar-chart-grouped',
      dataMapping: { categoryKey: [{ id: 'agentActions.reason' }], valueKey: [count('agentActions.seq')] },
      sort: [{ field: count('agentActions.seq'), direction: 'desc' }],
      format: title('Agent actions by guard reason'),
    },
    'by-verdict': {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'agentActions.verdict' }], valueKey: [count('agentActions.seq')] },
      format: title('Verdicts'),
    },
    actions: {
      type: 'grid',
      dataMapping: { cols: [{ id: 'agentActions.seq' }, { id: 'agentActions.agent' }, { id: 'agentActions.action' }, { id: 'agentActions.verdict' }, { id: 'agentActions.reason' }, { id: 'agentActions.amountUsd' }] },
      sort: [{ field: { id: 'agentActions.seq' }, direction: 'desc' }],
      format: title('Agent action ledger'),
    },
  },
  widgetLayout: { 'kpi-actions': at(0, 0, 8, 7), 'by-verdict': at(8, 0, 16, 18), 'blocked-by-reason': at(0, 7, 8, 22), actions: at(0, 29, 24, 20) },
};

export const dashboardReport: AgReportState = { selectedPageId: network.id, pages: [network, agents] };
