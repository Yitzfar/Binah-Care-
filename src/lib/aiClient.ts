import { auth, clearGmailAccessToken, getGmailAccessToken } from './firebase';
import { requestGmailSendConfirmation } from './gmailContext';
import type {
  DocumentAiAnalysis,
  FinancialAiAnalytics,
  Language,
  TriggerEventType,
} from '../types/binah';

async function getOptionalAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (auth.currentUser) {
    const token = await auth.currentUser.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function maybeConfirmAndAttachGmailHeader(params: {
  sendEmail: boolean;
  skipGmailOAuth?: boolean;
  recipientEmail: string;
  ccEmails?: string[];
  subject: string;
  bodyPreview: string;
  itemCount?: number;
  itemSummaries?: string[];
}): Promise<{ cancelled: boolean; gmailHeader: string | null }> {
  if (!params.sendEmail || params.skipGmailOAuth) {
    return { cancelled: false, gmailHeader: null };
  }
  const gmailToken = getGmailAccessToken();
  if (!gmailToken) {
    return { cancelled: false, gmailHeader: null };
  }
  const approved = await requestGmailSendConfirmation({
    recipientEmail: params.recipientEmail,
    ccEmails: params.ccEmails,
    subject: params.subject,
    bodyPreview: params.bodyPreview,
    itemCount: params.itemCount,
    itemSummaries: params.itemSummaries,
  });
  if (!approved) {
    return { cancelled: true, gmailHeader: null };
  }
  return { cancelled: false, gmailHeader: `Bearer ${gmailToken}` };
}

function handleGmailAuthFailureResponse(data: {
  emailStatus?: string;
  emailMessage?: string;
}) {
  if (
    data.emailStatus === 'failed' &&
    typeof data.emailMessage === 'string' &&
    (data.emailMessage.includes('Gmail API (401)') ||
      data.emailMessage.includes('Gmail API (403)'))
  ) {
    clearGmailAccessToken();
  }
}

export interface DispatchTriggerResponse {
  sent: boolean;
  emailSent?: boolean;
  smsSent?: boolean;
  provider?: string;
  smsProvider?: string;
  status: 'sent' | 'queued_no_smtp' | 'failed' | 'disabled';
  emailStatus?: 'sent' | 'queued_no_smtp' | 'failed' | 'disabled';
  smsStatus?: 'sent' | 'queued_no_sms' | 'failed' | 'disabled';
  recipientEmail: string;
  recipientPhone?: string;
  subject?: string;
  textBody?: string;
  smsBody?: string;
  message: string;
  emailMessage?: string;
  smsMessage?: string;
}

export async function submitPublicInquiry(payload: {
  parentName: string;
  email: string;
  phone: string;
  childAge: string;
  borough: string;
  preferredLanguage: Language;
  contractCompanyId?: string;
  contractCompanyName?: string;
  partnerEmail?: string;
  sendEmailTrigger?: boolean;
  message: string;
}): Promise<{
  inquiry: Record<string, unknown>;
  triggerResult?: DispatchTriggerResponse | null;
}> {
  const res = await fetch('/api/public/inquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to submit inquiry.');
  }
  return {
    inquiry: data.inquiry,
    triggerResult: (data.triggerResult || null) as DispatchTriggerResponse | null,
  };
}

export async function dispatchActionTrigger(params: {
  eventType: TriggerEventType;
  actionLabel: string;
  contractCompanyId?: string;
  contractCompanyName?: string;
  recipientEmail: string;
  ccEmails?: string[];
  recipientPhone?: string;
  sendEmail: boolean;
  sendSms: boolean;
  subject: string;
  textBody: string;
  smsBody: string;
}): Promise<DispatchTriggerResponse> {
  const { cancelled, gmailHeader } = await maybeConfirmAndAttachGmailHeader({
    sendEmail: params.sendEmail,
    recipientEmail: params.recipientEmail,
    ccEmails: params.ccEmails,
    subject: params.subject,
    bodyPreview: params.textBody,
  });

  if (cancelled && !params.sendSms) {
    return {
      sent: false,
      emailSent: false,
      smsSent: false,
      status: 'disabled',
      emailStatus: 'disabled',
      smsStatus: 'disabled',
      recipientEmail: params.recipientEmail,
      recipientPhone: params.recipientPhone,
      subject: params.subject,
      textBody: params.textBody,
      smsBody: params.smsBody,
      message: 'Gmail email send cancelled by user.',
    };
  }

  const effectiveSendEmail = cancelled ? false : params.sendEmail;
  const headers = await getOptionalAuthHeaders();
  if (gmailHeader) {
    headers['X-Gmail-Access-Token'] = gmailHeader;
  }

  const res = await fetch('/api/triggers/dispatch', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...params,
      sendEmail: effectiveSendEmail,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Unable to dispatch action trigger.');
  }
  handleGmailAuthFailureResponse(data as DispatchTriggerResponse);
  return data as DispatchTriggerResponse;
}

