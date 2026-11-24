import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const firestoreDatabaseId =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-b7a72e30-c0fd-457a-bcb3-d34673e95a20';
export const db = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();

export const GMAIL_SCOPES: string[] = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
  'https://www.googleapis.com/auth/gmail.addons.current.message.action',
  'https://www.googleapis.com/auth/gmail.addons.current.message.metadata',
  'https://www.googleapis.com/auth/gmail.addons.current.message.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
];

export const gmailAuthProvider = new GoogleAuthProvider();
for (const scope of GMAIL_SCOPES) {
  gmailAuthProvider.addScope(scope);
}
gmailAuthProvider.setCustomParameters({
  prompt: 'consent',
});

// Strict in-memory Gmail OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedGmailAccessToken: string | null = null;
let cachedGmailEmail: string | null = null;
const gmailTokenListeners = new Set<() => void>();

function notifyGmailListeners() {
  for (const listener of gmailTokenListeners) {
    listener();
  }
}

onAuthStateChanged(auth, (fbUser) => {
  if (!fbUser) {
    cachedGmailAccessToken = null;
    cachedGmailEmail = null;
    notifyGmailListeners();
  }
});

export function subscribeGmailTokenChange(listener: () => void): () => void {
  gmailTokenListeners.add(listener);
  return () => {
    gmailTokenListeners.delete(listener);
  };
}

export function getGmailAccessToken(): string | null {
  return cachedGmailAccessToken;
}

export function getConnectedGmailEmail(): string | null {
  return cachedGmailEmail;
}

export function clearGmailAccessToken(): void {
  cachedGmailAccessToken = null;
  cachedGmailEmail = null;
  notifyGmailListeners();
}

export async function connectGmailAccount(): Promise<{
  accessToken: string;
  email: string;
}> {
  const result = auth.currentUser
    ? await reauthenticateWithPopup(auth.currentUser, gmailAuthProvider).catch(() =>
        signInWithPopup(auth, gmailAuthProvider)
      )
    : await signInWithPopup(auth, gmailAuthProvider);

  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Google did not return a Gmail access token. Please try connecting again.');
  }
  cachedGmailAccessToken = credential.accessToken;
  cachedGmailEmail = result.user.email || auth.currentUser?.email || null;
  notifyGmailListeners();
  return {
    accessToken: cachedGmailAccessToken,
    email: cachedGmailEmail || '',
  };
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();
