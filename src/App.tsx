import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  Bot,
  BookOpen,
  Briefcase,
  Building2,
  ClipboardList,
  DollarSign,
  ExternalLink,
  LogOut,
  MessageSquare,
  Users,
} from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { AdminDocsView } from './components/AdminDocsModal';
import { AiAutomationHub } from './components/AiAutomationHub';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GeminiChatbot } from './components/GeminiChatbot';
import { ParentPortal } from './components/ParentPortal';
import { PartnerPortal } from './components/PartnerPortal';
import { PublicWebsite } from './components/PublicWebsite';
import { StaffPortal } from './components/StaffPortal';
import { getCopy } from './i18n/translations';
import { sendUnbilledAdminEmailAlert } from './lib/aiClient';
import {
  buildHipaaSafeDigestPayload,
  evaluateUnbilledSessions48h,
  PRIMARY_ADMIN_ALERT_EMAIL,
} from './lib/billingAlerts';
import { auth, googleAuthProvider } from './lib/firebase';
import { GmailProvider } from './lib/gmailContext';
import {
  ensureUserProfile,
  saveBillingAlertRecord,
  subscribeAdminAlertSettings,
  subscribeAdminCollections,
  subscribeBillingAlerts,
  subscribeClients,
  subscribePartnerDirectory,
  subscribeReminders,
  subscribeSessions,
  subscribeTriggerLogs,
  updateBillingAlertStatus,
  updateUserProfileFields,
} from './lib/firestoreService';
import { formatEtNowClock } from './lib/timeEt';
import type {
  AdminAlertSettings,
  AutomatedReminder,
  BillingAlert,
  BillingAlertChannel,
  BtCompensation,
  BtPayout,
  ClientApplication,
  ContractCompany,
  Language,
  PartnerDirectoryEntry,
  PartnerPayment,
  StaffRosterEntry,
  TherapySession,
  TriggerLog,
  UserProfile,
} from './types/binah';

type WorkspaceTab = 'parent' | 'staff' | 'partner' | 'admin' | 'finance' | 'ai' | 'docs';

