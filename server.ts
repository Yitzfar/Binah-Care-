import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { GoogleGenAI, Type } from '@google/genai';
import nodemailer from 'nodemailer';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAuth();

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT')
  );
}

async function runWithGeminiRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isTransientGeminiError(err)) {
        const delayMs = 600 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function formatGeminiApiError(err: unknown, fallbackMessage: string): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('GEMINI_API_KEY is not configured')) {
    return { status: 500, message: raw };
  }
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      message: 'Please verify your Gemini API key in Settings > Secrets and try again.',
    };
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'Gemini quota limit reached right now. Try switching to Fast mode or check Settings > Secrets.',
    };
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE')) {
    return {
      status: 503,
      message: 'Gemini is temporarily busy due to high demand. Please retry in a few seconds.',
    };
  }
  return { status: 500, message: raw || fallbackMessage };
}

interface AuthRequest extends Request {
  authUser?: DecodedIdToken;
}

const requireFirebaseAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please sign in to continue.' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.authUser = decoded;
    next();
  } catch (err) {
    console.error('Firebase token verification error:', err);
    res.status(401).json({ error: 'Session expired or invalid token. Please sign in again.' });
  }
};

interface StoredInquiry {
  inquiryId: string;
  parentName: string;
  email: string;
  phone: string;
  childAge: string;
  preferredLanguage: 'en' | 'yi';
  borough: string;
  contractCompanyId?: string;
  contractCompanyName?: string;
  message: string;
  status: 'new' | 'contacted' | 'converted';
  createdAt: string;
}

const recentInquiries: StoredInquiry[] = [];

const app = express();
app.use(express.json({ limit: '12mb' }));

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timezone: 'America/New_York',
    aiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
  });
});

function normalizePhoneForSmsServer(phone?: string): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D/g, '');
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

function escapeHtml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractGmailToken(req: Request): string {
  const header = req.headers['x-gmail-access-token'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw || typeof raw !== 'string') return '';
  if (raw.startsWith('Bearer ')) {
    return raw.slice('Bearer '.length).trim();
  }
  return raw.trim();
}

function encodeRfc2047Utf8(text: string): string {
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function sanitizeHeaderEmailList(emails: string[]): string {
  return emails
    .map((e) => e.replace(/[\r\n<>]/g, '').trim())
    .filter((e) => e.includes('@'))
    .join(', ');
}

async function sendViaGmailApi(params: {
  accessToken: string;
  to: string;
  ccEmails?: string[];
  subject: string;
  textBody: string;
  htmlBody: string;
}): Promise<{ id: string; threadId?: string }> {
  const boundary = `binah_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const ccHeader = sanitizeHeaderEmailList(params.ccEmails || []);
  const headers = [
    `To: ${params.to.replace(/[\r\n]/g, '').trim()}`,
    ccHeader ? `Cc: ${ccHeader}` : '',
    `Subject: ${encodeRfc2047Utf8(params.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
    .filter(Boolean)
    .join('\r\n');

  const rawMime = [
    headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(params.textBody, 'utf8').toString('base64'),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(params.htmlBody, 'utf8').toString('base64'),
    '',
    `--${boundary}--`,
  ].join('\r\n');

  const rawEncoded = Buffer.from(rawMime, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: rawEncoded }),
  });

  if (!gmailRes.ok) {
    const errText = await gmailRes.text();
    let detail = errText.slice(0, 240);
    try {
      const parsed = JSON.parse(errText) as { error?: { message?: string; status?: string } };
      if (parsed?.error?.message) {
        detail = parsed.error.message;
      }
    } catch {
      // keep raw snippet
    }
    throw new Error(`Gmail API (${gmailRes.status}): ${detail}`);
  }

  return (await gmailRes.json()) as { id: string; threadId?: string };
}

