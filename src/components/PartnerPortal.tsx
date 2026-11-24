import React, { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  Settings2,
} from 'lucide-react';
import {
  CHECKLIST_LABELS,
  getCopy,
  SESSION_STATUS_LABELS,
  STATUS_LABELS,
} from '../i18n/translations';
import {
  countMissingDocs,
  fetchClientDocuments,
  updateClientCoordination,
  updateClientDocumentReview,
  updatePartnerNotificationSettings,
} from '../lib/firestoreService';
import { formatEtDateLabel } from '../lib/timeEt';
import {
  triggerActionNotification,
  type DispatchedTriggerOutcome,
} from '../lib/triggers';
import type {
  AdminAlertSettings,
  ApplicationStatus,
  ChecklistKey,
  ClientApplication,
  ClientDocument,
  Language,
  PartnerDirectoryEntry,
  TherapySession,
  TriggerLog,
  UserProfile,
} from '../types/binah';
import {
  ActionTriggerCheckboxes,
  QuickActionTriggerButton,
  TriggerOutcomeBanner,
} from './ActionTriggerBar';

interface PartnerPortalProps {
  user: UserProfile;
  language: Language;
  clients: ClientApplication[];
  sessions: TherapySession[];
  partnerDirectory: PartnerDirectoryEntry[];
  triggerLogs: TriggerLog[];
  alertSettings?: AdminAlertSettings | null;
  isAdminPreview?: boolean;
}

const CHECKLIST_KEYS: ChecklistKey[] = ['rx', 'evaluation', 'insurance', 'iep', 'hipaaConsent'];

