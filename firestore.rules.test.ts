/**
 * BINAH CARE — Phase 0 Security Rules Verification Specification
 * Covers the "Dirty Dozen" adversarial payloads verifying PERMISSION_DENIED invariants.
 */

export interface DirtyDozenCase {
  id: string;
  name: string;
  actor: 'parentA' | 'parentB' | 'staff1' | 'unverifiedUser' | 'spoofedAdmin';
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenCase[] = [
  {
    id: 'DD-01',
    name: 'Self-Role Escalation on User Registration',
    actor: 'parentA',
    operation: 'create',
    path: 'users/parentA',
    payload: {
      uid: 'parentA',
      email: 'parentA@example.com',
      displayName: 'Parent A',
      role: 'admin',
      preferredLanguage: 'en',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-02',
    name: 'Shadow Field Injection on Client Application',
    actor: 'parentA',
    operation: 'create',
    path: 'clients/client_1',
    payload: {
      clientId: 'client_1',
      parentUid: 'parentA',
      isVerified: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-03',
    name: 'Cross-Parent Read on Another Child Application',
    actor: 'parentA',
    operation: 'get',
    path: 'clients/client_owned_by_parentB',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-04',
    name: 'Unscoped List Query on Clients Collection',
    actor: 'parentA',
    operation: 'list',
    path: 'clients',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-05',
    name: 'Unverified Email Write Attempt',
    actor: 'unverifiedUser',
    operation: 'create',
    path: 'clients/client_unverified',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-06',
    name: 'Admin Email Spoof with Unverified Token',
    actor: 'spoofedAdmin',
    operation: 'list',
    path: 'partnerPayments',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-07',
    name: 'Financial Snooping on Contract Companies by Staff',
    actor: 'staff1',
    operation: 'get',
    path: 'contractCompanies/el_heim',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-08',
    name: 'Client-Side Timestamp Forgery on Client Application',
    actor: 'parentA',
    operation: 'create',
    path: 'clients/client_forged_time',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-09',
    name: 'ID Poisoning with Invalid Characters',
    actor: 'parentA',
    operation: 'create',
    path: 'clients/invalid id with spaces $',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-10',
    name: 'Parent Ownership Hijack on Update',
    actor: 'parentA',
    operation: 'update',
    path: 'clients/client_owned_by_parentA',
    payload: { parentUid: 'parentB' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-11',
    name: 'Orphan Document Upload Under Nonexistent Client',
    actor: 'parentA',
    operation: 'create',
    path: 'clients/nonexistent_client/documents/doc_1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-12',
    name: 'Billable Hours Tampering by Parent',
    actor: 'parentA',
    operation: 'update',
    path: 'sessions/session_1',
    payload: { approvedBillableHours: 8, status: 'approved_billable' },
    expected: 'PERMISSION_DENIED',
  },
];
