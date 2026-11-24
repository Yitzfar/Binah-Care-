import type {
  BtCompensation,
  BtPayout,
  ContractCompany,
  PartnerPayment,
  TherapySession,
} from '../types/binah';
import { getTodayEtIso } from './timeEt';

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  let str = String(value);
  // Neutralize spreadsheet formula injection on string cells
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvContent(
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>
): string {
  const headerLine = headers.map((h) => escapeCsvCell(h)).join(',');
  const bodyLines = rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(','));
  // Prepend UTF-8 BOM for Excel & QuickBooks/Xero compatibility with אידיש/Hebrew text
  return '\uFEFF' + [headerLine, ...bodyLines].join('\r\n');
}

export function downloadCsvFile(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isWithinEtDateRange(dateEt: string, fromEt?: string, toEt?: string): boolean {
  if (!dateEt) return true;
  if (fromEt && dateEt < fromEt) return false;
  if (toEt && dateEt > toEt) return false;
  return true;
}

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

export interface CsvExportFilter {
  dateFromEt?: string;
  dateToEt?: string;
}

export function exportPartnerSummaryCsv(params: {
  contractCompanies: ContractCompany[];
  sessions: TherapySession[];
  partnerPayments: PartnerPayment[];
  btCompensation: BtCompensation[];
  filter?: CsvExportFilter;
}): { filename: string; rowCount: number } {
  const { contractCompanies, sessions, partnerPayments, btCompensation, filter } = params;
  const compRateMap = new Map(btCompensation.map((b) => [b.staffId, b.hourlyPayRate]));

  const filteredSessions = sessions.filter((s) =>
    isWithinEtDateRange(s.dateEt, filter?.dateFromEt, filter?.dateToEt)
  );
  const filteredPayments = partnerPayments.filter((p) =>
    isWithinEtDateRange(p.paymentDateEt, filter?.dateFromEt, filter?.dateToEt)
  );

  let grandScheduled = 0;
  let grandBillable = 0;
  let grandBilled = 0;
  let grandReceived = 0;
  let grandBtCost = 0;
  let grandProfit = 0;

  const rows: Array<Array<string | number | boolean>> = contractCompanies.map((comp) => {
    let scheduled = 0;
    let billable = 0;
    let billed = 0;
    let btCost = 0;

    for (const s of filteredSessions) {
      if (s.contractCompanyId !== comp.companyId) continue;
      if (s.status !== 'cancelled') {
        scheduled += s.scheduledHours || 0;
      }
      if (s.status === 'approved_billable') {
        const hrs = s.approvedBillableHours || 0;
        const btRate = compRateMap.get(s.btId) ?? comp.defaultBtPayPerHour;
        billable += hrs;
        billed += hrs * comp.billingRatePerHour;
        btCost += hrs * btRate;
      }
    }

    const received = filteredPayments
      .filter((p) => p.contractCompanyId === comp.companyId && p.status === 'received')
      .reduce((acc, p) => acc + (p.amount || 0), 0);

    const profit = billed - btCost;

    grandScheduled += scheduled;
    grandBillable += billable;
    grandBilled += billed;
    grandReceived += received;
    grandBtCost += btCost;
    grandProfit += profit;

    return [
      comp.companyId,
      comp.name,
      comp.paymentTerms || '',
      round2(comp.billingRatePerHour),
      round2(comp.defaultBtPayPerHour),
      round2(scheduled),
      round2(billable),
      round2(billed),
      round2(received),
      round2(btCost),
      round2(profit),
      comp.active ? 'Active' : 'Inactive',
    ];
  });

  rows.push([
    'TOTAL',
    'All Contract Companies',
    '',
    '',
    '',
    round2(grandScheduled),
    round2(grandBillable),
    round2(grandBilled),
    round2(grandReceived),
    round2(grandBtCost),
    round2(grandProfit),
    '',
  ]);

  const headers = [
    'Company ID',
    'Partner Company',
    'Payment Terms',
    'Bill Rate (USD/hr)',
    'Default BT Pay (USD/hr)',
    'Scheduled Hours',
    'Approved Billable Hours',
    'Accrued Gross Billed (USD)',
    'Payments Received (USD)',
    'Accrued BT Cost (USD)',
    'Net Margin (USD)',
    'Status',
  ];

  const filename = `binah-care-partner-summary-${getTodayEtIso()}.csv`;
  downloadCsvFile(filename, buildCsvContent(headers, rows));
  return { filename, rowCount: contractCompanies.length };
}

export function exportPartnerPaymentsCsv(params: {
  partnerPayments: PartnerPayment[];
  filter?: CsvExportFilter;
}): { filename: string; rowCount: number } {
  const { partnerPayments, filter } = params;
  const filtered = partnerPayments
    .filter((p) => isWithinEtDateRange(p.paymentDateEt, filter?.dateFromEt, filter?.dateToEt))
    .slice()
    .sort((a, b) => a.paymentDateEt.localeCompare(b.paymentDateEt));

  const rows = filtered.map((p) => [
    p.paymentId,
    p.paymentDateEt,
    p.contractCompanyName,
    p.contractCompanyId,
    p.periodLabel || '',
    p.referenceNumber || '',
    round2(p.amount || 0),
    p.status,
    p.notes || '',
  ]);

  const headers = [
    'Payment ID',
    'Payment Date (ET)',
    'Partner Company',
    'Company ID',
    'Billing Period',
    'Reference Number',
    'Amount (USD)',
    'Status',
    'Notes',
  ];

  const filename = `binah-care-partner-payments-${getTodayEtIso()}.csv`;
  downloadCsvFile(filename, buildCsvContent(headers, rows));
  return { filename, rowCount: filtered.length };
}

export function exportBtPayoutsCsv(params: {
  btPayouts: BtPayout[];
  filter?: CsvExportFilter;
}): { filename: string; rowCount: number } {
  const { btPayouts, filter } = params;
  const filtered = btPayouts
    .filter((p) => isWithinEtDateRange(p.paymentDateEt, filter?.dateFromEt, filter?.dateToEt))
    .slice()
    .sort((a, b) => a.paymentDateEt.localeCompare(b.paymentDateEt));

  const rows = filtered.map((bp) => [
    bp.payoutId,
    bp.paymentDateEt,
    bp.btName,
    bp.btId,
    bp.periodLabel || '',
    round2(bp.hoursPaid || 0),
    round2(bp.hourlyRate || 0),
    round2(bp.totalAmount || 0),
    bp.status,
    bp.notes || '',
  ]);

  const headers = [
    'Payout ID',
    'Payment Date (ET)',
    'Behavior Technician',
    'BT ID',
    'Pay Period',
    'Hours Paid',
    'Hourly Rate (USD/hr)',
    'Total Payout (USD)',
    'Status',
    'Notes',
  ];

  const filename = `binah-care-bt-payouts-${getTodayEtIso()}.csv`;
  downloadCsvFile(filename, buildCsvContent(headers, rows));
  return { filename, rowCount: filtered.length };
}

export function exportBillableSessionsCsv(params: {
  sessions: TherapySession[];
  contractCompanies: ContractCompany[];
  btCompensation: BtCompensation[];
  filter?: CsvExportFilter;
}): { filename: string; rowCount: number } {
  const { sessions, contractCompanies, btCompensation, filter } = params;
  const companyMap = new Map(contractCompanies.map((c) => [c.companyId, c]));
  const compRateMap = new Map(btCompensation.map((b) => [b.staffId, b.hourlyPayRate]));

  const filtered = sessions
    .filter((s) => isWithinEtDateRange(s.dateEt, filter?.dateFromEt, filter?.dateToEt))
    .slice()
    .sort((a, b) => a.dateEt.localeCompare(b.dateEt));

  const rows = filtered.map((s) => {
    const comp = s.contractCompanyId ? companyMap.get(s.contractCompanyId) : undefined;
    const billRate = comp?.billingRatePerHour ?? 84;
    const btRate = compRateMap.get(s.btId) ?? comp?.defaultBtPayPerHour ?? 34;
    const billableHrs = s.status === 'approved_billable' ? s.approvedBillableHours || 0 : 0;
    const grossRev = billableHrs * billRate;
    const btCost = billableHrs * btRate;
    const margin = grossRev - btCost;

    return [
      s.sessionId,
      s.dateEt,
      s.startTimeEt,
      s.endTimeEt,
      s.clientName || s.clientId,
      s.contractCompanyName || '',
      s.btName || s.btId,
      s.status,
      round2(s.scheduledHours || 0),
      round2(s.approvedBillableHours || 0),
      round2(billRate),
      round2(grossRev),
      round2(btRate),
      round2(btCost),
      round2(margin),
      s.notes || '',
    ];
  });

  const headers = [
    'Session ID',
    'Date (ET)',
    'Start Time (ET)',
    'End Time (ET)',
    'Client',
    'Partner Company',
    'Behavior Technician',
    'Status',
    'Scheduled Hours',
    'Approved Billable Hours',
    'Partner Bill Rate (USD/hr)',
    'Gross Billed (USD)',
    'BT Pay Rate (USD/hr)',
    'BT Cost (USD)',
    'Net Margin (USD)',
    'Notes',
  ];

  const filename = `binah-care-sessions-accounting-${getTodayEtIso()}.csv`;
  downloadCsvFile(filename, buildCsvContent(headers, rows));
  return { filename, rowCount: filtered.length };
}