async function dispatchEmailAndSms(params: {
  recipientEmail: string;
  ccEmails?: string[];
  recipientPhone?: string;
  sendEmail: boolean;
  sendSms: boolean;
  subject: string;
  textBody: string;
  htmlBody?: string;
  smsBody: string;
  gmailAccessToken?: string;
  webhookPayload?: Record<string, unknown>;
}) {
  const recipientEmail = params.recipientEmail.trim() || 'arledigt@gmail.com';
  const ccList = (params.ccEmails || [])
    .map((e) => e.trim())
    .filter((e) => e.includes('@') && e.toLowerCase() !== recipientEmail.toLowerCase());
  const rawTargetPhone = params.recipientPhone?.trim() || process.env.ADMIN_ALERT_PHONE || '';
  const recipientPhone = normalizePhoneForSmsServer(rawTargetPhone);
  const webhookUrl = process.env.ADMIN_ALERT_WEBHOOK_URL?.trim();

  let emailSent = false;
  let emailStatus: 'sent' | 'queued_no_smtp' | 'failed' | 'disabled' = params.sendEmail
    ? 'queued_no_smtp'
    : 'disabled';
  let emailProvider = params.sendEmail ? 'dashboard_only' : 'disabled';
  let emailMessage = params.sendEmail
    ? `Email queued for ${recipientEmail} (connect your Gmail account in Email & Text Setup, or add SMTP/Resend secrets for background delivery).`
    : 'Email trigger channel disabled.';

  const defaultHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #181A1F; max-width: 640px; margin: 0 auto; padding: 24px; background: #FAF9F6;">
      <div style="background: #FFFFFF; border: 1px solid #E6E4DF; border-radius: 12px; padding: 24px;">
        <div style="font-size: 12px; font-weight: 700; color: #0F5C53; letter-spacing: 0.04em;">BINAH CARE · NEW YORK</div>
        <h2 style="margin: 8px 0 12px; font-size: 18px; color: #181A1F;">${escapeHtml(params.subject)}</h2>
        <pre style="white-space: pre-wrap; font-family: inherit; font-size: 13px; line-height: 1.6; color: #363942; margin: 0;">${escapeHtml(params.textBody)}</pre>
        <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid #E6E4DF; font-size: 11px; color: #575B66;">
          HIPAA-Safe Notification: Sign in to the BINAH CARE Portal to review complete authorized records.
        </div>
      </div>
    </div>`;

  if (params.sendEmail) {
    try {
      const resendKey = process.env.RESEND_API_KEY?.trim();
      const smtpUser = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
      const rawSmtpPass = (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').trim();
      const inferredGmail =
        smtpUser.toLowerCase().endsWith('@gmail.com') ||
        smtpUser.toLowerCase().endsWith('@googlemail.com');
      const smtpHost = (process.env.SMTP_HOST || (inferredGmail ? 'smtp.gmail.com' : '')).trim();
      const smtpPass =
        smtpHost === 'smtp.gmail.com' ? rawSmtpPass.replace(/\s+/g, '') : rawSmtpPass;
      const allTo = [recipientEmail, ...ccList];
      const gmailToken = params.gmailAccessToken?.trim();

      if (gmailToken) {
        await sendViaGmailApi({
          accessToken: gmailToken,
          to: recipientEmail,
          ccEmails: ccList,
          subject: params.subject,
          textBody: params.textBody,
          htmlBody: params.htmlBody || defaultHtml,
        });
        emailSent = true;
        emailStatus = 'sent';
        emailProvider = 'gmail_oauth';
        emailMessage = `Real email sent via Gmail to ${allTo.join(', ')}.`;
      } else if (resendKey) {
        const fromEmail =
          process.env.ALERT_FROM_EMAIL?.trim() || 'BINAH CARE Alerts <onboarding@resend.dev>';
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromEmail,
            to: allTo,
            subject: params.subject,
            text: params.textBody,
            html: params.htmlBody || defaultHtml,
          }),
        });
        if (!resendRes.ok) {
          const errText = await resendRes.text();
          throw new Error(`Resend API error: ${errText.slice(0, 240)}`);
        }
        emailSent = true;
        emailStatus = 'sent';
        emailProvider = 'resend';
        emailMessage = `Real email sent via Resend to ${allTo.join(', ')}.`;
      } else if (smtpHost && smtpUser && smtpPass) {
        const port = Number(process.env.SMTP_PORT || 587);
        const secure = process.env.SMTP_SECURE === 'true' || port === 465;
        const fromEmail =
          process.env.ALERT_FROM_EMAIL?.trim() || `BINAH CARE Alerts <${smtpUser}>`;
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port,
          secure,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });
        await transporter.sendMail({
          from: fromEmail,
          to: recipientEmail,
          cc: ccList.length > 0 ? ccList : undefined,
          subject: params.subject,
          text: params.textBody,
          html: params.htmlBody || defaultHtml,
        });
        emailSent = true;
        emailStatus = 'sent';
        emailProvider = smtpHost === 'smtp.gmail.com' ? 'gmail_smtp' : 'smtp';
        emailMessage = `Real email sent via ${smtpHost} to ${allTo.join(', ')}.`;
      } else if (webhookUrl) {
        const hookRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'email',
            recipientEmail,
            ccEmails: ccList,
            subject: params.subject,
            textBody: params.textBody,
            ...(params.webhookPayload || {}),
          }),
        });
        if (!hookRes.ok) {
          throw new Error(`Webhook responded with HTTP ${hookRes.status}`);
        }
        emailSent = true;
        emailStatus = 'sent';
        emailProvider = 'webhook';
        emailMessage = `Real email dispatched via webhook to ${allTo.join(', ')}.`;
      }
    } catch (err) {
      console.error('Trigger email dispatch error:', err);
      emailStatus = 'failed';
      emailMessage = err instanceof Error ? err.message : 'Unable to send email trigger.';
    }
  }

  let smsSent = false;
  let smsStatus: 'sent' | 'queued_no_sms' | 'failed' | 'disabled' = params.sendSms
    ? 'queued_no_sms'
    : 'disabled';
  let smsProvider = params.sendSms ? 'dashboard_only' : 'disabled';
  const twilioSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const twilioToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const twilioFrom = process.env.TWILIO_FROM_NUMBER?.trim();
  const twilioMsgSvc = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  const hasTwilio = Boolean(twilioSid && twilioToken && (twilioFrom || twilioMsgSvc));

  let smsMessage = params.sendSms
    ? !recipientPhone
      ? 'Add a recipient mobile phone number in Alert Settings (or ADMIN_ALERT_PHONE secret) to send SMS texts.'
      : hasTwilio || webhookUrl
        ? `Text queued for ${recipientPhone}.`
        : `Text queued for ${recipientPhone} (add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in Settings > Secrets for automatic SMS).`
    : 'Text (SMS) channel disabled.';

  if (params.sendSms && recipientPhone) {
    try {
      if (hasTwilio && twilioSid && twilioToken) {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioSid)}/Messages.json`;
        const form = new URLSearchParams({
          To: recipientPhone,
          Body: params.smsBody.slice(0, 480),
        });
        if (twilioMsgSvc) {
          form.set('MessagingServiceSid', twilioMsgSvc);
        } else if (twilioFrom) {
          form.set('From', twilioFrom);
        }
        const authHeader = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
        const twRes = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        });
        if (!twRes.ok) {
          const errText = await twRes.text();
          throw new Error(`Twilio SMS error: ${errText.slice(0, 240)}`);
        }
        smsSent = true;
        smsStatus = 'sent';
        smsProvider = 'twilio';
        smsMessage = `Real text (SMS) sent via Twilio to ${recipientPhone}.`;
      } else if (webhookUrl) {
        const hookRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'sms',
            recipientPhone,
            smsBody: params.smsBody,
            ...(params.webhookPayload || {}),
          }),
        });
        if (!hookRes.ok) {
          throw new Error(`SMS webhook responded with HTTP ${hookRes.status}`);
        }
        smsSent = true;
        smsStatus = 'sent';
        smsProvider = 'webhook';
        smsMessage = `Real text (SMS) dispatched via webhook to ${recipientPhone}.`;
      }
    } catch (err) {
      console.error('Trigger SMS dispatch error:', err);
      smsStatus = 'failed';
      smsMessage = err instanceof Error ? err.message : 'Unable to send SMS text trigger.';
    }
  }

  const combinedParts = [
    params.sendEmail ? emailMessage : '',
    params.sendSms ? smsMessage : '',
  ].filter(Boolean);

  return {
    sent: emailSent || smsSent,
    emailSent,
    smsSent,
    provider: emailProvider,
    smsProvider,
    status: emailStatus,
    emailStatus,
    smsStatus,
    recipientEmail,
    recipientPhone,
    subject: params.subject,
    textBody: params.textBody,
    smsBody: params.smsBody,
    message: combinedParts.join(' · ') || 'Trigger recorded.',
    emailMessage,
    smsMessage,
  };
}

