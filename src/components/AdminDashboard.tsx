import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Building2,
  CheckCircle2,
  DollarSign,
  Download,
  Mail,
  MessageSquare,
  Plus,
  Settings2,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { getCopy } from '../i18n/translations';
import {
  fetchGmailActivity,
  fetchNotificationStatus,
  sendTestNotification,
  sendUnbilledAdminEmailAlert,
  type DispatchTriggerResponse,
  type GmailActivityResponse,
  type NotificationProviderStatus,
} from '../lib/aiClient';
import { useGmail } from '../lib/gmailContext';
import {
  buildHipaaSafeDigestPayload,
  evaluateUnbilledSessions48h,
  PRIMARY_ADMIN_ALERT_EMAIL,
  type OverdueUnbilledSession,
} from '../lib/billingAlerts';
import {
  exportBillableSessionsCsv,
  exportBtPayoutsCsv,
  exportPartnerPaymentsCsv,
  exportPartnerSummaryCsv,
} from '../lib/csvExport';
import { auth } from '../lib/firebase';
import {
  assignUserPartnerRole,
  BOOTSTRAPPED_ADMIN_EMAIL,
  recordBtPayout,
  recordPartnerPayment,
  saveAdminAlertSettings,
  saveBillingAlertRecord,
  saveContractCompany,
  saveStaffMember,
  seedStarterOperationsData,
  syncPartnerDirectoryFromCompanies,
  updateBillingAlertStatus,
  updateSessionStatus,
} from '../lib/firestoreService';
import { formatEtDateLabel, formatOverdueDuration, getTodayEtIso } from '../lib/timeEt';
import {
  triggerActionNotification,
  type DispatchedTriggerOutcome,
} from '../lib/triggers';
import type {
  AdminAlertSettings,
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
  UserRole,
} from '../types/binah';
import {
  ActionTriggerCheckboxes,
  QuickActionTriggerButton,
  TriggerOutcomeBanner,
} from './ActionTriggerBar';
import { GoogleSignInButton } from './GoogleSignInButton';

interface AdminDashboardProps {
  user: UserProfile;
  language: Language;
  clients: ClientApplication[];
  sessions: TherapySession[];
  contractCompanies: ContractCompany[];
  partnerDirectory: PartnerDirectoryEntry[];
  triggerLogs: TriggerLog[];
  staffRoster: StaffRosterEntry[];
  btCompensation: BtCompensation[];
  partnerPayments: PartnerPayment[];
  btPayouts: BtPayout[];
  usersList: UserProfile[];
  billingAlerts: BillingAlert[];
  alertSettings: AdminAlertSettings | null;
  section: 'overview' | 'finance';
}

interface PublicInquiryItem {
  inquiryId: string;
  parentName: string;
  email: string;
  phone: string;
  borough: string;
  preferredLanguage: Language;
  message: string;
  createdAt: string;
}

function fmtUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  user,
  language,
  clients,
  sessions,
  contractCompanies,
  partnerDirectory,
  triggerLogs,
  staffRoster,
  btCompensation,
  partnerPayments,
  btPayouts,
  usersList,
  billingAlerts,
  alertSettings,
  section,
}) => {
  const t = getCopy(language);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState('');
  const [inquiries, setInquiries] = useState<PublicInquiryItem[]>([]);

  // Action Triggers (Email & SMS option on all admin actions)
  const [actionTriggerEmail, setActionTriggerEmail] = useState(true);
  const [actionTriggerSms, setActionTriggerSms] = useState(false);
  const [actionTriggerOutcome, setActionTriggerOutcome] =
    useState<DispatchedTriggerOutcome | null>(null);
  const [assigningUserUid, setAssigningUserUid] = useState<string | null>(null);
  const [rbacError, setRbacError] = useState('');

  useEffect(() => {
    if (contractCompanies.length > 0) {
      syncPartnerDirectoryFromCompanies(contractCompanies, partnerDirectory).catch(() => {});
    }
  }, [contractCompanies, partnerDirectory]);

  // 48-Hour Unbilled Session Alert State & Live Delivery Setup (Email + Text SMS)
  const [alertFilter, setAlertFilter] = useState<'active' | 'all'>('active');
  const [showAlertSettings, setShowAlertSettings] = useState(false);
  const [showDeliverySetup, setShowDeliverySetup] = useState(false);
  const [providerStatus, setProviderStatus] = useState<NotificationProviderStatus | null>(null);
  const [loadingProviderStatus, setLoadingProviderStatus] = useState(false);
  const [testingDelivery, setTestingDelivery] = useState(false);
  const [testOutcome, setTestOutcome] = useState<DispatchTriggerResponse | null>(null);
  const [testError, setTestError] = useState('');
  const [cfgEmail, setCfgEmail] = useState(alertSettings?.alertEmail || PRIMARY_ADMIN_ALERT_EMAIL);
  const [cfgPhone, setCfgPhone] = useState(alertSettings?.alertPhone || '');
  const [cfgNotifyEmail, setCfgNotifyEmail] = useState(alertSettings ? alertSettings.notifyEmail : true);
  const [cfgNotifySms, setCfgNotifySms] = useState(alertSettings ? alertSettings.notifySms : true);
  const [savingAlertCfg, setSavingAlertCfg] = useState(false);
  const [alertCfgNotice, setAlertCfgNotice] = useState('');
  const [sendingAlertEmail, setSendingAlertEmail] = useState(false);
  const [alertEmailNotice, setAlertEmailNotice] = useState('');
  const [alertMailtoUrl, setAlertMailtoUrl] = useState('');
  const [alertSmsUri, setAlertSmsUri] = useState('');
  const [alertSmsPreview, setAlertSmsPreview] = useState('');
  const [alertActionError, setAlertActionError] = useState('');
  const [approvingSessionId, setApprovingSessionId] = useState<string | null>(null);

  const {
    gmailConnected,
    gmailEmail,
    connectingGmail,
    gmailError,
    connectGmail,
    disconnectGmail,
  } = useGmail();

  const [gmailActivity, setGmailActivity] = useState<GmailActivityResponse | null>(null);
  const [loadingGmailActivity, setLoadingGmailActivity] = useState(false);
  const [gmailActivityError, setGmailActivityError] = useState('');

  const loadProviderStatus = async () => {
    setLoadingProviderStatus(true);
    try {
      const status = await fetchNotificationStatus();
      setProviderStatus(status);
      if (!alertSettings?.alertPhone && status.defaultAdminPhone) {
        setCfgPhone((prev) => prev || status.defaultAdminPhone);
      }
    } catch {
      // keep silent if non-admin or transient
    } finally {
      setLoadingProviderStatus(false);
    }
  };

  const loadGmailActivity = async () => {
    if (!gmailConnected) {
      setGmailActivity(null);
      return;
    }
    setLoadingGmailActivity(true);
    setGmailActivityError('');
    try {
      const activity = await fetchGmailActivity();
      setGmailActivity(activity);
    } catch (err) {
      setGmailActivityError(err instanceof Error ? err.message : 'Unable to load Gmail activity.');
    } finally {
      setLoadingGmailActivity(false);
    }
  };

  useEffect(() => {
    loadProviderStatus();
  }, []);

  useEffect(() => {
    if (gmailConnected) {
      loadGmailActivity();
    } else {
      setGmailActivity(null);
      setGmailActivityError('');
    }
  }, [gmailConnected]);

  useEffect(() => {
    if (alertSettings) {
      setCfgEmail(alertSettings.alertEmail || PRIMARY_ADMIN_ALERT_EMAIL);
      setCfgPhone(alertSettings.alertPhone || '');
      setCfgNotifyEmail(alertSettings.notifyEmail);
      setCfgNotifySms(alertSettings.notifySms);
      if (alertSettings.notifySms && alertSettings.alertPhone) {
        setActionTriggerSms(true);
      }
    }
  }, [alertSettings]);

  // Add Contract Company Form
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [compName, setCompName] = useState('');
  const [compContact, setCompContact] = useState('');
  const [compEmail, setCompEmail] = useState('');
  const [compPhone, setCompPhone] = useState('');
  const [compBillRate, setCompBillRate] = useState('85');
  const [compBtRate, setCompBtRate] = useState('35');
  const [compTerms, setCompTerms] = useState('Net 15 ACH');
  const [compAutoSignup, setCompAutoSignup] = useState(true);
  const [compAutoActions, setCompAutoActions] = useState(true);

  // Add Staff / BT Form
  const [showAddBt, setShowAddBt] = useState(false);
  const [btName, setBtName] = useState('');
  const [btTitle, setBtTitle] = useState('Behavior Technician');
  const [btBorough, setBtBorough] = useState('Monroe / Orange County, NY');
  const [btLanguages, setBtLanguages] = useState('אידיש, English');
  const [btRate, setBtRate] = useState('35');

  // Record Partner Payment Form
  const [showAddPay, setShowAddPay] = useState(false);
  const [payCompanyId, setPayCompanyId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payPeriod, setPayPeriod] = useState('Nov 2026');
  const [payDateEt, setPayDateEt] = useState(getTodayEtIso());
  const [payRef, setPayRef] = useState('');

  // Record BT Payout Form
  const [showAddPayout, setShowAddPayout] = useState(false);
  const [payoutBtId, setPayoutBtId] = useState('');
  const [payoutHours, setPayoutHours] = useState('20');
  const [payoutPeriod, setPayoutPeriod] = useState('Nov 2026');
  const [payoutDateEt, setPayoutDateEt] = useState(getTodayEtIso());

  // CSV Accounting Export State
  const [showExportPanel, setShowExportPanel] = useState(section === 'finance');
  const [exportFromEt, setExportFromEt] = useState('');
  const [exportToEt, setExportToEt] = useState('');
  const [exportNotice, setExportNotice] = useState('');

  useEffect(() => {
    if (section === 'finance') {
      setShowExportPanel(true);
    }
  }, [section]);

  useEffect(() => {
    if (!auth.currentUser) return;
    auth.currentUser
      .getIdToken()
      .then((token) =>
        fetch('/api/public/inquiries', {
          headers: {
            Authorization: `Bearer ${token}`,
            'x-binah-role': user.role,
          },
        })
      )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.inquiries) setInquiries(data.inquiries);
      })
      .catch(() => {});
  }, [user.role]);

  // Compute complete Financial & Operational Breakdown
  const financials = useMemo(() => {
    const companyMap = new Map(contractCompanies.map((c) => [c.companyId, c]));
    const compRateMap = new Map(btCompensation.map((b) => [b.staffId, b.hourlyPayRate]));

    let scheduledHours = 0;
    let approvedBillableHours = 0;
    let accruedGrossRevenue = 0;
    let accruedBtCost = 0;

    const byCompany: Record<
      string,
      {
        companyId: string;
        name: string;
        scheduledHours: number;
        approvedBillableHours: number;
        grossBilled: number;
        paymentsReceived: number;
        btCost: number;
        netProfit: number;
      }
    > = {};

    for (const c of contractCompanies) {
      byCompany[c.companyId] = {
        companyId: c.companyId,
        name: c.name,
        scheduledHours: 0,
        approvedBillableHours: 0,
        grossBilled: 0,
        paymentsReceived: 0,
        btCost: 0,
        netProfit: 0,
      };
    }

    for (const s of sessions) {
      if (s.status !== 'cancelled') {
        scheduledHours += s.scheduledHours || 0;
        if (s.contractCompanyId && byCompany[s.contractCompanyId]) {
          byCompany[s.contractCompanyId].scheduledHours += s.scheduledHours || 0;
        }
      }
      if (s.status === 'approved_billable') {
        const hrs = s.approvedBillableHours || 0;
        approvedBillableHours += hrs;

        const comp = s.contractCompanyId ? companyMap.get(s.contractCompanyId) : undefined;
        const billRate = comp?.billingRatePerHour ?? 84;
        const btPayRate = compRateMap.get(s.btId) ?? comp?.defaultBtPayPerHour ?? 34;

        const rev = hrs * billRate;
        const cost = hrs * btPayRate;

        accruedGrossRevenue += rev;
        accruedBtCost += cost;

        if (s.contractCompanyId && byCompany[s.contractCompanyId]) {
          byCompany[s.contractCompanyId].approvedBillableHours += hrs;
          byCompany[s.contractCompanyId].grossBilled += rev;
          byCompany[s.contractCompanyId].btCost += cost;
          byCompany[s.contractCompanyId].netProfit += rev - cost;
        }
      }
    }

    let totalPartnerReceived = 0;
    for (const p of partnerPayments) {
      if (p.status === 'received') {
        totalPartnerReceived += p.amount || 0;
        if (byCompany[p.contractCompanyId]) {
          byCompany[p.contractCompanyId].paymentsReceived += p.amount || 0;
        }
      }
    }

    let totalBtPaid = 0;
    for (const bp of btPayouts) {
      if (bp.status === 'paid') {
        totalBtPaid += bp.totalAmount || 0;
      }
    }

    const accruedProfit = accruedGrossRevenue - accruedBtCost;
    const cashNetProfit = totalPartnerReceived - totalBtPaid;
    const marginPct =
      accruedGrossRevenue > 0 ? Math.round((accruedProfit / accruedGrossRevenue) * 1000) / 10 : 0;

    return {
      scheduledHours: Math.round(scheduledHours * 100) / 100,
      approvedBillableHours: Math.round(approvedBillableHours * 100) / 100,
      accruedGrossRevenue,
      accruedBtCost,
      accruedProfit,
      marginPct,
      totalPartnerReceived,
      totalBtPaid,
      cashNetProfit,
      companyRows: Object.values(byCompany),
    };
  }, [contractCompanies, btCompensation, sessions, partnerPayments, btPayouts]);

  const handleSeed = async () => {
    setSeeding(true);
    setSeedError('');
    try {
      await seedStarterOperationsData(user.uid);
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Unable to seed sample data.');
    } finally {
      setSeeding(false);
    }
  };

  const handleAddCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    const companyId = await saveContractCompany({
      name: compName,
      contactName: compContact,
      contactEmail: compEmail,
      contactPhone: compPhone,
      billingRatePerHour: Number(compBillRate) || 85,
      defaultBtPayPerHour: Number(compBtRate) || 35,
      paymentTerms: compTerms,
      autoTriggerOnSignup: compAutoSignup,
      autoTriggerOnActions: compAutoActions,
      active: true,
    });
    if ((actionTriggerEmail || actionTriggerSms) && compEmail.trim()) {
      const outcome = await triggerActionNotification({
        user,
        eventType: 'custom_action',
        actionLabel: 'Partner Agency Configured',
        contractCompanyId: companyId,
        contractCompanyName: compName,
        summaryDetails: `Partner company ${compName} configured in BINAH CARE (${compTerms}).`,
        channels: {
          sendEmail: actionTriggerEmail,
          sendSms: actionTriggerSms,
          recipientEmail: compEmail.trim(),
          recipientPhone: compPhone.trim() || undefined,
        },
        partnerDirectory,
        alertSettings,
        language,
      }).catch(() => null);
      if (outcome) setActionTriggerOutcome(outcome);
    }
    setCompName('');
    setCompContact('');
    setCompEmail('');
    setCompPhone('');
    setShowAddCompany(false);
  };

  const handleAddBt = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveStaffMember({
      displayName: btName,
      title: btTitle,
      borough: btBorough,
      languages: btLanguages.split(',').map((s) => s.trim()).filter(Boolean),
      hourlyPayRate: Number(btRate) || 35,
    });
    if (actionTriggerEmail || actionTriggerSms) {
      const outcome = await triggerActionNotification({
        user,
        eventType: 'custom_action',
        actionLabel: 'Behavior Technician Added',
        summaryDetails: `Added ${btName} (${btTitle}, ${btBorough}) to the BINAH CARE staff roster.`,
        channels: {
          sendEmail: actionTriggerEmail,
          sendSms: actionTriggerSms,
        },
        partnerDirectory,
        alertSettings,
        language,
      }).catch(() => null);
      if (outcome) setActionTriggerOutcome(outcome);
    }
    setBtName('');
    setShowAddBt(false);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const comp =
      contractCompanies.find((c) => c.companyId === payCompanyId) || contractCompanies[0];
    if (!comp) return;
    const amt = Number(payAmount) || 0;
    const refNum = payRef || `ACH-${Date.now().toString().slice(-4)}`;
    await recordPartnerPayment({
      contractCompanyId: comp.companyId,
      contractCompanyName: comp.name,
      amount: amt,
      periodLabel: payPeriod,
      paymentDateEt: payDateEt,
      referenceNumber: refNum,
      status: 'received',
      notes: 'Recorded by Admin',
      recordedByUid: user.uid,
    });
    if (actionTriggerEmail || actionTriggerSms) {
      const outcome = await triggerActionNotification({
        user,
        eventType: 'payment_recorded',
        contractCompanyId: comp.companyId,
        contractCompanyName: comp.name,
        partnerUids: comp.partnerUids,
        summaryDetails: `Recorded payment of ${fmtUsd(amt)} from ${comp.name} for ${payPeriod} (Ref ${refNum}).`,
        channels: {
          sendEmail: actionTriggerEmail,
          sendSms: actionTriggerSms,
        },
        partnerDirectory,
        alertSettings,
        language,
      }).catch(() => null);
      if (outcome) setActionTriggerOutcome(outcome);
    }
    setPayAmount('');
    setPayRef('');
    setShowAddPay(false);
  };

  const handleRecordPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    const bt = staffRoster.find((b) => b.staffId === payoutBtId) || staffRoster[0];
    if (!bt) return;
    const rate =
      btCompensation.find((c) => c.staffId === bt.staffId)?.hourlyPayRate ?? 35;
    const hrs = Number(payoutHours) || 0;
    const totalAmt = Math.round(hrs * rate * 100) / 100;
    await recordBtPayout({
      btId: bt.staffId,
      btName: bt.displayName,
      hoursPaid: hrs,
      hourlyRate: rate,
      totalAmount: totalAmt,
      periodLabel: payoutPeriod,
      paymentDateEt: payoutDateEt,
      status: 'paid',
      notes: 'Bi-weekly BT payroll payout',
      recordedByUid: user.uid,
    });
    if (actionTriggerEmail || actionTriggerSms) {
      const outcome = await triggerActionNotification({
        user,
        eventType: 'payout_recorded',
        summaryDetails: `Recorded BT payroll payout of ${fmtUsd(totalAmt)} (${hrs}h) for ${bt.displayName} (${payoutPeriod}).`,
        channels: {
          sendEmail: actionTriggerEmail,
          sendSms: actionTriggerSms,
        },
        partnerDirectory,
        alertSettings,
        language,
      }).catch(() => null);
      if (outcome) setActionTriggerOutcome(outcome);
    }
    setShowAddPayout(false);
  };

  const exportFilter = useMemo(
    () => ({
      dateFromEt: exportFromEt || undefined,
      dateToEt: exportToEt || undefined,
    }),
    [exportFromEt, exportToEt]
  );

  const handleExportPartnerSummary = () => {
    const res = exportPartnerSummaryCsv({
      contractCompanies,
      sessions,
      partnerPayments,
      btCompensation,
      filter: exportFilter,
    });
    setExportNotice(`Downloaded ${res.filename} (${res.rowCount} companies).`);
  };

  const handleExportPartnerPayments = () => {
    const res = exportPartnerPaymentsCsv({
      partnerPayments,
      filter: exportFilter,
    });
    setExportNotice(`Downloaded ${res.filename} (${res.rowCount} payment records).`);
  };

  const handleExportBtPayouts = () => {
    const res = exportBtPayoutsCsv({
      btPayouts,
      filter: exportFilter,
    });
    setExportNotice(`Downloaded ${res.filename} (${res.rowCount} payout records).`);
  };

  const handleExportSessionsJournal = () => {
    const res = exportBillableSessionsCsv({
      sessions,
      contractCompanies,
      btCompensation,
      filter: exportFilter,
    });
    setExportNotice(`Downloaded ${res.filename} (${res.rowCount} session entries).`);
  };

  const handleExportAllCsv = () => {
    const r1 = exportPartnerSummaryCsv({
      contractCompanies,
      sessions,
      partnerPayments,
      btCompensation,
      filter: exportFilter,
    });
    const r2 = exportPartnerPaymentsCsv({ partnerPayments, filter: exportFilter });
    const r3 = exportBtPayoutsCsv({ btPayouts, filter: exportFilter });
    const r4 = exportBillableSessionsCsv({
      sessions,
      contractCompanies,
      btCompensation,
      filter: exportFilter,
    });
    setExportNotice(
      `Exported 4 accounting CSVs (${r1.rowCount} partners, ${r2.rowCount} payments, ${r3.rowCount} payouts, ${r4.rowCount} sessions).`
    );
  };

  // 48-Hour Unbilled Therapy Session Alert Analytics & Handlers
  const overdueItems = useMemo(
    () =>
      evaluateUnbilledSessions48h(
        sessions,
        contractCompanies,
        btCompensation,
        billingAlerts
      ),
    [sessions, contractCompanies, btCompensation, billingAlerts]
  );

  const activeOverdueItems = useMemo(
    () =>
      overdueItems.filter(
        (item) =>
          item.alertRecord?.status !== 'acknowledged' &&
          item.alertRecord?.status !== 'resolved'
      ),
    [overdueItems]
  );

  const displayedOverdueItems = alertFilter === 'active' ? activeOverdueItems : overdueItems;

  const overdueTotals = useMemo(() => {
    const hrs = activeOverdueItems.reduce((sum, i) => sum + (i.session.scheduledHours || 0), 0);
    const rev = activeOverdueItems.reduce((sum, i) => sum + i.estimatedRevenue, 0);
    return {
      count: activeOverdueItems.length,
      hours: Math.round(hrs * 100) / 100,
      revenue: Math.round(rev * 100) / 100,
    };
  }, [activeOverdueItems]);

  const handleSaveAlertSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAlertCfg(true);
    setAlertCfgNotice('');
    setAlertActionError('');
    try {
      await saveAdminAlertSettings({
        alertEmail: cfgEmail.trim() || PRIMARY_ADMIN_ALERT_EMAIL,
        alertPhone: cfgPhone.trim(),
        notifyEmail: cfgNotifyEmail,
        notifySms: cfgNotifySms,
        updatedByUid: user.uid,
      });
      setAlertCfgNotice('Saved Email & Text (SMS) alert channel preferences.');
    } catch (err) {
      setAlertActionError(err instanceof Error ? err.message : 'Unable to save alert settings.');
    } finally {
      setSavingAlertCfg(false);
    }
  };

  const handleRunLiveDeliveryTest = async () => {
    setTestingDelivery(true);
    setTestError('');
    setTestOutcome(null);
    try {
      const targetEmail = cfgEmail.trim() || PRIMARY_ADMIN_ALERT_EMAIL;
      const targetPhone = cfgPhone.trim() || providerStatus?.defaultAdminPhone || '';
      const res = await sendTestNotification({
        recipientEmail: targetEmail,
        recipientPhone: targetPhone || undefined,
        sendEmail: cfgNotifyEmail,
        sendSms: cfgNotifySms,
      });
      setTestOutcome(res);
      await loadProviderStatus();
      if (gmailConnected && res.emailSent) {
        loadGmailActivity();
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Unable to run live delivery test.');
    } finally {
      setTestingDelivery(false);
    }
  };

  const handleDispatchAlertEmail = async () => {
    const targetList = activeOverdueItems.length > 0 ? activeOverdueItems : overdueItems;
    if (targetList.length === 0) return;

    const targetEmail = cfgEmail.trim() || PRIMARY_ADMIN_ALERT_EMAIL;
    const targetPhone = cfgPhone.trim();

    if (!cfgNotifyEmail && !cfgNotifySms) {
      setAlertActionError('Enable at least Email or Text (SMS) notifications before sending.');
      return;
    }

    setSendingAlertEmail(true);
    setAlertEmailNotice('');
    setAlertActionError('');
    setAlertMailtoUrl('');
    setAlertSmsUri('');
    setAlertSmsPreview('');

    try {
      const digest = buildHipaaSafeDigestPayload(
        targetList,
        window.location.origin,
        targetEmail,
        targetPhone
      );
      const res = await sendUnbilledAdminEmailAlert({
        recipientEmail: targetEmail,
        recipientPhone: targetPhone || undefined,
        sendEmail: cfgNotifyEmail,
        sendSms: cfgNotifySms,
        subject: digest.subject,
        textBody: digest.textBody,
        smsBody: digest.smsBody,
        items: digest.digestItems,
      });

      const emailStatus = res.emailStatus ?? res.status;
      const smsStatus = res.smsStatus ?? (cfgNotifySms ? 'queued_no_sms' : 'disabled');

      if (emailStatus === 'disabled' && smsStatus === 'disabled' && !res.sent) {
        setAlertEmailNotice(res.message || 'Gmail send cancelled.');
        return;
      }

      const emailSentOk = emailStatus === 'sent';
      const smsSentOk = smsStatus === 'sent';
      const channel: BillingAlertChannel =
        emailSentOk && smsSentOk
          ? 'email_sms_and_dashboard'
          : emailSentOk
            ? 'email_and_dashboard'
            : smsSentOk
              ? 'sms_and_dashboard'
              : 'dashboard';

      await Promise.all(
        targetList.map((item) =>
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
            status: item.alertRecord?.status === 'acknowledged' ? 'acknowledged' : 'active',
            createdByUid: user.uid,
          })
        )
      );

      setAlertEmailNotice(res.message);
      if (gmailConnected && emailSentOk) {
        loadGmailActivity();
      }
      if (cfgNotifyEmail && !emailSentOk) {
        setAlertMailtoUrl(digest.mailtoUrl);
      }
      if (cfgNotifySms && !smsSentOk) {
        setAlertSmsUri(digest.smsUri);
        setAlertSmsPreview(res.smsBody || digest.smsBody);
      }
    } catch (err) {
      setAlertActionError(err instanceof Error ? err.message : 'Unable to dispatch billing alerts.');
    } finally {
      setSendingAlertEmail(false);
    }
  };

  const handleApproveAndBillOverdue = async (item: OverdueUnbilledSession) => {
    setApprovingSessionId(item.session.sessionId);
    setAlertActionError('');
    try {
      await updateSessionStatus(item.session.sessionId, {
        status: 'approved_billable',
        approvedBillableHours: item.session.scheduledHours,
        approvedByUid: user.uid,
      });
      if (actionTriggerEmail || actionTriggerSms) {
        const outcome = await triggerActionNotification({
          user,
          eventType: 'session_billed',
          contractCompanyId: item.session.contractCompanyId,
          contractCompanyName: item.session.contractCompanyName,
          partnerUids: item.session.partnerUids,
          clientId: item.session.clientId,
          clientName: item.session.clientName,
          summaryDetails: `Overdue session on ${item.session.dateEt} (${item.session.startTimeEt} - ${item.session.endTimeEt}) approved billable for ${item.session.scheduledHours.toFixed(2)}h.`,
          channels: {
            sendEmail: actionTriggerEmail,
            sendSms: actionTriggerSms,
          },
          partnerDirectory,
          alertSettings,
          language,
        }).catch(() => null);
        if (outcome) setActionTriggerOutcome(outcome);
      }
    } catch (err) {
      setAlertActionError(err instanceof Error ? err.message : 'Unable to approve session.');
    } finally {
      setApprovingSessionId(null);
    }
  };

  const handleAcknowledgeOverdue = async (item: OverdueUnbilledSession) => {
    setAlertActionError('');
    try {
      if (item.alertRecord) {
        await updateBillingAlertStatus(item.alertRecord.alertId, 'acknowledged');
      } else {
        await saveBillingAlertRecord({
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
          recipientEmail: cfgEmail.trim() || PRIMARY_ADMIN_ALERT_EMAIL,
          recipientPhone: cfgPhone.trim() || undefined,
          channel: 'dashboard',
          emailStatus: 'queued_no_smtp',
          smsStatus: cfgNotifySms ? 'queued_no_sms' : 'disabled',
          status: 'acknowledged',
          createdByUid: user.uid,
        });
      }
    } catch (err) {
      setAlertActionError(err instanceof Error ? err.message : 'Unable to acknowledge alert.');
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#E6E4DF]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#181A1F]">
            {section === 'finance' ? t.tabFinance : t.tabAdmin}
          </h1>
          <p className="mt-1 text-sm text-[#575B66]">
            {language === 'yi'
              ? 'פולער אַדמין צוטריט צו שותף פֿירמעס (אל היים, הילף), BT צאָלונגען, און בינה קעיר פּראָפֿיטן.'
              : 'Administrator-only ledger across El Heim, Hilf, and partner companies—tracking scheduled vs. approved billable hours, BT payroll, and BINAH CARE net profit.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowDeliverySetup((v) => !v);
                loadProviderStatus();
                if (gmailConnected) loadGmailActivity();
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-[#E6E4DF] text-[#181A1F] text-sm font-medium rounded-lg hover:border-[#0F5C53] transition-colors whitespace-nowrap shrink-0"
            >
              <BellRing className="w-4 h-4 text-[#0F5C53]" />
              <span>Email &amp; Text Setup</span>
              {(providerStatus || gmailConnected) && (
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                    (providerStatus?.emailConfigured || gmailConnected) && providerStatus?.smsConfigured
                      ? 'bg-[#DCFCE7] text-[#166534]'
                      : gmailConnected || providerStatus?.emailConfigured || providerStatus?.smsConfigured
                        ? 'bg-[#DCFCE7] text-[#166534]'
                        : 'bg-[#FEF3C7] text-[#B45309]'
                  }`}
                >
                  {(providerStatus?.emailConfigured || gmailConnected) && providerStatus?.smsConfigured
                    ? 'Live'
                    : gmailConnected
                      ? 'Gmail Live'
                      : providerStatus?.emailConfigured || providerStatus?.smsConfigured
                        ? 'Partial'
                        : 'Setup Needed'}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowExportPanel((v) => !v)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-[#E6E4DF] text-[#181A1F] text-sm font-medium rounded-lg hover:border-[#0F5C53] transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4 text-[#0F5C53]" />
              <span>{t.exportCsv}</span>
            </button>

            {contractCompanies.length === 0 && (
              <button
                type="button"
                onClick={handleSeed}
                disabled={seeding}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0F5C53] text-white text-sm font-medium rounded-lg hover:bg-[#0B4740] transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-4 h-4" />
                <span>{seeding ? 'Initializing...' : 'Load Starter El Heim & Hilf Data'}</span>
              </button>
            )}
          </div>
        </div>

        {seedError && <p className="text-xs text-[#B91C1C]">{seedError}</p>}

        {/* Automatic Email & Text (SMS) Delivery Setup & Live Test Console */}
        {showDeliverySetup && (
          <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#E6E4DF]">
              <div>
                <h2 className="text-base font-semibold text-[#181A1F]">
                  Gmail, Automatic Email &amp; Text (SMS) Delivery Setup
                </h2>
                <p className="mt-1 text-xs text-[#575B66]">
                  Connect your Gmail account directly with Google Sign-In to send alerts, or configure server SMTP/Twilio secrets for background delivery.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  loadProviderStatus();
                  if (gmailConnected) loadGmailActivity();
                }}
                disabled={loadingProviderStatus || loadingGmailActivity}
                className="px-3 py-1.5 text-xs font-medium border border-[#E6E4DF] rounded-lg hover:border-[#0F5C53]"
              >
                {loadingProviderStatus || loadingGmailActivity ? 'Checking...' : 'Refresh Status'}
              </button>
            </div>

            {/* Direct Gmail OAuth Connection */}
            <div
              className={`p-4 rounded-lg border text-xs space-y-3 ${
                gmailConnected
                  ? 'border-[#16A34A]/40 bg-[#F0FDF4]'
                  : 'border-[#E6E4DF] bg-[#FAF9F6]'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-[#181A1F] flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-[#0F5C53]" />
                    <span>Gmail Account Integration (Google OAuth)</span>
                  </div>
                  <p className="mt-1 text-[#575B66]">
                    {gmailConnected ? (
                      <>
                        Connected as{' '}
                        <span className="font-mono font-semibold text-[#181A1F]">
                          {gmailEmail || gmailActivity?.emailAddress || 'Gmail'}
                        </span>
                        . Every alert shows a confirmation preview dialog before sending through Gmail.
                      </>
                    ) : (
                      'Connect your Google / Gmail account to send BINAH CARE alerts directly from Gmail with confirmation before sending.'
                    )}
                  </p>
                </div>

                {gmailConnected ? (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={loadGmailActivity}
                      disabled={loadingGmailActivity}
                      className="px-3 py-1.5 bg-white border border-[#E6E4DF] text-[#181A1F] text-xs font-medium rounded-lg hover:border-[#0F5C53] disabled:opacity-50"
                    >
                      {loadingGmailActivity ? 'Loading...' : 'Refresh Sent Alerts'}
                    </button>
                    <button
                      type="button"
                      onClick={disconnectGmail}
                      className="px-3 py-1.5 bg-white border border-[#E6E4DF] text-[#B91C1C] text-xs font-medium rounded-lg hover:border-[#B91C1C]"
                    >
                      Disconnect Gmail
                    </button>
                  </div>
                ) : (
                  <GoogleSignInButton
                    onClick={connectGmail}
                    disabled={connectingGmail}
                    label={connectingGmail ? 'Connecting Gmail...' : 'Sign in with Google'}
                  />
                )}
              </div>

              {gmailError && <p className="text-[#B91C1C] font-medium">{gmailError}</p>}
              {gmailActivityError && <p className="text-[#B91C1C] font-medium">{gmailActivityError}</p>}

              {gmailConnected && gmailActivity && (
                <div className="pt-3 border-t border-[#16A34A]/20 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-[#575B66]">
                    <span className="font-medium text-[#181A1F]">
                      Recent BINAH CARE Gmail Messages ({gmailActivity.recentMessages.length})
                    </span>
                    <span className="font-mono">
                      Mailbox total: {gmailActivity.messagesTotal.toLocaleString()}
                    </span>
                  </div>
                  {gmailActivity.recentMessages.length === 0 ? (
                    <p className="text-[11px] text-[#575B66]">
                      No BINAH CARE alerts found in Gmail yet. Click &ldquo;Send Live Test&rdquo; below to send your first Gmail alert.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {gmailActivity.recentMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className="p-2.5 bg-white border border-[#E6E4DF] rounded-md flex flex-wrap items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-[#181A1F] truncate">{msg.subject}</div>
                            <div className="text-[11px] text-[#575B66] truncate">
                              To: {msg.to || 'Recipient'}
                            </div>
                          </div>
                          <span className="text-[10px] font-mono text-[#575B66] shrink-0">
                            {msg.date}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div
                className={`p-4 rounded-lg border ${
                  providerStatus?.emailConfigured || gmailConnected
                    ? 'border-[#16A34A]/40 bg-[#F0FDF4]'
                    : 'border-[#F59E0B]/50 bg-[#FFFBEB]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#181A1F] flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-[#0F5C53]" />
                    <span>Email Delivery Status</span>
                  </span>
                  <span className="font-mono text-[11px] font-semibold">
                    {gmailConnected
                      ? 'GMAIL OAUTH CONNECTED'
                      : providerStatus?.emailConfigured
                        ? `CONNECTED (${providerStatus.emailProvider.toUpperCase()})`
                        : 'NOT CONFIGURED'}
                  </span>
                </div>
                <p className="mt-2 text-[#575B66] leading-relaxed">
                  {gmailConnected ? (
                    <>
                      Sending through Gmail as{' '}
                      <span className="font-mono text-[#181A1F]">{gmailEmail || 'Gmail'}</span>.
                    </>
                  ) : providerStatus?.emailConfigured ? (
                    <>
                      Sending automatically from{' '}
                      <span className="font-mono text-[#181A1F]">{providerStatus.emailSender}</span>.
                    </>
                  ) : (
                    <>
                      Click <strong>Sign in with Google</strong> above to send via Gmail, or add{' '}
                      <code className="px-1 py-0.5 bg-white border border-[#E6E4DF] rounded">GMAIL_USER</code>{' '}
                      + <code className="px-1 py-0.5 bg-white border border-[#E6E4DF] rounded">GMAIL_APP_PASSWORD</code>{' '}
                      or <code className="px-1 py-0.5 bg-white border border-[#E6E4DF] rounded">RESEND_API_KEY</code> in AI Studio Secrets for background alerts.
                    </>
                  )}
                </p>
              </div>

            <div
              className={`p-4 rounded-lg border ${
                providerStatus?.smsConfigured
                  ? 'border-[#16A34A]/40 bg-[#F0FDF4]'
                  : 'border-[#F59E0B]/50 bg-[#FFFBEB]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#181A1F] flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-[#0F5C53]" />
                  <span>Automatic Text (SMS) Status</span>
                </span>
                <span className="font-mono text-[11px] font-semibold">
                  {providerStatus?.smsConfigured
                    ? `CONNECTED (${providerStatus.smsProvider.toUpperCase()})`
                    : 'NOT CONFIGURED'}
                </span>
              </div>
              <p className="mt-2 text-[#575B66] leading-relaxed">
                {providerStatus?.smsConfigured ? (
                  <>
                    Sending real SMS automatically from{' '}
                    <span className="font-mono text-[#181A1F]">{providerStatus.smsSender || 'Webhook'}</span>.
                  </>
                ) : (
                  <>
                    In AI Studio <strong>Settings &rarr; Secrets</strong>, add{' '}
                    <code className="px-1 py-0.5 bg-white border border-[#E6E4DF] rounded">TWILIO_ACCOUNT_SID</code>,{' '}
                    <code className="px-1 py-0.5 bg-white border border-[#E6E4DF] rounded">TWILIO_AUTH_TOKEN</code>,{' '}
                    <code className="px-1 py-0.5 bg-white border border-[#E6E4DF] rounded">TWILIO_FROM_NUMBER</code>, and{' '}
                    <code className="px-1 py-0.5 bg-white border border-[#E6E4DF] rounded">ADMIN_ALERT_PHONE</code>.
                  </>
                )}
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveAlertSettings} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-[11px] font-medium text-[#575B66] mb-1">
                {t.alertEmailTarget}
              </label>
              <input
                type="email"
                required
                value={cfgEmail}
                onChange={(e) => setCfgEmail(e.target.value)}
                placeholder="arledigt@gmail.com"
                className="w-full px-3 py-2 text-xs font-mono bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#575B66] mb-1">
                {t.alertPhoneTarget}
              </label>
              <input
                type="tel"
                value={cfgPhone}
                onChange={(e) => setCfgPhone(e.target.value)}
                placeholder="+1 (845) 555-0199"
                className="w-full px-3 py-2 text-xs font-mono bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg"
              />
            </div>
            <div className="flex flex-wrap items-center gap-4 py-2">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-[#181A1F] cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfgNotifyEmail}
                  onChange={(e) => setCfgNotifyEmail(e.target.checked)}
                />
                <span>Auto Email</span>
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-[#181A1F] cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfgNotifySms}
                  onChange={(e) => setCfgNotifySms(e.target.checked)}
                />
                <span>Auto Text (SMS)</span>
              </label>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="submit"
                disabled={savingAlertCfg}
                className="px-3.5 py-2 bg-[#0F5C53] text-white text-xs font-medium rounded-lg hover:bg-[#0B4740] disabled:opacity-50 whitespace-nowrap"
              >
                {savingAlertCfg ? 'Saving...' : 'Save Settings'}
              </button>
              <button
                type="button"
                onClick={handleRunLiveDeliveryTest}
                disabled={testingDelivery}
                className="px-3.5 py-2 bg-[#181A1F] text-white text-xs font-medium rounded-lg hover:bg-[#2F333D] disabled:opacity-50 whitespace-nowrap"
              >
                {testingDelivery ? 'Testing...' : 'Send Live Test'}
              </button>
            </div>
          </form>

          {alertCfgNotice && <p className="text-xs font-medium text-[#0F5C53]">{alertCfgNotice}</p>}
          {testError && <p className="text-xs font-medium text-[#B91C1C]">{testError}</p>}
          {testOutcome && (
            <div
              className={`p-3.5 rounded-lg border text-xs space-y-1 ${
                testOutcome.emailStatus === 'failed' || testOutcome.smsStatus === 'failed'
                  ? 'border-[#B91C1C]/40 bg-[#FEF2F2] text-[#B91C1C]'
                  : testOutcome.emailStatus === 'sent' || testOutcome.smsStatus === 'sent'
                    ? 'border-[#16A34A]/40 bg-[#F0FDF4] text-[#166534]'
                    : 'border-[#F59E0B]/50 bg-[#FFFBEB] text-[#92400E]'
              }`}
            >
              <div className="font-semibold">
                Email: {testOutcome.emailStatus} · Text (SMS): {testOutcome.smsStatus}
              </div>
              <div>{testOutcome.message}</div>
            </div>
          )}
        </div>
      )}

      {/* Global Action Trigger Options & Feedback */}
      <div className="space-y-2.5">
        <ActionTriggerCheckboxes
          language={language}
          sendEmail={actionTriggerEmail}
          sendSms={actionTriggerSms}
          onChangeEmail={setActionTriggerEmail}
          onChangeSms={setActionTriggerSms}
          targetSummary={`Default Admin: ${cfgEmail || PRIMARY_ADMIN_ALERT_EMAIL}${cfgPhone ? ` · SMS: ${cfgPhone}` : ''} · Partner Agencies route to their configured contact`}
        />
        <TriggerOutcomeBanner
          outcome={actionTriggerOutcome}
          onDismiss={() => setActionTriggerOutcome(null)}
        />
      </div>

      {/* 48-Hour Unbilled Therapy Session Alerts (Automatic Revenue Safeguard — Email & Text SMS) */}
      {overdueItems.length > 0 ? (
        <div className="p-6 bg-[#FFFBEB] border border-[#F59E0B]/50 rounded-xl space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#F59E0B]/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-[#B45309] shrink-0 mt-0.5" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-[#181A1F]">
                    {t.unbilledAlertTitle}
                  </h2>
                  <span className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-[#FEF3C7] text-[#B45309] border border-[#F59E0B]/40 rounded">
                    {overdueTotals.count} Active · {overdueTotals.hours.toFixed(2)}h ·{' '}
                    {fmtUsd(overdueTotals.revenue)} at risk
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#575B66]">
                  {t.unbilledAlertSubtitle} ·{' '}
                  <span className="font-mono text-[#181A1F]">
                    Email: {cfgEmail || PRIMARY_ADMIN_ALERT_EMAIL}
                    {cfgPhone ? ` · Text: ${cfgPhone}` : ' · Add SMS number'}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="flex items-center gap-1 p-1 bg-white border border-[#E6E4DF] rounded-lg">
                <button
                  type="button"
                  onClick={() => setAlertFilter('active')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                    alertFilter === 'active'
                      ? 'bg-[#0F5C53] text-white'
                      : 'text-[#575B66] hover:text-[#181A1F]'
                  }`}
                >
                  Active ({activeOverdueItems.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAlertFilter('all')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                    alertFilter === 'all'
                      ? 'bg-[#0F5C53] text-white'
                      : 'text-[#575B66] hover:text-[#181A1F]'
                  }`}
                >
                  All Overdue ({overdueItems.length})
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowAlertSettings((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-[#E6E4DF] text-[#181A1F] text-xs font-medium rounded-lg hover:border-[#0F5C53] whitespace-nowrap shrink-0"
              >
                <Settings2 className="w-3.5 h-3.5 text-[#0F5C53]" />
                <span>{t.alertSettingsTitle}</span>
              </button>

              {!gmailConnected && (
                <GoogleSignInButton
                  onClick={connectGmail}
                  disabled={connectingGmail}
                  label={connectingGmail ? 'Connecting...' : 'Connect Gmail'}
                />
              )}

              <button
                type="button"
                onClick={handleDispatchAlertEmail}
                disabled={sendingAlertEmail}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#B45309] text-white text-xs font-medium rounded-lg hover:bg-[#92400E] transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>
                  {sendingAlertEmail
                    ? 'Sending...'
                    : gmailConnected
                      ? 'Send via Gmail'
                      : t.sendAlertEmail}
                </span>
              </button>
            </div>
          </div>

          {showAlertSettings && (
            <form
              onSubmit={handleSaveAlertSettings}
              className="p-4 bg-white border border-[#E6E4DF] rounded-lg space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                <div>
                  <label className="block text-[11px] font-medium text-[#575B66] mb-1">
                    {t.alertEmailTarget}
                  </label>
                  <input
                    type="email"
                    required
                    value={cfgEmail}
                    onChange={(e) => setCfgEmail(e.target.value)}
                    placeholder="arledigt@gmail.com"
                    className="w-full px-3 py-2 text-xs font-mono bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#575B66] mb-1">
                    {t.alertPhoneTarget}
                  </label>
                  <input
                    type="tel"
                    value={cfgPhone}
                    onChange={(e) => setCfgPhone(e.target.value)}
                    placeholder="(845) 555-0199"
                    className="w-full px-3 py-2 text-xs font-mono bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-4 py-2">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-[#181A1F] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfgNotifyEmail}
                      onChange={(e) => setCfgNotifyEmail(e.target.checked)}
                      className="rounded border-[#E6E4DF] text-[#0F5C53]"
                    />
                    <span>{t.channelEmail}</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-[#181A1F] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfgNotifySms}
                      onChange={(e) => setCfgNotifySms(e.target.checked)}
                      className="rounded border-[#E6E4DF] text-[#0F5C53]"
                    />
                    <span>{t.channelSms}</span>
                  </label>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingAlertCfg}
                    className="px-4 py-2 bg-[#0F5C53] text-white text-xs font-medium rounded-lg hover:bg-[#0B4740] disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {savingAlertCfg ? 'Saving...' : t.saveAlertSettings}
                  </button>
                </div>
              </div>
              {alertCfgNotice && (
                <p className="text-xs font-medium text-[#0F5C53]">{alertCfgNotice}</p>
              )}
            </form>
          )}

          {alertActionError && (
            <p className="text-xs text-[#B91C1C] font-medium">{alertActionError}</p>
          )}
          {alertEmailNotice && (
            <div className="p-3.5 bg-white border border-[#E6E4DF] rounded-lg space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[#181A1F] font-medium">{alertEmailNotice}</span>
                <div className="flex flex-wrap items-center gap-2">
                  {alertMailtoUrl && (
                    <a
                      href={alertMailtoUrl}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0F5C53] text-white font-medium rounded-md hover:bg-[#0B4740] whitespace-nowrap shrink-0"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span>Open Email Draft</span>
                    </a>
                  )}
                  {alertSmsUri && (
                    <a
                      href={alertSmsUri}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#181A1F] text-white font-medium rounded-md hover:bg-[#2F333D] whitespace-nowrap shrink-0"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Open Text / SMS Draft</span>
                    </a>
                  )}
                </div>
              </div>
              {alertSmsPreview && (
                <div className="p-2.5 bg-[#FAF9F6] border border-[#E6E4DF] rounded font-mono text-[11px] text-[#575B66]">
                  SMS Text Preview (HIPAA-Safe): {alertSmsPreview}
                </div>
              )}
            </div>
          )}

          {displayedOverdueItems.length === 0 ? (
            <p className="text-xs text-[#575B66] py-2">
              All currently overdue sessions have been acknowledged. Switch to “All Overdue” to review or bill them.
            </p>
          ) : (
            <div className="overflow-x-auto bg-white border border-[#E6E4DF] rounded-lg">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#E6E4DF] text-[#575B66]">
                    <th className="py-2.5 px-3 font-medium">Client &amp; BT</th>
                    <th className="py-2.5 px-3 font-medium">Partner</th>
                    <th className="py-2.5 px-3 font-medium">Session (ET 12h)</th>
                    <th className="py-2.5 px-3 font-medium">Delay</th>
                    <th className="py-2.5 px-3 font-medium text-right">Hours / Est. Rev</th>
                    <th className="py-2.5 px-3 font-medium">Email &amp; Text Status</th>
                    <th className="py-2.5 px-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E4DF]">
                  {displayedOverdueItems.map((item) => {
                    const alertStatus = item.alertRecord?.status || 'active';
                    const emailStatus = item.alertRecord?.emailStatus;
                    const smsStatus = item.alertRecord?.smsStatus;
                    return (
                      <tr key={item.session.sessionId} className="hover:bg-[#FAF9F6]">
                        <td className="py-3 px-3">
                          <div className="font-semibold text-[#181A1F]">
                            {item.session.clientName || item.session.clientId}
                          </div>
                          <div className="text-[#575B66]">{item.session.btName || item.session.btId}</div>
                        </td>
                        <td className="py-3 px-3 text-[#181A1F]">
                          {item.session.contractCompanyName || 'Unassigned'}
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-[#181A1F]">
                          <div>{formatEtDateLabel(item.session.dateEt)}</div>
                          <div className="text-[#575B66]">
                            {item.session.startTimeEt} – {item.session.endTimeEt}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-mono font-semibold text-[#B45309]">
                            {formatOverdueDuration(item.hoursOverdue, language)}
                          </span>
                          <div className="text-[11px] text-[#575B66]">
                            {item.reason === 'completed_unbilled'
                              ? 'Completed · Unbilled'
                              : 'Past Due · Unclosed'}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-right">
                          <div className="font-medium text-[#181A1F]">
                            {item.session.scheduledHours.toFixed(2)}h
                          </div>
                          <div className="text-[#0F5C53] font-semibold">
                            {fmtUsd(item.estimatedRevenue)}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-[11px]">
                          <div className="font-medium text-[#181A1F]">
                            Email: {emailStatus === 'sent' ? 'Sent' : emailStatus === 'disabled' ? 'Off' : 'Queued'} ·
                            Text: {smsStatus === 'sent' ? 'Sent' : smsStatus === 'disabled' || !smsStatus ? 'Off' : 'Queued'}
                          </div>
                          <div className="text-[#575B66]">
                            {alertStatus === 'acknowledged' ? 'Acknowledged' : 'Dashboard Active'}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {alertStatus !== 'acknowledged' && (
                              <button
                                type="button"
                                onClick={() => handleAcknowledgeOverdue(item)}
                                className="px-2.5 py-1.5 text-[11px] font-medium text-[#575B66] border border-[#E6E4DF] rounded-md hover:text-[#181A1F] whitespace-nowrap"
                              >
                                {t.acknowledgeAlert}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={approvingSessionId === item.session.sessionId}
                              onClick={() => handleApproveAndBillOverdue(item)}
                              className="px-2.5 py-1.5 text-[11px] font-medium bg-[#0F5C53] text-white rounded-md hover:bg-[#0B4740] disabled:opacity-50 whitespace-nowrap"
                            >
                              {approvingSessionId === item.session.sessionId
                                ? '...'
                                : `${t.approveAndBill} (${item.session.scheduledHours.toFixed(1)}h)`}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 bg-white border border-[#E6E4DF] rounded-xl space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[#16A34A] font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                {language === 'yi'
                  ? 'אַלע פאַרענדיקטע סעסיעס זענען באַשטעטיקט ביז 48 שעה (ET).'
                  : '48-Hour Billing SLA Clear — no therapy sessions are overdue beyond 48 hours.'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[11px] text-[#575B66]">
                Email: {cfgEmail || PRIMARY_ADMIN_ALERT_EMAIL}
                {cfgPhone ? ` · Text: ${cfgPhone}` : ''}
              </span>
              <button
                type="button"
                onClick={() => setShowAlertSettings((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[#FAF9F6] border border-[#E6E4DF] text-[#181A1F] text-xs font-medium rounded-lg hover:border-[#0F5C53] whitespace-nowrap shrink-0"
              >
                <Settings2 className="w-3.5 h-3.5 text-[#0F5C53]" />
                <span>{t.alertSettingsTitle}</span>
              </button>
            </div>
          </div>

          {showAlertSettings && (
            <form
              onSubmit={handleSaveAlertSettings}
              className="pt-3 border-t border-[#E6E4DF] space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                <div>
                  <label className="block text-[11px] font-medium text-[#575B66] mb-1">
                    {t.alertEmailTarget}
                  </label>
                  <input
                    type="email"
                    required
                    value={cfgEmail}
                    onChange={(e) => setCfgEmail(e.target.value)}
                    placeholder="arledigt@gmail.com"
                    className="w-full px-3 py-2 text-xs font-mono bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#575B66] mb-1">
                    {t.alertPhoneTarget}
                  </label>
                  <input
                    type="tel"
                    value={cfgPhone}
                    onChange={(e) => setCfgPhone(e.target.value)}
                    placeholder="(845) 555-0199"
                    className="w-full px-3 py-2 text-xs font-mono bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-4 py-2">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-[#181A1F] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfgNotifyEmail}
                      onChange={(e) => setCfgNotifyEmail(e.target.checked)}
                      className="rounded border-[#E6E4DF] text-[#0F5C53]"
                    />
                    <span>{t.channelEmail}</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-[#181A1F] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cfgNotifySms}
                      onChange={(e) => setCfgNotifySms(e.target.checked)}
                      className="rounded border-[#E6E4DF] text-[#0F5C53]"
                    />
                    <span>{t.channelSms}</span>
                  </label>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingAlertCfg}
                    className="px-4 py-2 bg-[#0F5C53] text-white text-xs font-medium rounded-lg hover:bg-[#0B4740] disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {savingAlertCfg ? 'Saving...' : t.saveAlertSettings}
                  </button>
                </div>
              </div>
              {alertCfgNotice && (
                <p className="text-xs font-medium text-[#0F5C53]">{alertCfgNotice}</p>
              )}
            </form>
          )}
        </div>
      )}

      {/* Accounting CSV Export Center */}
      {showExportPanel && (
        <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E6E4DF]">
            <div>
              <h2 className="text-base font-semibold text-[#181A1F]">
                {t.exportAccountingTitle}
              </h2>
              <p className="mt-0.5 text-xs text-[#575B66]">
                {language === 'yi'
                  ? 'אַראָפּלאָדן UTF-8 CSV רעפּאָרטן פאַר QuickBooks, Xero, אָדער Excel (איסטערן טײַם).'
                  : 'Download UTF-8 CSV spreadsheets compatible with QuickBooks, Xero, and Excel (Eastern Time dates).'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleExportAllCsv}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#0F5C53] text-white text-xs font-medium rounded-lg hover:bg-[#0B4740] transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t.exportAllCsv}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-[11px] font-medium text-[#575B66] mb-1">
                From Date (ET)
              </label>
              <input
                type="date"
                value={exportFromEt}
                onChange={(e) => setExportFromEt(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#575B66] mb-1">
                To Date (ET)
              </label>
              <input
                type="date"
                value={exportToEt}
                onChange={(e) => setExportToEt(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg"
              />
            </div>
            <div className="flex items-center gap-2">
              {(exportFromEt || exportToEt) && (
                <button
                  type="button"
                  onClick={() => {
                    setExportFromEt('');
                    setExportToEt('');
                  }}
                  className="px-3 py-2 text-xs text-[#575B66] border border-[#E6E4DF] rounded-lg hover:text-[#181A1F] whitespace-nowrap shrink-0"
                >
                  Clear Dates
                </button>
              )}
              <span className="text-xs text-[#575B66]">
                {exportFromEt || exportToEt ? 'Filtered ET range' : 'All recorded dates'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
            <button
              type="button"
              onClick={handleExportPartnerSummary}
              className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-xs font-medium text-[#181A1F] hover:border-[#0F5C53] transition-colors whitespace-nowrap"
            >
              <span className="truncate">{t.exportPartnerSummary}</span>
              <Download className="w-3.5 h-3.5 text-[#0F5C53] shrink-0" />
            </button>
            <button
              type="button"
              onClick={handleExportPartnerPayments}
              className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-xs font-medium text-[#181A1F] hover:border-[#0F5C53] transition-colors whitespace-nowrap"
            >
              <span className="truncate">{t.exportPartnerPayments}</span>
              <Download className="w-3.5 h-3.5 text-[#0F5C53] shrink-0" />
            </button>
            <button
              type="button"
              onClick={handleExportBtPayouts}
              className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-xs font-medium text-[#181A1F] hover:border-[#0F5C53] transition-colors whitespace-nowrap"
            >
              <span className="truncate">{t.exportBtPayouts}</span>
              <Download className="w-3.5 h-3.5 text-[#0F5C53] shrink-0" />
            </button>
            <button
              type="button"
              onClick={handleExportSessionsJournal}
              className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-xs font-medium text-[#181A1F] hover:border-[#0F5C53] transition-colors whitespace-nowrap"
            >
              <span className="truncate">{t.exportSessionsJournal}</span>
              <Download className="w-3.5 h-3.5 text-[#0F5C53] shrink-0" />
            </button>
          </div>

          {exportNotice && (
            <p className="text-xs font-medium text-[#0F5C53]">{exportNotice}</p>
          )}
        </div>
      )}

      {/* Executive Financial KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 border border-[#E6E4DF] bg-white rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-[#E6E4DF]">
        <div className="p-5">
          <p className="text-xs text-[#575B66]">{t.scheduledHours}</p>
          <p className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#181A1F]">
            {financials.scheduledHours.toFixed(2)}h
          </p>
          <p className="mt-1 text-[11px] text-[#575B66]">Booked ET calendar</p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#575B66]">{t.approvedBillableHours}</p>
          <p className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#0F5C53]">
            {financials.approvedBillableHours.toFixed(2)}h
          </p>
          <p className="mt-1 text-[11px] text-[#575B66]">Verified for invoicing</p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#575B66]">{t.partnerPayments}</p>
          <p className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#181A1F]">
            {fmtUsd(financials.totalPartnerReceived)}
          </p>
          <p className="mt-1 text-[11px] text-[#575B66]">
            Accrued: {fmtUsd(financials.accruedGrossRevenue)}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#575B66]">{t.btPayouts}</p>
          <p className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#181A1F]">
            {fmtUsd(financials.totalBtPaid)}
          </p>
          <p className="mt-1 text-[11px] text-[#575B66]">
            Accrued Cost: {fmtUsd(financials.accruedBtCost)}
          </p>
        </div>
        <div className="p-5 bg-[#FAF9F6]">
          <p className="text-xs font-medium text-[#0F5C53]">{t.netProfit}</p>
          <p className="mt-1.5 text-xl font-bold font-mono tabular-nums text-[#0F5C53]">
            {fmtUsd(financials.cashNetProfit)}
          </p>
          <p className="mt-1 text-[11px] font-mono tabular-nums text-[#575B66]">
            Margin: {financials.marginPct}% (Accrued {fmtUsd(financials.accruedProfit)})
          </p>
        </div>
      </div>

      {/* Contract Companies & Per-Partner Profitability */}
      <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E6E4DF]">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#0F5C53]" />
            <h2 className="text-base font-semibold text-[#181A1F]">
              {t.contractCompanies} &amp; Partner Margin Breakdown
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportPartnerSummary}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#E6E4DF] rounded-lg hover:border-[#0F5C53] whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-[#0F5C53]" />
              <span>{t.exportCsv}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowAddCompany((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0F5C53] text-white rounded-lg hover:bg-[#0B4740] whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.addContractCompany}</span>
            </button>
          </div>
        </div>

        {showAddCompany && (
          <form
            onSubmit={handleAddCompany}
            className="my-5 p-4 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg grid grid-cols-1 sm:grid-cols-3 gap-3"
          >
            <input
              required
              type="text"
              value={compName}
              onChange={(e) => setCompName(e.target.value)}
              placeholder="Partner Company Name (e.g. Chesed ABA)"
              className="px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
            />
            <input
              type="text"
              value={compContact}
              onChange={(e) => setCompContact(e.target.value)}
              placeholder="Billing Contact Name"
              className="px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
            />
            <input
              required
              type="email"
              value={compEmail}
              onChange={(e) => setCompEmail(e.target.value)}
              placeholder="Partner Notification & Billing Email"
              className="px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
            />
            <input
              type="tel"
              value={compPhone}
              onChange={(e) => setCompPhone(e.target.value)}
              placeholder="Partner Mobile Phone (SMS Triggers)"
              className="px-3 py-2 text-xs font-mono bg-white border border-[#E6E4DF] rounded-lg"
            />
            <div>
              <label className="block text-[11px] text-[#575B66] mb-1">Partner Bill Rate ($/hr)</label>
              <input
                required
                type="number"
                step="0.5"
                value={compBillRate}
                onChange={(e) => setCompBillRate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-[#E6E4DF] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#575B66] mb-1">Default BT Pay ($/hr)</label>
              <input
                required
                type="number"
                step="0.5"
                value={compBtRate}
                onChange={(e) => setCompBtRate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-[#E6E4DF] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#575B66] mb-1">Payment Terms</label>
              <input
                type="text"
                value={compTerms}
                onChange={(e) => setCompTerms(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
              />
            </div>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-4 pt-2">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-[#181A1F] cursor-pointer">
                <input
                  type="checkbox"
                  checked={compAutoSignup}
                  onChange={(e) => setCompAutoSignup(e.target.checked)}
                />
                <span>Auto email trigger on new client signup</span>
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-[#181A1F] cursor-pointer">
                <input
                  type="checkbox"
                  checked={compAutoActions}
                  onChange={(e) => setCompAutoActions(e.target.checked)}
                />
                <span>Allow Email/SMS triggers on all actions</span>
              </label>
            </div>
            <div className="sm:col-span-3 flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddCompany(false)}
                className="px-3 py-1.5 text-xs text-[#575B66] border border-[#E6E4DF] rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-medium bg-[#0F5C53] text-white rounded-lg"
              >
                Save Partner Company
              </button>
            </div>
          </form>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#E6E4DF] text-xs text-[#575B66]">
                <th className="py-2.5 pr-4 font-medium">Partner Company</th>
                <th className="py-2.5 pr-4 font-medium">Notification Contact</th>
                <th className="py-2.5 pr-4 font-medium text-right">Bill Rate</th>
                <th className="py-2.5 pr-4 font-medium text-right">BT Default</th>
                <th className="py-2.5 pr-4 font-medium text-right">Scheduled</th>
                <th className="py-2.5 pr-4 font-medium text-right">Billable</th>
                <th className="py-2.5 pr-4 font-medium text-right">Accrued Billed</th>
                <th className="py-2.5 pr-4 font-medium text-right">Received</th>
                <th className="py-2.5 pr-4 font-medium text-right">Net Margin</th>
                <th className="py-2.5 font-medium text-right">Trigger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E4DF]">
              {contractCompanies.map((comp) => {
                const stats = financials.companyRows.find((r) => r.companyId === comp.companyId);
                return (
                  <tr key={comp.companyId}>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-[#181A1F]">{comp.name}</div>
                      <div className="text-xs text-[#575B66]">{comp.paymentTerms}</div>
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      <div className="font-mono text-[#181A1F]">{comp.contactEmail || '—'}</div>
                      <div className="text-[#575B66]">
                        {comp.contactPhone || 'No SMS'} ·{' '}
                        {comp.autoTriggerOnSignup !== false ? 'Signup Email On' : 'Signup Email Off'}
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs tabular-nums text-right">
                      {fmtUsd(comp.billingRatePerHour)}/hr
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs tabular-nums text-right">
                      {fmtUsd(comp.defaultBtPayPerHour)}/hr
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs tabular-nums text-right">
                      {(stats?.scheduledHours ?? 0).toFixed(2)}h
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs tabular-nums text-right text-[#0F5C53]">
                      {(stats?.approvedBillableHours ?? 0).toFixed(2)}h
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs tabular-nums text-right">
                      {fmtUsd(stats?.grossBilled ?? 0)}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs tabular-nums text-right">
                      {fmtUsd(stats?.paymentsReceived ?? 0)}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs tabular-nums text-right font-semibold text-[#0F5C53]">
                      {fmtUsd(stats?.netProfit ?? 0)}
                    </td>
                    <td className="py-3 text-right">
                      <QuickActionTriggerButton
                        user={user}
                        language={language}
                        eventType="custom_action"
                        actionLabel={`Partner Update (${comp.name})`}
                        contractCompanyId={comp.companyId}
                        contractCompanyName={comp.name}
                        partnerUids={comp.partnerUids}
                        defaultSummary={`BINAH CARE update for ${comp.name}: ${(stats?.approvedBillableHours ?? 0).toFixed(2)}h approved billable (${fmtUsd(stats?.grossBilled ?? 0)}).`}
                        partnerDirectory={partnerDirectory}
                        alertSettings={alertSettings}
                        onDispatched={setActionTriggerOutcome}
                      />
                    </td>
                  </tr>
                );
              })}
              {contractCompanies.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-xs text-[#575B66]">
                    No contract companies configured yet. Load starter data or add El Heim / Hilf above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Partner Payments & BT Payouts Side-by-Side */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Incoming Partner Payments */}
        <div className="lg:col-span-6 p-6 bg-white border border-[#E6E4DF] rounded-xl">
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#E6E4DF]">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-[#0F5C53]" />
              <h3 className="text-base font-semibold text-[#181A1F]">{t.partnerPayments}</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportPartnerPayments}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-[#E6E4DF] rounded-lg hover:border-[#0F5C53] whitespace-nowrap shrink-0"
                title="Export Partner Payments CSV"
              >
                <Download className="w-3.5 h-3.5 text-[#0F5C53]" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAddPay((v) => !v)}
                className="px-3 py-1.5 text-xs font-medium border border-[#E6E4DF] rounded-lg hover:border-[#0F5C53] whitespace-nowrap shrink-0"
              >
                + Record Payment
              </button>
            </div>
          </div>

          {showAddPay && (
            <form
              onSubmit={handleRecordPayment}
              className="my-4 p-4 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              <select
                value={payCompanyId || contractCompanies[0]?.companyId || ''}
                onChange={(e) => setPayCompanyId(e.target.value)}
                className="px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
              >
                {contractCompanies.map((c) => (
                  <option key={c.companyId} value={c.companyId}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                required
                type="number"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="Amount ($)"
                className="px-3 py-2 text-xs font-mono bg-white border border-[#E6E4DF] rounded-lg"
              />
              <input
                type="text"
                value={payPeriod}
                onChange={(e) => setPayPeriod(e.target.value)}
                placeholder="Billing Period"
                className="px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
              />
              <input
                type="text"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="ACH / Check Ref #"
                className="px-3 py-2 text-xs font-mono bg-white border border-[#E6E4DF] rounded-lg"
              />
              <input
                type="date"
                value={payDateEt}
                onChange={(e) => setPayDateEt(e.target.value)}
                className="px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
              />
              <div className="sm:col-span-2">
                <ActionTriggerCheckboxes
                  compact
                  language={language}
                  sendEmail={actionTriggerEmail}
                  sendSms={actionTriggerSms}
                  onChangeEmail={setActionTriggerEmail}
                  onChangeSms={setActionTriggerSms}
                />
              </div>
              <button
                type="submit"
                className="sm:col-span-2 px-4 py-2 text-xs font-medium bg-[#0F5C53] text-white rounded-lg"
              >
                Save Payment
              </button>
            </form>
          )}

          <div className="mt-4 divide-y divide-[#E6E4DF]">
            {partnerPayments.map((p) => (
              <div key={p.paymentId} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <p className="font-medium text-[#181A1F]">{p.contractCompanyName}</p>
                  <p className="text-[#575B66]">
                    {formatEtDateLabel(p.paymentDateEt)} · {p.periodLabel} · Ref {p.referenceNumber}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold tabular-nums text-[#0F5C53]">
                    {fmtUsd(p.amount)}
                  </span>
                  <QuickActionTriggerButton
                    user={user}
                    language={language}
                    eventType="payment_recorded"
                    actionLabel={`Partner Payment (${p.contractCompanyName})`}
                    contractCompanyId={p.contractCompanyId}
                    contractCompanyName={p.contractCompanyName}
                    defaultSummary={`Payment confirmation: ${fmtUsd(p.amount)} received from ${p.contractCompanyName} (${p.periodLabel}, Ref ${p.referenceNumber}).`}
                    partnerDirectory={partnerDirectory}
                    alertSettings={alertSettings}
                    onDispatched={setActionTriggerOutcome}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Outgoing BT Payouts */}
        <div className="lg:col-span-6 p-6 bg-white border border-[#E6E4DF] rounded-xl">
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#E6E4DF]">
            <h3 className="text-base font-semibold text-[#181A1F]">{t.btPayouts}</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportBtPayouts}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-[#E6E4DF] rounded-lg hover:border-[#0F5C53] whitespace-nowrap shrink-0"
                title="Export BT Payouts CSV"
              >
                <Download className="w-3.5 h-3.5 text-[#0F5C53]" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAddPayout((v) => !v)}
                className="px-3 py-1.5 text-xs font-medium border border-[#E6E4DF] rounded-lg hover:border-[#0F5C53] whitespace-nowrap shrink-0"
              >
                + Record BT Payout
              </button>
            </div>
          </div>

          {showAddPayout && (
            <form
              onSubmit={handleRecordPayout}
              className="my-4 p-4 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              <select
                value={payoutBtId || staffRoster[0]?.staffId || ''}
                onChange={(e) => setPayoutBtId(e.target.value)}
                className="px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
              >
                {staffRoster.map((b) => (
                  <option key={b.staffId} value={b.staffId}>
                    {b.displayName}
                  </option>
                ))}
              </select>
              <input
                required
                type="number"
                step="0.25"
                value={payoutHours}
                onChange={(e) => setPayoutHours(e.target.value)}
                placeholder="Approved Hours Paid"
                className="px-3 py-2 text-xs font-mono bg-white border border-[#E6E4DF] rounded-lg"
              />
              <input
                type="text"
                value={payoutPeriod}
                onChange={(e) => setPayoutPeriod(e.target.value)}
                placeholder="Pay Period"
                className="px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
              />
              <input
                type="date"
                value={payoutDateEt}
                onChange={(e) => setPayoutDateEt(e.target.value)}
                className="px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
              />
              <div className="sm:col-span-2">
                <ActionTriggerCheckboxes
                  compact
                  language={language}
                  sendEmail={actionTriggerEmail}
                  sendSms={actionTriggerSms}
                  onChangeEmail={setActionTriggerEmail}
                  onChangeSms={setActionTriggerSms}
                />
              </div>
              <button
                type="submit"
                className="sm:col-span-2 px-4 py-2 text-xs font-medium bg-[#0F5C53] text-white rounded-lg"
              >
                Save BT Payout
              </button>
            </form>
          )}

          <div className="mt-4 divide-y divide-[#E6E4DF]">
            {btPayouts.map((bp) => (
              <div key={bp.payoutId} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <p className="font-medium text-[#181A1F]">{bp.btName}</p>
                  <p className="text-[#575B66]">
                    {formatEtDateLabel(bp.paymentDateEt)} · {bp.hoursPaid}h @ {fmtUsd(bp.hourlyRate)}/hr
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold tabular-nums text-[#181A1F]">
                    {fmtUsd(bp.totalAmount)}
                  </span>
                  <QuickActionTriggerButton
                    user={user}
                    language={language}
                    eventType="payout_recorded"
                    actionLabel={`BT Payout (${bp.btName})`}
                    defaultSummary={`BT payroll payout notification: ${fmtUsd(bp.totalAmount)} for ${bp.btName} (${bp.hoursPaid}h on ${bp.paymentDateEt}).`}
                    partnerDirectory={partnerDirectory}
                    alertSettings={alertSettings}
                    onDispatched={setActionTriggerOutcome}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Trigger Audit Log (All Email & Text Triggers Sent) */}
      <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl">
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#E6E4DF]">
          <div className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-[#0F5C53]" />
            <h3 className="text-base font-semibold text-[#181A1F]">{t.triggerLogTitle}</h3>
          </div>
          <span className="text-xs font-mono text-[#575B66]">{triggerLogs.length} entries</span>
        </div>
        {triggerLogs.length === 0 ? (
          <p className="mt-4 text-xs text-[#575B66]">
            No action triggers logged yet. Triggers fire automatically on partner signups and any action with Email or Text checked.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E6E4DF] text-[#575B66]">
                  <th className="py-2 pr-4 font-medium">Action / Event</th>
                  <th className="py-2 pr-4 font-medium">Agency &amp; Client</th>
                  <th className="py-2 pr-4 font-medium">Recipient</th>
                  <th className="py-2 pr-4 font-medium">Email / SMS Status</th>
                  <th className="py-2 font-medium">Triggered By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E4DF]">
                {triggerLogs.slice(0, 15).map((log) => (
                  <tr key={log.triggerId}>
                    <td className="py-2.5 pr-4">
                      <div className="font-medium text-[#181A1F]">{log.actionLabel}</div>
                      <div className="text-[11px] text-[#575B66] truncate max-w-[260px]">
                        {log.summary}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="text-[#181A1F]">{log.contractCompanyName || 'Admin / General'}</div>
                      {log.clientLabel && (
                        <div className="text-[11px] text-[#575B66]">Client: {log.clientLabel}</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-[11px]">
                      <div>{log.recipientEmail}</div>
                      {log.recipientPhone && <div className="text-[#575B66]">{log.recipientPhone}</div>}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-[11px]">
                      <div>Email: {log.emailStatus}</div>
                      <div className="text-[#575B66]">SMS: {log.smsStatus}</div>
                    </td>
                    <td className="py-2.5 text-[11px] text-[#575B66]">
                      {log.triggeredByEmail || log.triggeredByUid}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Overview Only: Behavior Technician Roster, User Role Management & Public Leads */}
      {section === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Staff / BT Directory */}
          <div className="lg:col-span-6 p-6 bg-white border border-[#E6E4DF] rounded-xl">
            <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#E6E4DF]">
              <h3 className="text-base font-semibold text-[#181A1F]">
                Behavior Technician Roster &amp; Hourly Rates
              </h3>
              <button
                type="button"
                onClick={() => setShowAddBt((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#E6E4DF] rounded-lg hover:border-[#0F5C53]"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add BT</span>
              </button>
            </div>

            {showAddBt && (
              <form
                onSubmit={handleAddBt}
                className="my-4 p-4 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3"
              >
                <input
                  required
                  type="text"
                  value={btName}
                  onChange={(e) => setBtName(e.target.value)}
                  placeholder="Full Name (e.g. Rivka Stern, RBT)"
                  className="px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
                />
                <input
                  required
                  type="text"
                  value={btTitle}
                  onChange={(e) => setBtTitle(e.target.value)}
                  placeholder="Title"
                  className="px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
                />
                <input
                  type="text"
                  value={btBorough}
                  onChange={(e) => setBtBorough(e.target.value)}
                  placeholder="Service Area (e.g. Monroe / Brooklyn, NY)"
                  className="px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
                />
                <input
                  type="number"
                  step="0.5"
                  value={btRate}
                  onChange={(e) => setBtRate(e.target.value)}
                  placeholder="Hourly Rate ($)"
                  className="px-3 py-2 text-xs font-mono bg-white border border-[#E6E4DF] rounded-lg"
                />
                <input
                  type="text"
                  value={btLanguages}
                  onChange={(e) => setBtLanguages(e.target.value)}
                  placeholder="Languages (אידיש, English)"
                  className="sm:col-span-2 px-3 py-2 text-xs bg-white border border-[#E6E4DF] rounded-lg"
                />
                <button
                  type="submit"
                  className="sm:col-span-2 px-4 py-2 text-xs font-medium bg-[#0F5C53] text-white rounded-lg"
                >
                  Save Behavior Technician
                </button>
              </form>
            )}

            <div className="mt-4 divide-y divide-[#E6E4DF]">
              {staffRoster.map((bt) => {
                const rate = btCompensation.find((c) => c.staffId === bt.staffId)?.hourlyPayRate;
                return (
                  <div key={bt.staffId} className="py-3 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <p className="font-medium text-[#181A1F]">{bt.displayName}</p>
                      <p className="text-[#575B66]">
                        {bt.title} · {bt.borough} · {(bt.languages || []).join(', ')}
                      </p>
                    </div>
                    <span className="font-mono font-semibold tabular-nums text-[#0F5C53]">
                      {rate !== undefined ? `${fmtUsd(rate)}/hr` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* User Accounts & Role Assignment + Public Inquiries */}
          <div className="lg:col-span-6 space-y-6">
            <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl">
              <div className="pb-3 border-b border-[#E6E4DF]">
                <h3 className="text-base font-semibold text-[#181A1F]">
                  Role-Based Access Control (Users &amp; Partner Company Isolation)
                </h3>
                <p className="mt-0.5 text-[11px] text-[#575B66]">
                  Assigning a user to “partner” binds them strictly to their contract agency&apos;s clients and sessions (e.g., Hilf or El Heim only).
                </p>
              </div>
              {rbacError && (
                <p className="mt-2 text-xs text-[#B91C1C] font-medium">{rbacError}</p>
              )}
              <div className="mt-3 divide-y divide-[#E6E4DF]">
                {usersList.map((u) => {
                  const isBootstrapped =
                    u.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
                  const isBusy = assigningUserUid === u.uid;
                  return (
                    <div key={u.uid} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-[#181A1F]">
                          {u.displayName}{' '}
                          {isBootstrapped && (
                            <span className="text-[11px] font-mono text-[#0F5C53]">
                              (Primary Admin)
                            </span>
                          )}
                        </p>
                        <p className="text-[#575B66] truncate">
                          {u.email}
                          {u.role === 'partner' && u.contractCompanyName
                            ? ` · Agency: ${u.contractCompanyName}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <select
                          value={u.role}
                          disabled={isBootstrapped || isBusy}
                          onChange={async (e) => {
                            const nextRole = e.target.value as UserRole;
                            setRbacError('');
                            setAssigningUserUid(u.uid);
                            try {
                              const targetCompany =
                                nextRole === 'partner'
                                  ? contractCompanies.find(
                                      (c) => c.companyId === u.contractCompanyId
                                    ) || contractCompanies[0]
                                  : undefined;
                              await assignUserPartnerRole({
                                targetUser: u,
                                role: nextRole,
                                contractCompanyId: targetCompany?.companyId,
                                contractCompanyName: targetCompany?.name,
                                contractCompanies,
                                clients,
                                sessions,
                              });
                            } catch (err) {
                              setRbacError(
                                err instanceof Error ? err.message : 'Unable to update user role.'
                              );
                            } finally {
                              setAssigningUserUid(null);
                            }
                          }}
                          className="px-2.5 py-1.5 border border-[#E6E4DF] rounded-lg bg-white text-xs disabled:opacity-60"
                        >
                          <option value="parent">parent</option>
                          <option value="staff">staff</option>
                          <option value="partner">partner</option>
                          <option value="admin">admin</option>
                        </select>

                        {u.role === 'partner' && (
                          <select
                            value={u.contractCompanyId || ''}
                            disabled={isBusy || contractCompanies.length === 0}
                            onChange={async (e) => {
                              const comp = contractCompanies.find(
                                (c) => c.companyId === e.target.value
                              );
                              if (!comp) return;
                              setRbacError('');
                              setAssigningUserUid(u.uid);
                              try {
                                await assignUserPartnerRole({
                                  targetUser: u,
                                  role: 'partner',
                                  contractCompanyId: comp.companyId,
                                  contractCompanyName: comp.name,
                                  contractCompanies,
                                  clients,
                                  sessions,
                                });
                              } catch (err) {
                                setRbacError(
                                  err instanceof Error
                                    ? err.message
                                    : 'Unable to bind partner company.'
                                );
                              } finally {
                                setAssigningUserUid(null);
                              }
                            }}
                            className="px-2.5 py-1.5 border border-[#0F5C53]/50 rounded-lg bg-[#FAF9F6] text-xs font-medium text-[#181A1F] disabled:opacity-60"
                          >
                            <option value="">Select Contract Agency...</option>
                            {contractCompanies.map((c) => (
                              <option key={c.companyId} value={c.companyId}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {inquiries.length > 0 && (
              <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl">
                <h3 className="text-base font-semibold text-[#181A1F] pb-3 border-b border-[#E6E4DF]">
                  Recent Website Intake Inquiries
                </h3>
                <div className="mt-3 divide-y divide-[#E6E4DF]">
                  {inquiries.map((inq) => (
                    <div key={inq.inquiryId} className="py-3 text-xs">
                      <div className="flex justify-between font-medium text-[#181A1F]">
                        <span>{inq.parentName}</span>
                        <span className="text-[#575B66]">{inq.preferredLanguage.toUpperCase()}</span>
                      </div>
                      <p className="text-[#575B66]">
                        {inq.email} · {inq.borough}
                      </p>
                      {inq.message && <p className="mt-1 text-[#181A1F]">{inq.message}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
