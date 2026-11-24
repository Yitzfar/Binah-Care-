import React, { useMemo, useState } from 'react';
import { CalendarPlus, CheckCircle2, Clock } from 'lucide-react';
import {
  CHECKLIST_LABELS,
  getCopy,
  SESSION_STATUS_LABELS,
  STATUS_LABELS,
} from '../i18n/translations';
import {
  createTherapySession,
  updateClientCoordination,
  updateSessionStatus,
} from '../lib/firestoreService';
import {
  computeHoursBetween12Hr,
  EASTERN_TIME_SLOTS_12HR,
  formatEtDateLabel,
  formatOverdueDuration,
  getHoursSinceSessionEndedEt,
  getTodayEtIso,
} from '../lib/timeEt';
import {
  triggerActionNotification,
  type DispatchedTriggerOutcome,
} from '../lib/triggers';
import type {
  AdminAlertSettings,
  ApplicationStatus,
  ChecklistKey,
  ClientApplication,
  ContractCompany,
  Language,
  PartnerDirectoryEntry,
  StaffRosterEntry,
  TherapySession,
  TriggerEventType,
  UserProfile,
} from '../types/binah';
import {
  ActionTriggerCheckboxes,
  QuickActionTriggerButton,
  TriggerOutcomeBanner,
} from './ActionTriggerBar';

interface StaffPortalProps {
  user: UserProfile;
  language: Language;
  clients: ClientApplication[];
  sessions: TherapySession[];
  staffRoster: StaffRosterEntry[];
  contractCompanies: ContractCompany[];
  partnerDirectory: PartnerDirectoryEntry[];
  alertSettings?: AdminAlertSettings | null;
  isAdminPreview: boolean;
}

const CHECKLIST_KEYS: ChecklistKey[] = ['rx', 'evaluation', 'insurance', 'iep', 'hipaaConsent'];

