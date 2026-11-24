import React, { useEffect, useRef, useState } from 'react';
import { Bot, RotateCcw, Send, Sparkles, X, Zap } from 'lucide-react';
import { getCopy } from '../i18n/translations';
import { sendAiChatMessage } from '../lib/aiClient';
import type { Language } from '../types/binah';

export type ChatbotPortalContext = 'public' | 'parent' | 'staff' | 'partner' | 'admin';

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
  modelUsed?: string;
}

interface GeminiChatbotProps {
  language: Language;
  portalContext: ChatbotPortalContext;
  snapshot?: Record<string, unknown>;
  variant?: 'panel' | 'drawer';
  onClose?: () => void;
}

const ROLE_BADGES: Record<ChatbotPortalContext, { en: string; yi: string }> = {
  public: { en: 'Public Coordinator', yi: 'אַלגעמיינער קאָאָרדינאַטאָר' },
  parent: { en: 'Family Assistant', yi: 'עלטערן הילף' },
  staff: { en: 'Staff & BT Assistant', yi: 'BT & סקעדזשול הילף' },
  partner: { en: 'Partner Agency Assistant', yi: 'שותף פֿירמע הילף' },
  admin: { en: 'Admin Operations Assistant', yi: 'אַדמין אָפּעראַציעס הילף' },
};

const STARTER_PROMPTS: Record<ChatbotPortalContext, { en: string[]; yi: string[] }> = {
  public: {
    en: [
      'What documents are required to start ABA services?',
      'Which New York communities do you coordinate in?',
      'How do you match male or female Behavior Technicians?',
    ],
    yi: [
      'וועלכע דאָקומענטן דאַרף מען צוצוגרייטן פאַר ABA?',
      'אין וועלכע ניו יאָרק געגנטן קאָאָרדינירט איר?',
      'ווי אַזוי טוט איר צוטיילן מענער אָדער פרויען טעראַפּיסטן?',
    ],
  },
  parent: {
    en: [
      'Which documents are still missing for my child?',
      'What happens during Insurance Auth and BT Matching?',
      'When is our next scheduled session (ET)?',
    ],
    yi: [
      'וועלכע דאָקומענטן פעלן נאָך פאַר מײַן קינד?',
      'וואָס זענען די שריט ביז מיר באַקומען אַ BT?',
      'ווען איז די קומענדיגע סעסיע (ET)?',
    ],
  },
  staff: {
    en: [
      'Explain scheduled hours vs. approved billable hours.',
      'How do I complete a session after it ends in ET?',
      'Summarize my current client caseload status.',
    ],
    yi: [
      'וואָס איז דער חילוק צווישן געפּלאַנטע און בילאַבל שעות?',
      'ווי אַזוי שליסט מען אַ סעסיע נאָך איסטערן טײַם?',
      'גיב אַ קורצן איבערבליק פֿון מײַנע קליענטן.',
    ],
  },
  partner: {
    en: [
      'How many active clients and sessions are assigned to our agency?',
      'Which client intake documents are still missing?',
      'How do signup email triggers work for our agency?',
    ],
    yi: [
      'וויפיל אַקטיווע קליענטן זענען דאָ בײַ אונזער פֿירמע?',
      'וועלכע דאָקומענטן פעלן בײַ אונזערע קליענטן?',
      'ווי אַזוי אַרבעטן די אימעיל טריגערס בײַ נײַע קליענטן?',
    ],
  },
  admin: {
    en: [
      'Compare scheduled vs. approved billable hours right now.',
      'Which operational bottlenecks need attention first?',
      'Draft an agenda for our weekly El Heim & Hilf billing review.',
    ],
    yi: [
      'פאַרגלײַכט געפּלאַנטע קעגן באַשטעטיקטע בילאַבל שעות.',
      'וועלכע זאַכן האַלטן אָפּ די ביללינג איצט?',
      'גרייט צו אַ קורצן פּלאַן פאַר אל היים און הילף רעוויו.',
    ],
  },
};

