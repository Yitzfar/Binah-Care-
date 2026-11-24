import React, { useMemo, useState } from 'react';
import { BarChart3, BellRing } from 'lucide-react';
import { CHECKLIST_LABELS, getCopy } from '../i18n/translations';
import {
  generateFinancialAnalyticsWithAi,
  generateReminderWithAi,
} from '../lib/aiClient';
import { countMissingDocs, saveReminder } from '../lib/firestoreService';
import {
  triggerActionNotification,
  type DispatchedTriggerOutcome,
} from '../lib/triggers';
import type {
  AdminAlertSettings,
  ClientApplication,
  ContractCompany,
  FinancialAiAnalytics,
  Language,
  PartnerDirectoryEntry,
  PartnerPayment,
  TherapySession,
  UserProfile,
} from '../types/binah';
import { ActionTriggerCheckboxes, TriggerOutcomeBanner } from './ActionTriggerBar';
import { GeminiChatbot } from './GeminiChatbot';

interface AiAutomationHubProps {
  user: UserProfile;
  language: Language;
  clients: ClientApplication[];
  sessions: TherapySession[];
  contractCompanies: ContractCompany[];
  partnerPayments: PartnerPayment[];
  partnerDirectory: PartnerDirectoryEntry[];
  alertSettings?: AdminAlertSettings | null;
}

