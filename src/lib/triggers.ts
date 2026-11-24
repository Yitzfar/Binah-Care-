import { dispatchActionTrigger, type DispatchTriggerResponse } from './aiClient';
import {
  normalizePhoneForSms,
  PRIMARY_ADMIN_ALERT_EMAIL,
  toHipaaSafeInitials,
} from './billingAlerts';
import { saveTriggerLog } from './firestoreService';
import type {
  AdminAlertSettings,
  Language,
  PartnerDirectoryEntry,
  TriggerEventType,
  UserProfile,
} from '../types/binah';

export interface TriggerChannelChoice {
  sendEmail: boolean;
  sendSms: boolean;
  recipientEmail?: string;
  recipientPhone?: string;
}

export interface DispatchedTriggerOutcome {
  triggerId: string;
  response: DispatchTriggerResponse;
  mailtoUrl: string;
  smsUri: string;
  recipientEmail: string;
  recipientPhone: string;
  subject: string;
  smsBody: string;
}

export const TRIGGER_EVENT_LABELS: Record<TriggerEventType, { en: string; yi: string }> = {
  new_client_signup: { en: 'New Client Signup', yi: 'נײַער קליענט רעגיסטראַציע' },
  document_uploaded: { en: 'Document Uploaded', yi: 'דאָקומענט אַרויפגעלאָדן' },
  checklist_verified: { en: 'Checklist Verified', yi: 'טשעקליסט באַשטעטיקט' },
  status_changed: { en: 'Case Status Updated', yi: 'אַפּליקאַציע סטאַטוס געטוישט' },
  partner_assigned: { en: 'Partner Agency Assigned', yi: 'שותף פֿירמע צוגעטיילט' },
  bt_assigned: { en: 'BT Assigned', yi: 'BT צוגעטיילט' },
  session_scheduled: { en: 'Session Scheduled (ET)', yi: 'סעסיע געפּלאַנט (ET)' },
  session_completed: { en: 'Session Completed', yi: 'סעסיע פאַרענדיקט' },
  session_billed: { en: 'Session Approved Billable', yi: 'סעסיע באַשטעטיקט פאַר ביללינג' },
  payment_recorded: { en: 'Partner Payment Recorded', yi: 'שותף צאָלונג אײַנגעשריבן' },
  payout_recorded: { en: 'BT Payout Recorded', yi: 'BT געהאַלט אײַנגעשריבן' },
  reminder_sent: { en: 'Coordination Reminder Sent', yi: 'קאָאָרדינאַציע דערמאָנונג געשיקט' },
  custom_action: { en: 'Manual Action Trigger', yi: 'מאַנועלער אַקציע טריגער' },
};

export function resolveTriggerTargets(params: {
  contractCompanyId?: string;
  partnerDirectory: PartnerDirectoryEntry[];
  alertSettings?: AdminAlertSettings | null;
  overrideEmail?: string;
  overridePhone?: string;
}): {
  partnerEntry?: PartnerDirectoryEntry;
  recipientEmail: string;
  ccEmails: string[];
  recipientPhone: string;
} {
  const partnerEntry = params.contractCompanyId
    ? params.partnerDirectory.find((p) => p.companyId === params.contractCompanyId)
    : undefined;

  const adminEmail = params.alertSettings?.alertEmail || PRIMARY_ADMIN_ALERT_EMAIL;
  const adminPhone = params.alertSettings?.alertPhone || '';

  const partnerEmail = (partnerEntry?.notificationEmail || '').trim();
  const partnerPhone = (partnerEntry?.notificationPhone || '').trim();

  const recipientEmail = (
    params.overrideEmail ||
    partnerEmail ||
    adminEmail ||
    PRIMARY_ADMIN_ALERT_EMAIL
  ).trim();

  const ccEmails =
    partnerEmail && adminEmail && partnerEmail.toLowerCase() !== adminEmail.toLowerCase()
      ? [adminEmail]
      : [];

  const recipientPhone = (params.overridePhone || partnerPhone || adminPhone || '').trim();

  return {
    partnerEntry,
    recipientEmail,
    ccEmails,
    recipientPhone,
  };
}