export const GeminiChatbot: React.FC<GeminiChatbotProps> = ({
  language,
  portalContext,
  snapshot,
  variant = 'panel',
  onClose,
}) => {
  const t = getCopy(language);
  const isRtl = language === 'yi';
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [modelTier, setModelTier] = useState<'standard' | 'fast'>('standard');
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, loading]);

  const sendMessage = async (rawText: string) => {
    const prompt = rawText.trim();
    if (!prompt || loading) return;

    setErrorMsg('');
    setInput('');
    const priorTurns = history.map((m) => ({ role: m.role, text: m.text }));
    const nextHistory: ChatTurn[] = [...history, { role: 'user', text: prompt }];
    setHistory(nextHistory);
    setLoading(true);

    try {
      const res = await sendAiChatMessage({
        message: prompt,
        history: priorTurns,
        language,
        portalContext,
        modelTier,
        snapshot,
      });
      setHistory([
        ...nextHistory,
        { role: 'model', text: res.reply, modelUsed: res.modelUsed },
      ]);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to reach AI assistant right now.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const starterList = STARTER_PROMPTS[portalContext][language];
  const roleBadge = ROLE_BADGES[portalContext][language];

  const containerClass =
    variant === 'drawer'
      ? 'fixed bottom-5 right-5 z-40 w-[390px] max-w-[calc(100vw-2rem)] bg-white border border-[#E6E4DF] rounded-xl shadow-xl flex flex-col overflow-hidden'
      : 'p-6 bg-white border border-[#E6E4DF] rounded-xl flex flex-col';

  const threadHeightClass =
    variant === 'drawer'
      ? 'h-80 overflow-y-auto px-4 py-3.5 space-y-3'
      : 'flex-1 min-h-[300px] max-h-[380px] overflow-y-auto py-4 space-y-3';

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className={containerClass}>
      {/* Header */}
      <div
        className={
          variant === 'drawer'
            ? 'px-4 py-3 border-b border-[#E6E4DF] bg-[#FAF9F6] flex items-center justify-between gap-2'
            : 'pb-4 border-b border-[#E6E4DF] flex flex-wrap items-center justify-between gap-2'
        }
      >
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="w-4 h-4 text-[#0F5C53] shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#181A1F] truncate">
              {t.aiAssistantTitle}
            </h2>
            <p className="text-[11px] text-[#575B66] truncate">{roleBadge}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Standard (gemini-4-hydrogen) vs Fast (gemini-3.1-flash-lite) Switcher */}
          <div
            role="group"
            aria-label="Assistant speed"
            className="inline-flex items-center p-0.5 bg-[#F3F2EE] border border-[#E6E4DF] rounded-md text-[11px]"
          >
            <button
              type="button"
              onClick={() => setModelTier('standard')}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded ${
                modelTier === 'standard'
                  ? 'bg-white text-[#181A1F] font-medium shadow-xs'
                  : 'text-[#575B66]'
              }`}
              title="General coordination assistant (gemini-4-hydrogen)"
            >
              <Sparkles className="w-3 h-3 text-[#0F5C53]" />
              <span>{language === 'yi' ? 'נאָרמאַל' : 'Standard'}</span>
            </button>
            <button
              type="button"
              onClick={() => setModelTier('fast')}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded ${
                modelTier === 'fast'
                  ? 'bg-white text-[#181A1F] font-medium shadow-xs'
                  : 'text-[#575B66]'
              }`}
              title="Fast responses (gemini-3.1-flash-lite)"
            >
              <Zap className="w-3 h-3 text-[#B45309]" />
              <span>{language === 'yi' ? 'שנעל' : 'Fast'}</span>
            </button>
          </div>

          {history.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setHistory([]);
                setErrorMsg('');
              }}
              className="p-1.5 text-[#575B66] hover:text-[#181A1F] rounded-md border border-transparent hover:border-[#E6E4DF]"
              title={language === 'yi' ? 'רייניקן שמועס' : 'Clear conversation'}
              aria-label="Clear conversation"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          {variant === 'drawer' && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#575B66] hover:text-[#181A1F] rounded-md"
              aria-label={language === 'yi' ? 'פאַרמאַכן' : 'Close assistant'}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Multi-Turn Conversation Thread */}
      <div className={threadHeightClass}>
        {history.length === 0 && (
          <div className="space-y-3">
            <p className="text-xs text-[#575B66] leading-relaxed">
              {language === 'yi'
                ? 'שלום! פרעגט וועגן אַפּליקאַציעס, פעלנדע דאָקומענטן, אָדער איסטערן טײַם סקעדזשולס.'
                : 'Ask multi-turn questions grounded in your authorized workspace records, intake checklists, and Eastern Time schedules.'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {starterList.map((promptText, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => sendMessage(promptText)}
                  className="text-left px-2.5 py-1.5 text-[11px] bg-[#FAF9F6] border border-[#E6E4DF] text-[#181A1F] rounded-lg hover:border-[#0F5C53] transition-colors"
                >
                  {promptText}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((m, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${
              m.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`max-w-[88%] px-3.5 py-2.5 rounded-lg text-xs leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-[#0F5C53] text-white'
                  : 'bg-[#F3F2EE] text-[#181A1F]'
              }`}
            >
              {m.text}
            </div>
            {m.role === 'model' && m.modelUsed && (
              <span className="mt-1 text-[10px] font-mono text-[#575B66] px-1">
                {m.modelUsed}
              </span>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-start">
            <div className="px-3.5 py-2.5 rounded-lg bg-[#F3F2EE] text-xs text-[#575B66]">
              {language === 'yi' ? 'טראַכט...' : 'Drafting response...'}
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-2.5 rounded-lg bg-[#FEF2F2] border border-[#B91C1C]/30 text-xs text-[#B91C1C]">
            {errorMsg}
          </div>
        )}

        <div ref={scrollEndRef} />
      </div>

      {/* Input Form */}
      <form
        onSubmit={handleSubmit}
        className={
          variant === 'drawer'
            ? 'p-3 border-t border-[#E6E4DF] bg-white flex gap-2'
            : 'pt-3 border-t border-[#E6E4DF] flex gap-2'
        }
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t.aiAssistantPlaceholder}
          className="flex-1 px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E6E4DF] rounded-lg focus:outline-none focus:border-[#0F5C53]"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-3.5 py-2 bg-[#0F5C53] text-white text-xs font-medium rounded-lg hover:bg-[#0B4740] disabled:opacity-50 inline-flex items-center justify-center shrink-0"
          aria-label={t.send}
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
