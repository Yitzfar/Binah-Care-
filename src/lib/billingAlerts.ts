import { getHoursSinceSessionEndedEt } from './timeEt';
import type {
  BillingAlert,
  BtCompensation,
  ContractCompany,
  TherapySession,
} from '../types/binah';

export const UNBILLED_ALERT_THRESHOLD_HOURS = 48;
export const PRIMARY_ADMIN_ALERT_EMAIL = 'arledigt@gmail.com';

export interface OverdueUnbilledSession {
  session: TherapySession;
  alertId: string;
  alertRecord?: BillingAlert;
  hoursOverdue: number;
  estimatedRevenue: number;
  estimatedBtCost: number;
  reason: 'completed_unbilled' | 'past_due_unverified';
}

export interface HipaaSafeEmailDigestItem {
  sessionId: string;
  clientInitials: string;
  partnerCompany: string;
  dateEt: string;
  timeRangeEt: string;
  scheduledHours: number;
  estimatedRevenue: number;
  hoursOverdue: number;
  reasonLabel: string;
}

export function getBillingAlertId(sessionId: string): string {
  return `alert_${sessionId}`;
}

export function toHipaaSafeInitials(fullName?: string): string {
  if (!fullName || !fullName.trim()) return 'Client';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase() + '.';
  return `${parts[0]} ${parts[parts.length - 1].slice(0, 1).toUpperCase()}.`;
}

export function evaluateUnbilledSessions48h(
  sessions: TherapySession[],
  contractCompanies: ContractCompany[],
  btCompensation: BtCompensation[],
  existingAlerts: BillingAlert[] = [],
  nowMs = Date.now()
): OverdueUnbilledSession[] {
  const companyMap = new Map(contractCompanies.map((c) => [c.companyId, c]));
  const compRateMap = new Map(btCompensation.map((b) => [b.staffId, b.hourlyPayRate]));
  const alertBySessionMap = new Map(existingAlerts.map((a) => [a.sessionId, a]));

  const results: OverdueUnbilledSession[] = [];

  for (const session of sessions) {
    if (session.status === 'approved_billable' || session.status === 'cancelled') {
      continue;
    }

    const hoursElapsed = getHoursSinceSessionEndedEt(session.dateEt, session.endTimeEt, nowMs);
    if (hoursElapsed === null || hoursElapsed < UNBILLED_ALERT_THRESHOLD_HOURS) {
      continue;
    }

    const comp = session.contractCompanyId
      ? companyMap.get(session.contractCompanyId)
      : undefined;
    const billRate = comp?.billingRatePerHour ?? 84;
    const btRate = compRateMap.get(session.btId) ?? comp?.defaultBtPayPerHour ?? 35;

    const scheduledHours = Number(session.scheduledHours || 0);
    const estimatedRevenue = Math.round(scheduledHours * billRate * 100) / 100;
    const estimatedBtCost = Math.round(scheduledHours * btRate * 100) / 100;

    results.push({
      session,
      alertId: getBillingAlertId(session.sessionId),
      alertRecord: alertBySessionMap.get(session.sessionId),
      hoursOverdue: hoursElapsed,
      estimatedRevenue,
      estimatedBtCost,
      reason: session.status === 'completed' ? 'completed_unbilled' : 'past_due_unverified',
    });
  }

  results.sort((a, b) => b.hoursOverdue - a.hoursOverdue);
  return results;
}

export function normalizePhoneForSms(phone?: string): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D/g, '');
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

export function buildHipaaSafeDigestPayload(
  items: OverdueUnbilledSession[],
  portalUrl?: string,
  recipientEmail = PRIMARY_ADMIN_ALERT_EMAIL,
  recipientPhone?: string
): {
  subject: string;
  textBody: string;
  smsBody: string;
  mailtoUrl: string;
  smsUri: string;
  digestItems: HipaaSafeEmailDigestItem[];
} {
  const digestItems: HipaaSafeEmailDigestItem[] = items.map((item) => ({
    sessionId: item.session.sessionId,
    clientInitials: toHipaaSafeInitials(item.session.clientName),
    partnerCompany: item.session.contractCompanyName || 'Partner Pending',
    dateEt: item.session.dateEt,
    timeRangeEt: `${item.session.startTimeEt} - ${item.session.endTimeEt}`,
    scheduledHours: item.session.scheduledHours,
    estimatedRevenue: item.estimatedRevenue,
    hoursOverdue: item.hoursOverdue,
    reasonLabel:
      item.reason === 'completed_unbilled'
        ? 'Completed - Pending Admin Billing Approval'
        : 'Past Due - Never Closed/Billed',
  }));

  const totalRevenue = items.reduce((sum, i) => sum + i.estimatedRevenue, 0);
  const totalHours = items.reduce((sum, i) => sum + (i.session.scheduledHours || 0), 0);

  const subject = `[BINAH CARE Alert] ${items.length} Unbilled Therapy Session${items.length === 1 ? '' : 's'} (48h+ Overdue · $${totalRevenue.toFixed(2)})`;

  const lines = [
    'BINAH CARE — Automated 48-Hour Revenue & Billing Alert (HIPAA-Safe Summary)',
    `Recipient Admin: ${recipientEmail}`,
    `Overdue Sessions (>= 48 hrs since ET end): ${items.length}`,
    `Total Unbilled Hours: ${totalHours.toFixed(2)} hrs`,
    `Estimated Revenue at Risk: $${totalRevenue.toFixed(2)}`,
    '',
    'Sessions Requiring Billing Approval:',
    ...digestItems.map(
      (d, idx) =>
        `${idx + 1}. ${d.sessionId} | ${d.clientInitials} | ${d.partnerCompany} | ${d.dateEt} ${d.timeRangeEt} ET | ${d.scheduledHours.toFixed(2)}h ($${d.estimatedRevenue.toFixed(2)}) | ${d.hoursOverdue.toFixed(1)}h elapsed | ${d.reasonLabel}`
    ),
    '',
    portalUrl ? `Review & Approve Billing: ${portalUrl}` : 'Sign in to the BINAH CARE Admin Dashboard to approve billable hours.',
    '',
    'Note: Full client details remain protected inside the authenticated BINAH CARE portal.',
  ];

  const textBody = lines.join('\n');
  const firstItem = digestItems[0];
  const smsBody = [
    `BINAH CARE 48h+ Billing Alert: ${items.length} unbilled session${items.length === 1 ? '' : 's'} (${totalHours.toFixed(1)}h · $${totalRevenue.toFixed(2)} est. rev).`,
    firstItem
      ? `Oldest: ${firstItem.partnerCompany} ${firstItem.dateEt} (${firstItem.hoursOverdue.toFixed(0)}h overdue).`
      : '',
    portalUrl ? `Open Admin Portal: ${portalUrl}` : 'Open Admin Portal to approve billing.',
  ]
    .filter(Boolean)
    .join(' ');

  const mailtoUrl = `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(textBody)}`;
  const normalizedPhone = normalizePhoneForSms(recipientPhone);
  const smsUri = normalizedPhone
    ? `sms:${normalizedPhone}?body=${encodeURIComponent(smsBody)}`
    : `sms:?body=${encodeURIComponent(smsBody)}`;

  return {
    subject,
    textBody,
    smsBody,
    mailtoUrl,
    smsUri,
    digestItems,
  };
}

