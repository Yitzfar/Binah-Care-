# BINAH CARE — AI-Powered ABA Services Coordination Platform

BINAH CARE is a bilingual (English / Yiddish) Applied Behavior Analysis (ABA) services coordination and financial operations platform built for New York families, Behavior Technicians, and administrators.

## Key Modules
1. **Public Website**: English and Yiddish (`ייִדיש` RTL) overview of ABA coordination services, HIPAA role-isolation notice, contact/intake inquiry form, and a bilingual AI coordination assistant.
2. **Parent Portal**: Isolated strictly to the signed-in parent's own children (`parentUid == request.auth.uid`). Supports child intake applications, missing-document checklists (Rx, Evaluation, Insurance, IEP/IFSP, HIPAA Consent), AI document recognition, and Eastern Time (12-hour AM/PM) session schedules.
3. **Staff Portal**: Authorized client management, Behavior Technician assignments, Eastern Time 12-hour AM/PM scheduling, and **separate tracking of Scheduled Hours vs. Approved Billable Hours**.
4. **Admin Dashboard & Financial Management**: Complete visibility across contract partners (**El Heim**, **Hilf**, and dynamic expansion to additional partners), incoming partner payments, BT compensation payouts, hourly margins, and BINAH CARE net profit.
5. **AI Automation (`@google/genai`)**: Server-side Gemini integration (`gemini-4-hydrogen`) for document recognition, bilingual reminders, role-aware assistant chat, and executive financial analytics.

## Role-Based Security & Timezone Standards
- **Security**: Hardened `firestore.rules` aligned with `firebase-blueprint.json` enforce parent-only child isolation, least-privilege staff access, and admin-only financial collections.
- **Timezone**: All operational dates and therapy sessions use `America/New_York` (Eastern Time) with 12-hour `AM/PM` formatting.

## Deployment
- Configure `GEMINI_API_KEY` in environment secrets and ensure `firebase-applet-config.json` is provisioned.
- Build frontend assets: `npm run build`
- Start full-stack server on port 3000: `npm start`