function BinahWorkspaceApp() {
  const [language, setLanguage] = useState<Language>('en');
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showPublicSite, setShowPublicSite] = useState(true);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('parent');
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);

  // Firestore Live Collections
  const [clients, setClients] = useState<ClientApplication[]>([]);
  const [sessions, setSessions] = useState<TherapySession[]>([]);
  const [reminders, setReminders] = useState<AutomatedReminder[]>([]);
  const [partnerDirectory, setPartnerDirectory] = useState<PartnerDirectoryEntry[]>([]);
  const [triggerLogs, setTriggerLogs] = useState<TriggerLog[]>([]);
  const [contractCompanies, setContractCompanies] = useState<ContractCompany[]>([]);
  const [staffRoster, setStaffRoster] = useState<StaffRosterEntry[]>([]);
  const [btCompensation, setBtCompensation] = useState<BtCompensation[]>([]);
  const [partnerPayments, setPartnerPayments] = useState<PartnerPayment[]>([]);
  const [btPayouts, setBtPayouts] = useState<BtPayout[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [billingAlerts, setBillingAlerts] = useState<BillingAlert[]>([]);
  const [alertSettings, setAlertSettings] = useState<AdminAlertSettings | null>(null);
  const [billingAlertsLoaded, setBillingAlertsLoaded] = useState(false);
  const [alertSettingsLoaded, setAlertSettingsLoaded] = useState(false);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [dataError, setDataError] = useState('');
  const autoNotifiedSessionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUserProfile(null);
        setAuthReady(true);
        return;
      }
      try {
        const profile = await ensureUserProfile({
          uid: fbUser.uid,
          email: fbUser.email || '',
          displayName: fbUser.displayName || 'User',
          preferredLanguage: language,
        });
        setUserProfile(profile);
        setLanguage(profile.preferredLanguage || 'en');
        setActiveTab(
          profile.role === 'admin'
            ? 'admin'
            : profile.role === 'partner'
              ? 'partner'
              : profile.role === 'staff'
                ? 'staff'
                : 'parent'
        );
        setShowPublicSite(false);
      } catch (err) {
        setDataError(err instanceof Error ? err.message : 'Unable to load user profile.');
      } finally {
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!userProfile) {
      setClients([]);
      setSessions([]);
      setReminders([]);
      setPartnerDirectory([]);
      setTriggerLogs([]);
      setContractCompanies([]);
      setStaffRoster([]);
      setBtCompensation([]);
      setPartnerPayments([]);
      setBtPayouts([]);
      setUsersList([]);
      setBillingAlerts([]);
      setAlertSettings(null);
      setBillingAlertsLoaded(false);
      setAlertSettingsLoaded(false);
      setSessionsLoaded(false);
      autoNotifiedSessionIdsRef.current.clear();
      return;
    }

    const unsubs: Array<() => void> = [];
    const onErr = (err: Error) => {
      setDataError(err.message);
    };

    unsubs.push(subscribeClients(userProfile, setClients, onErr));
    unsubs.push(
      subscribeSessions(
        userProfile,
        (items) => {
          setSessions(items);
          setSessionsLoaded(true);
        },
        onErr
      )
    );
    unsubs.push(subscribeReminders(userProfile, setReminders, onErr));
    unsubs.push(subscribePartnerDirectory(setPartnerDirectory, onErr));
    unsubs.push(subscribeTriggerLogs(userProfile, setTriggerLogs, onErr));

    if (userProfile.role === 'admin') {
      unsubs.push(
        ...subscribeAdminCollections(
          setContractCompanies,
          setStaffRoster,
          setBtCompensation,
          setPartnerPayments,
          setBtPayouts,
          setUsersList,
          onErr
        )
      );
      unsubs.push(
        subscribeBillingAlerts((items) => {
          setBillingAlerts(items);
          setBillingAlertsLoaded(true);
        }, onErr)
      );
      unsubs.push(
        subscribeAdminAlertSettings((cfg) => {
          setAlertSettings(cfg);
          setAlertSettingsLoaded(true);
        }, onErr)
      );
    }

    return () => {
      for (const u of unsubs) u();
    };
  }, [userProfile?.uid, userProfile?.role, userProfile?.contractCompanyId]);

  const overdueUnbilledSessions = useMemo(() => {
    if (userProfile?.role !== 'admin') return [];
    return evaluateUnbilledSessions48h(
      sessions,
      contractCompanies,
      btCompensation,
      billingAlerts
    );
  }, [userProfile?.role, sessions, contractCompanies, btCompensation, billingAlerts]);

  const activeOverdueCount = useMemo(
    () =>
      overdueUnbilledSessions.filter(
        (item) => item.alertRecord?.status !== 'acknowledged' && item.alertRecord?.status !== 'resolved'
      ).length,
    [overdueUnbilledSessions]
  );

  const chatbotSnapshot = useMemo(() => {
    if (!userProfile) return undefined;
    if (userProfile.role === 'parent') {
      return {
        children: clients
          .filter((c) => c.parentUid === userProfile.uid)
          .map((c) => ({
            name: `${c.childFirstName} ${c.childLastName}`,
            status: c.status,
            checklist: c.checklist,
          })),
        upcomingSessionsCount: sessions.filter((s) => s.status === 'scheduled').length,
      };
    }
    return {
      clientCount: clients.length,
      sessionCount: sessions.length,
      scheduledHours: sessions.reduce((acc, s) => acc + (s.scheduledHours || 0), 0),
      approvedBillableHours: sessions
        .filter((s) => s.status === 'approved_billable')
        .reduce((acc, s) => acc + (s.approvedBillableHours || 0), 0),
      ...(userProfile.role === 'admin'
        ? {
            overdue48hCount: activeOverdueCount,
            partnerCompaniesCount: contractCompanies.length,
          }
        : {}),
    };
  }, [userProfile, clients, sessions, activeOverdueCount, contractCompanies.length]);

  // Automatic 48-hour Unbilled Revenue Monitor & Email/SMS/Dashboard Notification Dispatch
  useEffect(() => {
    if (
      !userProfile ||
      userProfile.role !== 'admin' ||
      !sessionsLoaded ||
      !billingAlertsLoaded ||
      !alertSettingsLoaded
    ) {
      return;
    }

    // Auto-resolve any alert whose underlying session has now been billed or cancelled
    const sessionById = new Map(sessions.map((s) => [s.sessionId, s]));
    for (const alert of billingAlerts) {
      if (alert.status !== 'resolved') {
        const ses = sessionById.get(alert.sessionId);
        if (ses && (ses.status === 'approved_billable' || ses.status === 'cancelled')) {
          updateBillingAlertStatus(alert.alertId, 'resolved').catch(() => {});
        }
      }
    }

    // Detect newly overdue (48h+) sessions not yet logged in billingAlerts
    const newlyOverdue = overdueUnbilledSessions.filter(
      (item) =>
        !item.alertRecord && !autoNotifiedSessionIdsRef.current.has(item.session.sessionId)
    );

    if (newlyOverdue.length === 0) return;

    for (const item of newlyOverdue) {
      autoNotifiedSessionIdsRef.current.add(item.session.sessionId);
    }

    const targetEmail = alertSettings?.alertEmail || PRIMARY_ADMIN_ALERT_EMAIL;
    const targetPhone = alertSettings?.alertPhone || '';
    const notifyEmail = alertSettings ? alertSettings.notifyEmail : true;
    const notifySms = alertSettings ? alertSettings.notifySms : undefined;

    const digest = buildHipaaSafeDigestPayload(
      newlyOverdue,
      window.location.origin,
      targetEmail,
      targetPhone
    );

    const resolveChannel = (emailOk: boolean, smsOk: boolean): BillingAlertChannel => {
      if (emailOk && smsOk) return 'email_sms_and_dashboard';
      if (emailOk) return 'email_and_dashboard';
      if (smsOk) return 'sms_and_dashboard';
      return 'dashboard';
    };

    sendUnbilledAdminEmailAlert({
      recipientEmail: targetEmail,
      recipientPhone: targetPhone || undefined,
      sendEmail: notifyEmail,
      sendSms: notifySms,
      skipGmailOAuth: true,
      subject: digest.subject,
      textBody: digest.textBody,
      smsBody: digest.smsBody,
      items: digest.digestItems,
    })
      .then((res) => {
        const emailStatus = res.emailStatus ?? res.status;
        const smsStatus = res.smsStatus ?? (notifySms ? 'queued_no_sms' : 'disabled');
        const channel = resolveChannel(emailStatus === 'sent', smsStatus === 'sent');
        return Promise.all(
          newlyOverdue.map((item) =>
            saveBillingAlertRecord({
              sessionId: item.session.sessionId,
              clientId: item.session.clientId,
              clientName: item.session.clientName,
              btName: item.session.btName,
              contractCompanyName: item.session.contractCompanyName,
              sessionDateEt: item.session.dateEt,
              sessionTimeRangeEt: `${item.session.startTimeEt} - ${item.session.endTimeEt}`,
              scheduledHours: item.session.scheduledHours,
              estimatedRevenue: item.estimatedRevenue,
              hoursOverdue: item.hoursOverdue,
              recipientEmail: targetEmail,
              recipientPhone: res.recipientPhone || targetPhone || undefined,
              channel,
              emailStatus,
              emailNote: res.emailMessage || res.message,
              smsStatus,
              smsNote: res.smsMessage,
              status: 'active',
              createdByUid: userProfile.uid,
            })
          )
        );
      })
      .catch((err) => {
        const note = err instanceof Error ? err.message : 'Alert dispatch failed';
        Promise.all(
          newlyOverdue.map((item) =>
            saveBillingAlertRecord({
              sessionId: item.session.sessionId,
              clientId: item.session.clientId,
              clientName: item.session.clientName,
              btName: item.session.btName,
              contractCompanyName: item.session.contractCompanyName,
              sessionDateEt: item.session.dateEt,
              sessionTimeRangeEt: `${item.session.startTimeEt} - ${item.session.endTimeEt}`,
              scheduledHours: item.session.scheduledHours,
              estimatedRevenue: item.estimatedRevenue,
              hoursOverdue: item.hoursOverdue,
              recipientEmail: targetEmail,
              recipientPhone: targetPhone || undefined,
              channel: 'dashboard',
              emailStatus: notifyEmail ? 'failed' : 'disabled',
              emailNote: note,
              smsStatus: notifySms ? 'failed' : 'disabled',
              smsNote: note,
              status: 'active',
              createdByUid: userProfile.uid,
            })
          )
        ).catch(() => {});
      });
  }, [
    userProfile?.uid,
    userProfile?.role,
    sessionsLoaded,
    billingAlertsLoaded,
    alertSettingsLoaded,
    alertSettings,
    sessions,
    billingAlerts,
    overdueUnbilledSessions,
  ]);

  const handleSignIn = async () => {
    setAuthError('');
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setShowPublicSite(true);
  };

  const handleLanguageChange = (nextLang: Language) => {
    setLanguage(nextLang);
    if (userProfile) {
      updateUserProfileFields(userProfile.uid, { preferredLanguage: nextLang }).catch(() => {});
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center text-sm text-[#575B66]">
        Loading BINAH CARE...
      </div>
    );
  }

  if (!userProfile || showPublicSite) {
    return (
      <div>
        {authError && (
          <div className="bg-[#FEF2F2] border-b border-[#FECACA] px-6 py-2.5 text-xs text-[#B91C1C] text-center">
            {authError}
          </div>
        )}
        <PublicWebsite
          language={language}
          onLanguageChange={handleLanguageChange}
          onSignIn={handleSignIn}
          signingIn={signingIn}
          isAuthenticated={Boolean(userProfile)}
          onEnterPortal={() => setShowPublicSite(false)}
        />
      </div>
    );
  }

  const t = getCopy(language);
  const isRtl = language === 'yi';

  // Strict RBAC Tab Visibility
  const availableTabs: Array<{ id: WorkspaceTab; label: string; icon: React.ReactNode }> = [];
  if (userProfile.role === 'admin') {
    availableTabs.push(
      { id: 'admin', label: t.tabAdmin, icon: <Building2 className="w-4 h-4" /> },
      { id: 'finance', label: t.tabFinance, icon: <DollarSign className="w-4 h-4" /> },
      { id: 'staff', label: t.tabStaff, icon: <Users className="w-4 h-4" /> },
      { id: 'partner', label: t.tabPartner, icon: <Briefcase className="w-4 h-4" /> },
      { id: 'parent', label: t.tabParent, icon: <ClipboardList className="w-4 h-4" /> },
      { id: 'ai', label: t.tabAi, icon: <Bot className="w-4 h-4" /> },
      { id: 'docs', label: t.tabDocs, icon: <BookOpen className="w-4 h-4" /> }
    );
  } else if (userProfile.role === 'partner') {
    availableTabs.push(
      { id: 'partner', label: t.tabPartner, icon: <Briefcase className="w-4 h-4" /> },
      { id: 'ai', label: t.tabAi, icon: <Bot className="w-4 h-4" /> }
    );
  } else if (userProfile.role === 'staff') {
    availableTabs.push(
      { id: 'staff', label: t.tabStaff, icon: <Users className="w-4 h-4" /> },
      { id: 'ai', label: t.tabAi, icon: <Bot className="w-4 h-4" /> },
      { id: 'docs', label: t.tabDocs, icon: <BookOpen className="w-4 h-4" /> }
    );
  } else {
    availableTabs.push(
      { id: 'parent', label: t.tabParent, icon: <ClipboardList className="w-4 h-4" /> },
      { id: 'ai', label: t.tabAi, icon: <Bot className="w-4 h-4" /> }
    );
  }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-[#FAF9F6] text-[#181A1F] flex flex-col lg:flex-row">
      {/* Sidebar Navigation (260px) */}
      <aside className="lg:w-[260px] bg-white border-b lg:border-b-0 lg:border-e border-[#E6E4DF] p-5 flex flex-col justify-between shrink-0">
        <div>
          <div className="pb-5 border-b border-[#E6E4DF]">
            <div className="text-lg font-bold tracking-tight text-[#181A1F]">BINAH CARE</div>
            <div className="mt-1 text-xs text-[#575B66]">
              {userProfile.role === 'partner' && userProfile.contractCompanyName
                ? `${userProfile.displayName} · ${userProfile.contractCompanyName}`
                : `${userProfile.displayName} · ${userProfile.role.toUpperCase()}`}
            </div>
          </div>

          <nav className="mt-5 space-y-1">
            {availableTabs.map((tab) => {
              const active = activeTab === tab.id;
              const showAlertCount =
                userProfile.role === 'admin' &&
                activeOverdueCount > 0 &&
                (tab.id === 'admin' || tab.id === 'finance');
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#0F5C53] text-white'
                      : 'text-[#575B66] hover:bg-[#FAF9F6] hover:text-[#181A1F]'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    {tab.icon}
                    <span className="truncate">{tab.label}</span>
                  </span>
                  {showAlertCount && (
                    <span
                      className={`px-1.5 py-0.5 text-[11px] font-mono font-semibold tabular-nums rounded ${
                        active
                          ? 'bg-white/20 text-white'
                          : 'bg-[#FEF3C7] text-[#B45309]'
                      }`}
                    >
                      {activeOverdueCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="mt-6 pt-5 border-t border-[#E6E4DF] space-y-3">
          {/* Language Toggle */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#F3F2EE] rounded-lg">
            <button
              type="button"
              onClick={() => handleLanguageChange('en')}
              className={`py-1.5 text-xs font-medium rounded-md ${
                language === 'en' ? 'bg-white text-[#181A1F] shadow-xs' : 'text-[#575B66]'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => handleLanguageChange('yi')}
              className={`py-1.5 text-xs font-medium rounded-md ${
                language === 'yi' ? 'bg-white text-[#181A1F] shadow-xs' : 'text-[#575B66]'
              }`}
            >
              אידיש
            </button>
          </div>

          <div className="text-[11px] font-mono tabular-nums text-[#575B66]">
            {formatEtNowClock()}
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowPublicSite(true)}
              className="inline-flex items-center gap-1.5 text-xs text-[#575B66] hover:text-[#181A1F]"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Public Site</span>
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 text-xs text-[#B91C1C] hover:underline"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t.signOut}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-6 sm:p-8 lg:p-10 max-w-[1200px]">
        {dataError && (
          <div className="mb-6 p-4 bg-white border border-[#B91C1C]/40 rounded-lg text-xs text-[#B91C1C]">
            {dataError}
          </div>
        )}

        {activeTab === 'parent' && (
          <ParentPortal
            user={userProfile}
            language={language}
            clients={clients}
            sessions={sessions}
            reminders={reminders}
            partnerDirectory={partnerDirectory}
            alertSettings={alertSettings}
          />
        )}

        {activeTab === 'staff' && (
          <StaffPortal
            user={userProfile}
            language={language}
            clients={clients}
            sessions={sessions}
            staffRoster={staffRoster}
            contractCompanies={contractCompanies}
            partnerDirectory={partnerDirectory}
            alertSettings={alertSettings}
            isAdminPreview={userProfile.role === 'admin'}
          />
        )}

        {activeTab === 'partner' &&
          (userProfile.role === 'partner' || userProfile.role === 'admin') && (
            <PartnerPortal
              user={userProfile}
              language={language}
              clients={clients}
              sessions={sessions}
              partnerDirectory={partnerDirectory}
              triggerLogs={triggerLogs}
              alertSettings={alertSettings}
              isAdminPreview={userProfile.role === 'admin'}
            />
          )}

        {(activeTab === 'admin' || activeTab === 'finance') && userProfile.role === 'admin' && (
          <AdminDashboard
            user={userProfile}
            language={language}
            clients={clients}
            sessions={sessions}
            contractCompanies={contractCompanies}
            partnerDirectory={partnerDirectory}
            triggerLogs={triggerLogs}
            staffRoster={staffRoster}
            btCompensation={btCompensation}
            partnerPayments={partnerPayments}
            btPayouts={btPayouts}
            usersList={usersList}
            billingAlerts={billingAlerts}
            alertSettings={alertSettings}
            section={activeTab === 'finance' ? 'finance' : 'overview'}
          />
        )}

        {activeTab === 'ai' && (
          <AiAutomationHub
            user={userProfile}
            language={language}
            clients={clients}
            sessions={sessions}
            contractCompanies={contractCompanies}
            partnerPayments={partnerPayments}
            partnerDirectory={partnerDirectory}
            alertSettings={alertSettings}
          />
        )}

        {activeTab === 'docs' && <AdminDocsView language={language} />}
      </main>

      {/* Quick-Access Multi-Turn Gemini Assistant Across All Portals */}
      {activeTab !== 'ai' &&
        (!aiDrawerOpen ? (
          <button
            type="button"
            onClick={() => setAiDrawerOpen(true)}
            className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 px-4 py-2.5 bg-[#0F5C53] text-white text-xs font-medium rounded-xl shadow-lg hover:bg-[#0B4740] transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            <span>{language === 'yi' ? 'פרעגט AI' : 'Ask AI Assistant'}</span>
          </button>
        ) : (
          <GeminiChatbot
            language={language}
            portalContext={userProfile.role}
            snapshot={chatbotSnapshot}
            variant="drawer"
            onClose={() => setAiDrawerOpen(false)}
          />
        ))}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <GmailProvider>
        <BinahWorkspaceApp />
      </GmailProvider>
    </ErrorBoundary>
  );
}
