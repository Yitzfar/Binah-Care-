import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, FileCheck2, FileWarning, Plus, Upload } from 'lucide-react';
import {
  CHECKLIST_LABELS,
  getCopy,
  SESSION_STATUS_LABELS,
  STATUS_LABELS,
} from '../i18n/translations';
import { analyzeDocumentWithAi } from '../lib/aiClient';
import {
  countMissingDocs,
  createClientApplication,
  fetchClientDocuments,
  getChecklistStatusBadgeLabel,
  saveClientDocumentAndChecklist,
} from '../lib/firestoreService';
import { formatEtDateLabel } from '../lib/timeEt';
import {
  triggerActionNotification,
  type DispatchedTriggerOutcome,
} from '../lib/triggers';
import type {
  AdminAlertSettings,
  AutomatedReminder,
  ChecklistKey,
  ClientApplication,
  ClientDocument,
  DocumentAiAnalysis,
  Language,
  PartnerDirectoryEntry,
  TherapySession,
  UserProfile,
} from '../types/binah';
import { ActionTriggerCheckboxes, TriggerOutcomeBanner } from './ActionTriggerBar';

interface ParentPortalProps {
  user: UserProfile;
  language: Language;
  clients: ClientApplication[];
  sessions: TherapySession[];
  reminders: AutomatedReminder[];
  partnerDirectory: PartnerDirectoryEntry[];
  alertSettings?: AdminAlertSettings | null;
}

const CHECKLIST_KEYS: ChecklistKey[] = ['rx', 'evaluation', 'insurance', 'iep', 'hipaaConsent'];
const PIPELINE_STEPS: Array<ClientApplication['status']> = [
  'intake_submitted',
  'document_review',
  'insurance_auth',
  'bt_matching',
  'active_services',
];