export async function triggerActionNotification(params: {
  user: UserProfile;
  eventType: TriggerEventType;
  actionLabel?: string;
  contractCompanyId?: string;
  contractCompanyName?: string;
  partnerUids?: string[];
  clientId?: string;
  clientName?: string;
  summaryDetails: string;
  channels: TriggerChannelChoice;
  partnerDirectory: PartnerDirectoryEntry[];
  alertSettings?: AdminAlertSettings | null;
  language?: Language;
}): Promise<DispatchedTriggerOutcome | null> {
  if (!params.channels.sendEmail && !params.channels.sendSms) {
    return null;
  }

  const label = params.actionLabel || TRIGGER_EVENT_LABELS[params.eventType].en;
  const clientInitials = params.clientName ? toHipaaSafeInitials(params.clientName) : '';
  const agencyLabel = params.contractCompanyName || 'BINAH CARE Coordination';

  const targets = resolveTriggerTargets({
    contractCompanyId: params.contractCompanyId,
    partnerDirectory: params.partnerDirectory,
    alertSettings: params.alertSettings,
    overrideEmail: params.channels.recipientEmail,
    overridePhone: params.channels.recipientPhone,
  });

  const subjectParts = ['[BINAH CARE]', label];
  if (agencyLabel) subjectParts.push(agencyLabel);
  if (clientInitials) subjectParts.push(clientInitials);
  const subject = subjectParts.join(' · ').slice(0, 220);

  const textBody = [
    `BINAH CARE — Action Notification Trigger`,
    `Event: ${label}`,
    `Partner Agency: ${agencyLabel}`,
    clientInitials ? `Client (HIPAA-Safe): ${clientInitials}` : '',
    `Action Summary: ${params.summaryDetails}`,
    `Triggered By: ${params.user.displayName} (${params.user.role})`,
    '',
    'Open the BINAH CARE Portal to view complete authorized records.',
  ]
    .filter(Boolean)
    .join('\n');

  const smsBody = [
    `BINAH CARE (${label}):`,
    agencyLabel,
    clientInitials ? `Client ${clientInitials}` : '',
    params.summaryDetails.slice(0, 160),
  ]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 480);

  const response = await dispatchActionTrigger({
    eventType: params.eventType,
    actionLabel: label,
    contractCompanyId: params.contractCompanyId,
    contractCompanyName: params.contractCompanyName,
    recipientEmail: targets.recipientEmail,
    ccEmails: targets.ccEmails,
    recipientPhone: targets.recipientPhone || undefined,
    sendEmail: params.channels.sendEmail,
    sendSms: params.channels.sendSms,
    subject,
    textBody,
    smsBody,
  });

  const emailStatus = response.emailStatus ?? response.status;
  const smsStatus =
    response.smsStatus ?? (params.channels.sendSms ? 'queued_no_sms' : 'disabled');

  if (emailStatus === 'disabled' && smsStatus === 'disabled' && !response.sent) {
    return null;
  }

  const resolvedPartnerUids =
    params.partnerUids ?? targets.partnerEntry?.partnerUids ?? [];

  const triggerId = await saveTriggerLog({
    eventType: params.eventType,
    actionLabel: label,
    contractCompanyId: params.contractCompanyId,
    contractCompanyName: params.contractCompanyName,
    partnerUids: resolvedPartnerUids,
    clientId: params.clientId,
    clientLabel: clientInitials || undefined,
    recipientEmail: response.recipientEmail || targets.recipientEmail,
    recipientPhone: response.recipientPhone || targets.recipientPhone || undefined,
    sendEmail: params.channels.sendEmail,
    sendSms: params.channels.sendSms,
    emailStatus,
    smsStatus,
    subject,
    summary: params.summaryDetails,
    triggeredByUid: params.user.uid,
    triggeredByEmail: params.user.email,
  });

  const mailtoUrl = `mailto:${response.recipientEmail || targets.recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(textBody)}`;
  const normPhone = normalizePhoneForSms(response.recipientPhone || targets.recipientPhone);
  const smsUri = normPhone
    ? `sms:${normPhone}?body=${encodeURIComponent(smsBody)}`
    : `sms:?body=${encodeURIComponent(smsBody)}`;

  return {
    triggerId,
    response,
    mailtoUrl,
    smsUri,
    recipientEmail: response.recipientEmail || targets.recipientEmail,
    recipientPhone: response.recipientPhone || targets.recipientPhone,
    subject,
    smsBody,
  };
}
