import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Mail, MessageSquare, Send, X } from 'lucide-react';
import { getCopy } from '../i18n/translations';
import {
  resolveTriggerTargets,
  triggerActionNotification,
  type DispatchedTriggerOutcome,
  type TriggerChannelChoice,
} from '../lib/triggers';
import type {
  AdminAlertSettings,
  Language,
  PartnerDirectoryEntry,
  TriggerEventType,
  UserProfile,
} from '../types/binah';

interface ActionTriggerCheckboxesProps {
  language: Language;
  sendEmail: boolean;
  sendSms: boolean;
  onChangeEmail: (val: boolean) => void;
  onChangeSms: (val: boolean) => void;
  targetSummary?: string;
  compact?: boolean;
}

export const ActionTriggerCheckboxes: React.FC<ActionTriggerCheckboxesProps> = ({
  language,
  sendEmail,
  sendSms,
  onChangeEmail,
  onChangeSms,
  targetSummary,
  compact = false,
}) => {
  const t = getCopy(language);
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 ${
        compact
          ? 'px-3 py-2 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg'
          : 'px-3.5 py-2.5 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg'
      }`}
    >
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-[11px] font-semibold text-[#575B66] uppercase tracking-wider">
          {language === 'yi' ? 'אַקציע טריגערס:' : 'Action Triggers:'}
        </span>
        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#181A1F] cursor-pointer">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => onChangeEmail(e.target.checked)}
            className="rounded border-[#E6E4DF] text-[#0F5C53]"
          />
          <Mail className="w-3.5 h-3.5 text-[#0F5C53]" />
          <span>{t.triggerEmailLabel}</span>
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#181A1F] cursor-pointer">
          <input
            type="checkbox"
            checked={sendSms}
            onChange={(e) => onChangeSms(e.target.checked)}
            className="rounded border-[#E6E4DF] text-[#0F5C53]"
          />
          <MessageSquare className="w-3.5 h-3.5 text-[#0F5C53]" />
          <span>{t.triggerSmsLabel}</span>
        </label>
      </div>
      {targetSummary && (
        <span className="text-[11px] font-mono text-[#575B66] truncate max-w-full">
          {targetSummary}
        </span>
      )}
    </div>
  );
};

interface TriggerOutcomeBannerProps {
  outcome: DispatchedTriggerOutcome | null;
  onDismiss: () => void;
}

export const TriggerOutcomeBanner: React.FC<TriggerOutcomeBannerProps> = ({
  outcome,
  onDismiss,
}) => {
  if (!outcome) return null;
  const emailStatus = outcome.response.emailStatus ?? outcome.response.status;
  const smsStatus = outcome.response.smsStatus ?? 'disabled';
  const emailSent = emailStatus === 'sent';
  const smsSent = smsStatus === 'sent';
  const anyFailed = emailStatus === 'failed' || smsStatus === 'failed';
  const anyQueued = emailStatus === 'queued_no_smtp' || smsStatus === 'queued_no_sms';

  const showMailto =
    emailStatus && emailStatus !== 'sent' && emailStatus !== 'disabled';
  const showSmsLink =
    smsStatus && smsStatus !== 'sent' && smsStatus !== 'disabled';

  const borderClass = anyFailed
    ? 'border-[#B91C1C]/40 bg-[#FEF2F2]'
    : anyQueued
      ? 'border-[#F59E0B]/50 bg-[#FFFBEB]'
      : 'border-[#16A34A]/40 bg-white';

  return (
    <div className={`p-3.5 border rounded-lg text-xs space-y-2 ${borderClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {anyFailed ? (
            <AlertCircle className="w-4 h-4 text-[#B91C1C] shrink-0 mt-0.5" />
          ) : anyQueued ? (
            <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
          )}
          <div>
            <p className="font-semibold text-[#181A1F]">{outcome.subject}</p>
            <p className="mt-0.5 text-[#575B66]">{outcome.response.message}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[#575B66] hover:text-[#181A1F] p-0.5"
          aria-label="Dismiss trigger notice"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {(!emailSent || !smsSent) && (showMailto || showSmsLink) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {showMailto && (
            <a
              href={outcome.mailtoUrl}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#0F5C53] text-white text-[11px] font-medium rounded hover:bg-[#0B4740] whitespace-nowrap shrink-0"
            >
              <Mail className="w-3 h-3" />
              <span>Open Email Draft ({outcome.recipientEmail})</span>
            </a>
          )}
          {showSmsLink && (
            <a
              href={outcome.smsUri}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#181A1F] text-white text-[11px] font-medium rounded hover:bg-[#2F333D] whitespace-nowrap shrink-0"
            >
              <MessageSquare className="w-3 h-3" />
              <span>Open Text / SMS Draft</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
};

interface QuickActionTriggerProps {
  user: UserProfile;
  language: Language;
  eventType: TriggerEventType;
  actionLabel: string;
  contractCompanyId?: string;
  contractCompanyName?: string;
  partnerUids?: string[];
  clientId?: string;
  clientName?: string;
  defaultSummary: string;
  partnerDirectory: PartnerDirectoryEntry[];
  alertSettings?: AdminAlertSettings | null;
  onDispatched?: (outcome: DispatchedTriggerOutcome) => void;
  buttonLabel?: string;
}

export const QuickActionTriggerButton: React.FC<QuickActionTriggerProps> = ({
  user,
  language,
  eventType,
  actionLabel,
  contractCompanyId,
  contractCompanyName,
  partnerUids,
  clientId,
  clientName,
  defaultSummary,
  partnerDirectory,
  alertSettings,
  onDispatched,
  buttonLabel,
}) => {
  const t = getCopy(language);
  const [open, setOpen] = useState(false);
  const targets = resolveTriggerTargets({
    contractCompanyId,
    partnerDirectory,
    alertSettings,
  });

  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(Boolean(targets.recipientPhone));
  const [customEmail, setCustomEmail] = useState(targets.recipientEmail);
  const [customPhone, setCustomPhone] = useState(targets.recipientPhone);
  const [summary, setSummary] = useState(defaultSummary);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  const handleOpen = () => {
    setCustomEmail(targets.recipientEmail);
    setCustomPhone(targets.recipientPhone);
    setSummary(defaultSummary);
    setErr('');
    setOpen((v) => !v);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendEmail && !sendSms) {
      setErr('Select Email and/or Text (SMS) channel.');
      return;
    }
    setSending(true);
    setErr('');
    try {
      const channels: TriggerChannelChoice = {
        sendEmail,
        sendSms,
        recipientEmail: customEmail.trim() || targets.recipientEmail,
        recipientPhone: customPhone.trim(),
      };
      const outcome = await triggerActionNotification({
        user,
        eventType,
        actionLabel,
        contractCompanyId,
        contractCompanyName,
        partnerUids,
        clientId,
        clientName,
        summaryDetails: summary,
        channels,
        partnerDirectory,
        alertSettings,
        language,
      });
      if (outcome && onDispatched) {
        onDispatched(outcome);
      }
      setOpen(false);
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to send trigger.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="inline-block text-left">
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-[#E6E4DF] bg-white text-[#181A1F] rounded-md hover:border-[#0F5C53] whitespace-nowrap shrink-0"
      >
        <Send className="w-3 h-3 text-[#0F5C53]" />
        <span>{buttonLabel || t.sendTriggerBtn}</span>
      </button>

      {open && (
        <form
          onSubmit={handleSend}
          className="mt-2 p-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg space-y-2.5 min-w-[280px] max-w-[380px]"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#181A1F]">{actionLabel}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[#575B66] hover:text-[#181A1F]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#181A1F] cursor-pointer">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              <span>{t.triggerEmailLabel}</span>
            </label>
            <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#181A1F] cursor-pointer">
              <input
                type="checkbox"
                checked={sendSms}
                onChange={(e) => setSendSms(e.target.checked)}
              />
              <span>{t.triggerSmsLabel}</span>
            </label>
          </div>

          {sendEmail && (
            <input
              type="email"
              required
              value={customEmail}
              onChange={(e) => setCustomEmail(e.target.value)}
              placeholder="Recipient Email"
              className="w-full px-2.5 py-1.5 text-[11px] font-mono bg-white border border-[#E6E4DF] rounded"
            />
          )}
          {sendSms && (
            <input
              type="tel"
              value={customPhone}
              onChange={(e) => setCustomPhone(e.target.value)}
              placeholder="Mobile Phone (SMS)"
              className="w-full px-2.5 py-1.5 text-[11px] font-mono bg-white border border-[#E6E4DF] rounded"
            />
          )}
          <textarea
            rows={2}
            required
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full px-2.5 py-1.5 text-[11px] bg-white border border-[#E6E4DF] rounded"
          />
          {err && <p className="text-[11px] text-[#B91C1C]">{err}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-2.5 py-1 text-[11px] text-[#575B66] border border-[#E6E4DF] rounded bg-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending}
              className="px-3 py-1 text-[11px] font-medium bg-[#0F5C53] text-white rounded hover:bg-[#0B4740] disabled:opacity-50"
            >
              {sending ? 'Sending...' : t.sendTriggerBtn}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
