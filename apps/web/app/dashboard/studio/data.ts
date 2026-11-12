// AG Studio data sources for the DockClock dashboard. Every field carries a description: Studio's agents read them
// to answer natural-language questions ("Which facilities leak the most money this month?").
import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat } from 'ag-studio';
import type { StudioData } from '@/lib/studio-data';

type FieldSpec = [id: string, name: string, format: AgFormat, description: string];
const fields = (specs: FieldSpec[]): AgFieldDefinition[] => specs.map(([id, name, format, description]) => ({ id, name, format, description }));

export const hasData = (data: StudioData) => data.ledger.length > 0;

export function buildStudioData(data: StudioData): AgDataSourcesDefinition {
  return {
    sources: [
      {
        id: 'ledger',
        name: 'Settlement ledger',
        description: 'One row per truck stop at a dock: detention owed, captured from the shipper PayPal hold, paid to the carrier, and leakage. Seeded rows have source Synthetic.',
        data: data.ledger,
        fields: fields([
          ['loadId', 'Load', 'textFormat', 'Unique load (stop) identifier'],
          ['facilityId', 'Facility id', 'textFormat', 'Warehouse or terminal id where the truck waited'],
          ['facilityName', 'Facility', 'textFormat', 'Warehouse or terminal name where the truck waited'],
          ['carrierName', 'Carrier', 'textFormat', 'Trucking company that hauled the load'],
          ['appointment', 'Appointment', 'dateTimeFormat', 'Scheduled dock appointment (UTC). Use for "this month" questions.'],
          ['week', 'Week', 'textFormat', 'ISO week of the appointment, e.g. 2026-W46'],
          ['arrivalClass', 'Arrival', 'textFormat', 'EARLY, ON_TIME or LATE against appointment plus grace'],
          ['action', 'Outcome', 'textFormat', 'Settlement outcome on PayPal: VOID, CAPTURE, CAPTURE_AND_INVOICE or HOLD_FOR_REVIEW'],
          ['state', 'State', 'textFormat', 'Load state machine state, e.g. PAID_OUT, NEEDS_REVIEW'],
          ['source', 'Source', 'textFormat', 'Synthetic for the seeded network, Live sandbox for real PayPal sandbox loads'],
          ['needsReview', 'Needs review', 'booleanFormat', 'True when evidence was too weak to move money automatically'],
          ['dwellMin', 'Dwell (min)', 'integerFormat', 'Minutes on site counted by the detention clock'],
          ['billableMin', 'Billable (min)', 'integerFormat', 'Minutes billed after free time, carrier delays and closed hours'],
          ['chargeUsd', 'Owed', 'currencyFormat', 'Total owed by the shipper (detention plus shipper line items), USD'],
          ['capturedUsd', 'Captured', 'currencyFormat', 'Captured from the shipper PayPal authorization hold, USD'],
          ['releasedUsd', 'Released', 'currencyFormat', 'Uncaptured hold released back to the shipper, USD'],
          ['invoicedUsd', 'Invoiced', 'currencyFormat', 'Billed by PayPal invoice above the capture ceiling, USD'],
          ['carrierPayoutUsd', 'Carrier paid', 'currencyFormat', 'Paid to the carrier via PayPal Payouts, USD'],
          ['claimedUsd', 'Claimed', 'currencyFormat', 'What the carrier claims on paper, USD'],
          ['leakageUsd', 'Leakage', 'currencyFormat', 'Money the carrier claims but could not be captured with evidence (claimed minus captured, floor 0), USD. "Leaks money" means this field.'],
        ]),
      },
      {
        id: 'facilities',
        name: 'Facility scorecard',
        description: 'One row per facility: average dwell against recovery rate, with captured dollars and its quadrant.',
        data: data.facilities,
        fields: fields([
          ['facilityId', 'Facility id', 'textFormat', 'Warehouse or terminal id'],
          ['facilityName', 'Facility', 'textFormat', 'Warehouse or terminal name'],
          ['loads', 'Loads', 'integerFormat', 'Number of stops at the facility'],
          ['avgDwellMin', 'Average dwell (min)', 'integerFormat', 'Average minutes on site'],
          ['detentionRate', 'Detention rate', 'percentageFormat', 'Share of stops that ran into billable detention'],
          ['recoveryRate', 'Recovery rate', 'percentageFormat', 'Captured divided by owed or claimed, whichever is larger'],
          ['capturedUsd', 'Captured', 'currencyFormat', 'Total captured from PayPal holds at the facility, USD'],
          ['leakageUsd', 'Leakage', 'currencyFormat', 'Total leakage at the facility, USD'],
          ['quadrant', 'Quadrant id', 'textFormat', 'FAST_AND_FAIR, SLOW_BUT_PAYS, FAST_BUT_DISPUTES or REVENUE_LEAK (network-median split)'],
          ['quadrantLabel', 'Quadrant', 'textFormat', 'Readable quadrant name'],
        ]),
      },
      {
        id: 'agentActions',
        name: 'Agent actions',
        description: 'Hash-chained log of every AI agent move: proposals, accepts, executions, and what the mandate guard BLOCKED or ESCALATED, with the reason.',
        data: data.agentActions,
        fields: fields([
          ['seq', 'Sequence', 'integerFormat', 'Position in the hash chain'],
          ['agent', 'Agent', 'textFormat', 'FACILITY, CARRIER or SHIPPER_TREASURY'],
          ['action', 'Action', 'textFormat', 'PROPOSE, ACCEPT, EXECUTE, PAY, RECEIPT or a carrier decision'],
          ['verdict', 'Verdict', 'textFormat', 'ALLOWED, BLOCKED or ESCALATED by the mandate guard'],
          ['reason', 'Reason', 'textFormat', 'First reason the guard gave (none when allowed). Use for "blocked agent actions by reason".'],
          ['amountUsd', 'Amount', 'currencyFormat', 'Engine-priced amount the action concerned, USD'],
          ['mandateId', 'Mandate', 'textFormat', 'Spending mandate that was checked'],
          ['createdAt', 'At', 'dateTimeFormat', 'When the action was logged (UTC)'],
        ]),
      },
    ],
  };
}