// Public Intake / Contact Inquiry Submission (with optional Partner Signup Email Trigger)
app.post('/api/public/inquiry', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const parentName = typeof body.parentName === 'string' ? body.parentName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const childAge = typeof body.childAge === 'string' ? body.childAge.trim() : '';
  const preferredLanguage = body.preferredLanguage === 'yi' ? 'yi' : 'en';
  const borough = typeof body.borough === 'string' ? body.borough.trim() : 'Monroe / Orange County, NY';
  const contractCompanyId =
    typeof body.contractCompanyId === 'string' ? body.contractCompanyId.trim().slice(0, 128) : '';
  const contractCompanyName =
    typeof body.contractCompanyName === 'string' ? body.contractCompanyName.trim().slice(0, 120) : '';
  const partnerEmail =
    typeof body.partnerEmail === 'string' && body.partnerEmail.includes('@')
      ? body.partnerEmail.trim().slice(0, 200)
      : '';
  const sendEmailTrigger = body.sendEmailTrigger !== false;
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (parentName.length < 2 || !email.includes('@') || email.length < 5) {
    res.status(400).json({ error: 'Please provide a valid parent name and email address.' });
    return;
  }

  const inquiry: StoredInquiry = {
    inquiryId: `inq_${Date.now()}`,
    parentName: parentName.slice(0, 120),
    email: email.slice(0, 200),
    phone: phone.slice(0, 32),
    childAge: childAge.slice(0, 32),
    preferredLanguage,
    borough: borough.slice(0, 80),
    ...(contractCompanyId ? { contractCompanyId } : {}),
    ...(contractCompanyName ? { contractCompanyName } : {}),
    message: message.slice(0, 2000),
    status: 'new',
    createdAt: new Date().toISOString(),
  };

  recentInquiries.unshift(inquiry);
  if (recentInquiries.length > 50) {
    recentInquiries.pop();
  }

  const sendSmsTrigger = body.sendSmsTrigger === true || Boolean(process.env.ADMIN_ALERT_PHONE);

  let triggerResult: Awaited<ReturnType<typeof dispatchEmailAndSms>> | null = null;
  if (sendEmailTrigger || sendSmsTrigger) {
    const primaryRecipient = partnerEmail || 'arledigt@gmail.com';
    const agencyLabel = contractCompanyName || 'BINAH CARE Intake Team';
    const subject = `[BINAH CARE New Client Signup] ${inquiry.borough} · ${agencyLabel}`;
    const textBody = [
      'BINAH CARE — New Family Registration / Client Signup Trigger',
      `Assigned Partner Agency: ${agencyLabel}`,
      `Community / Area: ${inquiry.borough}`,
      `Preferred Language: ${preferredLanguage === 'yi' ? 'אידיש (Yiddish)' : 'English'}`,
      `Child Age: ${inquiry.childAge || 'Not specified'}`,
      `Inquiry ID: ${inquiry.inquiryId}`,
      '',
      'Please sign in to the BINAH CARE Portal to review the new client signup and follow up with the family.',
    ].join('\n');
    const smsBody = `BINAH CARE New Client Signup (${agencyLabel}): ${inquiry.borough}, ${preferredLanguage === 'yi' ? 'אידיש' : 'English'}. Open BINAH CARE Portal to review.`;

    triggerResult = await dispatchEmailAndSms({
      recipientEmail: primaryRecipient,
      ccEmails: partnerEmail ? ['arledigt@gmail.com'] : [],
      recipientPhone: process.env.ADMIN_ALERT_PHONE,
      sendEmail: sendEmailTrigger,
      sendSms: sendSmsTrigger && Boolean(process.env.ADMIN_ALERT_PHONE),
      subject,
      textBody,
      smsBody,
      webhookPayload: {
        eventType: 'new_client_signup',
        inquiryId: inquiry.inquiryId,
        contractCompanyId,
        contractCompanyName,
      },
    });
  }

  res.status(201).json({ inquiry, triggerResult });
});

app.get('/api/public/inquiries', requireFirebaseAuth, (req: AuthRequest, res: Response) => {
  const email = req.authUser?.email || '';
  if (email.toLowerCase() !== 'arledigt@gmail.com' && req.headers['x-binah-role'] !== 'admin') {
    res.status(403).json({ error: 'Administrator access required.' });
    return;
  }
  res.json({ inquiries: recentInquiries });
});