export async function sendAiChatMessage(params: {
  message: string;
  history: Array<{ role: 'user' | 'model'; text: string }>;
  language: Language;
  portalContext: 'public' | 'parent' | 'staff' | 'partner' | 'admin';
  modelTier?: 'standard' | 'fast';
  snapshot?: Record<string, unknown>;
}): Promise<{ reply: string; modelUsed?: string }> {
  const headers = await getOptionalAuthHeaders();
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Unable to contact AI assistant.');
  }
  return {
    reply: (data.reply || '') as string,
    modelUsed: typeof data.modelUsed === 'string' ? data.modelUsed : undefined,
  };
}

export async function analyzeDocumentWithAi(params: {
  fileName: string;
  mimeType: string;
  base64Data?: string;
  textContent?: string;
  language: Language;
}): Promise<DocumentAiAnalysis> {
  const headers = await getOptionalAuthHeaders();
  const res = await fetch('/api/ai/analyze-document', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Document recognition failed.');
  }
  return data.analysis as DocumentAiAnalysis;
}

export async function generateReminderWithAi(params: {
  clientName: string;
  parentName: string;
  missingDocs: string[];
  pendingSessionsCount: number;
  recipientRole: 'parent' | 'staff';
  language: Language;
}): Promise<{ subject: string; body: string }> {
  const headers = await getOptionalAuthHeaders();
  const res = await fetch('/api/ai/generate-reminder', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to draft reminder.');
  }
  return data.reminder as { subject: string; body: string };
}

export async function generateFinancialAnalyticsWithAi(params: {
  metrics: Record<string, unknown>;
  language: Language;
}): Promise<FinancialAiAnalytics> {
  const headers = await getOptionalAuthHeaders();
  const res = await fetch('/api/ai/financial-analytics', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to run AI business analytics.');
  }
  return data.analytics as FinancialAiAnalytics;
}

export type UnbilledEmailDispatchResponse = DispatchTriggerResponse;

