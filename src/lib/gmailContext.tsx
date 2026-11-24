import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Mail, ShieldAlert, X } from 'lucide-react';
import {
  clearGmailAccessToken,
  connectGmailAccount,
  getConnectedGmailEmail,
  getGmailAccessToken,
  subscribeGmailTokenChange,
} from './firebase';

export interface GmailSendConfirmationDetails {
  recipientEmail: string;
  ccEmails?: string[];
  subject: string;
  bodyPreview: string;
  itemCount?: number;
  itemSummaries?: string[];
}

type ConfirmHandler = (details: GmailSendConfirmationDetails) => Promise<boolean>;

let registeredGmailConfirmHandler: ConfirmHandler | null = null;

export async function requestGmailSendConfirmation(
  details: GmailSendConfirmationDetails
): Promise<boolean> {
  if (registeredGmailConfirmHandler) {
    return registeredGmailConfirmHandler(details);
  }
  return false;
}

interface GmailContextValue {
  gmailConnected: boolean;
  gmailEmail: string | null;
  connectingGmail: boolean;
  gmailError: string;
  connectGmail: () => Promise<boolean>;
  disconnectGmail: () => void;
}

const GmailContext = createContext<GmailContextValue>({
  gmailConnected: false,
  gmailEmail: null,
  connectingGmail: false,
  gmailError: '',
  connectGmail: async () => false,
  disconnectGmail: () => {},
});

export function useGmail() {
  return useContext(GmailContext);
}

export const GmailProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [gmailConnected, setGmailConnected] = useState(Boolean(getGmailAccessToken()));
  const [gmailEmail, setGmailEmail] = useState<string | null>(getConnectedGmailEmail());
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [gmailError, setGmailError] = useState('');

  const [pendingConfirm, setPendingConfirm] = useState<GmailSendConfirmationDetails | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  useEffect(() => {
    return subscribeGmailTokenChange(() => {
      setGmailConnected(Boolean(getGmailAccessToken()));
      setGmailEmail(getConnectedGmailEmail());
    });
  }, []);

  useEffect(() => {
    const handler: ConfirmHandler = (details) => {
      return new Promise<boolean>((resolve) => {
        if (resolverRef.current) {
          resolverRef.current(false);
        }
        resolverRef.current = resolve;
        setPendingConfirm(details);
      });
    };
    registeredGmailConfirmHandler = handler;
    return () => {
      if (registeredGmailConfirmHandler === handler) {
        registeredGmailConfirmHandler = null;
      }
      if (resolverRef.current) {
        resolverRef.current(false);
        resolverRef.current = null;
      }
    };
  }, []);

  const handleConfirmDecision = (approved: boolean) => {
    setPendingConfirm(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    if (resolve) resolve(approved);
  };

  const connectGmail = async (): Promise<boolean> => {
    setConnectingGmail(true);
    setGmailError('');
    try {
      const res = await connectGmailAccount();
      setGmailConnected(Boolean(res.accessToken));
      setGmailEmail(res.email || null);
      return true;
    } catch (err) {
      setGmailError(err instanceof Error ? err.message : 'Unable to connect Gmail account.');
      return false;
    } finally {
      setConnectingGmail(false);
    }
  };

  const disconnectGmail = () => {
    clearGmailAccessToken();
    setGmailError('');
  };

  return (
    <GmailContext.Provider
      value={{
        gmailConnected,
        gmailEmail,
        connectingGmail,
        gmailError,
        connectGmail,
        disconnectGmail,
      }}
    >
      {children}

      {pendingConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gmail-confirm-title"
        >
          <div className="w-full max-w-lg bg-white border border-[#E6E4DF] rounded-xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E6E4DF] bg-[#FAF9F6] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Mail className="w-4 h-4 text-[#0F5C53]" />
                <h3 id="gmail-confirm-title" className="text-sm font-semibold text-[#181A1F]">
                  Confirm Sending Email via Gmail
                </h3>
              </div>
              <button
                type="button"
                onClick={() => handleConfirmDecision(false)}
                className="text-[#575B66] hover:text-[#181A1F] p-1"
                aria-label="Cancel Gmail send"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs">
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#FFFBEB] border border-[#F59E0B]/40 text-[#92400E]">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[#B45309]" />
                <p>
                  This will send a real email from your connected Gmail account (
                  <span className="font-mono font-semibold">{gmailEmail || 'Gmail'}</span>). Review
                  the recipient and message below before sending.
                </p>
              </div>

              <div className="space-y-1.5 border border-[#E6E4DF] rounded-lg p-3.5 bg-[#FAF9F6]">
                <div>
                  <span className="text-[#575B66] font-medium">To: </span>
                  <span className="font-mono text-[#181A1F]">{pendingConfirm.recipientEmail}</span>
                </div>
                {pendingConfirm.ccEmails && pendingConfirm.ccEmails.length > 0 && (
                  <div>
                    <span className="text-[#575B66] font-medium">CC: </span>
                    <span className="font-mono text-[#181A1F]">
                      {pendingConfirm.ccEmails.join(', ')}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-[#575B66] font-medium">Subject: </span>
                  <span className="font-semibold text-[#181A1F]">{pendingConfirm.subject}</span>
                </div>
              </div>

              {pendingConfirm.itemCount && pendingConfirm.itemCount > 1 && (
                <div className="text-[11px] text-[#575B66]">
                  Includes <strong>{pendingConfirm.itemCount}</strong> overdue therapy session items
                  {pendingConfirm.itemSummaries && pendingConfirm.itemSummaries.length > 0
                    ? `: ${pendingConfirm.itemSummaries.slice(0, 4).join('; ')}${
                        pendingConfirm.itemSummaries.length > 4 ? '…' : ''
                      }`
                    : '.'}
                </div>
              )}

              <div>
                <p className="text-[11px] font-medium text-[#575B66] mb-1">Message Preview:</p>
                <pre className="p-3 bg-white border border-[#E6E4DF] rounded-lg max-h-44 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-[#181A1F] leading-relaxed">
                  {pendingConfirm.bodyPreview}
                </pre>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-[#E6E4DF] bg-[#FAF9F6] flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => handleConfirmDecision(false)}
                className="px-4 py-2 text-xs font-medium text-[#575B66] bg-white border border-[#E6E4DF] rounded-lg hover:text-[#181A1F]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDecision(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#0F5C53] text-white rounded-lg hover:bg-[#0B4740]"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Confirm &amp; Send via Gmail</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </GmailContext.Provider>
  );
};
