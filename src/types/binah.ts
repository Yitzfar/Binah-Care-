export type Language = 'en' | 'yi';

export type UserRole = 'parent' | 'staff' | 'partner' | 'admin';

export type ChecklistStatus = 'missing' | 'uploaded' | 'verified';

export type ChecklistKey = 'rx' | 'evaluation' | 'insurance' | 'iep' | 'hipaaConsent';

export interface ClientChecklist {
  rx: ChecklistStatus;
  evaluation: ChecklistStatus;
  insurance: ChecklistStatus;
  iep: ChecklistStatus;
  hipaaConsent: ChecklistStatus;
}

export type ApplicationStatus =
  | 'intake_submitted'
  | 'document_review'
  | 'insurance_auth'
  | 'bt_matching'
  | 'active_services';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  preferredLanguage: Language;
  phone?: string;
  hipaaAcceptedAt?: string;
  assignedClientIds?: string[];
  contractCompanyId?: string;
  contractCompanyName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StaffRosterEntry {
  staffId: string;
  uid?: string;
  displayName: string;
  title: string;
  languages?: string[];
  borough?: string;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BtCompensation {
  staffId: string;
  btName: string;
  hourlyPayRate: number;
  updatedAt?: unknown;
}

export interface ContractCompany {
  companyId: string;
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  billingRatePerHour: number;
  defaultBtPayPerHour: number;
  paymentTerms?: string;
  partnerUids?: string[];
  autoTriggerOnSignup?: boolean;
  autoTriggerOnActions?: boolean;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PartnerDirectoryEntry {
  companyId: string;
  name: string;
  notificationEmail?: string;
  notificationPhone?: string;
  partnerUids?: string[];
  autoTriggerOnSignup: boolean;
  autoTriggerOnActions: boolean;
  active: boolean;
  updatedAt?: unknown;
}

export interface ClientApplication {
  clientId: string;
  parentUid: string;
  parentName: string;
  parentEmail?: string;
  parentPhone?: string;
  childFirstName: string;
  childLastName: string;
  childDob?: string;
  borough?: string;
  preferredLanguage: Language;
  contractCompanyId?: string;
  contractCompanyName?: string;
  partnerUids?: string[];
  assignedBtId?: string;
  assignedBtName?: string;
  assignedStaffUids?: string[];
  status: ApplicationStatus;
  authorizedWeeklyHours?: number;
  checklist: ClientChecklist;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ClientDocument {
  documentId: string;
  clientId: string;
  parentUid: string;
  partnerUids?: string[];
  docType: ChecklistKey | 'other';
  fileName: string;
  mimeType?: string;
  summary?: string;
  extractedFields?: Record<string, string>;
  verificationStatus: 'pending_review' | 'verified' | 'needs_resubmission';
  uploadedByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type SessionStatus = 'scheduled' | 'completed' | 'approved_billable' | 'cancelled';

export interface TherapySession {
  sessionId: string;
  clientId: string;
  clientName?: string;
  parentUid: string;
  contractCompanyId?: string;
  contractCompanyName?: string;
  partnerUids?: string[];
  btId: string;
  btUid?: string;
  btName?: string;
  dateEt: string;
  startTimeEt: string;
  endTimeEt: string;
  scheduledHours: number;
  approvedBillableHours: number;
  status: SessionStatus;
  notes?: string;
  approvedByUid?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PartnerPayment {
  paymentId: string;
  contractCompanyId: string;
  contractCompanyName: string;
  amount: number;
  periodLabel?: string;
  paymentDateEt: string;
  referenceNumber?: string;
  status: 'received' | 'pending';
  notes?: string;
  recordedByUid: string;
  createdAt?: unknown;
}

export interface BtPayout {
  payoutId: string;
  btId: string;
  btName: string;
  hoursPaid: number;
  hourlyRate: number;
  totalAmount: number;
  periodLabel?: string;
  paymentDateEt: string;
  status: 'paid' | 'scheduled';
  notes?: string;
  recordedByUid: string;
  createdAt?: unknown;
}

export interface AutomatedReminder {
  reminderId: string;
  targetUid?: string;
  clientId: string;
  clientName?: string;
  recipientRole: 'parent' | 'staff';
  language: Language;
  subject: string;
  body: string;
  status: 'sent' | 'acknowledged';
  createdByUid: string;
  createdAt?: unknown;
}

export interface DocumentAiAnalysis {
  docType: ChecklistKey | 'other';
  confidence: number;
  summary: string;
  childName?: string;
  providerName?: string;
  memberId?: string;
  effectiveDate?: string;
  recommendedHoursPerWeek?: string;
  diagnosisCode?: string;
  missingOrUnclearItems: string[];
  recommendedChecklistKey: ChecklistKey | 'none';
}

export interface FinancialAiAnalytics {
  executiveSummary: string;
  profitabilityInsights: string[];
  bottleneckAlerts: string[];
  recommendedActions: string[];
}

export type BillingAlertStatus = 'active' | 'acknowledged' | 'resolved';
export type BillingAlertEmailStatus = 'sent' | 'queued_no_smtp' | 'failed' | 'disabled';
export type BillingAlertSmsStatus = 'sent' | 'queued_no_sms' | 'failed' | 'disabled';
export type BillingAlertChannel =
  | 'dashboard'
  | 'email_and_dashboard'
  | 'sms_and_dashboard'
  | 'email_sms_and_dashboard';

export interface BillingAlert {
  alertId: string;
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
  status: BillingAlertStatus;
  lastNotifiedAt?: string;
  createdByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AdminAlertSettings {
  settingId: string;
  alertEmail: string;
  alertPhone?: string;
  notifyEmail: boolean;
  notifySms: boolean;
  updatedByUid: string;
  updatedAt?: unknown;
}

export type TriggerEventType =
  | 'new_client_signup'
  | 'document_uploaded'
  | 'checklist_verified'
  | 'status_changed'
  | 'partner_assigned'
  | 'bt_assigned'
  | 'session_scheduled'
  | 'session_completed'
  | 'session_billed'
  | 'payment_recorded'
  | 'payout_recorded'
  | 'reminder_sent'
  | 'custom_action';

export interface TriggerLog {
  triggerId: string;
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
  createdAt?: unknown;
}