// Notification Provider Status (Safe Diagnostics — Never Exposes Secrets)
app.get('/api/notifications/status', requireFirebaseAuth, (req: AuthRequest, res: Response) => {
  const callerEmail = (req.authUser?.email || '').toLowerCase();
  if (callerEmail !== 'arledigt@gmail.com' && req.headers['x-binah-role'] !== 'admin') {
    res.status(403).json({ error: 'Administrator access required.' });
    return;
  }

  const resendKey = Boolean(process.env.RESEND_API_KEY?.trim());
  const smtpUser = (process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
  const smtpPass = Boolean((process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').trim());
  const inferredGmail =
    smtpUser.toLowerCase().endsWith('@gmail.com') ||
    smtpUser.toLowerCase().endsWith('@googlemail.com');
  const smtpHost = (process.env.SMTP_HOST || (inferredGmail ? 'smtp.gmail.com' : '')).trim();
  const hasSmtp = Boolean(smtpHost && smtpUser && smtpPass);
  const hasWebhook = Boolean(process.env.ADMIN_ALERT_WEBHOOK_URL?.trim());

  const twilioSid = Boolean(process.env.TWILIO_ACCOUNT_SID?.trim());
  const twilioToken = Boolean(process.env.TWILIO_AUTH_TOKEN?.trim());
  const twilioFrom = (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const hasTwilio = Boolean(twilioSid && twilioToken && twilioFrom);

  const emailProvider = resendKey ? 'resend' : hasSmtp ? (smtpHost === 'smtp.gmail.com' ? 'gmail_smtp' : 'smtp') : hasWebhook ? 'webhook' : 'none';
  const smsProvider = hasTwilio ? 'twilio' : hasWebhook ? 'webhook' : 'none';

  const defaultPhone = normalizePhoneForSmsServer(process.env.ADMIN_ALERT_PHONE || '');

  res.json({
    emailConfigured: emailProvider !== 'none',
    emailProvider,
    emailSender: resendKey
      ? process.env.ALERT_FROM_EMAIL?.trim() || 'onboarding@resend.dev'
      : hasSmtp
        ? smtpUser
        : '',
    smsConfigured: smsProvider !== 'none',
    smsProvider,
    smsSender: hasTwilio ? twilioFrom : '',
    defaultAdminEmail: 'arledigt@gmail.com',
    defaultAdminPhone: defaultPhone,
  });
});

// Recent Gmail Sent Alerts & Profile Check (Requires X-Gmail-Access-Token)
app.get('/api/gmail/activity', requireFirebaseAuth, async (req: AuthRequest, res: Response) => {
  const gmailToken = extractGmailToken(req);
  if (!gmailToken) {
    res.status(401).json({ error: 'Connect Gmail with Google Sign-In to inspect Gmail activity.' });
    return;
  }
  try {
    const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${gmailToken}` },
    });
    if (!profileRes.ok) {
      const errTxt = await profileRes.text();
      res.status(profileRes.status).json({
        error: `Gmail token expired or unauthorized (${profileRes.status}): ${errTxt.slice(0, 160)}`,
      });
      return;
    }
    const profile = (await profileRes.json()) as {
      emailAddress?: string;
      messagesTotal?: number;
    };

    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&q=' +
        encodeURIComponent('subject:"BINAH CARE"'),
      {
        headers: { Authorization: `Bearer ${gmailToken}` },
      }
    );
    const recentMessages: Array<{
      id: string;
      subject: string;
      to: string;
      date: string;
      snippet: string;
    }> = [];

    if (listRes.ok) {
      const listData = (await listRes.json()) as { messages?: Array<{ id: string }> };
      const ids = (listData.messages || []).slice(0, 5);
      for (const item of ids) {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=To&metadataHeaders=Date`,
          {
            headers: { Authorization: `Bearer ${gmailToken}` },
          }
        );
        if (msgRes.ok) {
          const msg = (await msgRes.json()) as {
            id: string;
            snippet?: string;
            payload?: { headers?: Array<{ name: string; value: string }> };
          };
          const headers = msg.payload?.headers || [];
          const getHeader = (name: string) =>
            headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
          recentMessages.push({
            id: msg.id,
            subject: getHeader('Subject') || '(No Subject)',
            to: getHeader('To') || '',
            date: getHeader('Date') || '',
            snippet: msg.snippet || '',
          });
        }
      }
    }

    res.json({
      emailAddress: profile.emailAddress || '',
      messagesTotal: profile.messagesTotal || 0,
      recentMessages,
    });
  } catch (err) {
    console.error('Gmail activity error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unable to fetch Gmail activity.',
    });
  }
});