export const AiAutomationHub: React.FC<AiAutomationHubProps> = ({
  user,
  language,
  clients,
  sessions,
  contractCompanies,
  partnerPayments,
  partnerDirectory,
  alertSettings,
}) => {
  const t = getCopy(language);

  // Automatic Reminder Generator
  const [remClientId, setRemClientId] = useState(clients[0]?.clientId || '');
  const [remLang, setRemLang] = useState<Language>(language);
  const [remLoading, setRemLoading] = useState(false);
  const [remDraft, setRemDraft] = useState<{ subject: string; body: string } | null>(null);
  const [remSaved, setRemSaved] = useState(false);
  const [remTriggerEmail, setRemTriggerEmail] = useState(true);
  const [remTriggerSms, setRemTriggerSms] = useState(false);
  const [triggerOutcome, setTriggerOutcome] = useState<DispatchedTriggerOutcome | null>(null);

  // Admin Financial Analytics
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analytics, setAnalytics] = useState<FinancialAiAnalytics | null>(null);
  const [aiError, setAiError] = useState('');

  const operationalSnapshot = useMemo(() => {
    if (user.role === 'parent') {
      const own = clients.filter((c) => c.parentUid === user.uid);
      return {
        children: own.map((c) => ({
          name: `${c.childFirstName} ${c.childLastName}`,
          status: c.status,
          missingDocs: countMissingDocs(c.checklist),
        })),
      };
    }
    return {
      clientCount: clients.length,
      sessionCount: sessions.length,
      scheduledHours: sessions.reduce((acc, s) => acc + (s.scheduledHours || 0), 0),
      approvedBillableHours: sessions
        .filter((s) => s.status === 'approved_billable')
        .reduce((acc, s) => acc + (s.approvedBillableHours || 0), 0),
      ...(user.role === 'admin'
        ? {
            partnerCompanies: contractCompanies.map((c) => ({
              name: c.name,
              billingRatePerHour: c.billingRatePerHour,
              defaultBtPayPerHour: c.defaultBtPayPerHour,
            })),
            partnerPaymentsCount: partnerPayments.length,
          }
        : {}),
    };
  }, [user.role, user.uid, clients, sessions, contractCompanies, partnerPayments]);

  const handleGenerateReminder = async () => {
    const targetClient = clients.find((c) => c.clientId === remClientId) || clients[0];
    if (!targetClient) return;
    setAiError('');
    setRemSaved(false);
    setRemLoading(true);
    try {
      const missingKeys = countMissingDocs(targetClient.checklist);
      const missingLabels = missingKeys.map((k) => CHECKLIST_LABELS[k][remLang]);
      const pendingSessionsCount = sessions.filter(
        (s) => s.clientId === targetClient.clientId && s.status === 'completed'
      ).length;

      const draft = await generateReminderWithAi({
        clientName: `${targetClient.childFirstName} ${targetClient.childLastName}`,
        parentName: targetClient.parentName,
        missingDocs: missingLabels,
        pendingSessionsCount,
        recipientRole: 'parent',
        language: remLang,
      });
      setRemDraft(draft);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to generate reminder.');
    } finally {
      setRemLoading(false);
    }
  };

  const handleDispatchReminder = async () => {
    if (!remDraft) return;
    const targetClient = clients.find((c) => c.clientId === remClientId) || clients[0];
    if (!targetClient) return;
    setAiError('');
    setRemLoading(true);
    try {
      await saveReminder({
        targetUid: targetClient.parentUid,
        clientId: targetClient.clientId,
        clientName: `${targetClient.childFirstName} ${targetClient.childLastName}`,
        recipientRole: 'parent',
        language: remLang,
        subject: remDraft.subject,
        body: remDraft.body,
        createdByUid: user.uid,
      });
      if (remTriggerEmail || remTriggerSms) {
        const outcome = await triggerActionNotification({
          user,
          eventType: 'reminder_sent',
          actionLabel: 'Bilingual Reminder Dispatched',
          contractCompanyId: targetClient.contractCompanyId,
          contractCompanyName: targetClient.contractCompanyName,
          partnerUids: targetClient.partnerUids,
          clientId: targetClient.clientId,
          clientName: `${targetClient.childFirstName} ${targetClient.childLastName}`,
          summaryDetails: `Reminder sent (${remLang === 'yi' ? 'אידיש' : 'English'}): ${remDraft.subject}`,
          channels: {
            sendEmail: remTriggerEmail,
            sendSms: remTriggerSms,
            recipientEmail: targetClient.parentEmail || undefined,
            recipientPhone: targetClient.parentPhone || undefined,
          },
          partnerDirectory,
          alertSettings,
          language,
        }).catch(() => null);
        if (outcome) setTriggerOutcome(outcome);
      }
      setRemSaved(true);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to save and dispatch reminder.');
    } finally {
      setRemLoading(false);
    }
  };

  const handleRunAnalytics = async () => {
    setAiError('');
    setAnalyticsLoading(true);
    try {
      const result = await generateFinancialAnalyticsWithAi({
        metrics: {
          ...operationalSnapshot,
          missingChecklistClients: clients
            .map((c) => ({
              name: `${c.childFirstName} ${c.childLastName}`,
              missing: countMissingDocs(c.checklist),
            }))
            .filter((c) => c.missing.length > 0),
          unapprovedCompletedSessions: sessions.filter((s) => s.status === 'completed').length,
          totalPaymentsReceived: partnerPayments.reduce((a, p) => a + p.amount, 0),
        },
        language,
      });
      setAnalytics(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to run analytics.');
    } finally {
      setAnalyticsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="pb-5 border-b border-[#E6E4DF]">
        <h1 className="text-2xl font-bold tracking-tight text-[#181A1F]">{t.tabAi}</h1>
        <p className="mt-1 text-sm text-[#575B66]">
          {language === 'yi'
            ? 'צוויי־שפּראַכיקע AI הילף, אויטאָמאַטישע דערמאָנונגען, און געשעפט־אַנאַליטיקס.'
            : 'Role-isolated AI assistant, automated bilingual reminders, and executive operational analytics.'}
        </p>
      </div>

      {aiError && (
        <div className="p-4 bg-white border border-[#B91C1C]/40 rounded-lg text-xs text-[#B91C1C]">
          {aiError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Role-Aware Multi-Turn Gemini Chatbot */}
        <div className="lg:col-span-6">
          <GeminiChatbot
            language={language}
            portalContext={user.role}
            snapshot={operationalSnapshot}
            variant="panel"
          />
        </div>

        {/* Staff & Admin: Automatic Reminders + Admin Business Analytics */}
        <div className="lg:col-span-6 space-y-6">
          {user.role !== 'parent' && (
            <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-[#E6E4DF]">
                <BellRing className="w-4 h-4 text-[#0F5C53]" />
                <h2 className="text-base font-semibold text-[#181A1F]">
                  Automated Bilingual Reminders
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={remClientId || clients[0]?.clientId || ''}
                  onChange={(e) => {
                    setRemClientId(e.target.value);
                    setRemDraft(null);
                    setRemSaved(false);
                  }}
                  className="px-3 py-2 text-xs border border-[#E6E4DF] rounded-lg bg-white"
                >
                  {clients.map((c) => (
                    <option key={c.clientId} value={c.clientId}>
                      {c.childFirstName} {c.childLastName} ({countMissingDocs(c.checklist).length} missing)
                    </option>
                  ))}
                </select>
                <select
                  value={remLang}
                  onChange={(e) => {
                    setRemLang(e.target.value as Language);
                    setRemDraft(null);
                    setRemSaved(false);
                  }}
                  className="px-3 py-2 text-xs border border-[#E6E4DF] rounded-lg bg-white"
                >
                  <option value="en">Draft in English</option>
                  <option value="yi">Draft in אידיש (Yiddish)</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleGenerateReminder}
                disabled={remLoading || clients.length === 0}
                className="px-4 py-2 bg-[#0F5C53] text-white text-xs font-medium rounded-lg hover:bg-[#0B4740] disabled:opacity-50"
              >
                {remLoading ? 'Drafting Reminder...' : 'Generate Missing-Doc Reminder'}
              </button>

              {remDraft && (
                <div className="p-4 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg space-y-3 text-xs">
                  <p className="font-semibold text-[#181A1F]">{remDraft.subject}</p>
                  <p className="text-[#575B66] whitespace-pre-line leading-relaxed">{remDraft.body}</p>
                  <ActionTriggerCheckboxes
                    language={language}
                    sendEmail={remTriggerEmail}
                    sendSms={remTriggerSms}
                    onChangeEmail={setRemTriggerEmail}
                    onChangeSms={setRemTriggerSms}
                    compact
                  />
                  <div className="pt-1 flex items-center justify-between">
                    {remSaved ? (
                      <span className="text-[#16A34A] font-medium">
                        Saved to parent reminders inbox &amp; triggers processed.
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleDispatchReminder}
                        disabled={remLoading}
                        className="px-3 py-1.5 bg-[#0F5C53] text-white rounded-md font-medium disabled:opacity-50"
                      >
                        Send to Parent Portal
                      </button>
                    )}
                  </div>
                </div>
              )}
              <TriggerOutcomeBanner
                outcome={triggerOutcome}
                onDismiss={() => setTriggerOutcome(null)}
              />
            </div>
          )}

          {user.role === 'admin' && (
            <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#E6E4DF]">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#0F5C53]" />
                  <h2 className="text-base font-semibold text-[#181A1F]">
                    AI Financial &amp; Operations Report
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handleRunAnalytics}
                  disabled={analyticsLoading}
                  className="px-3.5 py-1.5 bg-[#0F5C53] text-white text-xs font-medium rounded-lg hover:bg-[#0B4740] disabled:opacity-50"
                >
                  {analyticsLoading ? 'Analyzing...' : 'Generate Executive Report'}
                </button>
              </div>

              {analytics ? (
                <div className="space-y-4 text-xs">
                  <p className="text-[#181A1F] leading-relaxed font-medium">
                    {analytics.executiveSummary}
                  </p>
                  <div>
                    <h4 className="font-semibold text-[#0F5C53] mb-1">Profitability Insights</h4>
                    <ul className="list-disc pl-4 space-y-1 text-[#575B66]">
                      {analytics.profitabilityInsights.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold text-[#B45309] mb-1">Operational Bottlenecks</h4>
                    <ul className="list-disc pl-4 space-y-1 text-[#575B66]">
                      {analytics.bottleneckAlerts.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold text-[#181A1F] mb-1">Recommended Next Steps</h4>
                    <ul className="list-disc pl-4 space-y-1 text-[#575B66]">
                      {analytics.recommendedActions.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#575B66]">
                  Run an AI operational &amp; profitability audit across El Heim, Hilf, scheduled vs.
                  approved billable hours, and pending client checklists.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
