import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, CheckCircle2, Globe, Lock, MessageSquare, ShieldCheck } from 'lucide-react';
import { getCopy } from '../i18n/translations';
import { submitPublicInquiry } from '../lib/aiClient';
import { formatEtNowClock } from '../lib/timeEt';
import type { Language } from '../types/binah';
import { GeminiChatbot } from './GeminiChatbot';

interface PublicWebsiteProps {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  onSignIn: () => void;
  signingIn: boolean;
  isAuthenticated: boolean;
  onEnterPortal: () => void;
}

const HERO_IMG = '/src/assets/images/hero_hasidic_male_pro_1794963239981.jpg';
const ABA_IMG = '/src/assets/images/service_male_therapist_aba_1794963240069.jpg';
const FAMILY_IMG = '/src/assets/images/community_family_male_coord_1794963240920.jpg';

const AnimatedIllustration: React.FC<{
  src: string;
  alt: string;
  variant: 'hero' | 'service' | 'community';
  className?: string;
}> = ({ src, alt, variant, className = '' }) => {
  const prefersReducedMotion = useReducedMotion();
  const [imgFailed, setImgFailed] = useState(false);

  const motionAnimate = prefersReducedMotion
    ? undefined
    : variant === 'hero'
      ? {
          scale: [1.02, 1.07, 1.02],
          x: [0, -8, 0],
          y: [0, -4, 0],
        }
      : variant === 'service'
        ? {
            scale: [1.01, 1.06, 1.01],
            x: [0, 7, 0],
            y: [0, -5, 0],
          }
        : {
            scale: [1.02, 1.065, 1.02],
            x: [0, -6, 0],
            y: [0, 4, 0],
          };

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-[#E6E4DF] bg-[#EAE7DF] ${className}`}
    >
      {imgFailed ? (
        <div className="w-full h-full min-h-[260px] flex flex-col items-center justify-center p-6 text-center bg-[#F3F2EE]">
          <p className="text-sm font-semibold text-[#181A1F]">BINAH CARE · New York</p>
          <p className="mt-1 text-xs text-[#575B66] max-w-xs">{alt}</p>
        </div>
      ) : (
        <motion.img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          initial={{ opacity: 0, scale: 1.01 }}
          animate={{ opacity: 1, ...motionAnimate }}
          transition={{
            opacity: { duration: 0.7, ease: 'easeOut' },
            scale: { duration: 15, repeat: Infinity, ease: 'easeInOut' },
            x: { duration: 15, repeat: Infinity, ease: 'easeInOut' },
            y: { duration: 15, repeat: Infinity, ease: 'easeInOut' },
          }}
          className="w-full h-full object-cover will-change-transform"
        />
      )}
    </div>
  );
};