// Live Test Email & SMS Trigger (Admin Only)
app.post('/api/notifications/test', requireFirebaseAuth, async (req: AuthRequest, res: Response) => {
  const callerEmail = (req.authUser?.email || '').toLowerCase();
  if (callerEmail !== 'arledigt@gmail.com' && req.headers['x-binah-role'] !== 'admin') {
    res.status(403).json({ error: 'Administrator access required.' });
    return;
  }

  const body = req.body as {
    recipientEmail?: string;
    recipientPhone?: string;
    sendEmail?: boolean;
    sendSms?: boolean;
  };

  const sendEmail = body.sendEmail !== false;
  const sendSms = body.sendSms === true;
  if (!sendEmail && !sendSms) {
    res.status(400).json({ error: 'Enable Email and/or Text (SMS) to run a live test.' });
    return;
  }

  const recipientEmail =
    typeof body.recipientEmail === 'string' && body.recipientEmail.includes('@')
      ? body.recipientEmail.trim().slice(0, 200)
      : 'arledigt@gmail.com';
  const recipientPhone =
    typeof body.recipientPhone === 'string' && body.recipientPhone.trim()
      ? body.recipientPhone.trim().slice(0, 32)
      : process.env.ADMIN_ALERT_PHONE || '';

  const nowEt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());

  const result = await dispatchEmailAndSms({
    recipientEmail,
    recipientPhone,
    sendEmail,
    sendSms,
    gmailAccessToken: extractGmailToken(req),
    subject: `[BINAH CARE Test] Automatic Email & Text Verification (${nowEt} ET)`,
    textBody: [
      'BINAH CARE — Live Notification Delivery Test',
      `Timestamp (ET): ${nowEt}`,
      `Recipient Email: ${recipientEmail}`,
      recipientPhone ? `Recipient SMS: ${recipientPhone}` : '',
      '',
      'Your BINAH CARE automatic email and text alerts are working properly.',
    ]
      .filter(Boolean)
      .join('\n'),
    smsBody: `BINAH CARE Test Alert (${nowEt} ET): Automatic Email & SMS notifications are live and ready.`,
    webhookPayload: {
      eventType: 'notification_test',
      triggeredByUid: req.authUser?.uid || '',
    },
  });

  res.json(result);
});

// Unified Action Email & SMS Trigger Endpoint (All Portal Actions & Partner Signups)
app.post('/api/triggers/dispatch', requireFirebaseAuth, async (req: AuthRequest, res: Response) => {
  const body = req.body as {
    eventType?: string;
    actionLabel?: string;
    contractCompanyId?: string;
    contractCompanyName?: string;
    recipientEmail?: string;
    ccEmails?: string[];
    recipientPhone?: string;
    sendEmail?: boolean;
    sendSms?: boolean;
    subject?: string;
    textBody?: string;
    smsBody?: string;
  };

  const sendEmail = body.sendEmail !== false;
  const sendSms = body.sendSms === true;
  if (!sendEmail && !sendSms) {
    res.status(400).json({ error: 'Select at least one trigger channel (Email or Text).' });
    return;
  }

  const recipientEmail =
    typeof body.recipientEmail === 'string' && body.recipientEmail.includes('@')
      ? body.recipientEmail.trim().slice(0, 200)
      : 'arledigt@gmail.com';
  const subject =
    typeof body.subject === 'string' && body.subject.trim()
      ? body.subject.trim().slice(0, 220)
      : `[BINAH CARE Trigger] ${body.actionLabel || 'Portal Action'}`;
  const textBody =
    typeof body.textBody === 'string' && body.textBody.trim()
      ? body.textBody.trim().slice(0, 8000)
      : `${subject}\nTriggered by ${req.authUser?.email || 'Authorized User'}.`;
  const smsBody =
    typeof body.smsBody === 'string' && body.smsBody.trim()
      ? body.smsBody.trim().slice(0, 480)
      : subject;

  const result = await dispatchEmailAndSms({
    recipientEmail,
    ccEmails: Array.isArray(body.ccEmails) ? body.ccEmails : [],
    recipientPhone: body.recipientPhone || process.env.ADMIN_ALERT_PHONE,
    sendEmail,
    sendSms,
    gmailAccessToken: extractGmailToken(req),
    subject,
    textBody,
    smsBody,
    webhookPayload: {
      eventType: body.eventType || 'custom_action',
      actionLabel: body.actionLabel || 'Action Trigger',
      contractCompanyId: body.contractCompanyId || '',
      contractCompanyName: body.contractCompanyName || '',
      triggeredByUid: req.authUser?.uid || '',
    },
  });

  res.json(result);
});