export const ParentPortal: React.FC<ParentPortalProps> = ({
  user,
  language,
  clients,
  sessions,
  reminders,
  partnerDirectory,
  alertSettings,
}) => {
  const t = getCopy(language);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [triggerOutcome, setTriggerOutcome] = useState<DispatchedTriggerOutcome | null>(null);

  // New Child Application Form State
  const [showNewForm, setShowNewForm] = useState(false);
  const [childFirstName, setChildFirstName] = useState('');
  const [childLastName, setChildLastName] = useState('');
  const [childDob, setChildDob] = useState('');
  const [parentPhone, setParentPhone] = useState(user.phone || '');
  const [borough, setBorough] = useState('Monroe / Orange County, NY');
  const [signupPartnerId, setSignupPartnerId] = useState('');
  const [notes, setNotes] = useState('');
  const [hipaaAgreed, setHipaaAgreed] = useState(true);
  const [signupTriggerEmail, setSignupTriggerEmail] = useState(true);
  const [signupTriggerSms, setSignupTriggerSms] = useState(false);
  const [creatingApp, setCreatingApp] = useState(false);
  const [appError, setAppError] = useState('');

  // Document Upload & AI Recognition State
  const [docTypeOverride, setDocTypeOverride] = useState<ChecklistKey | 'auto'>('auto');
  const [pastedDocText, setPastedDocText] = useState('');
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    mimeType: string;
    base64Data: string;
  } | null>(null);
  const [docTriggerEmail, setDocTriggerEmail] = useState(true);
  const [docTriggerSms, setDocTriggerSms] = useState(false);
  const [analyzingDoc, setAnalyzingDoc] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<DocumentAiAnalysis | null>(null);
  const [docFeedback, setDocFeedback] = useState('');
  const [docError, setDocError] = useState('');

  const myClients = clients.filter((c) => c.parentUid === user.uid);
  const activeClient =
    myClients.find((c) => c.clientId === selectedClientId) || myClients[0] || null;

  useEffect(() => {
    if (!activeClient) {
      setDocuments([]);
      return;
    }
    let mounted = true;
    setLoadingDocs(true);
    setDocError('');
    fetchClientDocuments(activeClient.clientId, user)
      .then((docs) => {
        if (mounted) setDocuments(docs);
      })
      .catch((err) => {
        if (mounted) {
          setDocError(err instanceof Error ? err.message : 'Unable to load submitted documents.');
        }
      })
      .finally(() => {
        if (mounted) setLoadingDocs(false);
      });
    return () => {
      mounted = false;
    };
  }, [activeClient?.clientId, user.uid, user.role]);

  const handleCreateApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hipaaAgreed) return;
    setAppError('');
    setCreatingApp(true);
    const chosenPartner = partnerDirectory.find((p) => p.companyId === signupPartnerId);
    try {
      const id = await createClientApplication({
        parentUid: user.uid,
        parentName: user.displayName,
        parentEmail: user.email,
        parentPhone,
        childFirstName,
        childLastName,
        childDob,
        borough,
        preferredLanguage: language,
        contractCompanyId: chosenPartner?.companyId,
        contractCompanyName: chosenPartner?.name,
        partnerUids: chosenPartner?.partnerUids,
        notes,
      });

      const shouldAutoSignupEmail = chosenPartner ? chosenPartner.autoTriggerOnSignup : true;
      if ((signupTriggerEmail && shouldAutoSignupEmail) || signupTriggerSms) {
        const outcome = await triggerActionNotification({
          user,
          eventType: 'new_client_signup',
          actionLabel: 'New Client Signup',
          contractCompanyId: chosenPartner?.companyId,
          contractCompanyName: chosenPartner?.name,
          partnerUids: chosenPartner?.partnerUids,
          clientId: id,
          clientName: `${childFirstName} ${childLastName}`,
          summaryDetails: `New client signed up in ${borough} (${language === 'yi' ? 'אידיש' : 'English'}).`,
          channels: {
            sendEmail: signupTriggerEmail && shouldAutoSignupEmail,
            sendSms: signupTriggerSms,
          },
          partnerDirectory,
          alertSettings,
          language,
        }).catch(() => null);
        if (outcome) setTriggerOutcome(outcome);
      }

      setSelectedClientId(id);
      setShowNewForm(false);
      setChildFirstName('');
      setChildLastName('');
      setChildDob('');
      setSignupPartnerId('');
      setNotes('');
    } catch (err) {
      setAppError(err instanceof Error ? err.message : 'Unable to submit application.');
    } finally {
      setCreatingApp(false);
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64Data = result.includes(',') ? result.split(',')[1] : '';
      setSelectedFile({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64Data,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyzeAndUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeClient) return;
    setDocError('');
    setDocFeedback('');

    if (!selectedFile && !pastedDocText.trim()) {
      setDocError(
        language === 'yi'
          ? 'ביטע קלויבט אויס אַ פייל אָדער שרייבט אריין דאָקומענט טעקסט.'
          : 'Please attach a file (image/PDF) or paste document text to analyze.'
      );
      return;
    }

    setAnalyzingDoc(true);
    try {
      const analysis = await analyzeDocumentWithAi({
        fileName: selectedFile?.name || 'pasted-document.txt',
        mimeType: selectedFile?.mimeType || 'text/plain',
        base64Data: selectedFile?.base64Data,
        textContent: pastedDocText.trim() || undefined,
        language,
      });

      const resolvedType: ChecklistKey | 'other' =
        docTypeOverride !== 'auto'
          ? docTypeOverride
          : CHECKLIST_KEYS.includes(analysis.docType as ChecklistKey)
            ? (analysis.docType as ChecklistKey)
            : 'other';

      const checklistKey: ChecklistKey | 'none' =
        docTypeOverride !== 'auto'
          ? docTypeOverride
          : CHECKLIST_KEYS.includes(analysis.recommendedChecklistKey as ChecklistKey)
            ? (analysis.recommendedChecklistKey as ChecklistKey)
            : 'none';

      const extractedFields: Record<string, string> = {};
      if (analysis.childName) extractedFields.childName = analysis.childName;
      if (analysis.providerName) extractedFields.providerName = analysis.providerName;
      if (analysis.memberId) extractedFields.memberId = analysis.memberId;
      if (analysis.effectiveDate) extractedFields.effectiveDate = analysis.effectiveDate;
      if (analysis.recommendedHoursPerWeek) {
        extractedFields.recommendedHoursPerWeek = analysis.recommendedHoursPerWeek;
      }
      if (analysis.diagnosisCode) extractedFields.diagnosisCode = analysis.diagnosisCode;

      await saveClientDocumentAndChecklist({
        clientId: activeClient.clientId,
        parentUid: activeClient.parentUid,
        uploadedByUid: user.uid,
        partnerUids: activeClient.partnerUids,
        docType: resolvedType,
        fileName: selectedFile?.name || `${resolvedType}_intake_note.txt`,
        mimeType: selectedFile?.mimeType || 'text/plain',
        summary: analysis.summary || '',
        extractedFields,
        currentChecklist: activeClient.checklist,
        checklistKeyToMark: checklistKey,
      });

      if (docTriggerEmail || docTriggerSms) {
        const outcome = await triggerActionNotification({
          user,
          eventType: 'document_uploaded',
          actionLabel: 'Document Uploaded',
          contractCompanyId: activeClient.contractCompanyId,
          contractCompanyName: activeClient.contractCompanyName,
          partnerUids: activeClient.partnerUids,
          clientId: activeClient.clientId,
          clientName: `${activeClient.childFirstName} ${activeClient.childLastName}`,
          summaryDetails: `Uploaded ${resolvedType} document (${selectedFile?.name || 'intake note'}).`,
          channels: {
            sendEmail: docTriggerEmail,
            sendSms: docTriggerSms,
          },
          partnerDirectory,
          alertSettings,
          language,
        }).catch(() => null);
        if (outcome) setTriggerOutcome(outcome);
      }

      setAiAnalysis(analysis);
      setPastedDocText('');
      setSelectedFile(null);
      setDocFeedback(
        language === 'yi'
          ? 'דער דאָקומענט איז אַנאַליזירט און אָפּגעהיט געוואָרן.'
          : 'Document recognized by AI, uploaded securely, and checklist updated.'
      );

      const refreshed = await fetchClientDocuments(activeClient.clientId, user);
      setDocuments(refreshed);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Unable to process document.');
    } finally {
      setAnalyzingDoc(false);
    }
  };

  const clientSessions = activeClient
    ? sessions.filter((s) => s.clientId === activeClient.clientId)
    : [];

  return (
    <div className="space-y-8">
      {/* Header & Child Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#E6E4DF]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#181A1F]">{t.tabParent}</h1>
          <p className="mt-1 text-sm text-[#575B66]">
            {language === 'yi'
              ? 'פּריוואַטער צוטריט בלויז צו אײַערע אייגענע קינדערס אַפּליקאַציעס, דאָקומענטן, און סעסיעס.'
              : 'Private family workspace showing strictly your own children’s applications, checklists, and schedules.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowNewForm((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0F5C53] text-white text-sm font-medium rounded-lg hover:bg-[#0B4740] transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{t.newChildApp}</span>
        </button>
      </div>

      <TriggerOutcomeBanner outcome={triggerOutcome} onDismiss={() => setTriggerOutcome(null)} />

      {/* New Child Application Drawer */}
      {showNewForm && (
        <form
          onSubmit={handleCreateApplication}
          className="p-6 bg-white border border-[#E6E4DF] rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-5"
        >
          <div className="sm:col-span-2">
            <h2 className="text-lg font-semibold text-[#181A1F]">{t.newChildApp}</h2>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
              {language === 'yi' ? 'קינדס ערשטער נאָמען' : 'Child First Name'} *
            </label>
            <input
              required
              type="text"
              value={childFirstName}
              onChange={(e) => setChildFirstName(e.target.value)}
              className="w-full px-3.5 py-2 border border-[#E6E4DF] rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
              {language === 'yi' ? 'פאַמיליע נאָמען' : 'Child Last Name'} *
            </label>
            <input
              required
              type="text"
              value={childLastName}
              onChange={(e) => setChildLastName(e.target.value)}
              className="w-full px-3.5 py-2 border border-[#E6E4DF] rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
              {language === 'yi' ? 'געבורטס דאַטום' : 'Date of Birth'}
            </label>
            <input
              type="date"
              value={childDob}
              onChange={(e) => setChildDob(e.target.value)}
              className="w-full px-3.5 py-2 border border-[#E6E4DF] rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
              {t.phoneLabel}
            </label>
            <input
              type="tel"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
              placeholder="(718) 555-0144"
              className="w-full px-3.5 py-2 border border-[#E6E4DF] rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
              {t.boroughLabel}
            </label>
            <select
              value={borough}
              onChange={(e) => setBorough(e.target.value)}
              className="w-full px-3.5 py-2 border border-[#E6E4DF] rounded-lg text-sm bg-white"
            >
              <option value="Monroe / Orange County, NY">Monroe / Orange County, NY</option>
              <option value="Williamsburg, Brooklyn">Williamsburg, Brooklyn</option>
              <option value="Borough Park, Brooklyn">Borough Park, Brooklyn</option>
              <option value="Monsey, NY">Monsey, NY</option>
              <option value="Bloomingburg / Sullivan, NY">Bloomingburg / Sullivan, NY</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
              {language === 'yi' ? 'קאָנטראַקט פֿירמע (אָפּציאָנאַל)' : 'Contract Partner Agency'}
            </label>
            <select
              value={signupPartnerId}
              onChange={(e) => setSignupPartnerId(e.target.value)}
              className="w-full px-3.5 py-2 border border-[#E6E4DF] rounded-lg text-sm bg-white"
            >
              <option value="">
                {language === 'yi' ? 'אויטאָמאַטיש צוטיילן' : 'Auto-Assign by BINAH CARE'}
              </option>
              {partnerDirectory.map((p) => (
                <option key={p.companyId} value={p.companyId}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
              {language === 'yi' ? 'באַמערקונגען / געוואונטשענע שעהן' : 'Scheduling Notes'}
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., After 3:30 PM ET preferred"
              className="w-full px-3.5 py-2 border border-[#E6E4DF] rounded-lg text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <ActionTriggerCheckboxes
              language={language}
              sendEmail={signupTriggerEmail}
              sendSms={signupTriggerSms}
              onChangeEmail={setSignupTriggerEmail}
              onChangeSms={setSignupTriggerSms}
              targetSummary={
                signupPartnerId
                  ? `Notifies ${partnerDirectory.find((p) => p.companyId === signupPartnerId)?.name || 'Partner'} on signup`
                  : 'Notifies BINAH CARE intake coordinator'
              }
            />
          </div>
          <div className="sm:col-span-2 flex items-start gap-2.5 pt-2">
            <input
              id="hipaa-consent-check"
              type="checkbox"
              checked={hipaaAgreed}
              onChange={(e) => setHipaaAgreed(e.target.checked)}
              className="mt-1"
              required
            />
            <label htmlFor="hipaa-consent-check" className="text-xs text-[#575B66] leading-relaxed">
              {language === 'yi'
                ? 'איך שטים צו צו דער HIPAA קאָאָרדינאַציע דערלויבעניש פאַר בינה קעיר צו איבערקוקן דאָקומענטן און קאָאָרדינירן ABA סערוויסעס.'
                : 'I accept the BINAH CARE HIPAA Care Coordination Agreement authorizing secure intake review and service coordination.'}
            </label>
          </div>
          {appError && (
            <p className="sm:col-span-2 text-xs text-[#B91C1C]">{appError}</p>
          )}
          <div className="sm:col-span-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowNewForm(false)}
              className="px-4 py-2 text-sm text-[#575B66] border border-[#E6E4DF] rounded-lg"
            >
              {language === 'yi' ? 'אַנולירן' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={creatingApp || !hipaaAgreed}
              className="px-5 py-2 bg-[#0F5C53] text-white text-sm font-medium rounded-lg hover:bg-[#0B4740] disabled:opacity-50"
            >
              {creatingApp
                ? '...'
                : language === 'yi'
                  ? 'שיקן אַפּליקאַציע'
                  : 'Submit Application'}
            </button>
          </div>
        </form>
      )}

      {/* Child Tabs if multiple children */}
      {myClients.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {myClients.map((child) => {
            const selected = activeClient?.clientId === child.clientId;
            return (
              <button
                key={child.clientId}
                type="button"
                onClick={() => setSelectedClientId(child.clientId)}
                className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  selected
                    ? 'bg-[#0F5C53] text-white border-[#0F5C53]'
                    : 'bg-white text-[#181A1F] border-[#E6E4DF] hover:border-[#0F5C53]'
                }`}
              >
                {child.childFirstName} {child.childLastName}
              </button>
            );
          })}
        </div>
      )}

      {!activeClient ? (
        <div className="p-10 bg-white border border-[#E6E4DF] rounded-xl text-center">
          <h2 className="text-lg font-semibold text-[#181A1F]">
            {language === 'yi'
              ? 'קיין קינד אַפּליקאַציעס נאָך נישט פאַראַן'
              : 'No child applications submitted yet'}
          </h2>
          <p className="mt-2 text-sm text-[#575B66] max-w-md mx-auto">
            {language === 'yi'
              ? 'דריקט "נײַע קינד אַפּליקאַציע" צו אָנהייבן אײַער ABA רעגיסטראַציע און אַרויפלאָדן דאָקומענטן.'
              : 'Click "New Child Application" to begin ABA coordination, upload prescriptions or IEPs, and track verification.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Application Status Pipeline */}
          <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#E6E4DF]">
              <div>
                <h2 className="text-lg font-semibold text-[#181A1F]">
                  {activeClient.childFirstName} {activeClient.childLastName}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#575B66]">
                  <span>{activeClient.borough || 'New York'}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {activeClient.contractCompanyName ||
                      (language === 'yi' ? 'ווערט צוגעטיילט' : 'Agency Assignment Pending')}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    BT: {activeClient.assignedBtName || (language === 'yi' ? 'נאָך נישט' : 'Pending Match')}
                  </span>
                </div>
              </div>
              <div className="text-sm font-semibold text-[#0F5C53]">
                {STATUS_LABELS[activeClient.status][language]}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-3">
              {PIPELINE_STEPS.map((step, idx) => {
                const currentIdx = PIPELINE_STEPS.indexOf(activeClient.status);
                const done = idx <= currentIdx;
                return (
                  <div
                    key={step}
                    className={`p-3 rounded-lg border text-xs ${
                      done
                        ? 'border-[#0F5C53]/40 bg-[#0F5C53]/5 text-[#181A1F]'
                        : 'border-[#E6E4DF] bg-[#FAF9F6] text-[#575B66]'
                    }`}
                  >
                    <div className="font-mono text-[11px] text-[#575B66]">0{idx + 1}</div>
                    <div className="mt-1 font-medium">{STATUS_LABELS[step][language]}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Missing-Document Checklist + AI Document Upload */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-6 p-6 bg-white border border-[#E6E4DF] rounded-xl">
              <div className="flex items-center justify-between gap-3 pb-4 border-b border-[#E6E4DF]">
                <h3 className="text-base font-semibold text-[#181A1F]">{t.missingChecklist}</h3>
                <span className="text-xs font-mono tabular-nums text-[#575B66]">
                  {5 - countMissingDocs(activeClient.checklist).length}/5{' '}
                  {language === 'yi' ? 'פאַרטיק' : 'Submitted'}
                </span>
              </div>

              <div className="divide-y divide-[#E6E4DF]">
                {CHECKLIST_KEYS.map((key) => {
                  const st = activeClient.checklist[key];
                  const label = CHECKLIST_LABELS[key];
                  return (
                    <div key={key} className="py-4 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-[#181A1F]">{label[language]}</p>
                        <p className="mt-0.5 text-xs text-[#575B66]">
                          {language === 'yi' ? label.descYi : label.descEn}
                        </p>
                      </div>
                      <div className="inline-flex items-center gap-1.5 text-xs font-medium shrink-0">
                        {st === 'verified' ? (
                          <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                        ) : st === 'uploaded' ? (
                          <FileCheck2 className="w-4 h-4 text-[#0F5C53]" />
                        ) : (
                          <FileWarning className="w-4 h-4 text-[#B45309]" />
                        )}
                        <span
                          className={
                            st === 'verified'
                              ? 'text-[#16A34A]'
                              : st === 'uploaded'
                                ? 'text-[#0F5C53]'
                                : 'text-[#B45309]'
                          }
                        >
                          {getChecklistStatusBadgeLabel(st, language)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AI Document Upload & Recognition */}
            <div className="lg:col-span-6 p-6 bg-white border border-[#E6E4DF] rounded-xl">
              <h3 className="text-base font-semibold text-[#181A1F] pb-4 border-b border-[#E6E4DF]">
                {t.uploadDocument}
              </h3>

              <form onSubmit={handleAnalyzeAndUpload} className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
                    {language === 'yi' ? 'דאָקומענט סאָרט' : 'Document Type'}
                  </label>
                  <select
                    value={docTypeOverride}
                    onChange={(e) => setDocTypeOverride(e.target.value as ChecklistKey | 'auto')}
                    className="w-full px-3 py-2 border border-[#E6E4DF] rounded-lg text-sm bg-white"
                  >
                    <option value="auto">
                      {language === 'yi'
                        ? 'אויטאָמאַטישע AI דערקענונג'
                        : 'Auto-Detect via AI Document Recognition'}
                    </option>
                    {CHECKLIST_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {CHECKLIST_LABELS[k][language]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
                    {language === 'yi' ? 'קלויבט אויס בילד אָדער PDF' : 'Upload Image or PDF'}
                  </label>
                  <label className="flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-[#CFCBC2] rounded-lg bg-[#FAF9F6] cursor-pointer hover:border-[#0F5C53] text-xs text-[#575B66]">
                    <Upload className="w-4 h-4 text-[#0F5C53]" />
                    <span>
                      {selectedFile
                        ? selectedFile.name
                        : language === 'yi'
                          ? 'קליקט צו קלויבן אַ פייל (PNG, JPG, PDF)'
                          : 'Choose file (PNG, JPG, WebP, or PDF)'}
                    </span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleFilePick}
                      className="hidden"
                    />
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
                    {language === 'yi'
                      ? 'אָדער קאָפּירט דאָקומענט טעקסט (פאַר שנעלע AI איבערקוק)'
                      : 'Or paste referral / IEP / insurance text'}
                  </label>
                  <textarea
                    rows={3}
                    value={pastedDocText}
                    onChange={(e) => setPastedDocText(e.target.value)}
                    placeholder={
                      language === 'yi'
                        ? 'למשל: דאָקטאָר רעצעפּט פאַר 20 שעהן ABA...'
                        : 'e.g., Rx for 20 hrs/week ABA therapy signed by Dr. Gold, Medicaid ID...'
                    }
                    className="w-full px-3 py-2 border border-[#E6E4DF] rounded-lg text-sm"
                  />
                </div>

                <ActionTriggerCheckboxes
                  language={language}
                  sendEmail={docTriggerEmail}
                  sendSms={docTriggerSms}
                  onChangeEmail={setDocTriggerEmail}
                  onChangeSms={setDocTriggerSms}
                  compact
                  targetSummary={
                    activeClient.contractCompanyName
                      ? `Notifies ${activeClient.contractCompanyName}`
                      : 'Notifies Coordinator'
                  }
                />

                {docError && <p className="text-xs text-[#B91C1C]">{docError}</p>}
                {docFeedback && <p className="text-xs text-[#16A34A] font-medium">{docFeedback}</p>}

                <button
                  type="submit"
                  disabled={analyzingDoc}
                  className="w-full px-4 py-2.5 bg-[#0F5C53] text-white text-sm font-medium rounded-lg hover:bg-[#0B4740] transition-colors disabled:opacity-50"
                >
                  {analyzingDoc
                    ? language === 'yi'
                      ? 'אַנאַליזירט מיט AI...'
                      : 'Scanning & Extracting with AI...'
                    : language === 'yi'
                      ? 'אַרויפלאָדן & אַנאַליזירן'
                      : 'Upload & Run AI Recognition'}
                </button>
              </form>

              {aiAnalysis && (
                <div className="mt-5 p-4 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg text-xs space-y-2">
                  <div className="flex items-center justify-between font-semibold text-[#181A1F]">
                    <span>
                      {language === 'yi' ? 'AI רעזולטאַט' : 'Extracted Clinical Summary'}
                    </span>
                    <span className="font-mono tabular-nums text-[#0F5C53]">
                      {aiAnalysis.confidence}% match
                    </span>
                  </div>
                  <p className="text-[#575B66] leading-relaxed">{aiAnalysis.summary}</p>
                  {aiAnalysis.missingOrUnclearItems.length > 0 && (
                    <p className="text-[#B45309]">
                      {language === 'yi' ? 'נאָטיץ: ' : 'Items to check: '}
                      {aiAnalysis.missingOrUnclearItems.join(' · ')}
                    </p>
                  )}
                </div>
              )}

              {/* Uploaded Documents List */}
              <div className="mt-6 pt-4 border-t border-[#E6E4DF]">
                <h4 className="text-xs font-semibold text-[#181A1F] mb-3">
                  {language === 'yi' ? 'אַרויפגעלאָדענע דאָקומענטן' : 'Submitted Documents'}
                </h4>
                {loadingDocs ? (
                  <p className="text-xs text-[#575B66]">Loading...</p>
                ) : documents.length === 0 ? (
                  <p className="text-xs text-[#575B66]">
                    {language === 'yi' ? 'נאָך קיין דאָקומענטן' : 'No documents uploaded yet.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {documents.map((docItem) => (
                      <div
                        key={docItem.documentId}
                        className="p-3 bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg flex items-start justify-between gap-3 text-xs"
                      >
                        <div>
                          <p className="font-medium text-[#181A1F]">{docItem.fileName}</p>
                          {docItem.summary && (
                            <p className="mt-0.5 text-[#575B66] line-clamp-2">{docItem.summary}</p>
                          )}
                        </div>
                        <span className="font-mono text-[11px] text-[#0F5C53] shrink-0">
                          {docItem.verificationStatus.replace('_', ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Upcoming & Recent Child Sessions (Eastern Time 12hr) */}
          <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl">
            <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#E6E4DF]">
              <h3 className="text-base font-semibold text-[#181A1F]">{t.sessionScheduleEt}</h3>
              <span className="inline-flex items-center gap-1.5 text-xs text-[#575B66]">
                <Clock className="w-3.5 h-3.5 text-[#0F5C53]" />
                <span>America/New_York · 12h AM/PM</span>
              </span>
            </div>

            {clientSessions.length === 0 ? (
              <p className="mt-4 text-sm text-[#575B66]">
                {language === 'yi'
                  ? 'סעסיע סקעדזשולס וועלן דאָ דערשיינען אַמאָל אַ BT ווערט צוגעטיילט.'
                  : 'Scheduled ABA sessions will appear here once a Behavior Technician is assigned.'}
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E6E4DF] text-xs text-[#575B66]">
                      <th className="py-2.5 pr-4 font-medium">
                        {language === 'yi' ? 'דאַטום (ET)' : 'Date (ET)'}
                      </th>
                      <th className="py-2.5 pr-4 font-medium">
                        {language === 'yi' ? 'צײַט (AM/PM)' : 'Time (AM/PM)'}
                      </th>
                      <th className="py-2.5 pr-4 font-medium">BT</th>
                      <th className="py-2.5 pr-4 font-medium text-right">
                        {t.scheduledHours}
                      </th>
                      <th className="py-2.5 font-medium text-right">
                        {language === 'yi' ? 'סטאַטוס' : 'Status'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E4DF]">
                    {clientSessions.map((ses) => (
                      <tr key={ses.sessionId}>
                        <td className="py-3 pr-4 font-mono text-xs tabular-nums">
                          {formatEtDateLabel(ses.dateEt)}
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs tabular-nums">
                          {ses.startTimeEt} – {ses.endTimeEt}
                        </td>
                        <td className="py-3 pr-4 text-xs text-[#181A1F]">
                          {ses.btName || 'Assigned BT'}
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs tabular-nums text-right">
                          {ses.scheduledHours.toFixed(2)} hrs
                        </td>
                        <td className="py-3 text-xs text-right font-medium text-[#0F5C53]">
                          {SESSION_STATUS_LABELS[ses.status][language]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Reminders Inbox */}
          {reminders.length > 0 && (
            <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl">
              <h3 className="text-base font-semibold text-[#181A1F] pb-3 border-b border-[#E6E4DF]">
                {language === 'yi' ? 'אָנזאָגן & דערמאָנונגען' : 'Care Coordination Reminders'}
              </h3>
              <div className="divide-y divide-[#E6E4DF]">
                {reminders.map((rem) => (
                  <div key={rem.reminderId} className="py-3">
                    <p className="text-sm font-medium text-[#181A1F]">{rem.subject}</p>
                    <p className="mt-1 text-xs text-[#575B66] whitespace-pre-line">{rem.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