export const PublicWebsite: React.FC<PublicWebsiteProps> = ({
  language,
  onLanguageChange,
  onSignIn,
  signingIn,
  isAuthenticated,
  onEnterPortal,
}) => {
  const t = getCopy(language);
  const isRtl = language === 'yi';

  const [parentName, setParentName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [childAge, setChildAge] = useState('');
  const [borough, setBorough] = useState('Monroe / Orange County, NY');
  const [preferredLanguage, setPreferredLanguage] = useState<Language>(language);
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [sendSignupEmailTrigger, setSendSignupEmailTrigger] = useState(true);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [inquiryDone, setInquiryDone] = useState(false);
  const [inquiryTriggerNote, setInquiryTriggerNote] = useState('');
  const [inquiryMailto, setInquiryMailto] = useState('');
  const [inquiryError, setInquiryError] = useState('');

  // Public AI Coordinator Drawer state
  const [aiOpen, setAiOpen] = useState(false);

  const PUBLIC_PARTNER_OPTIONS = [
    { id: '', name: '', email: '' },
    { id: 'el_heim', name: 'El Heim ABA Services', email: 'billing@elheimaba.org' },
    { id: 'hilf', name: 'Hilf Behavioral Health', email: 'ap@hilfcare.org' },
  ];

  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInquiryError('');
    setInquiryTriggerNote('');
    setInquiryMailto('');
    setSubmitting(true);
    const chosenPartner = PUBLIC_PARTNER_OPTIONS.find((p) => p.id === selectedPartnerId);
    try {
      const res = await submitPublicInquiry({
        parentName,
        email,
        phone,
        childAge,
        borough,
        preferredLanguage,
        contractCompanyId: chosenPartner?.id || undefined,
        contractCompanyName: chosenPartner?.name || undefined,
        partnerEmail: chosenPartner?.email || undefined,
        sendEmailTrigger: sendSignupEmailTrigger,
        message,
      });
      setInquiryDone(true);
      if (res.triggerResult) {
        setInquiryTriggerNote(res.triggerResult.emailMessage || res.triggerResult.message);
        if (res.triggerResult.emailStatus !== 'sent') {
          const to = res.triggerResult.recipientEmail || chosenPartner?.email || 'arledigt@gmail.com';
          const subj = res.triggerResult.subject || '[BINAH CARE New Client Signup]';
          const bodyText = res.triggerResult.textBody || `New family inquiry from ${borough}.`;
          setInquiryMailto(
            `mailto:${to}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(bodyText)}`
          );
        }
      }
      setParentName('');
      setEmail('');
      setPhone('');
      setChildAge('');
      setMessage('');
    } catch (err) {
      setInquiryError(err instanceof Error ? err.message : 'Unable to submit inquiry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="min-h-screen bg-[#FAF9F6] text-[#181A1F]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="border-b border-[#E6E4DF] bg-[#FAF9F6]/95 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-[1200px] mx-auto px-6 py-4 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Wordmark */}
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-[#181A1F] whitespace-nowrap shrink-0"
          >
            {t.brand}
          </a>

          {/* Zone 2: 4 Single-line Nav Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#575B66]">
            <a
              href="#services"
              className="hover:text-[#0F5C53] transition-colors whitespace-nowrap shrink-0"
            >
              {t.navServices}
            </a>
            <a
              href="#families"
              className="hover:text-[#0F5C53] transition-colors whitespace-nowrap shrink-0"
            >
              {t.navFamilies}
            </a>
            <a
              href="#compliance"
              className="hover:text-[#0F5C53] transition-colors whitespace-nowrap shrink-0"
            >
              {t.navCompliance}
            </a>
            <a
              href="#contact"
              className="hover:text-[#0F5C53] transition-colors whitespace-nowrap shrink-0"
            >
              {t.navContact}
            </a>
          </nav>

          {/* Zone 3: 1 Primary CTA */}
          <div className="shrink-0">
            {isAuthenticated ? (
              <button
                type="button"
                onClick={onEnterPortal}
                className="px-4 py-2 bg-[#0F5C53] text-white text-sm font-medium rounded-lg hover:bg-[#0B4740] transition-colors whitespace-nowrap shrink-0"
              >
                {t.openPortal}
              </button>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                disabled={signingIn}
                className="px-4 py-2 bg-[#0F5C53] text-white text-sm font-medium rounded-lg hover:bg-[#0B4740] transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {signingIn ? '...' : t.openPortal}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main id="top">
        <section className="max-w-[1200px] mx-auto px-6 pt-10 pb-14">
          {/* Hero Utility Bar: Language Switcher & Eastern Time */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-8 border-b border-[#E6E4DF]">
            <div className="flex items-center gap-3 text-xs text-[#575B66]">
              <span>{t.heroKicker}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{formatEtNowClock()}</span>
            </div>

            <div className="flex items-center gap-3">
              <div
                role="group"
                aria-label="Language switcher"
                className="inline-flex items-center p-1 bg-[#F3F2EE] border border-[#E6E4DF] rounded-lg"
              >
                <button
                  type="button"
                  onClick={() => onLanguageChange('en')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    language === 'en'
                      ? 'bg-white text-[#181A1F] shadow-xs'
                      : 'text-[#575B66] hover:text-[#181A1F]'
                  }`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => onLanguageChange('yi')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    language === 'yi'
                      ? 'bg-white text-[#181A1F] shadow-xs'
                      : 'text-[#575B66] hover:text-[#181A1F]'
                  }`}
                >
                  אידיש
                </button>
              </div>

              <button
                type="button"
                onClick={() => setAiOpen((v) => !v)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium border border-[#E6E4DF] bg-white text-[#181A1F] rounded-lg hover:border-[#0F5C53] transition-colors whitespace-nowrap shrink-0"
              >
                <MessageSquare className="w-3.5 h-3.5 text-[#0F5C53]" />
                <span>{language === 'yi' ? 'פרעגט AI' : 'Ask AI Coordinator'}</span>
              </button>
            </div>
          </div>

          {/* 2-Column Editorial Hero Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 pt-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-between py-2">
              <div>
                <h1
                  className="font-bold tracking-tight text-[#181A1F] leading-[1.12] max-w-xl"
                  style={{ fontSize: 'clamp(2.2rem, 3.8vw, 3.35rem)', textWrap: 'balance' }}
                >
                  {t.heroTitle}
                </h1>
                <p className="mt-6 text-base text-[#575B66] leading-relaxed max-w-xl">
                  {t.heroSubtitle}
                </p>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={isAuthenticated ? onEnterPortal : onSignIn}
                  disabled={signingIn}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#0F5C53] text-white text-sm font-medium rounded-lg hover:bg-[#0B4740] transition-colors whitespace-nowrap shrink-0"
                >
                  <span>{t.heroPrimaryCta}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <a
                  href="#contact"
                  className="inline-flex items-center gap-2 px-5 py-3 bg-white border border-[#E6E4DF] text-[#181A1F] text-sm font-medium rounded-lg hover:border-[#0F5C53] transition-colors whitespace-nowrap shrink-0"
                >
                  <span>{t.heroSecondaryCta}</span>
                </a>
              </div>
            </div>

            <div className="lg:col-span-6">
              <AnimatedIllustration
                src={HERO_IMG}
                variant="hero"
                alt="Hand-drawn animated illustration of a Hasidic father and young boy collaborating warmly at a wooden table with a secular male clinical ABA professional in New York"
                className="h-full min-h-[280px] lg:min-h-[380px]"
              />
            </div>
          </div>

          {/* 4-Column Operational Summary Strip */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-[#E6E4DF] bg-white rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-[#E6E4DF]">
            <div className="p-5">
              <p className="text-sm font-semibold text-[#181A1F]">{t.statIntake}</p>
              <p className="mt-1 text-xs text-[#575B66]">{t.statIntakeDesc}</p>
            </div>
            <div className="p-5">
              <p className="text-sm font-semibold text-[#181A1F]">{t.statTimezone}</p>
              <p className="mt-1 text-xs text-[#575B66]">{t.statTimezoneDesc}</p>
            </div>
            <div className="p-5">
              <p className="text-sm font-semibold text-[#181A1F]">{t.statBilling}</p>
              <p className="mt-1 text-xs text-[#575B66]">{t.statBillingDesc}</p>
            </div>
            <div className="p-5">
              <p className="text-sm font-semibold text-[#181A1F]">{t.statCompliance}</p>
              <p className="mt-1 text-xs text-[#575B66]">{t.statComplianceDesc}</p>
            </div>
          </div>
        </section>

        {/* Services Section */}
        <section id="services" className="border-t border-[#E6E4DF] bg-white py-16">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="max-w-2xl">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#181A1F]">
                {t.servicesTitle}
              </h2>
              <p className="mt-3 text-base text-[#575B66] leading-relaxed">{t.servicesLead}</p>
            </div>

            <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              <div className="lg:col-span-7 divide-y divide-[#E6E4DF] border-y border-[#E6E4DF]">
                <div className="py-6">
                  <h3 className="text-lg font-semibold text-[#181A1F]">{t.service1Title}</h3>
                  <p className="mt-2 text-sm text-[#575B66] leading-relaxed">{t.service1Desc}</p>
                </div>
                <div className="py-6">
                  <h3 className="text-lg font-semibold text-[#181A1F]">{t.service2Title}</h3>
                  <p className="mt-2 text-sm text-[#575B66] leading-relaxed">{t.service2Desc}</p>
                </div>
                <div className="py-6">
                  <h3 className="text-lg font-semibold text-[#181A1F]">{t.service3Title}</h3>
                  <p className="mt-2 text-sm text-[#575B66] leading-relaxed">{t.service3Desc}</p>
                </div>
              </div>

              <div className="lg:col-span-5 grid grid-cols-1 gap-6">
                <AnimatedIllustration
                  src={ABA_IMG}
                  variant="service"
                  alt="Hand-drawn animated illustration of a secular male behavioral therapist guiding a Hasidic boy with shape-sorting blocks while his Hasidic father watches warmly"
                  className="aspect-[4/3] bg-[#F3F2EE]"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Families & Compliance Split */}
        <section id="families" className="border-t border-[#E6E4DF] bg-[#FAF9F6] py-16">
          <div className="max-w-[1200px] mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-5">
              <AnimatedIllustration
                src={FAMILY_IMG}
                variant="community"
                alt="Hand-drawn animated illustration of a Hasidic father and boy greeting a secular male BINAH CARE coordinator outside a brick community clinic"
                className="h-full min-h-[260px]"
              />
            </div>

            <div className="lg:col-span-7 flex flex-col justify-between gap-8">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-[#181A1F]">
                  {t.familiesTitle}
                </h2>
                <p className="mt-3 text-sm sm:text-base text-[#575B66] leading-relaxed">
                  {t.familiesDesc}
                </p>
              </div>

              <div id="compliance" className="pt-8 border-t border-[#E6E4DF]">
                <div className="flex items-center gap-2.5 text-sm font-semibold text-[#0F5C53]">
                  <ShieldCheck className="w-4 h-4" />
                  <span>{t.complianceTitle}</span>
                </div>
                <p className="mt-2 text-sm text-[#575B66] leading-relaxed">{t.complianceDesc}</p>
                <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[#575B66]">
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-[#0F5C53]" />
                    <span>
                      {language === 'yi'
                        ? 'אייגענע קינדער רעקאָרדס בלויז'
                        : 'Parent-isolated child records'}
                    </span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-[#0F5C53]" />
                    <span>
                      {language === 'yi'
                        ? 'איסטערן טײַם (America/New_York)'
                        : 'America/New_York 12h AM/PM'}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Contact & Registration Inquiry Section */}
        <section id="contact" className="border-t border-[#E6E4DF] bg-white py-16">
          <div className="max-w-[900px] mx-auto px-6">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#181A1F]">
              {t.contactTitle}
            </h2>
            <p className="mt-2 text-sm sm:text-base text-[#575B66]">{t.contactSubtitle}</p>

            {inquiryDone ? (
              <div className="mt-8 p-6 bg-[#FAF9F6] border border-[#0F5C53]/30 rounded-xl flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#0F5C53] shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-[#181A1F]">{t.inquirySuccess}</p>
                  {inquiryTriggerNote && (
                    <p className="text-xs text-[#575B66]">{inquiryTriggerNote}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {inquiryMailto && (
                      <a
                        href={inquiryMailto}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0F5C53] text-white text-xs font-medium rounded-md hover:bg-[#0B4740]"
                      >
                        Open Signup Email Draft
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setInquiryDone(false)}
                      className="text-xs font-medium text-[#0F5C53] underline"
                    >
                      {language === 'yi' ? 'שיקן נאָך אַן אַנפֿראַגע' : 'Submit another inquiry'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <form
                onSubmit={handleInquirySubmit}
                className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-5 p-6 sm:p-8 bg-[#FAF9F6] border border-[#E6E4DF] rounded-xl"
              >
                <div>
                  <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
                    {t.parentNameLabel} *
                  </label>
                  <input
                    required
                    type="text"
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E6E4DF] rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
                    {t.emailLabel} *
                  </label>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E6E4DF] rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
                    {t.phoneLabel}
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(718) 555-0100"
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E6E4DF] rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
                    {t.childAgeLabel}
                  </label>
                  <input
                    type="text"
                    value={childAge}
                    onChange={(e) => setChildAge(e.target.value)}
                    placeholder="e.g. 4 years"
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E6E4DF] rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
                    {t.boroughLabel}
                  </label>
                  <select
                    value={borough}
                    onChange={(e) => setBorough(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E6E4DF] rounded-lg text-sm"
                  >
                    <option value="Monroe / Orange County, NY">Monroe / Orange County, NY</option>
                    <option value="Williamsburg, Brooklyn">Williamsburg, Brooklyn</option>
                    <option value="Borough Park, Brooklyn">Borough Park, Brooklyn</option>
                    <option value="Monsey, Rockland">Monsey, Rockland</option>
                    <option value="Bloomingburg / Sullivan, NY">Bloomingburg / Sullivan, NY</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
                    {t.preferredLangLabel}
                  </label>
                  <select
                    value={preferredLanguage}
                    onChange={(e) => setPreferredLanguage(e.target.value as Language)}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E6E4DF] rounded-lg text-sm"
                  >
                    <option value="en">English</option>
                    <option value="yi">אידיש (Yiddish)</option>
                  </select>
                </div>
                <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div>
                    <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
                      {language === 'yi' ? 'שותף פֿירמע (אָפּציאָנאַל)' : 'Partner Agency (Optional)'}
                    </label>
                    <select
                      value={selectedPartnerId}
                      onChange={(e) => setSelectedPartnerId(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-[#E6E4DF] rounded-lg text-sm"
                    >
                      <option value="">
                        {language === 'yi'
                          ? 'אויטאָמאַטיש צוטיילן דורך בינה קעיר'
                          : 'Auto-Assign via BINAH CARE Coordinator'}
                      </option>
                      <option value="el_heim">El Heim ABA Services</option>
                      <option value="hilf">Hilf Behavioral Health</option>
                    </select>
                  </div>
                  <label className="flex items-start gap-2.5 pt-4 text-xs text-[#181A1F] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sendSignupEmailTrigger}
                      onChange={(e) => setSendSignupEmailTrigger(e.target.checked)}
                      className="mt-0.5 rounded border-[#E6E4DF] text-[#0F5C53]"
                    />
                    <span>
                      {language === 'yi'
                        ? 'שיקן אימעיל טריגער גלייך צו דער שותף פֿירמע / קאָאָרדינאַטאָר בײַ רעגיסטראַציע'
                        : 'Send immediate email signup trigger to selected partner agency / coordinator'}
                    </span>
                  </label>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#181A1F] mb-1.5">
                    {t.messageLabel}
                  </label>
                  <textarea
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-[#E6E4DF] rounded-lg text-sm"
                  />
                </div>
                {inquiryError && (
                  <p className="sm:col-span-2 text-xs text-[#B91C1C] font-medium">{inquiryError}</p>
                )}
                <div className="sm:col-span-2 flex items-center justify-between gap-4 pt-2">
                  <span className="text-xs text-[#575B66]">
                    {language === 'yi'
                      ? 'HIPAA-באַשיצטע אינפֿאָרמאַציע איבערגעבונג'
                      : 'Protected intake submission · New York State'}
                  </span>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2.5 bg-[#0F5C53] text-white text-sm font-medium rounded-lg hover:bg-[#0B4740] transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    {submitting ? '...' : t.submitInquiry}
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-[#E6E4DF] bg-[#FAF9F6] py-8">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-wrap items-center justify-between gap-4 text-xs text-[#575B66]">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-[#181A1F]">BINAH CARE</span>
            <span aria-hidden="true">·</span>
            <span>New York · ABA Services Coordination</span>
          </div>
          <div className="flex items-center gap-4">
            <span>America/New_York (ET)</span>
            <span aria-hidden="true">·</span>
            <span>English &amp; אידיש</span>
          </div>
        </div>
      </footer>

      {/* Floating AI Assistant Toggle & Multi-Turn Gemini Drawer */}
      {!aiOpen ? (
        <button
          type="button"
          onClick={() => setAiOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 px-4 py-2.5 bg-[#0F5C53] text-white text-xs font-medium rounded-xl shadow-lg hover:bg-[#0B4740] transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
          <span>{language === 'yi' ? 'פרעגט AI' : 'Ask AI Coordinator'}</span>
        </button>
      ) : (
        <GeminiChatbot
          language={language}
          portalContext="public"
          variant="drawer"
          onClose={() => setAiOpen(false)}
        />
      )}
    </div>
  );
};