app.post('/api/alerts/unbilled-email', requireFirebaseAuth, async (req: AuthRequest, res: Response) => {
  const callerEmail = (req.authUser?.email || '').toLowerCase();
  if (callerEmail !== 'arledigt@gmail.com' && req.headers['x-binah-role'] !== 'admin') {
    res.status(403).json({ error: 'Administrator access required to dispatch billing alerts.' });
    return;
  }

  const body = req.body as {
    recipientEmail?: string;
    recipientPhone?: string;
    sendEmail?: boolean;
    sendSms?: boolean;
    subject?: string;
    textBody?: string;
    smsBody?: string;
    items?: Array<{
      sessionId?: string;
      clientInitials?: string;
      partnerCompany?: string;
      dateEt?: string;
      timeRangeEt?: string;
      scheduledHours?: number;
      estimatedRevenue?: number;
      hoursOverdue?: number;
      reasonLabel?: string;
    }>;
  };

  const recipientEmail =
    typeof body.recipientEmail === 'string' && body.recipientEmail.includes('@')
      ? body.recipientEmail.trim()
      : 'arledigt@gmail.com';
  const rawPhone =
    typeof body.recipientPhone === 'string' && body.recipientPhone.trim()
      ? body.recipientPhone.trim()
      : process.env.ADMIN_ALERT_PHONE || '';
  const recipientPhone = normalizePhoneForSmsServer(rawPhone);
  const sendEmail = body.sendEmail !== false;
  const sendSms = body.sendSms === true || (body.sendSms === undefined && Boolean(recipientPhone));
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];

  if (items.length === 0) {
    res.status(400).json({ error: 'At least one overdue session alert item is required.' });
    return;
  }

  const totalRevenue = items.reduce((sum, i) => sum + Number(i.estimatedRevenue || 0), 0);
  const totalHours = items.reduce((sum, i) => sum + Number(i.scheduledHours || 0), 0);
  const subject =
    typeof body.subject === 'string' && body.subject.trim()
      ? body.subject.trim().slice(0, 200)
      : `[BINAH CARE Alert] ${items.length} Unbilled Therapy Session${items.length === 1 ? '' : 's'} (48h+ Overdue · $${totalRevenue.toFixed(2)})`;

  const portalUrl = process.env.APP_URL || 'BINAH CARE Admin Dashboard';
  const textBody =
    typeof body.textBody === 'string' && body.textBody.trim()
      ? body.textBody.trim().slice(0, 8000)
      : [
          'BINAH CARE — Automated 48-Hour Unbilled Session Alert (HIPAA-Safe Summary)',
          `Admin Recipient: ${recipientEmail}`,
          `Overdue Sessions: ${items.length} (${totalHours.toFixed(2)} hrs · $${totalRevenue.toFixed(2)} est. revenue)`,
          '',
          ...items.map(
            (item, idx) =>
              `${idx + 1}. ${item.sessionId || 'ses'} | ${item.clientInitials || 'Client'} | ${item.partnerCompany || 'Partner'} | ${item.dateEt || ''} ${item.timeRangeEt || ''} ET | ${Number(item.scheduledHours || 0).toFixed(2)}h ($${Number(item.estimatedRevenue || 0).toFixed(2)}) | ${Number(item.hoursOverdue || 48).toFixed(1)}h elapsed`
          ),
          '',
          `Open Admin Dashboard: ${portalUrl}`,
        ].join('\n');

  const firstItem = items[0];
  const smsBody =
    typeof body.smsBody === 'string' && body.smsBody.trim()
      ? body.smsBody.trim().slice(0, 480)
      : [
          `BINAH CARE 48h+ Billing Alert: ${items.length} unbilled session${items.length === 1 ? '' : 's'} (${totalHours.toFixed(1)}h · $${totalRevenue.toFixed(2)} est. rev).`,
          firstItem
            ? `Oldest: ${firstItem.partnerCompany || 'Partner'} ${firstItem.dateEt || ''} (${Number(firstItem.hoursOverdue || 48).toFixed(0)}h overdue).`
            : '',
          process.env.APP_URL ? `Portal: ${process.env.APP_URL}` : 'Open Admin Portal to approve billing.',
        ]
          .filter(Boolean)
          .join(' ');

  const escapeHtml = (val: unknown) =>
    String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #181A1F; max-width: 680px; margin: 0 auto; padding: 24px; background: #FAF9F6;">
      <div style="background: #FFFFFF; border: 1px solid #E6E4DF; border-radius: 12px; padding: 24px;">
        <div style="border-bottom: 1px solid #E6E4DF; padding-bottom: 16px; margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 700; color: #0F5C53; letter-spacing: 0.04em;">BINAH CARE · NEW YORK</div>
          <h2 style="margin: 6px 0 4px; font-size: 20px; color: #181A1F;">48-Hour Unbilled Session Alert</h2>
          <p style="margin: 0; font-size: 13px; color: #575B66;">${items.length} session(s) have exceeded 48 hours since ending in Eastern Time without billing approval (${totalHours.toFixed(2)} hrs · $${totalRevenue.toFixed(2)} est. revenue).</p>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="border-bottom: 1px solid #E6E4DF; color: #575B66; text-align: left;">
              <th style="padding: 8px 6px;">Client</th>
              <th style="padding: 8px 6px;">Partner</th>
              <th style="padding: 8px 6px;">Session (ET)</th>
              <th style="padding: 8px 6px; text-align: right;">Hours</th>
              <th style="padding: 8px 6px; text-align: right;">Est. Revenue</th>
              <th style="padding: 8px 6px; text-align: right;">Elapsed</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map(
                (i) => `
              <tr style="border-bottom: 1px solid #F0EEEA;">
                <td style="padding: 8px 6px; font-weight: 600;">${escapeHtml(i.clientInitials || 'Client')}</td>
                <td style="padding: 8px 6px;">${escapeHtml(i.partnerCompany || 'Partner')}</td>
                <td style="padding: 8px 6px;">${escapeHtml(i.dateEt)} · ${escapeHtml(i.timeRangeEt)}</td>
                <td style="padding: 8px 6px; text-align: right;">${Number(i.scheduledHours || 0).toFixed(2)}h</td>
                <td style="padding: 8px 6px; text-align: right;">$${Number(i.estimatedRevenue || 0).toFixed(2)}</td>
                <td style="padding: 8px 6px; text-align: right; color: #B45309; font-weight: 600;">${Number(i.hoursOverdue || 48).toFixed(1)}h</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
        <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #E6E4DF; font-size: 12px; color: #575B66;">
          <p style="margin: 0 0 10px;">HIPAA Notice: Client full names and PHI are omitted from email alerts. Sign in to approve billable hours inside the Admin Dashboard.</p>
          ${process.env.APP_URL ? `<a href="${escapeHtml(process.env.APP_URL)}" style="display: inline-block; padding: 10px 16px; background: #0F5C53; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-weight: 600;">Open BINAH CARE Admin Dashboard</a>` : ''}
        </div>
      </div>
    </div>
  `;

  const result = await dispatchEmailAndSms({
    recipientEmail,
    recipientPhone,
    sendEmail,
    sendSms,
    gmailAccessToken: extractGmailToken(req),
    subject,
    textBody,
    htmlBody,
    smsBody,
    webhookPayload: {
      items,
      totalRevenue,
      totalHours,
    },
  });

  res.json(result);
});

