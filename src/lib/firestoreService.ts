import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import type {
  AdminAlertSettings,
  ApplicationStatus,
  AutomatedReminder,
  BillingAlert,
  BillingAlertChannel,
  BillingAlertEmailStatus,
  BillingAlertSmsStatus,
  BillingAlertStatus,
  BtCompensation,
  BtPayout,
  ChecklistKey,
  ChecklistStatus,
  ClientApplication,
  ClientChecklist,
  ClientDocument,
  ContractCompany,
  Language,
  PartnerDirectoryEntry,
  PartnerPayment,
  SessionStatus,
  StaffRosterEntry,
  TherapySession,
  TriggerEventType,
  TriggerLog,
  UserProfile,
  UserRole,
} from '../types/binah';
import { getRelativeDaysAgoEtIso, getTodayEtIso } from './timeEt';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'arledigt@gmail.com';

export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

export async function ensureUserProfile(params: {
  uid: string;
  email: string;
  displayName: string;
  preferredLanguage: Language;
}): Promise<UserProfile> {
  const userRef = doc(db, 'users', params.uid);
  try {
    const snap = await getDoc(userRef);
    const isBootstrapAdmin = params.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      if (isBootstrapAdmin && existing.role !== 'admin') {
        await updateDoc(userRef, {
          role: 'admin',
          updatedAt: serverTimestamp(),
        });
        return { ...existing, role: 'admin' };
      }
      return existing;
    }
    const initialRole: UserRole = isBootstrapAdmin ? 'admin' : 'parent';

    const profilePayload = {
      uid: params.uid,
      email: params.email,
      displayName: params.displayName || params.email.split('@')[0] || 'Family Member',
      role: initialRole,
      preferredLanguage: params.preferredLanguage,
      hipaaAcceptedAt: new Date().toISOString(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(userRef, profilePayload);
    return {
      ...profilePayload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${params.uid}`);
  }
}

export async function updateUserProfileFields(
  uid: string,
  updates: Partial<
    Pick<
      UserProfile,
      | 'displayName'
      | 'preferredLanguage'
      | 'phone'
      | 'hipaaAcceptedAt'
      | 'role'
      | 'assignedClientIds'
      | 'contractCompanyId'
      | 'contractCompanyName'
    >
  >
): Promise<void> {
  const userRef = doc(db, 'users', uid);
  try {
    await updateDoc(userRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export function subscribeClients(
  user: UserProfile,
  onData: (clients: ClientApplication[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, 'clients');
  const q =
    user.role === 'admin'
      ? query(colRef)
      : user.role === 'staff'
        ? query(colRef, where('assignedStaffUids', 'array-contains', user.uid))
        : user.role === 'partner'
          ? query(colRef, where('partnerUids', 'array-contains', user.uid))
          : query(colRef, where('parentUid', '==', user.uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as ClientApplication);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'clients');
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeSessions(
  user: UserProfile,
  onData: (sessions: TherapySession[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, 'sessions');
  const q =
    user.role === 'admin'
      ? query(colRef)
      : user.role === 'staff'
        ? query(colRef, where('btUid', '==', user.uid))
        : user.role === 'partner'
          ? query(colRef, where('partnerUids', 'array-contains', user.uid))
          : query(colRef, where('parentUid', '==', user.uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as TherapySession);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'sessions');
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeReminders(
  user: UserProfile,
  onData: (reminders: AutomatedReminder[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, 'reminders');
  const q =
    user.role === 'admin'
      ? query(colRef)
      : query(colRef, where('targetUid', '==', user.uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as AutomatedReminder);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'reminders');
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribePartnerDirectory(
  onData: (entries: PartnerDirectoryEntry[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'partnerDirectory'), where('active', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((d) => d.data() as PartnerDirectoryEntry));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'partnerDirectory');
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeTriggerLogs(
  user: UserProfile,
  onData: (logs: TriggerLog[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const colRef = collection(db, 'triggerLogs');
  const q =
    user.role === 'admin'
      ? query(colRef)
      : user.role === 'partner'
        ? query(colRef, where('partnerUids', 'array-contains', user.uid))
        : query(colRef, where('triggeredByUid', '==', user.uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as TriggerLog);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'triggerLogs');
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeAdminCollections(
  onCompanies: (items: ContractCompany[]) => void,
  onStaff: (items: StaffRosterEntry[]) => void,
  onComp: (items: BtCompensation[]) => void,
  onPartnerPayments: (items: PartnerPayment[]) => void,
  onBtPayouts: (items: BtPayout[]) => void,
  onUsers: (items: UserProfile[]) => void,
  onError: (err: Error) => void
): Unsubscribe[] {
  const handleErr = (path: string) => (error: unknown) => {
    try {
      handleFirestoreError(error, OperationType.LIST, path);
    } catch (wrapped) {
      onError(wrapped as Error);
    }
  };

  return [
    onSnapshot(
      collection(db, 'contractCompanies'),
      (s) => onCompanies(s.docs.map((d) => d.data() as ContractCompany)),
      handleErr('contractCompanies')
    ),
    onSnapshot(
      collection(db, 'staffRoster'),
      (s) => onStaff(s.docs.map((d) => d.data() as StaffRosterEntry)),
      handleErr('staffRoster')
    ),
    onSnapshot(
      collection(db, 'btCompensation'),
      (s) => onComp(s.docs.map((d) => d.data() as BtCompensation)),
      handleErr('btCompensation')
    ),
    onSnapshot(
      collection(db, 'partnerPayments'),
      (s) => onPartnerPayments(s.docs.map((d) => d.data() as PartnerPayment)),
      handleErr('partnerPayments')
    ),
    onSnapshot(
      collection(db, 'btPayouts'),
      (s) => onBtPayouts(s.docs.map((d) => d.data() as BtPayout)),
      handleErr('btPayouts')
    ),
    onSnapshot(
      collection(db, 'users'),
      (s) => onUsers(s.docs.map((d) => d.data() as UserProfile)),
      handleErr('users')
    ),
  ];
}

export function subscribeBillingAlerts(
  onData: (alerts: BillingAlert[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'billingAlerts'),
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as BillingAlert);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'billingAlerts');
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export function subscribeAdminAlertSettings(
  onData: (settings: AdminAlertSettings | null) => void,
  onError: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'adminSettings', 'billingAlerts'),
    (snap) => {
      onData(snap.exists() ? (snap.data() as AdminAlertSettings) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, 'adminSettings/billingAlerts');
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    }
  );
}

export async function saveAdminAlertSettings(input: {
  alertEmail: string;
  alertPhone?: string;
  notifyEmail: boolean;
  notifySms: boolean;
  updatedByUid: string;
}): Promise<void> {
  const ref = doc(db, 'adminSettings', 'billingAlerts');
  try {
    await setDoc(ref, {
      settingId: 'billingAlerts',
      alertEmail: (input.alertEmail || BOOTSTRAPPED_ADMIN_EMAIL).trim().slice(0, 200),
      alertPhone: (input.alertPhone || '').trim().slice(0, 32),
      notifyEmail: Boolean(input.notifyEmail),
      notifySms: Boolean(input.notifySms),
      updatedByUid: input.updatedByUid,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'adminSettings/billingAlerts');
  }
}

async function resolvePartnerUidsForCompany(contractCompanyId?: string): Promise<string[]> {
  if (!contractCompanyId) return [];
  try {
    const dirSnap = await getDoc(doc(db, 'partnerDirectory', contractCompanyId));
    if (dirSnap.exists()) {
      const data = dirSnap.data() as PartnerDirectoryEntry;
      return Array.isArray(data.partnerUids) ? data.partnerUids.slice(0, 20) : [];
    }
  } catch {
    // Fallback to empty if directory lookup isn't present yet
  }
  return [];
}

export async function createClientApplication(input: {
  parentUid: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  childFirstName: string;
  childLastName: string;
  childDob: string;
  borough: string;
  preferredLanguage: Language;
  notes?: string;
  contractCompanyId?: string;
  contractCompanyName?: string;
  partnerUids?: string[];
}): Promise<string> {
  const clientId = makeId('cli');
  const checklist: ClientChecklist = {
    rx: 'missing',
    evaluation: 'missing',
    insurance: 'missing',
    iep: 'missing',
    hipaaConsent: 'uploaded',
  };

  const resolvedPartnerUids =
    input.partnerUids ?? (await resolvePartnerUidsForCompany(input.contractCompanyId));

  const payload = {
    clientId,
    parentUid: input.parentUid,
    parentName: input.parentName.slice(0, 120),
    parentEmail: input.parentEmail.slice(0, 200),
    parentPhone: input.parentPhone.slice(0, 32),
    childFirstName: input.childFirstName.slice(0, 80),
    childLastName: input.childLastName.slice(0, 80),
    childDob: input.childDob.slice(0, 20),
    borough: input.borough.slice(0, 80),
    preferredLanguage: input.preferredLanguage,
    ...(input.contractCompanyId ? { contractCompanyId: input.contractCompanyId } : {}),
    ...(input.contractCompanyName ? { contractCompanyName: input.contractCompanyName } : {}),
    partnerUids: resolvedPartnerUids.slice(0, 20),
    assignedStaffUids: [],
    status: 'intake_submitted' as ApplicationStatus,
    authorizedWeeklyHours: 0,
    checklist,
    notes: (input.notes || '').slice(0, 2000),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'clients', clientId), payload);
    return clientId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `clients/${clientId}`);
  }
}

const VALID_DOC_TYPES = new Set<ChecklistKey | 'other'>([
  'rx',
  'evaluation',
  'insurance',
  'iep',
  'hipaaConsent',
  'other',
]);
const VALID_CHECKLIST_KEYS = new Set<ChecklistKey>([
  'rx',
  'evaluation',
  'insurance',
  'iep',
  'hipaaConsent',
]);

export async function fetchClientDocuments(
  clientId: string,
  user: Pick<UserProfile, 'uid' | 'role'>
): Promise<ClientDocument[]> {
  try {
    const colRef = collection(db, 'clients', clientId, 'documents');
    const q =
      user.role === 'admin'
        ? query(colRef)
        : user.role === 'partner'
          ? query(colRef, where('partnerUids', 'array-contains', user.uid))
          : query(colRef, where('parentUid', '==', user.uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ClientDocument);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `clients/${clientId}/documents`);
  }
}

export async function updateClientDocumentReview(params: {
  clientId: string;
  documentId: string;
  verificationStatus: 'pending_review' | 'verified' | 'needs_resubmission';
  summary?: string;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'clients', params.clientId, 'documents', params.documentId), {
      verificationStatus: params.verificationStatus,
      ...(params.summary !== undefined ? { summary: params.summary.slice(0, 1500) } : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `clients/${params.clientId}/documents/${params.documentId}`
    );
  }
}

export async function saveClientDocumentAndChecklist(params: {
  clientId: string;
  parentUid: string;
  uploadedByUid: string;
  partnerUids?: string[];
  docType: ChecklistKey | 'other';
  fileName: string;
  mimeType: string;
  summary: string;
  extractedFields: Record<string, string>;
  currentChecklist: ClientChecklist;
  checklistKeyToMark?: ChecklistKey | 'none';
}): Promise<string> {
  const documentId = makeId('doc');
  const docRef = doc(db, 'clients', params.clientId, 'documents', documentId);
  const clientRef = doc(db, 'clients', params.clientId);

  const safeDocType: ChecklistKey | 'other' = VALID_DOC_TYPES.has(params.docType)
    ? params.docType
    : 'other';

  const sanitizedFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.extractedFields || {})) {
    if (typeof v === 'string' && v.trim()) {
      sanitizedFields[k] = v.trim().slice(0, 200);
    }
  }

  let partnerUids = params.partnerUids;
  if (!partnerUids) {
    try {
      const clientSnap = await getDoc(clientRef);
      if (clientSnap.exists()) {
        const cData = clientSnap.data() as ClientApplication;
        partnerUids = Array.isArray(cData.partnerUids) ? cData.partnerUids : [];
      }
    } catch {
      partnerUids = [];
    }
  }

  try {
    await setDoc(docRef, {
      documentId,
      clientId: params.clientId,
      parentUid: params.parentUid,
      partnerUids: (partnerUids || []).slice(0, 20),
      docType: safeDocType,
      fileName: (params.fileName || 'uploaded-document').slice(0, 200),
      mimeType: (params.mimeType || 'application/octet-stream').slice(0, 100),
      summary: (params.summary || '').slice(0, 1500),
      extractedFields: sanitizedFields,
      verificationStatus: 'pending_review',
      uploadedByUid: params.uploadedByUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (
      params.checklistKeyToMark &&
      params.checklistKeyToMark !== 'none' &&
      VALID_CHECKLIST_KEYS.has(params.checklistKeyToMark)
    ) {
      const keyToMark = params.checklistKeyToMark;
      const updatedChecklist: ClientChecklist = {
        ...params.currentChecklist,
        [keyToMark]:
          params.currentChecklist[keyToMark] === 'verified' ? 'verified' : 'uploaded',
      };
      await updateDoc(clientRef, {
        checklist: updatedChecklist,
        updatedAt: serverTimestamp(),
      });
    }
    return documentId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `clients/${params.clientId}/documents/${documentId}`);
  }
}

export async function updateClientCoordination(
  clientId: string,
  updates: Partial<{
    status: ApplicationStatus;
    checklist: ClientChecklist;
    contractCompanyId: string;
    contractCompanyName: string;
    partnerUids: string[];
    assignedBtId: string;
    assignedBtName: string;
    assignedStaffUids: string[];
    authorizedWeeklyHours: number;
    notes: string;
  }>
): Promise<void> {
  try {
    const nextUpdates = { ...updates };
    if (updates.contractCompanyId && updates.partnerUids === undefined) {
      nextUpdates.partnerUids = await resolvePartnerUidsForCompany(updates.contractCompanyId);
    }

    await updateDoc(doc(db, 'clients', clientId), {
      ...nextUpdates,
      updatedAt: serverTimestamp(),
    });

    // When partner company changes, propagate partnerUids & company assignment to child sessions/docs
    if (updates.contractCompanyId && nextUpdates.partnerUids) {
      const batch = writeBatch(db);
      const sesSnap = await getDocs(
        query(collection(db, 'sessions'), where('clientId', '==', clientId))
      ).catch(() => null);
      if (sesSnap) {
        for (const sDoc of sesSnap.docs) {
          batch.update(sDoc.ref, {
            contractCompanyId: updates.contractCompanyId,
            ...(updates.contractCompanyName
              ? { contractCompanyName: updates.contractCompanyName }
              : {}),
            partnerUids: nextUpdates.partnerUids.slice(0, 20),
            updatedAt: serverTimestamp(),
          });
        }
      }
      const docsSnap = await getDocs(collection(db, 'clients', clientId, 'documents')).catch(
        () => null
      );
      if (docsSnap) {
        for (const dDoc of docsSnap.docs) {
          batch.update(dDoc.ref, {
            partnerUids: nextUpdates.partnerUids.slice(0, 20),
            updatedAt: serverTimestamp(),
          });
        }
      }
      await batch.commit().catch(() => {});
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `clients/${clientId}`);
  }
}

export async function createTherapySession(input: {
  clientId: string;
  clientName: string;
  parentUid: string;
  contractCompanyId?: string;
  contractCompanyName?: string;
  partnerUids?: string[];
  btId: string;
  btUid?: string;
  btName: string;
  dateEt: string;
  startTimeEt: string;
  endTimeEt: string;
  scheduledHours: number;
  notes?: string;
}): Promise<string> {
  const sessionId = makeId('ses');
  const resolvedPartnerUids =
    input.partnerUids ?? (await resolvePartnerUidsForCompany(input.contractCompanyId));
  try {
    await setDoc(doc(db, 'sessions', sessionId), {
      sessionId,
      clientId: input.clientId,
      clientName: input.clientName.slice(0, 160),
      parentUid: input.parentUid,
      ...(input.contractCompanyId ? { contractCompanyId: input.contractCompanyId } : {}),
      ...(input.contractCompanyName ? { contractCompanyName: input.contractCompanyName } : {}),
      partnerUids: resolvedPartnerUids.slice(0, 20),
      btId: input.btId,
      ...(input.btUid ? { btUid: input.btUid } : {}),
      btName: input.btName.slice(0, 120),
      dateEt: input.dateEt,
      startTimeEt: input.startTimeEt,
      endTimeEt: input.endTimeEt,
      scheduledHours: input.scheduledHours,
      approvedBillableHours: 0,
      status: 'scheduled' as SessionStatus,
      notes: (input.notes || '').slice(0, 1000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return sessionId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `sessions/${sessionId}`);
  }
}

export async function updateSessionStatus(
  sessionId: string,
  updates: {
    status: SessionStatus;
    approvedBillableHours?: number;
    approvedByUid?: string;
    notes?: string;
  }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'sessions', sessionId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    if (updates.status === 'approved_billable' || updates.status === 'cancelled') {
      const alertId = `alert_${sessionId}`;
      const alertRef = doc(db, 'billingAlerts', alertId);
      const alertSnap = await getDoc(alertRef).catch(() => null);
      if (alertSnap && alertSnap.exists()) {
        await updateDoc(alertRef, {
          status: 'resolved' as BillingAlertStatus,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function saveBillingAlertRecord(input: {
  sessionId: string;
  clientId: string;
  clientName?: string;
  btName?: string;
  contractCompanyName?: string;
  sessionDateEt: string;
  sessionTimeRangeEt?: string;
  scheduledHours: number;
  estimatedRevenue: number;
  hoursOverdue: number;
  recipientEmail: string;
  recipientPhone?: string;
  channel: BillingAlertChannel;
  emailStatus: BillingAlertEmailStatus;
  emailNote?: string;
  smsStatus?: BillingAlertSmsStatus;
  smsNote?: string;
  status?: BillingAlertStatus;
  createdByUid: string;
}): Promise<string> {
  const alertId = `alert_${input.sessionId}`;
  const ref = doc(db, 'billingAlerts', alertId);
  try {
    const existingSnap = await getDoc(ref);
    const nowIso = new Date().toISOString();
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        hoursOverdue: Math.max(0, Math.round(input.hoursOverdue * 10) / 10),
        estimatedRevenue: Math.max(0, Math.round(input.estimatedRevenue * 100) / 100),
        recipientEmail: input.recipientEmail.slice(0, 200),
        ...(input.recipientPhone ? { recipientPhone: input.recipientPhone.slice(0, 32) } : {}),
        channel: input.channel,
        emailStatus: input.emailStatus,
        ...(input.emailNote ? { emailNote: input.emailNote.slice(0, 300) } : {}),
        ...(input.smsStatus ? { smsStatus: input.smsStatus } : {}),
        ...(input.smsNote ? { smsNote: input.smsNote.slice(0, 300) } : {}),
        ...(input.status ? { status: input.status } : {}),
        lastNotifiedAt: nowIso,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        alertId,
        sessionId: input.sessionId,
        clientId: input.clientId,
        ...(input.clientName ? { clientName: input.clientName.slice(0, 160) } : {}),
        ...(input.btName ? { btName: input.btName.slice(0, 120) } : {}),
        ...(input.contractCompanyName
          ? { contractCompanyName: input.contractCompanyName.slice(0, 120) }
          : {}),
        sessionDateEt: input.sessionDateEt.slice(0, 20),
        ...(input.sessionTimeRangeEt
          ? { sessionTimeRangeEt: input.sessionTimeRangeEt.slice(0, 45) }
          : {}),
        scheduledHours: input.scheduledHours,
        estimatedRevenue: Math.max(0, Math.round(input.estimatedRevenue * 100) / 100),
        hoursOverdue: Math.max(0, Math.round(input.hoursOverdue * 10) / 10),
        recipientEmail: input.recipientEmail.slice(0, 200),
        ...(input.recipientPhone ? { recipientPhone: input.recipientPhone.slice(0, 32) } : {}),
        channel: input.channel,
        emailStatus: input.emailStatus,
        ...(input.emailNote ? { emailNote: input.emailNote.slice(0, 300) } : {}),
        ...(input.smsStatus ? { smsStatus: input.smsStatus } : {}),
        ...(input.smsNote ? { smsNote: input.smsNote.slice(0, 300) } : {}),
        status: input.status || 'active',
        lastNotifiedAt: nowIso,
        createdByUid: input.createdByUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return alertId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `billingAlerts/${alertId}`);
  }
}

export async function updateBillingAlertStatus(
  alertId: string,
  status: BillingAlertStatus
): Promise<void> {
  try {
    await updateDoc(doc(db, 'billingAlerts', alertId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `billingAlerts/${alertId}`);
  }
}

export async function saveContractCompany(input: {
  companyId?: string;
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  billingRatePerHour: number;
  defaultBtPayPerHour: number;
  paymentTerms: string;
  partnerUids?: string[];
  autoTriggerOnSignup?: boolean;
  autoTriggerOnActions?: boolean;
  active: boolean;
}): Promise<string> {
  const companyId = input.companyId || makeId('comp');
  const ref = doc(db, 'contractCompanies', companyId);
  const dirRef = doc(db, 'partnerDirectory', companyId);
  const autoSignup = input.autoTriggerOnSignup !== false;
  const autoActions = input.autoTriggerOnActions !== false;
  try {
    const batch = writeBatch(db);
    if (input.companyId) {
      batch.update(ref, {
        name: input.name.slice(0, 120),
        contactName: input.contactName.slice(0, 120),
        contactEmail: input.contactEmail.slice(0, 200),
        contactPhone: (input.contactPhone || '').slice(0, 32),
        billingRatePerHour: input.billingRatePerHour,
        defaultBtPayPerHour: input.defaultBtPayPerHour,
        paymentTerms: input.paymentTerms.slice(0, 120),
        ...(input.partnerUids ? { partnerUids: input.partnerUids.slice(0, 20) } : {}),
        autoTriggerOnSignup: autoSignup,
        autoTriggerOnActions: autoActions,
        active: input.active,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(ref, {
        companyId,
        name: input.name.slice(0, 120),
        contactName: input.contactName.slice(0, 120),
        contactEmail: input.contactEmail.slice(0, 200),
        contactPhone: (input.contactPhone || '').slice(0, 32),
        billingRatePerHour: input.billingRatePerHour,
        defaultBtPayPerHour: input.defaultBtPayPerHour,
        paymentTerms: input.paymentTerms.slice(0, 120),
        partnerUids: (input.partnerUids || []).slice(0, 20),
        autoTriggerOnSignup: autoSignup,
        autoTriggerOnActions: autoActions,
        active: input.active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    batch.set(
      dirRef,
      {
        companyId,
        name: input.name.slice(0, 120),
        notificationEmail: input.contactEmail.slice(0, 200),
        notificationPhone: (input.contactPhone || '').slice(0, 32),
        ...(input.partnerUids ? { partnerUids: input.partnerUids.slice(0, 20) } : !input.companyId ? { partnerUids: [] } : {}),
        autoTriggerOnSignup: autoSignup,
        autoTriggerOnActions: autoActions,
        active: input.active,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await batch.commit();
    return companyId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `contractCompanies/${companyId}`);
  }
}

export async function updatePartnerNotificationSettings(
  companyId: string,
  updates: {
    notificationEmail: string;
    notificationPhone: string;
    autoTriggerOnSignup: boolean;
    autoTriggerOnActions: boolean;
  },
  alsoSyncContractCompany = false
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'partnerDirectory', companyId), {
      notificationEmail: updates.notificationEmail.trim().slice(0, 200),
      notificationPhone: updates.notificationPhone.trim().slice(0, 32),
      autoTriggerOnSignup: Boolean(updates.autoTriggerOnSignup),
      autoTriggerOnActions: Boolean(updates.autoTriggerOnActions),
      updatedAt: serverTimestamp(),
    });
    if (alsoSyncContractCompany) {
      batch.update(doc(db, 'contractCompanies', companyId), {
        contactEmail: updates.notificationEmail.trim().slice(0, 200),
        contactPhone: updates.notificationPhone.trim().slice(0, 32),
        autoTriggerOnSignup: Boolean(updates.autoTriggerOnSignup),
        autoTriggerOnActions: Boolean(updates.autoTriggerOnActions),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `partnerDirectory/${companyId}`);
  }
}

export async function syncPartnerDirectoryFromCompanies(
  companies: ContractCompany[],
  existingDir: PartnerDirectoryEntry[]
): Promise<void> {
  const existingIds = new Set(existingDir.map((d) => d.companyId));
  const missing = companies.filter((c) => !existingIds.has(c.companyId));
  if (missing.length === 0) return;

  const batch = writeBatch(db);
  for (const c of missing) {
    batch.set(doc(db, 'partnerDirectory', c.companyId), {
      companyId: c.companyId,
      name: c.name.slice(0, 120),
      notificationEmail: (c.contactEmail || '').slice(0, 200),
      notificationPhone: (c.contactPhone || '').slice(0, 32),
      partnerUids: (c.partnerUids || []).slice(0, 20),
      autoTriggerOnSignup: c.autoTriggerOnSignup !== false,
      autoTriggerOnActions: c.autoTriggerOnActions !== false,
      active: c.active,
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit().catch(() => {});
}

export async function assignUserPartnerRole(params: {
  targetUser: UserProfile;
  role: UserRole;
  contractCompanyId?: string;
  contractCompanyName?: string;
  contractCompanies: ContractCompany[];
  clients: ClientApplication[];
  sessions: TherapySession[];
}): Promise<void> {
  const { targetUser, role, contractCompanyId, contractCompanyName, contractCompanies, clients, sessions } =
    params;
  const uid = targetUser.uid;
  const nextCompanyId = role === 'partner' ? contractCompanyId || '' : '';
  const nextCompanyName = role === 'partner' ? contractCompanyName || '' : '';

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid), {
      role,
      contractCompanyId: nextCompanyId,
      contractCompanyName: nextCompanyName,
      updatedAt: serverTimestamp(),
    });

    const updatedUidsByCompany = new Map<string, string[]>();
    for (const comp of contractCompanies) {
      const currentUids = Array.isArray(comp.partnerUids) ? [...comp.partnerUids] : [];
      const filtered = currentUids.filter((id) => id !== uid);
      if (role === 'partner' && comp.companyId === nextCompanyId && !filtered.includes(uid)) {
        filtered.push(uid);
      }
      updatedUidsByCompany.set(comp.companyId, filtered.slice(0, 20));
      batch.update(doc(db, 'contractCompanies', comp.companyId), {
        partnerUids: filtered.slice(0, 20),
        updatedAt: serverTimestamp(),
      });
      batch.set(
        doc(db, 'partnerDirectory', comp.companyId),
        {
          companyId: comp.companyId,
          name: comp.name.slice(0, 120),
          notificationEmail: (comp.contactEmail || '').slice(0, 200),
          notificationPhone: (comp.contactPhone || '').slice(0, 32),
          partnerUids: filtered.slice(0, 20),
          autoTriggerOnSignup: comp.autoTriggerOnSignup !== false,
          autoTriggerOnActions: comp.autoTriggerOnActions !== false,
          active: comp.active,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    // Sync partnerUids across matching clients, documents, and sessions so isolation is immediate
    for (const cli of clients) {
      if (cli.contractCompanyId && updatedUidsByCompany.has(cli.contractCompanyId)) {
        const nextUids = updatedUidsByCompany.get(cli.contractCompanyId) || [];
        batch.update(doc(db, 'clients', cli.clientId), {
          partnerUids: nextUids,
          updatedAt: serverTimestamp(),
        });
        const docsSnap = await getDocs(collection(db, 'clients', cli.clientId, 'documents')).catch(
          () => null
        );
        if (docsSnap) {
          for (const dDoc of docsSnap.docs) {
            batch.update(dDoc.ref, {
              partnerUids: nextUids,
              updatedAt: serverTimestamp(),
            });
          }
        }
      }
    }

    for (const ses of sessions) {
      if (ses.contractCompanyId && updatedUidsByCompany.has(ses.contractCompanyId)) {
        const nextUids = updatedUidsByCompany.get(ses.contractCompanyId) || [];
        batch.update(doc(db, 'sessions', ses.sessionId), {
          partnerUids: nextUids,
          updatedAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function saveTriggerLog(input: {
  eventType: TriggerEventType;
  actionLabel: string;
  contractCompanyId?: string;
  contractCompanyName?: string;
  partnerUids?: string[];
  clientId?: string;
  clientLabel?: string;
  recipientEmail: string;
  recipientPhone?: string;
  sendEmail: boolean;
  sendSms: boolean;
  emailStatus: BillingAlertEmailStatus;
  smsStatus: BillingAlertSmsStatus;
  subject: string;
  summary: string;
  triggeredByUid: string;
  triggeredByEmail?: string;
}): Promise<string> {
  const triggerId = makeId('trg');
  const resolvedPartnerUids =
    input.partnerUids ?? (await resolvePartnerUidsForCompany(input.contractCompanyId));
  try {
    await setDoc(doc(db, 'triggerLogs', triggerId), {
      triggerId,
      eventType: input.eventType,
      actionLabel: input.actionLabel.slice(0, 120),
      ...(input.contractCompanyId ? { contractCompanyId: input.contractCompanyId } : {}),
      ...(input.contractCompanyName
        ? { contractCompanyName: input.contractCompanyName.slice(0, 120) }
        : {}),
      partnerUids: resolvedPartnerUids.slice(0, 20),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.clientLabel ? { clientLabel: input.clientLabel.slice(0, 120) } : {}),
      recipientEmail: (input.recipientEmail || BOOTSTRAPPED_ADMIN_EMAIL).slice(0, 200),
      ...(input.recipientPhone ? { recipientPhone: input.recipientPhone.slice(0, 32) } : {}),
      sendEmail: Boolean(input.sendEmail),
      sendSms: Boolean(input.sendSms),
      emailStatus: input.emailStatus,
      smsStatus: input.smsStatus,
      subject: input.subject.slice(0, 220),
      summary: input.summary.slice(0, 2000),
      triggeredByUid: input.triggeredByUid,
      ...(input.triggeredByEmail ? { triggeredByEmail: input.triggeredByEmail.slice(0, 200) } : {}),
      createdAt: serverTimestamp(),
    });
    return triggerId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `triggerLogs/${triggerId}`);
  }
}

export async function saveStaffMember(input: {
  displayName: string;
  title: string;
  languages: string[];
  borough: string;
  hourlyPayRate: number;
  uid?: string;
}): Promise<string> {
  const staffId = makeId('bt');
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'staffRoster', staffId), {
      staffId,
      ...(input.uid ? { uid: input.uid } : {}),
      displayName: input.displayName.slice(0, 120),
      title: input.title.slice(0, 80),
      languages: input.languages.slice(0, 10),
      borough: input.borough.slice(0, 80),
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'btCompensation', staffId), {
      staffId,
      btName: input.displayName.slice(0, 120),
      hourlyPayRate: input.hourlyPayRate,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return staffId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `staffRoster/${staffId}`);
  }
}

export async function recordPartnerPayment(input: {
  contractCompanyId: string;
  contractCompanyName: string;
  amount: number;
  periodLabel: string;
  paymentDateEt: string;
  referenceNumber: string;
  status: 'received' | 'pending';
  notes: string;
  recordedByUid: string;
}): Promise<string> {
  const paymentId = makeId('pay');
  try {
    await setDoc(doc(db, 'partnerPayments', paymentId), {
      paymentId,
      contractCompanyId: input.contractCompanyId,
      contractCompanyName: input.contractCompanyName.slice(0, 120),
      amount: input.amount,
      periodLabel: input.periodLabel.slice(0, 80),
      paymentDateEt: input.paymentDateEt,
      referenceNumber: input.referenceNumber.slice(0, 80),
      status: input.status,
      notes: input.notes.slice(0, 500),
      recordedByUid: input.recordedByUid,
      createdAt: serverTimestamp(),
    });
    return paymentId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `partnerPayments/${paymentId}`);
  }
}

export async function recordBtPayout(input: {
  btId: string;
  btName: string;
  hoursPaid: number;
  hourlyRate: number;
  totalAmount: number;
  periodLabel: string;
  paymentDateEt: string;
  status: 'paid' | 'scheduled';
  notes: string;
  recordedByUid: string;
}): Promise<string> {
  const payoutId = makeId('btp');
  try {
    await setDoc(doc(db, 'btPayouts', payoutId), {
      payoutId,
      btId: input.btId,
      btName: input.btName.slice(0, 120),
      hoursPaid: input.hoursPaid,
      hourlyRate: input.hourlyRate,
      totalAmount: input.totalAmount,
      periodLabel: input.periodLabel.slice(0, 80),
      paymentDateEt: input.paymentDateEt,
      status: input.status,
      notes: input.notes.slice(0, 500),
      recordedByUid: input.recordedByUid,
      createdAt: serverTimestamp(),
    });
    return payoutId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `btPayouts/${payoutId}`);
  }
}

export async function saveReminder(input: {
  targetUid?: string;
  clientId: string;
  clientName: string;
  recipientRole: 'parent' | 'staff';
  language: Language;
  subject: string;
  body: string;
  createdByUid: string;
}): Promise<string> {
  const reminderId = makeId('rem');
  try {
    await setDoc(doc(db, 'reminders', reminderId), {
      reminderId,
      ...(input.targetUid ? { targetUid: input.targetUid } : {}),
      clientId: input.clientId,
      clientName: input.clientName.slice(0, 160),
      recipientRole: input.recipientRole,
      language: input.language,
      subject: input.subject.slice(0, 200),
      body: input.body.slice(0, 2000),
      status: 'sent',
      createdByUid: input.createdByUid,
      createdAt: serverTimestamp(),
    });
    return reminderId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `reminders/${reminderId}`);
  }
}

export async function seedStarterOperationsData(adminUid: string): Promise<void> {
  const today = getTodayEtIso();
  const batch = writeBatch(db);

  // Contract Companies: El Heim & Hilf (+ Non-Financial Partner Directory Entries)
  batch.set(doc(db, 'contractCompanies', 'el_heim'), {
    companyId: 'el_heim',
    name: 'El Heim ABA Services',
    contactName: 'Reb Shloime Friedman',
    contactEmail: 'billing@elheimaba.org',
    contactPhone: '(845) 555-0112',
    billingRatePerHour: 84,
    defaultBtPayPerHour: 35,
    paymentTerms: 'Net 15 ACH',
    partnerUids: [],
    autoTriggerOnSignup: true,
    autoTriggerOnActions: true,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'partnerDirectory', 'el_heim'), {
    companyId: 'el_heim',
    name: 'El Heim ABA Services',
    notificationEmail: 'billing@elheimaba.org',
    notificationPhone: '(845) 555-0112',
    partnerUids: [],
    autoTriggerOnSignup: true,
    autoTriggerOnActions: true,
    active: true,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'contractCompanies', 'hilf'), {
    companyId: 'hilf',
    name: 'Hilf Behavioral Health',
    contactName: 'Reb Mendel Stein',
    contactEmail: 'ap@hilfcare.org',
    contactPhone: '(845) 555-0148',
    billingRatePerHour: 88,
    defaultBtPayPerHour: 36,
    paymentTerms: 'Bi-Weekly Direct Deposit',
    partnerUids: [],
    autoTriggerOnSignup: true,
    autoTriggerOnActions: true,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'partnerDirectory', 'hilf'), {
    companyId: 'hilf',
    name: 'Hilf Behavioral Health',
    notificationEmail: 'ap@hilfcare.org',
    notificationPhone: '(845) 555-0148',
    partnerUids: [],
    autoTriggerOnSignup: true,
    autoTriggerOnActions: true,
    active: true,
    updatedAt: serverTimestamp(),
  });

  // Behavior Technicians (Mixed Male & Female Staff Roster + Admin-Only Compensation)
  const bts = [
    {
      staffId: 'bt_yosef_goldstein',
      displayName: 'Yosef Goldstein, RBT',
      title: 'Senior Behavior Technician',
      languages: ['אידיש', 'English'],
      borough: 'Monroe / Orange County, NY',
      rate: 36,
    },
    {
      staffId: 'bt_rivka_rosenberg',
      displayName: 'Rivka Rosenberg, BT',
      title: 'Behavior Technician',
      languages: ['אידיש', 'English'],
      borough: 'Orange County, NY',
      rate: 34,
    },
    {
      staffId: 'bt_miriam_schwartz',
      displayName: 'Miriam Schwartz, RBT',
      title: 'Bilingual Behavior Technician',
      languages: ['אידיש', 'Hebrew', 'English'],
      borough: 'Williamsburg, Brooklyn',
      rate: 37,
    },
  ];

  for (const bt of bts) {
    batch.set(doc(db, 'staffRoster', bt.staffId), {
      staffId: bt.staffId,
      uid: adminUid,
      displayName: bt.displayName,
      title: bt.title,
      languages: bt.languages,
      borough: bt.borough,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'btCompensation', bt.staffId), {
      staffId: bt.staffId,
      btName: bt.displayName,
      hourlyPayRate: bt.rate,
      updatedAt: serverTimestamp(),
    });
  }

  // Sample NY Community Clients
  batch.set(doc(db, 'clients', 'cli_moshe_f'), {
    clientId: 'cli_moshe_f',
    parentUid: adminUid,
    parentName: 'Yankel Friedman',
    parentEmail: 'yfriedman@example.com',
    parentPhone: '(845) 555-0142',
    childFirstName: 'Moshe',
    childLastName: 'Friedman',
    childDob: '2020-04-12',
    borough: 'Monroe / Orange County, NY',
    preferredLanguage: 'yi',
    contractCompanyId: 'el_heim',
    contractCompanyName: 'El Heim ABA Services',
    partnerUids: [],
    assignedBtId: 'bt_yosef_goldstein',
    assignedBtName: 'Yosef Goldstein, RBT',
    assignedStaffUids: [adminUid],
    status: 'active_services',
    authorizedWeeklyHours: 20,
    checklist: {
      rx: 'verified',
      evaluation: 'verified',
      insurance: 'verified',
      iep: 'verified',
      hipaaConsent: 'verified',
    },
    notes: 'אידיש-speaking household in Orange County, NY. Sessions scheduled after 3:30 PM ET.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'clients', 'cli_yoel_w'), {
    clientId: 'cli_yoel_w',
    parentUid: adminUid,
    parentName: 'Usher Weiss',
    parentEmail: 'uweiss@example.com',
    parentPhone: '(845) 555-0198',
    childFirstName: 'Yoel',
    childLastName: 'Weiss',
    childDob: '2021-09-03',
    borough: 'Monroe / Orange County, NY',
    preferredLanguage: 'yi',
    contractCompanyId: 'hilf',
    contractCompanyName: 'Hilf Behavioral Health',
    partnerUids: [],
    assignedBtId: 'bt_miriam_schwartz',
    assignedBtName: 'Miriam Schwartz, RBT',
    assignedStaffUids: [adminUid],
    status: 'document_review',
    authorizedWeeklyHours: 15,
    checklist: {
      rx: 'verified',
      evaluation: 'missing',
      insurance: 'uploaded',
      iep: 'missing',
      hipaaConsent: 'verified',
    },
    notes: 'Orange County family; awaiting updated evaluation & IEP.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'clients', 'cli_dovid_k'), {
    clientId: 'cli_dovid_k',
    parentUid: adminUid,
    parentName: 'Yitzchok Klein',
    parentEmail: 'yklein@example.com',
    parentPhone: '(917) 555-0164',
    childFirstName: 'Dovid',
    childLastName: 'Klein',
    childDob: '2019-11-22',
    borough: 'Borough Park, Brooklyn',
    preferredLanguage: 'yi',
    contractCompanyId: 'el_heim',
    contractCompanyName: 'El Heim ABA Services',
    partnerUids: [],
    assignedBtId: 'bt_rivka_rosenberg',
    assignedBtName: 'Rivka Rosenberg, BT',
    assignedStaffUids: [adminUid],
    status: 'insurance_auth',
    authorizedWeeklyHours: 18,
    checklist: {
      rx: 'verified',
      evaluation: 'verified',
      insurance: 'verified',
      iep: 'uploaded',
      hipaaConsent: 'verified',
    },
    notes: 'All primary intake docs submitted to El Heim utilization review.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Therapy Sessions (Tracking Scheduled vs Approved Billable Hours separately in Eastern Time 12hr)
  batch.set(doc(db, 'sessions', 'ses_seed_1'), {
    sessionId: 'ses_seed_1',
    clientId: 'cli_moshe_f',
    clientName: 'Moshe Friedman',
    parentUid: adminUid,
    contractCompanyId: 'el_heim',
    contractCompanyName: 'El Heim ABA Services',
    partnerUids: [],
    btId: 'bt_yosef_goldstein',
    btUid: adminUid,
    btName: 'Yosef Goldstein, RBT',
    dateEt: today,
    startTimeEt: '3:30 PM',
    endTimeEt: '6:30 PM',
    scheduledHours: 3.0,
    approvedBillableHours: 3.0,
    status: 'approved_billable',
    notes: 'Completed home ABA session; parent signature & note verified.',
    approvedByUid: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'sessions', 'ses_seed_2'), {
    sessionId: 'ses_seed_2',
    clientId: 'cli_moshe_f',
    clientName: 'Moshe Friedman',
    parentUid: adminUid,
    contractCompanyId: 'el_heim',
    contractCompanyName: 'El Heim ABA Services',
    partnerUids: [],
    btId: 'bt_yosef_goldstein',
    btUid: adminUid,
    btName: 'Yosef Goldstein, RBT',
    dateEt: today,
    startTimeEt: '9:00 AM',
    endTimeEt: '11:30 AM',
    scheduledHours: 2.5,
    approvedBillableHours: 0,
    status: 'completed',
    notes: 'Completed morning session; awaiting supervisor billable sign-off.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'sessions', 'ses_seed_3'), {
    sessionId: 'ses_seed_3',
    clientId: 'cli_yoel_w',
    clientName: 'Yoel Weiss',
    parentUid: adminUid,
    contractCompanyId: 'hilf',
    contractCompanyName: 'Hilf Behavioral Health',
    partnerUids: [],
    btId: 'bt_miriam_schwartz',
    btUid: adminUid,
    btName: 'Miriam Schwartz, RBT',
    dateEt: today,
    startTimeEt: '1:00 PM',
    endTimeEt: '4:00 PM',
    scheduledHours: 3.0,
    approvedBillableHours: 2.5,
    status: 'approved_billable',
    notes: 'Scheduled 3.0 hrs; parent ended 30 mins early — 2.5 hrs approved billable.',
    approvedByUid: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'sessions', 'ses_seed_4'), {
    sessionId: 'ses_seed_4',
    clientId: 'cli_yoel_w',
    clientName: 'Yoel Weiss',
    parentUid: adminUid,
    contractCompanyId: 'hilf',
    contractCompanyName: 'Hilf Behavioral Health',
    partnerUids: [],
    btId: 'bt_rivka_rosenberg',
    btUid: adminUid,
    btName: 'Rivka Rosenberg, BT',
    dateEt: today,
    startTimeEt: '4:00 PM',
    endTimeEt: '6:00 PM',
    scheduledHours: 2.0,
    approvedBillableHours: 0,
    status: 'scheduled',
    notes: 'Scheduled home ABA intake observation.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // 72-hour overdue unbilled completed session (triggers automatic 48h admin alert)
  const threeDaysAgoEt = getRelativeDaysAgoEtIso(3);
  batch.set(doc(db, 'sessions', 'ses_seed_overdue_48h'), {
    sessionId: 'ses_seed_overdue_48h',
    clientId: 'cli_dovid_k',
    clientName: 'Dovid Klein',
    parentUid: adminUid,
    contractCompanyId: 'el_heim',
    contractCompanyName: 'El Heim ABA Services',
    partnerUids: [],
    btId: 'bt_yosef_goldstein',
    btUid: adminUid,
    btName: 'Yosef Goldstein, RBT',
    dateEt: threeDaysAgoEt,
    startTimeEt: '1:00 PM',
    endTimeEt: '4:00 PM',
    scheduledHours: 3.0,
    approvedBillableHours: 0,
    status: 'completed',
    notes: 'Completed 3 days ago; unbilled beyond 48-hour SLA — requires Admin billing approval.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Partner Payments & BT Payouts
  batch.set(doc(db, 'partnerPayments', 'pay_seed_1'), {
    paymentId: 'pay_seed_1',
    contractCompanyId: 'el_heim',
    contractCompanyName: 'El Heim ABA Services',
    amount: 2520,
    periodLabel: 'Nov 1 - Nov 15, 2026',
    paymentDateEt: today,
    referenceNumber: 'ACH-EH-9042',
    status: 'received',
    notes: '30.0 approved billable hours settled via ACH.',
    recordedByUid: adminUid,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'partnerPayments', 'pay_seed_2'), {
    paymentId: 'pay_seed_2',
    contractCompanyId: 'hilf',
    contractCompanyName: 'Hilf Behavioral Health',
    amount: 1760,
    periodLabel: 'Nov 1 - Nov 15, 2026',
    paymentDateEt: today,
    referenceNumber: 'ACH-HL-4410',
    status: 'received',
    notes: '20.0 approved billable hours settled.',
    recordedByUid: adminUid,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'btPayouts', 'btp_seed_1'), {
    payoutId: 'btp_seed_1',
    btId: 'bt_yosef_goldstein',
    btName: 'Yosef Goldstein, RBT',
    hoursPaid: 30,
    hourlyRate: 36,
    totalAmount: 1080,
    periodLabel: 'Nov 1 - Nov 15, 2026',
    paymentDateEt: today,
    status: 'paid',
    notes: 'Bi-weekly payroll direct deposit.',
    recordedByUid: adminUid,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'btPayouts', 'btp_seed_2'), {
    payoutId: 'btp_seed_2',
    btId: 'bt_miriam_schwartz',
    btName: 'Miriam Schwartz, RBT',
    hoursPaid: 20,
    hourlyRate: 37,
    totalAmount: 740,
    periodLabel: 'Nov 1 - Nov 15, 2026',
    paymentDateEt: today,
    status: 'paid',
    notes: 'Bi-weekly payroll direct deposit.',
    recordedByUid: adminUid,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'seedStarterOperationsData');
  }
}

export function countMissingDocs(checklist: ClientChecklist): ChecklistKey[] {
  const keys: ChecklistKey[] = ['rx', 'evaluation', 'insurance', 'iep', 'hipaaConsent'];
  return keys.filter((k) => checklist[k] === 'missing');
}

export function getChecklistStatusBadgeLabel(status: ChecklistStatus, lang: Language): string {
  if (lang === 'yi') {
    if (status === 'verified') return 'באַשטעטיקט';
    if (status === 'uploaded') return 'אַרויפגעלאָדן';
    return 'פעלט';
  }
  if (status === 'verified') return 'Verified';
  if (status === 'uploaded') return 'Uploaded';
  return 'Missing';
}
