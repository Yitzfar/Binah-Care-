import React from 'react';
import { BookOpen, Clock, ShieldCheck } from 'lucide-react';
import type { Language } from '../types/binah';

export const AdminDocsView: React.FC<{ language: Language }> = ({ language }) => {
  return (
    <div className="space-y-8 max-w-4xl">
      <div className="pb-5 border-b border-[#E6E4DF]">
        <h1 className="text-2xl font-bold tracking-tight text-[#181A1F]">
          {language === 'yi'
            ? 'אַדמין טריינינג, HIPAA זיכערקייט & דאָקומענטאַציע'
            : 'Administrator Training, HIPAA Architecture & Operations Guide'}
        </h1>
        <p className="mt-1 text-sm text-[#575B66]">
          Reference manual for BINAH CARE administrators, care coordinators, and compliance review.
        </p>
      </div>

      <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#0F5C53]">
          <ShieldCheck className="w-4 h-4" />
          <span>1. Role-Based Access &amp; HIPAA Security Architecture</span>
        </div>
        <ul className="list-disc pl-5 text-sm text-[#575B66] space-y-2 leading-relaxed">
          <li>
            <strong>Parent Isolation:</strong> Firestore security rules enforce{' '}
            <code className="font-mono text-xs bg-[#F3F2EE] px-1.5 py-0.5 rounded">
              parentUid == request.auth.uid
            </code>{' '}
            so parents strictly access only their own children’s applications, checklists, uploaded
            documents, and Eastern Time schedules.
          </li>
          <li>
            <strong>Staff Least-Privilege:</strong> Staff coordinators and Behavior Technicians can
            only view clients explicitly listed in{' '}
            <code className="font-mono text-xs bg-[#F3F2EE] px-1.5 py-0.5 rounded">
              assignedStaffUids
            </code>{' '}
            and their own sessions. Partner billing rates, payouts, and profit margins are never
            accessible to Staff or Parents.
          </li>
          <li>
            <strong>New York Coordination &amp; Bilingual Standards:</strong> Based in New York,
            BINAH CARE coordinates both male and female Behavior Technicians and coordinators across
            Orange County, Monroe, Williamsburg, Borough Park, and Monsey with native אידיש (Yiddish)
            and English support.
          </li>
          <li>
            <strong>Admin-Only Financial Ledger:</strong> Contract company rates (El Heim, Hilf, and
            new partners), incoming partner payments, BT compensation rates, and net profit figures
            are restricted exclusively to verified Admin accounts.
          </li>
          <li>
            <strong>BAA &amp; Production Hardening:</strong> Before processing live ePHI at scale,
            execute a Google Cloud Business Associate Agreement (BAA), enable Cloud Audit Logs, and
            enforce periodic access reviews.
          </li>
        </ul>
      </div>

      <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#0F5C53]">
          <Clock className="w-4 h-4" />
          <span>2. Daily Operations Workflow (Eastern Time · 12-Hour AM/PM)</span>
        </div>
        <ol className="list-decimal pl-5 text-sm text-[#575B66] space-y-2 leading-relaxed">
          <li>
            <strong>Intake &amp; AI Checklist Verification:</strong> Parents submit a Child
            Application and upload prescriptions, evaluations, insurance cards, or IEPs. Gemini AI
            automatically extracts clinical metadata and updates the 5-item checklist. Staff verify
            each item to move the case toward Insurance Authorization.
          </li>
          <li>
            <strong>Scheduling vs. Approved Billable Hours:</strong> All sessions are booked in
            American Eastern Time (12-hour AM/PM). New sessions start with{' '}
            <code className="font-mono text-xs bg-[#F3F2EE] px-1.5 py-0.5 rounded">
              approvedBillableHours = 0
            </code>
            . When a BT marks a session Completed, an Admin reviews parent confirmation/notes and
            clicks <strong>Approve Billable</strong> before revenue or BT payroll accrues.
          </li>
          <li>
            <strong>Adding New Contract Companies:</strong> Navigate to{' '}
            <strong>Admin Dashboard &rarr; Add Contract Company</strong> to onboard additional ABA
            partner agencies beyond El Heim and Hilf with custom hourly billing rates and default BT
            pay rates.
          </li>
        </ol>
      </div>

      <div className="p-6 bg-white border border-[#E6E4DF] rounded-xl space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#0F5C53]">
          <BookOpen className="w-4 h-4" />
          <span>3. Deployment &amp; Environment Configuration</span>
        </div>
        <p className="text-sm text-[#575B66] leading-relaxed">
          BINAH CARE runs on a full-stack Node.js + Express backend (port 3000) serving the React +
          TypeScript frontend and server-side{' '}
          <code className="font-mono text-xs bg-[#F3F2EE] px-1.5 py-0.5 rounded">@google/genai</code>{' '}
          API endpoints. Set{' '}
          <code className="font-mono text-xs bg-[#F3F2EE] px-1.5 py-0.5 rounded">
            GEMINI_API_KEY
          </code>{' '}
          in server environment secrets, build via{' '}
          <code className="font-mono text-xs bg-[#F3F2EE] px-1.5 py-0.5 rounded">npm run build</code>
          , and start production with{' '}
          <code className="font-mono text-xs bg-[#F3F2EE] px-1.5 py-0.5 rounded">npm start</code>.
        </p>
      </div>
    </div>
  );
};