// AI Assistant (Multi-Turn Role-Aware, Yiddish / English, Standard & Fast Gemini Models)
app.post('/api/ai/chat', async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      message?: string;
      history?: Array<{ role: 'user' | 'model'; text: string }>;
      language?: 'en' | 'yi';
      portalContext?: 'public' | 'parent' | 'staff' | 'partner' | 'admin';
      modelTier?: 'standard' | 'fast';
      snapshot?: Record<string, unknown>;
    };

    const userMessage = (body.message || '').trim().slice(0, 4000);
    if (!userMessage) {
      res.status(400).json({ error: 'Message cannot be empty.' });
      return;
    }

    const language = body.language === 'yi' ? 'yi' : 'en';
    const portalContext = body.portalContext || 'public';
    const preferredModel =
      body.modelTier === 'fast' ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';

    if (portalContext !== 'public') {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Sign in required for portal assistant.' });
        return;
      }
      await adminAuth.verifyIdToken(authHeader.slice('Bearer '.length).trim());
    }

    const langDirective =
      language === 'yi'
        ? 'Respond strictly in authentic, natural Heimish אידיש (Yiddish) as spoken in New York Heimish communities (using Hebrew script—write the word אידיש, not ייִדיש, and use natural phrasing such as בס״ד, אונזער, אייער, יישר כח, טעראַפּיסטן/BTs, עלטערן/גאַרדיאַן). Avoid stiff academic YIVO spellings; write naturally like a respectful New York coordinator while keeping acronyms like ABA, IEP, BT, HIPAA, El Heim, and Hilf clear.'
        : 'Respond in clear, respectful English appropriate for families served by our New York office (across Orange County, Monroe, Williamsburg, Borough Park, and Monsey).';

    const policyDirective =
      'BINAH CARE is based in New York and has both male and female Behavior Technicians and care coordinators to thoughtfully match family preferences. Never state that staff are male-only, and never use restricted community sect names.';

    const roleDirective =
      portalContext === 'admin'
        ? 'You are assisting a BINAH CARE Administrator in New York. You can analyze partner billing (El Heim, Hilf, and additional contract partners), BT payroll, scheduled vs. approved billable hours (Eastern Time 12-hour AM/PM), and company profit margins.'
        : portalContext === 'partner'
          ? 'You are assisting an authorized Contract Company Partner Representative (e.g. Hilf or El Heim) in New York. Only discuss clients, intake checklists, and Eastern Time schedules assigned to their own contract company. Never reveal or speculate on BINAH CARE internal BT pay rates, other contract companies, or BINAH CARE profit margins.'
          : portalContext === 'staff'
            ? 'You are assisting an authorized BINAH CARE Staff Coordinator / Behavior Technician in New York. Help with schedules in American Eastern Time (12-hour AM/PM), separating scheduled hours from approved billable hours, and missing document checklists. Never fabricate financial margins.'
            : portalContext === 'parent'
              ? 'You are assisting a Parent / Guardian in the BINAH CARE Parent Portal (New York). Help explain required ABA intake documents (Rx/Prescription, Psychological Evaluation, IEP/IFSP, Insurance Card, HIPAA Consent), application status steps, BT matching, and upcoming therapy sessions in Eastern Time 12-hour AM/PM.'
              : 'You are the BINAH CARE public coordinator based in New York (serving Orange County, Monroe, Williamsburg, Borough Park, and Monsey). Answer questions about ABA coordination services, אידיש and English support, HIPAA-compliant intake, and how to register.';

    const contextData = body.snapshot
      ? `\n\nCurrent Authorized Workspace Context:\n${JSON.stringify(body.snapshot)}`
      : '';

    const systemInstruction = `You are the BINAH CARE AI Coordination Assistant.\n${policyDirective}\n${roleDirective}\n${langDirective}\nAlways use American Eastern Time (ET) and 12-hour AM/PM format when mentioning times. Keep answers concise, structured, and grounded strictly in the provided context.${contextData}`;

    const ai = getGeminiClient();
    const chatHistory = (Array.isArray(body.history) ? body.history : [])
      .filter((item) => item && typeof item.text === 'string' && item.text.trim().length > 0)
      .slice(-12)
      .map((item) => ({
        role: item.role === 'model' ? ('model' as const) : ('user' as const),
        parts: [{ text: item.text.slice(0, 4000) }],
      }));

    const sendChatWithModel = async (model: string) => {
      const chat = ai.chats.create({
        model,
        history: chatHistory,
        config: {
          systemInstruction,
        },
      });
      return chat.sendMessage({ message: userMessage });
    };

    let modelUsed = preferredModel;
    let response;
    try {
      response = await runWithGeminiRetry(() => sendChatWithModel(preferredModel), 1);
    } catch (primaryErr) {
      if (preferredModel === 'gemini-4-hydrogen' && isTransientGeminiError(primaryErr)) {
        modelUsed = 'gemini-3.1-flash-lite';
        response = await runWithGeminiRetry(() => sendChatWithModel(modelUsed), 1);
      } else {
        throw primaryErr;
      }
    }

    res.json({ reply: response.text || '', modelUsed });
  } catch (error) {
    console.error('AI Chat Error:', error);
    const formatted = formatGeminiApiError(error, 'Unable to reach AI assistant.');
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// AI Document Recognition (Image / PDF / Text Intake Extraction)
app.post('/api/ai/analyze-document', requireFirebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      fileName?: string;
      mimeType?: string;
      base64Data?: string;
      textContent?: string;
      language?: 'en' | 'yi';
    };

    const fileName = (body.fileName || 'uploaded-document').trim();
    const mimeType = body.mimeType || 'text/plain';
    const language = body.language === 'yi' ? 'yi' : 'en';

    if (!body.base64Data && !body.textContent) {
      res.status(400).json({ error: 'Please upload a document file or paste document text to analyze.' });
      return;
    }

    const ai = getGeminiClient();
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    if (body.base64Data && (mimeType.startsWith('image/') || mimeType === 'application/pdf')) {
      parts.push({
        inlineData: {
          mimeType,
          data: body.base64Data,
        },
      });
    }

    const promptText = `Analyze this ABA intake document for BINAH CARE in New York (file name: "${fileName}").
Classify its document type, extract key clinical/administrative fields (do not invent fields not present; leave empty string if absent), summarize its contents in ${language === 'yi' ? 'authentic Heimish אידיש (Hebrew script, write אידיש not ייִדיש, e.g. אונזער / אייער / דאָקטער)' : 'English'}, list any missing or unclear items (such as missing signature, missing NPI, expired date, or missing back of insurance card), and map it to the matching checklist key.
${body.textContent ? `\nDocument Text Content:\n${body.textContent.slice(0, 12000)}` : ''}`;

    parts.push({ text: promptText });

    const response = await runWithGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              docType: {
                type: Type.STRING,
                description: "One of: rx, evaluation, insurance, iep, hipaaConsent, other",
              },
              confidence: {
                type: Type.INTEGER,
                description: "Confidence score from 0 to 100",
              },
              summary: {
                type: Type.STRING,
                description: "Concise summary of the document in the requested language",
              },
              childName: { type: Type.STRING },
              providerName: { type: Type.STRING },
              memberId: { type: Type.STRING },
              effectiveDate: { type: Type.STRING },
              recommendedHoursPerWeek: { type: Type.STRING },
              diagnosisCode: { type: Type.STRING },
              missingOrUnclearItems: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              recommendedChecklistKey: {
                type: Type.STRING,
                description: "One of: rx, evaluation, insurance, iep, hipaaConsent, none",
              },
            },
            required: [
              'docType',
              'confidence',
              'summary',
              'missingOrUnclearItems',
              'recommendedChecklistKey',
            ],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({ analysis: parsed });
  } catch (error) {
    console.error('Document Recognition Error:', error);
    const formatted = formatGeminiApiError(error, 'Failed to analyze document.');
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// AI Automatic Reminder Generator (English / Yiddish)
app.post('/api/ai/generate-reminder', requireFirebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      clientName?: string;
      parentName?: string;
      missingDocs?: string[];
      pendingSessionsCount?: number;
      recipientRole?: 'parent' | 'staff';
      language?: 'en' | 'yi';
    };

    const language = body.language === 'yi' ? 'yi' : 'en';
    const recipientRole = body.recipientRole === 'staff' ? 'staff' : 'parent';
    const ai = getGeminiClient();

    const prompt = `Draft a polite, clear, HIPAA-safe BINAH CARE reminder message (avoid including sensitive diagnostic details in subject/body).
Note: BINAH CARE is based in New York and serves families with both male and female Behavior Technicians and coordinators.
Recipient Role: ${recipientRole}
Language: ${language === 'yi' ? 'Authentic Heimish אידיש (Hebrew script, write אידיש not ייִדיש, e.g. בס״ד, אונזער, אייער, יישר כח)' : 'English'}
Client First Name / Label: ${body.clientName || 'Client'}
Parent / Guardian Name: ${body.parentName || 'Parent'}
Missing Documents: ${(body.missingDocs || []).join(', ') || 'None'}
Pending Unapproved Completed Sessions: ${body.pendingSessionsCount ?? 0}

Return a concise subject line and a warm, respectful, actionable body.`;

    const response = await runWithGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subject: { type: Type.STRING },
              body: { type: Type.STRING },
            },
            required: ['subject', 'body'],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({ reminder: parsed });
  } catch (error) {
    console.error('Generate Reminder Error:', error);
    const formatted = formatGeminiApiError(error, 'Failed to generate reminder.');
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// AI Business & Financial Analytics (Admin)
app.post('/api/ai/financial-analytics', requireFirebaseAuth, async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as {
      metrics?: Record<string, unknown>;
      language?: 'en' | 'yi';
    };

    const language = body.language === 'yi' ? 'yi' : 'en';
    const ai = getGeminiClient();

    const prompt = `You are the BINAH CARE Operations & Financial Analyst. Review these real-time operational and financial metrics for BINAH CARE (ABA coordination company based in New York working with El Heim, Hilf, and partner companies).
Note: Scheduled hours and approved billable hours are tracked separately. All times are America/New_York 12-hour AM/PM.
Language for output: ${language === 'yi' ? 'Authentic Heimish אידיש (Hebrew script, write אידיש not ייִדיש, e.g. אונזער, פאַרדינסט, פּראָפֿיט, יישר כח)' : 'English'}.

Metrics Payload:
${JSON.stringify(body.metrics || {}, null, 2)}

Provide:
1. An executiveSummary (2-3 sentences).
2. 3 concrete profitabilityInsights comparing partner revenue, BT payouts, and scheduled-vs-billable conversion.
3. 2-3 bottleneckAlerts (e.g., missing intake checklists or unapproved completed sessions blocking billing).
4. 3 recommendedActions for the administrator.`;

    const response = await runWithGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              executiveSummary: { type: Type.STRING },
              profitabilityInsights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              bottleneckAlerts: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              recommendedActions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: [
              'executiveSummary',
              'profitabilityInsights',
              'bottleneckAlerts',
              'recommendedActions',
            ],
          },
        },
      })
    );

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({ analytics: parsed });
  } catch (error) {
    console.error('Financial Analytics Error:', error);
    const formatted = formatGeminiApiError(error, 'Failed to generate financial analytics.');
    res.status(formatted.status).json({ error: formatted.message });
  }
});

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BINAH CARE server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start BINAH CARE server:', err);
  process.exit(1);
});