export const PartnerPortal: React.FC<PartnerPortalProps> = ({
  user,
  language,
  clients,
  sessions,
  partnerDirectory,
  triggerLogs,
  alertSettings,
  isAdminPreview = false,
}) => {
  const t = getCopy(language);

  const [previewCompanyId, setPreviewCompanyId] = useState<string>(
    user.contractCompanyId || partnerDirectory[0]?.companyId || ''
  );

  const activeCompanyId =
    user.role === 'partner'
      ? user.contractCompanyId || ''
      : previewCompanyId || partnerDirectory[0]?.companyId || '';

  const activePartner = useMemo(
    () => partnerDirectory.find((p) => p.companyId === activeCompanyId) || null,
    [partnerDirectory, activeCompanyId]
  );

  // Strict Company Isolation: Partner only sees clients, sessions, and logs belonging to their own company
  const scopedClients = useMemo(() => {
    if (!activeCompanyId) return [];
    return clients.filter((c) => c.contractCompanyId === activeCompanyId);
  }, [clients, activeCompanyId]);

  const scopedSessions = useMemo(() => {
    if (!activeCompanyId) return [];
    return sessions.filter((s) => s.contractCompanyId === activeCompanyId);
  }, [sessions, activeCompanyId]);

  const scopedTriggerLogs = useMemo(() => {
    if (!activeCompanyId) return [];
    return triggerLogs.filter((l) => l.contractCompanyId === activeCompanyId);
  }, [triggerLogs, activeCompanyId]);

  const [searchTerm, setSearchTerm] = useState('');
  const filteredClients = useMemo(() => {
    if (!searchTerm.trim()) return scopedClients;
    const q = searchTerm.toLowerCase();
    return scopedClients.filter(
      (c) =>
        `${c.childFirstName} ${c.childLastName}`.toLowerCase().includes(q) ||
        c.parentName.toLowerCase().includes(q) ||
        (c.borough || '').toLowerCase().includes(q)
    );
  }, [scopedClients, searchTerm]);

  // Trigger Channel Preferences on All Partner Actions
  const [sendEmailOnAction, setSendEmailOnAction] = useState(true);
  const [sendSmsOnAction, setSendSmsOnAction] = useState(false);
  const [triggerOutcome, setTriggerOutcome] = useState<DispatchedTriggerOutcome | null>(null);
  const [actionError, setActionError] = useState('');

  // Partner Notification Settings Drawer
  const [showSettings, setShowSettings] = useState(false);
  const [notifEmail, setNotifEmail] = useState(activePartner?.notificationEmail || '');
  const [notifPhone, setNotifPhone] = useState(activePartner?.notificationPhone || '');
  const [autoSignup, setAutoSignup] = useState(activePartner?.autoTriggerOnSignup ?? true);
  const [autoActions, setAutoActions] = useState(activePartner?.autoTriggerOnActions ?? true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState('');

  useEffect(() => {
    if (activePartner) {
      setNotifEmail(activePartner.notificationEmail || '');
      setNotifPhone(activePartner.notificationPhone || '');
      setAutoSignup(activePartner.autoTriggerOnSignup);
      setAutoActions(activePartner.autoTriggerOnActions);
    }
  }, [activePartner?.companyId, activePartner?.notificationEmail, activePartner?.notificationPhone]);

  // Document Inspector per Client
  const [openDocsClientId, setOpenDocsClientId] = useState<string | null>(null);
  const [docsByClient, setDocsByClient] = useState<Record<string, ClientDocument[]>>({});
  const [loadingDocsId, setLoadingDocsId] = useState<string | null>(null);

  const metrics = useMemo(() => {
    let scheduledHours = 0;
    let approvedHours = 0;
    let missingChecklistItems = 0;
    for (const c of scopedClients) {
      missingChecklistItems += countMissingDocs(c.checklist).length;
    }
    for (const s of scopedSessions) {
      if (s.status !== 'cancelled') scheduledHours += s.scheduledHours || 0;
      if (s.status === 'approved_billable') approvedHours += s.approvedBillableHours || 0;
    }
    return {
      clientsCount: scopedClients.length,
      missingChecklistItems,
      scheduledHours: Math.round(scheduledHours * 100) / 100,
      approvedHours: Math.round(approvedHours * 100) / 100,
    };
  }, [scopedClients, scopedSessions]);

  const handleSavePartnerSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSavingSettings(true);
    setSettingsSavedMsg('');
    setActionError('');
    try {
      await updatePartnerNotificationSettings(
        activeCompanyId,
        {
          notificationEmail: notifEmail,
          notificationPhone: notifPhone,
          autoTriggerOnSignup: autoSignup,
          autoTriggerOnActions: autoActions,
        },
        user.role === 'admin'
      );
      setSettingsSavedMsg(
        language === 'yi'
          ? 'שותף אימעיל & טעקסט טריגערס זענען געהיטן געוואָרן.'
          : 'Partner signup email & action trigger preferences saved.'
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to save notification settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleToggleDocs = async (client: ClientApplication) => {
    if (openDocsClientId === client.clientId) {
      setOpenDocsClientId(null);
      return;
    }
    setOpenDocsClientId(client.clientId);
    setLoadingDocsId(client.clientId);
    setActionError('');
    try {
      const docs = await fetchClientDocuments(client.clientId, user);
      setDocsByClient((prev) => ({ ...prev, [client.clientId]: docs }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to load client documents.');
    } finally {
      setLoadingDocsId(null);
    }
  };

  const fireTrigger = async (params: {
    eventType: 'status_changed' | 'checklist_verified' | 'document_uploaded';
    actionLabel: string;
    client: ClientApplication;
    summaryDetails: string;
  }) => {
    if (!sendEmailOnAction && !sendSmsOnAction) return;
    try {
      const outcome = await triggerActionNotification({
        user,
        eventType: params.eventType,
        actionLabel: params.actionLabel,
        contractCompanyId: params.client.contractCompanyId,
        contractCompanyName: params.client.contractCompanyName,
        partnerUids: params.client.partnerUids,
        clientId: params.client.clientId,
        clientName: `${params.client.childFirstName} ${params.client.childLastName}`,
        summaryDetails: params.summaryDetails,
        channels: {
          sendEmail: sendEmailOnAction,
          sendSms: sendSmsOnAction,
        },
        partnerDirectory,
        alertSettings,
        language,
      });
      if (outcome) setTriggerOutcome(outcome);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action trigger failed.');
    }
  };

  const handleStatusChange = async (client: ClientApplication, nextStatus: ApplicationStatus) => {
    setActionError('');
    try {
      await updateClientCoordination(client.clientId, { status: nextStatus });
      await fireTrigger({
        eventType: 'status_changed',
        actionLabel: 'Case Status Updated',
        client,
        summaryDetails: `Partner (${activePartner?.name || 'Agency'}) updated case status to ${STATUS_LABELS[nextStatus].en}.`,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update status.');
    }
  };

  const handleToggleChecklist = async (client: ClientApplication, key: ChecklistKey) => {
    setActionError('');
    const nextVal = client.checklist[key] === 'verified' ? 'uploaded' : 'verified';
    try {
      await updateClientCoordination(client.clientId, {
        checklist: {
          ...client.checklist,
          [key]: nextVal,
        },
      });
      await fireTrigger({
        eventType: 'checklist_verified',
        actionLabel: 'Checklist Verification Updated',
        client,
        summaryDetails: `${CHECKLIST_LABELS[key].en} marked as ${nextVal}.`,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update checklist.');
    }
  };

  const handleDocumentReview = async (
    client: ClientApplication,
    docItem: ClientDocument,
    nextStatus: ClientDocument['verificationStatus']
  ) => {
    setActionError('');
    try {
      await updateClientDocumentReview({
        clientId: client.clientId,
        documentId: docItem.documentId,
        verificationStatus: nextStatus,
      });
      const refreshed = await fetchClientDocuments(client.clientId, user);
      setDocsByClient((prev) => ({ ...prev, [client.clientId]: refreshed }));
      await fireTrigger({
        eventType: 'checklist_verified',
        actionLabel: 'Partner Document Review',
        client,
        summaryDetails: `Document "${docItem.fileName}" marked as ${nextStatus.replace('_', ' ')}.`,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update document review.');
    }
  };

  if (!activeCompanyId) {
    return (
      <div className="p-8 bg-white border border-[#E6E4DF] rounded-xl text-center space-y-2">
        <Building2 className="w-6 h-6 text-[#0F5C53] mx-auto" />
        <h2 className="text-base font-semibold text-[#181A1F]">
          {language === 'yi'
            ? 'קיין קאָנטראַקט פֿירמע איז נאָך נישט צוגעטיילט'
            : 'Contract Company Assignment Pending'}
        </h2>
        <p className="text-xs text-[#575B66] max-w-md mx-auto">
          {language === 'yi'
            ? 'אַן אַדמיניסטראַטאָר דאַרף צוטיילן אײַער קאָנטראַקט פֿירמע (למשל הילף אָדער אל היים) כדי איר זאָלט זען אײַערע אייגענע קליענטן.'
            : 'An Administrator must bind your Partner account to a contract company (such as Hilf or El Heim) before isolated client records appear.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#E6E4DF]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[#181A1F]">
              {activePartner?.name || user.contractCompanyName || t.tabPartner}
            </h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-[#0F5C53]/10 text-[#0F5C53] rounded">
              <Lock className="w-3 h-3" />
              <span>{language === 'yi' ? 'בלויז אייגענע קליענטן' : 'Isolated Client Scope'}</span>
            </span>
          </div>
          <p className="mt-1 text-sm text-[#575B66]">
            {language === 'yi'
              ? 'צוטריט אויסשליסליך צו קליענטן, דאָקומענטן, און סעסיעס וואָס זענען צוגעטיילט צו אײַער פֿירמע.'
              : 'Restricted Partner Agency view showing strictly clients, documents, and Eastern Time schedules assigned to your company.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {isAdminPreview && partnerDirectory.length > 0 && (
            <select
              value={activeCompanyId}
              onChange={(e) => setPreviewCompanyId(e.target.value)}
              className="px-3 py-2 text-xs font-medium bg-white border border-[#E6E4DF] rounded-lg"
            >
              {partnerDirectory.map((p) => (
                <option key={p.companyId} value={p.companyId}>
                  Preview: {p.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[#E6E4DF] text-[#181A1F] text-xs font-medium rounded-lg hover:border-[#0F5C53] whitespace-nowrap shrink-0"
          >
            <Settings2 className="w-3.5 h-3.5 text-[#0F5C53]" />
            <span>
              {language === 'yi' ? 'טריגער & אימעיל אײַנשטעלונגען' : 'Signup & Trigger Settings'}
            </span>
          </button>
        </div>
      </div>

      {/* Partner Notification & Signup Trigger Settings Drawer */}
      {showSettings && (
        <form
          onSubmit={handleSavePartnerSettings}
          className="p-5 bg-white border border-[#E6E4DF] rounded-xl space-y-4"
        >
          <div className="flex items-center justify-between border-b border-[#E6E4DF] pb-3">
            <div>
              <h2 className="text-sm font-semibold text-[#181A1F]">
                {activePartner?.name} — Email &amp; Text Trigger Routing
              </h2>
              <p className="text-xs text-[#575B66]">
                Configure where new client signup email triggers and action alerts are sent for your company.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-[11px] font-medium text-[#575B66] mb-1">
                Partner Notification Email
              </label>
              <input
                type="email"
                required
                value={notifEmail}
                onChange={(e) => setNotifEmail(e.target.value)}
                placeholder="intake@hilfcare.org"
                className="w-full px-3 py-2 text-xs font-mono bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#575B66] mb-1">
                Partner SMS / Text Phone
              </label>
              <input
                type="tel"
                value={notifPhone}
                onChange={(e) => setNotifPhone(e.target.value)}
                placeholder="(845) 555-0148"
                className="w-full px-3 py-2 text-xs font-mono bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg"
              />
            </div>
            <div className="space-y-1.5 py-1">
              <label className="flex items-center gap-2 text-xs text-[#181A1F] cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSignup}
                  onChange={(e) => setAutoSignup(e.target.checked)}
                />
                <span>Auto-email on New Client Signup</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-[#181A1F] cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoActions}
                  onChange={(e) => setAutoActions(e.target.checked)}
                />
                <span>Allow Action Email &amp; SMS Triggers</span>
              </label>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingSettings}
                className="px-4 py-2 bg-[#0F5C53] text-white text-xs font-medium rounded-lg hover:bg-[#0B4740] disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {savingSettings ? 'Saving...' : 'Save Partner Routing'}
              </button>
            </div>
          </div>
          {settingsSavedMsg && (
            <p className="text-xs font-medium text-[#0F5C53]">{settingsSavedMsg}</p>
          )}
        </form>
      )}

      {/* Action Trigger Channels Strip + Feedback */}
      <div className="space-y-2.5">
        <ActionTriggerCheckboxes
          language={language}
          sendEmail={sendEmailOnAction}
          sendSms={sendSmsOnAction}
          onChangeEmail={setSendEmailOnAction}
          onChangeSms={setSendSmsOnAction}
          targetSummary={`Routing: ${activePartner?.notificationEmail || alertSettings?.alertEmail || 'Admin'}${activePartner?.notificationPhone ? ` · SMS ${activePartner.notificationPhone}` : ''}`}
        />
        <TriggerOutcomeBanner outcome={triggerOutcome} onDismiss={() => setTriggerOutcome(null)} />
        {actionError && <p className="text-xs text-[#B91C1C] font-medium">{actionError}</p>}
      </div>

      {/* KPI Strip (Strictly Non-Financial Operational Counts Only) */}
      <div className="grid grid-cols-1 sm:grid-cols-4 border border-[#E6E4DF] bg-white rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-[#E6E4DF]">
        <div className="p-5">
          <p className="text-xs text-[#575B66]">
            {language === 'yi' ? 'אונזערע קליענטן' : 'Company Clients'}
          </p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[#181A1F]">
            {metrics.clientsCount}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#575B66]">
            {language === 'yi' ? 'פעלנדע דאָקומענטן' : 'Open Checklist Items'}
          </p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[#B45309]">
            {metrics.missingChecklistItems}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#575B66]">{t.scheduledHours}</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[#181A1F]">
            {metrics.scheduledHours.toFixed(2)}h
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#575B66]">{t.approvedBillableHours}</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[#0F5C53]">
            {metrics.approvedHours.toFixed(2)}h
          </p>
        </div>
      </div>

      {/* Isolated Partner Client Cases */}
      <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E6E4DF]">
          <h2 className="text-base font-semibold text-[#181A1F]">
            {language === 'yi'
              ? `${activePartner?.name || ''} קליענטן & דאָקומענטן`
              : `${activePartner?.name || 'Partner'} Assigned Clients`}
          </h2>
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filter your company's clients..."
            className="px-3 py-1.5 text-xs border border-[#E6E4DF] rounded-lg w-64"
          />
        </div>

        <div className="divide-y divide-[#E6E4DF]">
          {filteredClients.map((client) => {
            const docsOpen = openDocsClientId === client.clientId;
            const docs = docsByClient[client.clientId] || [];
            return (
              <div key={client.clientId} className="py-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-[#181A1F]">
                      {client.childFirstName} {client.childLastName}
                    </h3>
                    <p className="text-xs text-[#575B66]">
                      Parent: {client.parentName} · {client.borough || 'NY'} · BT:{' '}
                      {client.assignedBtName || 'Pending Match'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={client.status}
                      onChange={(e) =>
                        handleStatusChange(client, e.target.value as ApplicationStatus)
                      }
                      className="px-2.5 py-1.5 text-xs border border-[#E6E4DF] rounded-lg bg-white"
                    >
                      {(Object.keys(STATUS_LABELS) as ApplicationStatus[]).map((st) => (
                        <option key={st} value={st}>
                          {STATUS_LABELS[st][language]}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => handleToggleDocs(client)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-[#E6E4DF] rounded-lg hover:border-[#0F5C53] whitespace-nowrap"
                    >
                      <FileText className="w-3.5 h-3.5 text-[#0F5C53]" />
                      <span>{docsOpen ? 'Hide Docs' : 'Review Docs'}</span>
                    </button>

                    <QuickActionTriggerButton
                      user={user}
                      language={language}
                      eventType="custom_action"
                      actionLabel={`Partner Case Trigger (${activePartner?.name || 'Agency'})`}
                      contractCompanyId={client.contractCompanyId}
                      contractCompanyName={client.contractCompanyName}
                      partnerUids={client.partnerUids}
                      clientId={client.clientId}
                      clientName={`${client.childFirstName} ${client.childLastName}`}
                      defaultSummary={`Case follow-up for ${client.childFirstName} ${client.childLastName.slice(0, 1)}. (${STATUS_LABELS[client.status].en}).`}
                      partnerDirectory={partnerDirectory}
                      alertSettings={alertSettings}
                      onDispatched={setTriggerOutcome}
                    />
                  </div>
                </div>

                {/* Checklist Strip */}
                <div className="flex flex-wrap items-center gap-2">
                  {CHECKLIST_KEYS.map((key) => {
                    const st = client.checklist[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleToggleChecklist(client, key)}
                        className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                          st === 'verified'
                            ? 'border-[#16A34A]/40 bg-[#16A34A]/5 text-[#16A34A]'
                            : st === 'uploaded'
                              ? 'border-[#0F5C53]/40 bg-[#0F5C53]/5 text-[#0F5C53]'
                              : 'border-[#E6E4DF] text-[#575B66]'
                        }`}
                      >
                        {CHECKLIST_LABELS[key].en}: {st}
                      </button>
                    );
                  })}
                </div>

                {/* Isolated Document Drawer */}
                {docsOpen && (
                  <div className="p-4 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg space-y-2.5">
                    <h4 className="text-xs font-semibold text-[#181A1F]">
                      Submitted Intake Documents
                    </h4>
                    {loadingDocsId === client.clientId ? (
                      <p className="text-xs text-[#575B66]">Loading documents...</p>
                    ) : docs.length === 0 ? (
                      <p className="text-xs text-[#575B66]">
                        No documents uploaded for this client yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {docs.map((d) => (
                          <div
                            key={d.documentId}
                            className="p-3 bg-white border border-[#E6E4DF] rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs"
                          >
                            <div>
                              <p className="font-medium text-[#181A1F]">{d.fileName}</p>
                              {d.summary && <p className="text-[#575B66] mt-0.5">{d.summary}</p>}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-[#0F5C53]">
                                {d.verificationStatus.replace('_', ' ')}
                              </span>
                              {d.verificationStatus !== 'verified' && (
                                <button
                                  type="button"
                                  onClick={() => handleDocumentReview(client, d, 'verified')}
                                  className="px-2.5 py-1 text-[11px] font-medium bg-[#0F5C53] text-white rounded hover:bg-[#0B4740]"
                                >
                                  Verify Doc
                                </button>
                              )}
                              {d.verificationStatus !== 'needs_resubmission' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDocumentReview(client, d, 'needs_resubmission')
                                  }
                                  className="px-2.5 py-1 text-[11px] font-medium border border-[#E6E4DF] text-[#B45309] rounded hover:border-[#B45309]"
                                >
                                  Flag Resubmit
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filteredClients.length === 0 && (
            <p className="py-8 text-center text-sm text-[#575B66]">
              No clients are currently assigned to {activePartner?.name || 'this contract company'}.
            </p>
          )}
        </div>
      </div>

      {/* Partner Sessions Table */}
      <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#E6E4DF]">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#0F5C53]" />
            <h2 className="text-base font-semibold text-[#181A1F]">{t.sessionScheduleEt}</h2>
          </div>
          <span className="text-xs text-[#575B66]">Eastern Time · 12h AM/PM</span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#E6E4DF] text-xs text-[#575B66]">
                <th className="py-2.5 pr-4 font-medium">Client</th>
                <th className="py-2.5 pr-4 font-medium">BT</th>
                <th className="py-2.5 pr-4 font-medium">Date &amp; Time (ET)</th>
                <th className="py-2.5 pr-4 font-medium text-right">Scheduled</th>
                <th className="py-2.5 pr-4 font-medium text-right">Approved Billable</th>
                <th className="py-2.5 pr-4 font-medium">Status</th>
                <th className="py-2.5 font-medium text-right">Trigger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E4DF]">
              {scopedSessions.map((ses) => (
                <tr key={ses.sessionId} className="hover:bg-[#FAF9F6]">
                  <td className="py-3 pr-4 font-medium text-[#181A1F]">
                    {ses.clientName || ses.clientId}
                  </td>
                  <td className="py-3 pr-4 text-xs text-[#575B66]">{ses.btName}</td>
                  <td className="py-3 pr-4 font-mono text-xs tabular-nums">
                    {formatEtDateLabel(ses.dateEt)} · {ses.startTimeEt} – {ses.endTimeEt}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs tabular-nums text-right">
                    {ses.scheduledHours.toFixed(2)}h
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs tabular-nums text-right font-semibold text-[#0F5C53]">
                    {ses.approvedBillableHours.toFixed(2)}h
                  </td>
                  <td className="py-3 pr-4 text-xs">
                    {SESSION_STATUS_LABELS[ses.status][language]}
                  </td>
                  <td className="py-3 text-right">
                    <QuickActionTriggerButton
                      user={user}
                      language={language}
                      eventType={
                        ses.status === 'approved_billable'
                          ? 'session_billed'
                          : ses.status === 'completed'
                            ? 'session_completed'
                            : 'session_scheduled'
                      }
                      actionLabel="Session Follow-Up Trigger"
                      contractCompanyId={ses.contractCompanyId}
                      contractCompanyName={ses.contractCompanyName}
                      partnerUids={ses.partnerUids}
                      clientId={ses.clientId}
                      clientName={ses.clientName}
                      defaultSummary={`Session ${formatEtDateLabel(ses.dateEt)} ${ses.startTimeEt}-${ses.endTimeEt} ET (${ses.scheduledHours.toFixed(2)}h, ${ses.status}).`}
                      partnerDirectory={partnerDirectory}
                      alertSettings={alertSettings}
                      onDispatched={setTriggerOutcome}
                    />
                  </td>
                </tr>
              ))}
              {scopedSessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-[#575B66]">
                    No therapy sessions recorded for {activePartner?.name || 'this company'} yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Partner Trigger Log History */}
      <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl">
        <div className="flex items-center gap-2 pb-4 border-b border-[#E6E4DF]">
          <BellRing className="w-4 h-4 text-[#0F5C53]" />
          <h2 className="text-base font-semibold text-[#181A1F]">{t.triggerLogTitle}</h2>
        </div>
        <div className="mt-3 divide-y divide-[#E6E4DF]">
          {scopedTriggerLogs.slice(0, 15).map((log) => (
            <div key={log.triggerId} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div>
                <p className="font-medium text-[#181A1F]">{log.subject}</p>
                <p className="text-[#575B66] mt-0.5">{log.summary}</p>
              </div>
              <div className="text-right font-mono text-[11px] text-[#575B66]">
                <div>
                  Email: {log.emailStatus} · SMS: {log.smsStatus}
                </div>
                <div>{log.recipientEmail}</div>
              </div>
            </div>
          ))}
          {scopedTriggerLogs.length === 0 && (
            <p className="py-6 text-center text-xs text-[#575B66]">
              No triggers dispatched for {activePartner?.name || 'this company'} yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
