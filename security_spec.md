# BINAH CARE Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Parent Isolation**: A parent user (`role == 'parent'`) may ONLY read, list, create, or update `/clients/{clientId}` and `/clients/{clientId}/documents/{documentId}` where `parentUid == request.auth.uid`.
2. **No Self-Assigned Privilege Escalation**: A user creating or updating their own `/users/{userId}` document CANNOT assign themselves `'staff'` or `'admin'` roles (`role` must remain `'parent'` on self-create; only Admin can change `role` or `assignedClientIds`).
3. **Strict Financial Isolation**: `/contractCompanies`, `/btCompensation`, `/partnerPayments`, and `/btPayouts` contain sensitive financial margins, partner billing rates, and BT payroll data. Only verified Admins (`isAdmin()`) may read or write these collections.
4. **Master Gate for Subcollections**: Access to `/clients/{clientId}/documents/{documentId}` verifies the parent document `/clients/{clientId}` exists and `parentUid == request.auth.uid` (or Admin/authorized Staff).
5. **Email Verification Mandate**: All authenticated reads and writes require `request.auth.token.email_verified == true`.
6. **Temporal Integrity**: `createdAt` and `updatedAt` timestamps on client-created records MUST equal `request.time`.
7. **Terminal & Immutable Fields**: `parentUid` and `createdAt` are immutable after creation.
8. **Zero Unbounded Arrays & Size Limits**: Every string validates `.size() <= MAX`, every ID matches `^[a-zA-Z0-9_-]+$` and `.size() <= 128`, and array fields (`assignedClientIds`, `assignedStaffUids`, `languages`) are strictly bounded.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Self-Role Escalation**: Parent creates `/users/{uid}` with `{ role: "admin" }`.
2. **Shadow Field Injection**: Parent creates `/clients/{id}` with extra ghost field `{ isVerified: true }`.
3. **Cross-Parent Read**: Parent A calls `get` on `/clients/{clientB_id}` owned by Parent B.
4. **Unscoped List Query**: Parent A calls `list` on `/clients` without `where('parentUid', '==', uid)`.
5. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts write to `/clients/{id}`.
6. **Admin Email Spoof**: Non-admin user with `email: "arledigt@gmail.com"` and `email_verified: false` attempts read on `/partnerPayments`.
7. **Financial Snooping by Parent/Staff**: Parent or Staff attempts `get` or `list` on `/contractCompanies` or `/btPayouts`.
8. **Client-Side Timestamp Forgery**: Parent creates `/clients/{id}` with forged past `createdAt` (`createdAt != request.time`).
9. **ID Poisoning**: Attacker writes to `/clients/` with a 500-character invalid document ID containing `$` or spaces.
10. **Parent Ownership Hijack**: Parent updates `/clients/{id}` attempting to overwrite `parentUid` to another user's UID.
11. **Orphan Document Upload**: Parent attempts to write `/clients/nonexistent_id/documents/doc1` when parent `/clients/nonexistent_id` does not exist.
12. **Billable Hours Tampering**: Parent attempts to update `/sessions/{sessionId}` to modify `approvedBillableHours` or `status: "approved_billable"`.