export async function sendUnbilledAdminEmailAlert(params: {
  recipientEmail: string;
  recipientPhone?: string;
  sendEmail?: boolean;
  sendSms?: boolean;
  skipGmailOAuth?: boolean;
  subject: string;
  textBody: string;
  smsBody?: string;
  items: Array<{
    sessionId: string;
    clientInitials: string;
    partnerCompany: string;
    dateEt: string;
    timeRangeEt: string;
    scheduledHours: number;
    estimatedRevenue: number;
    hoursOverdue: number;
    reasonLabel: string;
  }>;
}): Promise<UnbilledEmailDispatchResponse> {
  const sendEmailRequested = params.sendEmail !== false;
  const { cancelled, gmailHeader } = await maybeConfirmAndAttachGmailHeader({
    sendEmail: sendEmailRequested,
    skipGmailOAuth: params.skipGmailOAuth,
    recipientEmail: params.recipientEmail,
    subject: params.subject,
    bodyPreview: params.textBody,
    itemCount: params.items.length,
    itemSummaries: params.items.map(
      (i) => `${i.clientInitials} · ${i.partnerCompany} · ${i.dateEt}`
    ),
  });

  if (cancelled && !params.sendSms) {
    return {
      sent: false,
      emailSent: false,
      smsSent: false,
      status: 'disabled',
      emailStatus: 'disabled',
      smsStatus: 'disabled',
      recipientEmail: params.recipientEmail,
      recipientPhone: params.recipientPhone,
      subject: params.subject,
      textBody: params.textBody,
      smsBody: params.smsBody,
      message: 'Gmail email alert cancelled by user.',
    };
  }

  const effectiveSendEmail = cancelled ? false : sendEmailRequested;
  const headers = await getOptionalAuthHeaders();
  if (gmailHeader) {
    headers['X-Gmail-Access-Token'] = gmailHeader;
  }

  const { skipGmailOAuth: _skip, ...payload } = params;
  const res = await fetch('/api/alerts/unbilled-email', {
    method: 'POST',
    headers: {
      ...headers,
      'x-binah-role': 'admin',
    },
    body: JSON.stringify({
      ...payload,
      sendEmail: effectiveSendEmail,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Unable to dispatch billing alert.');
  }
  handleGmailAuthFailureResponse(data as UnbilledEmailDispatchResponse);
  return data as UnbilledEmailDispatchResponse;
}

export interface NotificationProviderStatus {
  emailConfigured: boolean;
  emailProvider: 'resend' | 'gmail_smtp' | 'smtp' | 'webhook' | 'none';
  emailSender: string;
  smsConfigured: boolean;
  smsProvider: 'twilio' | 'webhook' | 'none';
  smsSender: string;
  defaultAdminEmail: string;
  defaultAdminPhone: string;
}

export async function fetchNotificationStatus(): Promise<NotificationProviderStatus> {
  const headers = await getOptionalAuthHeaders();
  const res = await fetch('/api/notifications/status', {
    headers: {
      ...headers,
      'x-binah-role': 'admin',
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Unable to load notification provider status.');
  }
  return data as NotificationProviderStatus;
}

export async function sendTestNotification(params: {
  recipientEmail: string;
  recipientPhone?: string;
  sendEmail: boolean;
  sendSms: boolean;
}): Promise<DispatchTriggerResponse> {
  const { cancelled, gmailHeader } = await maybeConfirmAndAttachGmailHeader({
    sendEmail: params.sendEmail,
    recipientEmail: params.recipientEmail,
    subject: '[BINAH CARE Test] Automatic Email & Text Verification',
    bodyPreview: [
      'BINAH CARE — Live Notification Delivery Test',
      `Recipient Email: ${params.recipientEmail}`,
      params.recipientPhone ? `Recipient SMS: ${params.recipientPhone}` : '',
      '',
      'Your BINAH CARE automatic email and text alerts are working properly.',
    ]
      .filter(Boolean)
      .join('\n'),
  });

  if (cancelled && !params.sendSms) {
    return {
      sent: false,
      emailSent: false,
      smsSent: false,
      status: 'disabled',
      emailStatus: 'disabled',
      smsStatus: 'disabled',
      recipientEmail: params.recipientEmail,
      recipientPhone: params.recipientPhone,
      message: 'Gmail test email cancelled by user.',
    };
  }

  const effectiveSendEmail = cancelled ? false : params.sendEmail;
  const headers = await getOptionalAuthHeaders();
  if (gmailHeader) {
    headers['X-Gmail-Access-Token'] = gmailHeader;
  }

  const res = await fetch('/api/notifications/test', {
    method: 'POST',
    headers: {
      ...headers,
      'x-binah-role': 'admin',
    },
    body: JSON.stringify({
      ...params,
      sendEmail: effectiveSendEmail,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Unable to send test notification.');
  }
  handleGmailAuthFailureResponse(data as DispatchTriggerResponse);
  return data as DispatchTriggerResponse;
}

export interface GmailActivityMessage {
  id: string;
  subject: string;
  to: string;
  date: string;
  snippet: string;
}

export interface GmailActivityResponse {
  emailAddress: string;
  messagesTotal: number;
  recentMessages: GmailActivityMessage[];
}

export async function fetchGmailActivity(): Promise<GmailActivityResponse> {
  const gmailToken = getGmailAccessToken();
  if (!gmailToken) {
    throw new Error('Gmail is not connected.');
  }
  const headers = await getOptionalAuthHeaders();
  headers['X-Gmail-Access-Token'] = `Bearer ${gmailToken}`;
  const res = await fetch('/api/gmail/activity', { headers });
  const data = await res.json();
  if (res.status === 401 || res.status === 403) {
    clearGmailAccessToken();
    throw new Error(data.error || 'Gmail session expired. Please reconnect Gmail.');
  }
  if (!res.ok) {
    throw new Error(data.error || 'Unable to fetch Gmail activity.');
  }
  return data as GmailActivityResponse;
}