export const StaffPortal: React.FC<StaffPortalProps> = ({
  user,
  language,
  clients,
  sessions,
  staffRoster,
  contractCompanies,
  partnerDirectory,
  alertSettings,
  isAdminPreview,
}) => {
  const t = getCopy(language);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TherapySession['status']>('all');
  const [triggerEmailOnAction, setTriggerEmailOnAction] = useState(true);
  const [triggerSmsOnAction, setTriggerSmsOnAction] = useState(false);
  const [triggerOutcome, setTriggerOutcome] = useState<DispatchedTriggerOutcome | null>(null);
  const [actionError, setActionError] = useState('');

  // Schedule Session Form
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [selClientId, setSelClientId] = useState('');
  const [selBtId, setSelBtId] = useState('');
  const [dateEt, setDateEt] = useState(getTodayEtIso());
  const [startTimeEt, setStartTimeEt] = useState('3:30 PM');
  const [endTimeEt, setEndTimeEt] = useState('6:00 PM');
  const [sessionNotes, setSessionNotes] = useState('');
  const [savingSession, setSavingSession] = useState(false);
  const [scheduleError, setScheduleError] = useState('');

  const authorizedClients = useMemo(() => {
    const base =
      isAdminPreview || user.role === 'admin'
        ? clients
        : clients.filter((c) => c.assignedStaffUids?.includes(user.uid));
    if (!searchTerm.trim()) return base;
    const q = searchTerm.toLowerCase();
    return base.filter(
      (c) =>
        `${c.childFirstName} ${c.childLastName}`.toLowerCase().includes(q) ||
        c.parentName.toLowerCase().includes(q) ||
        (c.borough || '').toLowerCase().includes(q)
    );
  }, [clients, isAdminPreview, user.role, user.uid, searchTerm]);

  const authorizedSessions = useMemo(() => {
    const base =
      isAdminPreview || user.role === 'admin'
        ? sessions
        : sessions.filter((s) => s.btUid === user.uid);
    if (statusFilter === 'all') return base;
    return base.filter((s) => s.status === statusFilter);
  }, [sessions, isAdminPreview, user.role, user.uid, statusFilter]);

  // Separate Scheduled Hours vs Approved Billable Hours!
  const totals = useMemo(() => {
    let totalScheduled = 0;
    let totalApprovedBillable = 0;
    let pendingSignOffHours = 0;

    for (const s of authorizedSessions) {
      if (s.status !== 'cancelled') {
        totalScheduled += s.scheduledHours || 0;
      }
      if (s.status === 'approved_billable') {
        totalApprovedBillable += s.approvedBillableHours || 0;
      } else if (s.status === 'completed') {
        pendingSignOffHours += s.scheduledHours || 0;
      }
    }
    return {
      totalScheduled: Math.round(totalScheduled * 100) / 100,
      totalApprovedBillable: Math.round(totalApprovedBillable * 100) / 100,
      pendingSignOffHours: Math.round(pendingSignOffHours * 100) / 100,
    };
  }, [authorizedSessions]);

  const maybeDispatchActionTrigger = async (params: {
    eventType: TriggerEventType;
    actionLabel: string;
    contractCompanyId?: string;
    contractCompanyName?: string;
    partnerUids?: string[];
    clientId?: string;
    clientName?: string;
    summaryDetails: string;
    forceEmail?: boolean;
  }) => {
    const sendEmail = params.forceEmail || triggerEmailOnAction;
    const sendSms = triggerSmsOnAction;
    if (!sendEmail && !sendSms) return;
    const outcome = await triggerActionNotification({
      user,
      eventType: params.eventType,
      actionLabel: params.actionLabel,
      contractCompanyId: params.contractCompanyId,
      contractCompanyName: params.contractCompanyName,
      partnerUids: params.partnerUids,
      clientId: params.clientId,
      clientName: params.clientName,
      summaryDetails: params.summaryDetails,
      channels: { sendEmail, sendSms },
      partnerDirectory,
      alertSettings,
      language,
    }).catch(() => null);
    if (outcome) setTriggerOutcome(outcome);
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setScheduleError('');
    const client = authorizedClients.find((c) => c.clientId === selClientId) || authorizedClients[0];
    const bt = staffRoster.find((b) => b.staffId === selBtId) || staffRoster[0];

    if (!client) {
      setScheduleError('Please select an authorized client.');
      return;
    }

    const hrs = computeHoursBetween12Hr(startTimeEt, endTimeEt);
    if (hrs <= 0) {
      setScheduleError('End time must be after start time (12-hour AM/PM Eastern Time).');
      return;
    }

    setSavingSession(true);
    try {
      await createTherapySession({
        clientId: client.clientId,
        clientName: `${client.childFirstName} ${client.childLastName}`,
        parentUid: client.parentUid,
        contractCompanyId: client.contractCompanyId,
        contractCompanyName: client.contractCompanyName,
        partnerUids: client.partnerUids,
        btId: bt ? bt.staffId : user.uid,
        btUid: bt?.uid || user.uid,
        btName: bt ? bt.displayName : user.displayName,
        dateEt,
        startTimeEt,
        endTimeEt,
        scheduledHours: hrs,
        notes: sessionNotes,
      });
      await maybeDispatchActionTrigger({
        eventType: 'session_scheduled',
        actionLabel: 'Session Scheduled (ET)',
        contractCompanyId: client.contractCompanyId,
        contractCompanyName: client.contractCompanyName,
        partnerUids: client.partnerUids,
        clientId: client.clientId,
        clientName: `${client.childFirstName} ${client.childLastName}`,
        summaryDetails: `Scheduled ${hrs.toFixed(2)}h on ${formatEtDateLabel(dateEt)} (${startTimeEt}-${endTimeEt} ET) with ${bt ? bt.displayName : user.displayName}.`,
      });
      setShowScheduleForm(false);
      setSessionNotes('');
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Unable to schedule session.');
    } finally {
      setSavingSession(false);
    }
  };

  const handleToggleChecklistVerify = async (client: ClientApplication, key: ChecklistKey) => {
    setActionError('');
    const nextVal = client.checklist[key] === 'verified' ? 'uploaded' : 'verified';
    try {
      await updateClientCoordination(client.clientId, {
        checklist: {
          ...client.checklist,
          [key]: nextVal,
        },
      });
      await maybeDispatchActionTrigger({
        eventType: 'checklist_verified',
        actionLabel: 'Checklist Verification Updated',
        contractCompanyId: client.contractCompanyId,
        contractCompanyName: client.contractCompanyName,
        partnerUids: client.partnerUids,
        clientId: client.clientId,
        clientName: `${client.childFirstName} ${client.childLastName}`,
        summaryDetails: `${CHECKLIST_LABELS[key].en} updated to ${nextVal}.`,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update checklist item.');
    }
  };

  const handleMarkCompleted = async (ses: TherapySession) => {
    setActionError('');
    try {
      await updateSessionStatus(ses.sessionId, { status: 'completed' });
      await maybeDispatchActionTrigger({
        eventType: 'session_completed',
        actionLabel: 'Session Completed',
        contractCompanyId: ses.contractCompanyId,
        contractCompanyName: ses.contractCompanyName,
        partnerUids: ses.partnerUids,
        clientId: ses.clientId,
        clientName: ses.clientName,
        summaryDetails: `Completed ${ses.scheduledHours.toFixed(2)}h session on ${formatEtDateLabel(ses.dateEt)} (${ses.startTimeEt}-${ses.endTimeEt} ET).`,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to mark session completed.');
    }
  };

  const handleApproveBillable = async (ses: TherapySession) => {
    setActionError('');
    try {
      await updateSessionStatus(ses.sessionId, {
        status: 'approved_billable',
        approvedBillableHours: ses.scheduledHours,
        approvedByUid: user.uid,
      });
      await maybeDispatchActionTrigger({
        eventType: 'session_billed',
        actionLabel: 'Session Approved Billable',
        contractCompanyId: ses.contractCompanyId,
        contractCompanyName: ses.contractCompanyName,
        partnerUids: ses.partnerUids,
        clientId: ses.clientId,
        clientName: ses.clientName,
        summaryDetails: `Approved ${ses.scheduledHours.toFixed(2)}h billable on ${formatEtDateLabel(ses.dateEt)} (${ses.startTimeEt}-${ses.endTimeEt} ET).`,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to approve billable hours.');
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#E6E4DF]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#181A1F]">{t.tabStaff}</h1>
          <p className="mt-1 text-sm text-[#575B66]">
            {language === 'yi'
              ? 'פאַרוואַלטעט באַרעכטיקטע קליענטן, BT סקעדזשולס (איסטערן טײַם), און באַשטעטיקטע שעהן.'
              : 'Manage authorized clients, Behavior Technician assignments, Eastern Time schedules, and separate scheduled vs. billable hours.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowScheduleForm((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0F5C53] text-white text-sm font-medium rounded-lg hover:bg-[#0B4740] transition-colors whitespace-nowrap shrink-0"
        >
          <CalendarPlus className="w-4 h-4" />
          <span>{language === 'yi' ? 'פּלאַנירן נײַע סעסיע' : 'Schedule Session (ET)'}</span>
        </button>
      </div>

      {/* Global Action Trigger Options Bar */}
      <div className="space-y-2.5">
        <ActionTriggerCheckboxes
          language={language}
          sendEmail={triggerEmailOnAction}
          sendSms={triggerSmsOnAction}
          onChangeEmail={setTriggerEmailOnAction}
          onChangeSms={setTriggerSmsOnAction}
          targetSummary={
            language === 'yi'
              ? 'שיקט טריגער אויף יעדע סעסיע, סטאַטוס, BT, שותף אָדער טשעקליסט אַקציע'
              : 'Applies automatically to schedule, status, BT, partner assignment, checklist & billing actions'
          }
        />
        <TriggerOutcomeBanner outcome={triggerOutcome} onDismiss={() => setTriggerOutcome(null)} />
        {actionError && <p className="text-xs text-[#B91C1C] font-medium">{actionError}</p>}
      </div>

      {/* KPI Strip: Strictly Separating Scheduled Hours vs Approved Billable Hours */}
      <div className="grid grid-cols-1 sm:grid-cols-4 border border-[#E6E4DF] bg-white rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-[#E6E4DF]">
        <div className="p-5">
          <p className="text-xs text-[#575B66]">
            {language === 'yi' ? 'באַרעכטיקטע קליענטן' : 'Authorized Clients'}
          </p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[#181A1F]">
            {authorizedClients.length}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#575B66]">{t.scheduledHours}</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[#181A1F]">
            {totals.totalScheduled.toFixed(2)} hrs
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#575B66]">{t.approvedBillableHours}</p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[#0F5C53]">
            {totals.totalApprovedBillable.toFixed(2)} hrs
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#575B66]">
            {language === 'yi' ? 'וואַרטן אויף באַשטעטיקונג' : 'Pending Sign-off'}
          </p>
          <p className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[#B45309]">
            {totals.pendingSignOffHours.toFixed(2)} hrs
          </p>
        </div>
      </div>

      {/* Schedule New Session Form */}
      {showScheduleForm && (
        <form
          onSubmit={handleCreateSession}
          className="p-6 bg-white border border-[#E6E4DF] rounded-xl grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          <div className="sm:col-span-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#181A1F]">
              {language === 'yi'
                ? 'נײַע טעראַפּיע סעסיע (איסטערן טײַם 12h AM/PM)'
                : 'Schedule ABA Therapy Session (Eastern Time 12-Hour AM/PM)'}
            </h2>
            <span className="text-xs font-mono tabular-nums text-[#0F5C53]">
              Duration: {computeHoursBetween12Hr(startTimeEt, endTimeEt).toFixed(2)} hrs
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1">Client</label>
            <select
              value={selClientId || authorizedClients[0]?.clientId || ''}
              onChange={(e) => setSelClientId(e.target.value)}
              className="w-full px-3 py-2 border border-[#E6E4DF] rounded-lg text-sm bg-white"
            >
              {authorizedClients.map((c) => (
                <option key={c.clientId} value={c.clientId}>
                  {c.childFirstName} {c.childLastName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1">
              Behavior Technician (BT)
            </label>
            <select
              value={selBtId || staffRoster[0]?.staffId || ''}
              onChange={(e) => setSelBtId(e.target.value)}
              className="w-full px-3 py-2 border border-[#E6E4DF] rounded-lg text-sm bg-white"
            >
              {staffRoster.map((b) => (
                <option key={b.staffId} value={b.staffId}>
                  {b.displayName}
                </option>
              ))}
              {staffRoster.length === 0 && <option value={user.uid}>{user.displayName}</option>}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1">Date (ET)</label>
            <input
              type="date"
              value={dateEt}
              onChange={(e) => setDateEt(e.target.value)}
              className="w-full px-3 py-2 border border-[#E6E4DF] rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1">Start Time (ET)</label>
            <select
              value={startTimeEt}
              onChange={(e) => setStartTimeEt(e.target.value)}
              className="w-full px-3 py-2 border border-[#E6E4DF] rounded-lg text-sm font-mono bg-white"
            >
              {EASTERN_TIME_SLOTS_12HR.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1">End Time (ET)</label>
            <select
              value={endTimeEt}
              onChange={(e) => setEndTimeEt(e.target.value)}
              className="w-full px-3 py-2 border border-[#E6E4DF] rounded-lg text-sm font-mono bg-white"
            >
              {EASTERN_TIME_SLOTS_12HR.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1">Session Notes</label>
            <input
              type="text"
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
              placeholder="Location or goal focus"
              className="w-full px-3 py-2 border border-[#E6E4DF] rounded-lg text-sm"
            />
          </div>

          <div className="sm:col-span-3">
            <ActionTriggerCheckboxes
              language={language}
              sendEmail={triggerEmailOnAction}
              sendSms={triggerSmsOnAction}
              onChangeEmail={setTriggerEmailOnAction}
              onChangeSms={setTriggerSmsOnAction}
              compact
            />
          </div>

          {scheduleError && (
            <p className="sm:col-span-3 text-xs text-[#B91C1C]">{scheduleError}</p>
          )}

          <div className="sm:col-span-3 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowScheduleForm(false)}
              className="px-4 py-2 text-sm text-[#575B66] border border-[#E6E4DF] rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingSession}
              className="px-5 py-2 bg-[#0F5C53] text-white text-sm font-medium rounded-lg hover:bg-[#0B4740]"
            >
              {savingSession ? 'Saving...' : 'Save Session'}
            </button>
          </div>
        </form>
      )}

      {/* Working Schedules & Separate Hours Table */}
      <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E6E4DF]">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#0F5C53]" />
            <h2 className="text-base font-semibold text-[#181A1F]">{t.sessionScheduleEt}</h2>
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#F3F2EE] rounded-lg">
            {(['all', 'scheduled', 'completed', 'approved_billable'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === st
                    ? 'bg-white text-[#181A1F] shadow-xs'
                    : 'text-[#575B66] hover:text-[#181A1F]'
                }`}
              >
                {st === 'all' ? 'All' : SESSION_STATUS_LABELS[st][language]}
              </button>
            ))}
          </div>
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
                <th className="py-2.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E4DF]">
              {authorizedSessions.map((ses) => (
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
                    <div>{SESSION_STATUS_LABELS[ses.status][language]}</div>
                    {ses.status !== 'approved_billable' &&
                      ses.status !== 'cancelled' &&
                      (getHoursSinceSessionEndedEt(ses.dateEt, ses.endTimeEt) ?? 0) >= 48 && (
                        <div className="mt-0.5 text-[11px] font-mono font-semibold text-[#B45309]">
                          48h+ Unbilled (
                          {formatOverdueDuration(
                            getHoursSinceSessionEndedEt(ses.dateEt, ses.endTimeEt) ?? 48,
                            language
                          )}
                          )
                        </div>
                      )}
                  </td>
                  <td className="py-3 text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      {ses.status === 'scheduled' && (
                        <button
                          type="button"
                          onClick={() => handleMarkCompleted(ses)}
                          className="px-2.5 py-1 text-xs font-medium border border-[#E6E4DF] rounded-md hover:border-[#0F5C53] whitespace-nowrap"
                        >
                          Mark Completed
                        </button>
                      )}
                      {ses.status === 'completed' && (user.role === 'admin' || isAdminPreview) && (
                        <button
                          type="button"
                          onClick={() => handleApproveBillable(ses)}
                          className="px-2.5 py-1 text-xs font-medium bg-[#0F5C53] text-white rounded-md hover:bg-[#0B4740] whitespace-nowrap"
                        >
                          Approve Billable
                        </button>
                      )}
                      {ses.status === 'approved_billable' && (
                        <span className="inline-flex items-center gap-1 text-xs text-[#16A34A] whitespace-nowrap">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Billed</span>
                        </span>
                      )}
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
                        actionLabel="Session Action Trigger"
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
                    </div>
                  </td>
                </tr>
              ))}
              {authorizedSessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-[#575B66]">
                    No therapy sessions match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Authorized Client Management */}
      <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E6E4DF]">
          <h2 className="text-base font-semibold text-[#181A1F]">
            {language === 'yi' ? 'קליענטן & צוטיילונגען' : 'Authorized Client Cases & BT Matching'}
          </h2>
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filter by child, parent, or borough..."
            className="px-3 py-1.5 text-xs border border-[#E6E4DF] rounded-lg w-64"
          />
        </div>

        <div className="divide-y divide-[#E6E4DF]">
          {authorizedClients.map((client) => (
            <div key={client.clientId} className="py-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-[#181A1F]">
                    {client.childFirstName} {client.childLastName}
                  </h3>
                  <p className="text-xs text-[#575B66]">
                    Parent: {client.parentName} · {client.borough || 'NY'} ·{' '}
                    {client.contractCompanyName || 'Unassigned Partner'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={client.status}
                    onChange={async (e) => {
                      const nextStatus = e.target.value as ApplicationStatus;
                      setActionError('');
                      try {
                        await updateClientCoordination(client.clientId, { status: nextStatus });
                        await maybeDispatchActionTrigger({
                          eventType: 'status_changed',
                          actionLabel: 'Case Status Updated',
                          contractCompanyId: client.contractCompanyId,
                          contractCompanyName: client.contractCompanyName,
                          partnerUids: client.partnerUids,
                          clientId: client.clientId,
                          clientName: `${client.childFirstName} ${client.childLastName}`,
                          summaryDetails: `Application status changed to ${STATUS_LABELS[nextStatus].en}.`,
                        });
                      } catch (err) {
                        setActionError(err instanceof Error ? err.message : 'Unable to update status.');
                      }
                    }}
                    className="px-2.5 py-1.5 text-xs border border-[#E6E4DF] rounded-lg bg-white"
                  >
                    {(Object.keys(STATUS_LABELS) as ApplicationStatus[]).map((st) => (
                      <option key={st} value={st}>
                        {STATUS_LABELS[st][language]}
                      </option>
                    ))}
                  </select>

                  <select
                    value={client.assignedBtId || ''}
                    onChange={async (e) => {
                      const bt = staffRoster.find((b) => b.staffId === e.target.value);
                      if (bt) {
                        setActionError('');
                        try {
                          const nextStaffUids = bt.uid
                            ? Array.from(new Set([...(client.assignedStaffUids || []), bt.uid]))
                            : client.assignedStaffUids;
                          await updateClientCoordination(client.clientId, {
                            assignedBtId: bt.staffId,
                            assignedBtName: bt.displayName,
                            ...(nextStaffUids ? { assignedStaffUids: nextStaffUids } : {}),
                          });
                          await maybeDispatchActionTrigger({
                            eventType: 'bt_assigned',
                            actionLabel: 'BT Assigned to Case',
                            contractCompanyId: client.contractCompanyId,
                            contractCompanyName: client.contractCompanyName,
                            partnerUids: client.partnerUids,
                            clientId: client.clientId,
                            clientName: `${client.childFirstName} ${client.childLastName}`,
                            summaryDetails: `Assigned Behavior Technician: ${bt.displayName}.`,
                          });
                        } catch (err) {
                          setActionError(err instanceof Error ? err.message : 'Unable to assign BT.');
                        }
                      }
                    }}
                    className="px-2.5 py-1.5 text-xs border border-[#E6E4DF] rounded-lg bg-white"
                  >
                    <option value="">Assign BT...</option>
                    {staffRoster.map((b) => (
                      <option key={b.staffId} value={b.staffId}>
                        {b.displayName}
                      </option>
                    ))}
                  </select>

                  {(user.role === 'admin' || isAdminPreview) && contractCompanies.length > 0 && (
                    <select
                      value={client.contractCompanyId || ''}
                      onChange={async (e) => {
                        const comp = contractCompanies.find((c) => c.companyId === e.target.value);
                        if (comp) {
                          setActionError('');
                          try {
                            await updateClientCoordination(client.clientId, {
                              contractCompanyId: comp.companyId,
                              contractCompanyName: comp.name,
                              partnerUids: comp.partnerUids || [],
                            });
                            await maybeDispatchActionTrigger({
                              eventType: 'partner_assigned',
                              actionLabel: 'New Client Assigned to Partner',
                              contractCompanyId: comp.companyId,
                              contractCompanyName: comp.name,
                              partnerUids: comp.partnerUids || [],
                              clientId: client.clientId,
                              clientName: `${client.childFirstName} ${client.childLastName}`,
                              summaryDetails: `Client assigned to ${comp.name} (${client.borough || 'NY'}).`,
                              forceEmail: comp.autoTriggerOnSignup !== false,
                            });
                          } catch (err) {
                            setActionError(
                              err instanceof Error ? err.message : 'Unable to assign partner company.'
                            );
                          }
                        }
                      }}
                      className="px-2.5 py-1.5 text-xs border border-[#E6E4DF] rounded-lg bg-white"
                    >
                      <option value="">Partner Company...</option>
                      {contractCompanies.map((c) => (
                        <option key={c.companyId} value={c.companyId}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}

                  <QuickActionTriggerButton
                    user={user}
                    language={language}
                    eventType="custom_action"
                    actionLabel="Client Case Trigger"
                    contractCompanyId={client.contractCompanyId}
                    contractCompanyName={client.contractCompanyName}
                    partnerUids={client.partnerUids}
                    clientId={client.clientId}
                    clientName={`${client.childFirstName} ${client.childLastName}`}
                    defaultSummary={`Coordination update for ${client.childFirstName} ${client.childLastName.slice(0, 1)}. (${STATUS_LABELS[client.status].en}).`}
                    partnerDirectory={partnerDirectory}
                    alertSettings={alertSettings}
                    onDispatched={setTriggerOutcome}
                  />
                </div>
              </div>

              {/* Checklist Verification Toggle Strip */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {CHECKLIST_KEYS.map((key) => {
                  const st = client.checklist[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleToggleChecklistVerify(client, key)}
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
            </div>
          ))}
          {authorizedClients.length === 0 && (
            <p className="py-8 text-center text-sm text-[#575B66]">
              No authorized clients assigned to your staff account yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
