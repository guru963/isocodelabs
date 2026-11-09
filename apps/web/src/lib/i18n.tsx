import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Stage } from "./types";

export type Language = "ta" | "en";

/** Screens supervisors use. Tamil wording is an assumption, to be checked with a native speaker. */
const STRINGS = {
  signIn: { en: "Sign in", ta: "உள்நுழைக" },
  signInStory: {
    en: "See which order is running late while there is still time to catch up.",
    ta: "எந்த ஆர்டர் தாமதமாகிறது என்பதை, சரிசெய்ய நேரம் இருக்கும்போதே பாருங்கள்.",
  },
  signInPhotoAlt: {
    en: "A worker's hands guide peacock-blue fabric under a sewing needle, with cones of thread behind.",
    ta: "நூல் கோன்கள் பின்னால் இருக்க, தொழிலாளரின் கைகள் மயில்நீல துணியை தையல் ஊசியின் கீழ் நகர்த்துகின்றன.",
  },
  signingIn: { en: "Signing in…", ta: "உள்நுழைகிறது…" },
  email: { en: "Email", ta: "மின்னஞ்சல்" },
  password: { en: "Password", ta: "கடவுச்சொல்" },
  signOut: { en: "Sign out", ta: "வெளியேறு" },
  signOutAnyway: { en: "Sign out anyway", ta: "பரவாயில்லை, வெளியேறு" },
  keepSignedIn: { en: "Stay signed in", ta: "உள்ளேயே இரு" },
  signOutWarning: {
    en: "Updates that have not been sent stay on this phone until you sign in again.",
    ta: "அனுப்பப்படாத பதிவுகள் மீண்டும் உள்நுழையும் வரை இந்த போனில் இருக்கும்.",
  },
  offlineSignIn: {
    en: "No network. Connect to sign in.",
    ta: "இணையம் இல்லை. உள்நுழைய இணையத்தை இணைக்கவும்.",
  },
  todaysWork: { en: "Today's work", ta: "இன்றைய வேலை" },
  reportedToday: { en: "reported today", ta: "இன்று பதிவு செய்யப்பட்டது" },
  dueToday: { en: "Due today", ta: "இன்று கடைசி நாள்" },
  dueTomorrow: { en: "Due tomorrow", ta: "நாளை கடைசி நாள்" },
  daysLeft: { en: "days left", ta: "நாட்கள் உள்ளன" },
  daysLate: { en: "days late", ta: "நாட்கள் தாமதம்" },
  reminder: { en: "Reminder", ta: "நினைவூட்டல்" },
  gotIt: { en: "OK", ta: "சரி" },
  syncAllSent: { en: "All sent", ta: "எல்லாம் அனுப்பப்பட்டது" },
  syncOffline: { en: "No network", ta: "இணையம் இல்லை" },
  syncSaved: { en: "saved on phone", ta: "போனில் சேமிப்பு" },
  stagesOpen: { en: "stages to report", ta: "பதிவு செய்ய வேண்டிய வேலைகள்" },
  oneStageOpen: { en: "stage to report", ta: "பதிவு செய்ய வேண்டிய வேலை" },
  noWork: { en: "No open stages at your unit.", ta: "உங்கள் யூனிட்டில் வேலை எதுவும் இல்லை." },
  offline: { en: "No network. You can keep working.", ta: "இணையம் இல்லை. நீங்கள் தொடர்ந்து பதிவு செய்யலாம்." },
  savedCopy: { en: "Showing the last saved list.", ta: "கடைசியாக சேமித்த பட்டியல்." },
  loadFailed: {
    en: "Could not load your work. Connect to the network and try again.",
    ta: "வேலைப் பட்டியல் கிடைக்கவில்லை. இணையத்தை இணைத்து மீண்டும் முயலவும்.",
  },
  tryAgain: { en: "Try again", ta: "மீண்டும் முயல்க" },
  done: { en: "Done", ta: "முடிந்தது" },
  of: { en: "of", ta: "/" },
  piecesLeft: { en: "left", ta: "மீதம்" },
  due: { en: "Due", ta: "கடைசி நாள்" },
  todayCount: { en: "Pieces made today", ta: "இன்று முடித்த பீஸ்" },
  enterToday: { en: "Enter today's count", ta: "இன்றைய எண்ணிக்கை பதிவு" },
  changeToday: { en: "Change today's count", ta: "இன்றைய எண்ணிக்கை மாற்று" },
  entered: { en: "Today", ta: "இன்று" },
  maxHint: { en: "Up to", ta: "அதிகபட்சம்" },
  tooMany: { en: "That is more than the pieces left. The most you can enter is", ta: "மீதமுள்ள பீஸை விட அதிகம். அதிகபட்சம்" },
  enterNumber: { en: "Enter a whole number.", ta: "முழு எண்ணை உள்ளிடவும்." },
  missedDay: { en: "Missed", ta: "விடுபட்டது" },
  missedDayCount: { en: "Pieces made on", ta: "முடித்த பீஸ் —" },
  missedDayHint: {
    en: "Not entered that day. Leave empty if you don't know.",
    ta: "அன்று பதிவாகவில்லை. தெரியாவிட்டால் காலியாக விடுங்கள்.",
  },
  missedDayWarning: { en: "No count for", ta: "எண்ணிக்கை இல்லை:" },
  missedDayButton: { en: "Add missed and today's count", ta: "விடுபட்டதையும் பதிவு செய்" },
  noteLabel: { en: "Any problem? (optional)", ta: "ஏதாவது பிரச்சனை? (விருப்பம்)" },
  notePlaceholder: { en: "Write in Tamil or English", ta: "தமிழ் அல்லது ஆங்கிலத்தில் எழுதுங்கள்" },
  addPhoto: { en: "Add photo", ta: "படம் சேர்" },
  changePhoto: { en: "Change photo", ta: "படம் மாற்று" },
  removePhoto: { en: "Remove photo", ta: "படம் நீக்கு" },
  photoFailed: { en: "Could not read this photo. Try another.", ta: "இந்த படத்தை படிக்க முடியவில்லை. வேறு படம் முயலவும்." },
  recordVoice: { en: "Record voice note", ta: "குரல் பதிவு" },
  stopRecording: { en: "Stop recording", ta: "பதிவை நிறுத்து" },
  recording: { en: "Recording…", ta: "பதிவாகிறது…" },
  voiceAdded: { en: "Voice note added", ta: "குரல் பதிவு சேர்க்கப்பட்டது" },
  removeVoice: { en: "Remove voice note", ta: "குரல் பதிவை நீக்கு" },
  micDenied: { en: "Microphone is not allowed. Type your note instead.", ta: "மைக் அனுமதி இல்லை. குறிப்பை எழுதுங்கள்." },
  send: { en: "Send", ta: "அனுப்பு" },
  cancel: { en: "Cancel", ta: "ரத்து" },
  allSent: { en: "All updates sent", ta: "எல்லா பதிவுகளும் அனுப்பப்பட்டன" },
  waitingToSend: { en: "waiting to send", ta: "அனுப்ப காத்திருக்கிறது" },
  willSendLater: {
    en: "Saved on this phone. It will send when the network returns.",
    ta: "இந்த போனில் சேமிக்கப்பட்டது. இணையம் வந்ததும் தானாக அனுப்பப்படும்.",
  },
  sendNow: { en: "Send now", ta: "இப்போது அனுப்பு" },
  sending: { en: "Sending…", ta: "அனுப்புகிறது…" },
  needsAttention: { en: "Needs your attention", ta: "கவனிக்க வேண்டியவை" },
  fixAndResend: { en: "Change count", ta: "எண்ணிக்கை மாற்று" },
  discard: { en: "Discard", ta: "நீக்கு" },
  confirmDiscard: { en: "Yes, discard", ta: "ஆம், நீக்கு" },
  keep: { en: "Keep", ta: "வைத்திரு" },
  sent: { en: "sent", ta: "அனுப்பப்பட்டது" },
  rejectOver: { en: "This is more than the pieces left on this stage.", ta: "இந்த நிலையில் மீதமுள்ள பீஸை விட அதிகம்." },
  rejectUnit: { en: "This stage now belongs to another unit.", ta: "இந்த வேலை இப்போது வேறு யூனிட்டில் உள்ளது." },
  rejectDate: { en: "The date on this update is not valid.", ta: "இந்த பதிவின் தேதி சரியில்லை." },
  rejectOld: { en: "This update is too old to add.", ta: "இந்த பதிவு மிகவும் பழையது." },
  rejectLate: {
    en: "Only the last working day's count can be added late.",
    ta: "கடைசி வேலை நாளின் எண்ணிக்கையை மட்டுமே தாமதமாக சேர்க்க முடியும்.",
  },
  rejectGone: { en: "This stage can no longer be updated.", ta: "இந்த வேலையை இனி பதிவு செய்ய முடியாது." },
  rejectFile: { en: "The photo or voice note could not be accepted.", ta: "படம் அல்லது குரல் பதிவை ஏற்க முடியவில்லை." },
} as const;

export type StringKey = keyof typeof STRINGS;

const STAGE_TAMIL: Record<Stage, string> = {
  CUTTING: "கட்டிங்",
  PRINTING: "பிரிண்டிங்",
  WASHING: "வாஷிங்",
  STITCHING: "தையல்",
  FINISHING: "ஃபினிஷிங்",
  INSPECTION: "ஆய்வு",
  EX_FACTORY: "அனுப்புதல்",
};

const STAGE_ENGLISH: Record<Stage, string> = {
  CUTTING: "Cutting",
  PRINTING: "Printing",
  WASHING: "Washing",
  STITCHING: "Stitching",
  FINISHING: "Finishing",
  INSPECTION: "Inspection",
  EX_FACTORY: "Ex-factory",
};

const STORAGE_KEY = "tna.language";

function savedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "ta" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

interface LanguageContextValue {
  language: Language;
  setLanguage(language: Language): void;
  /** Used once the user is known: their profile language applies unless they chose otherwise here. */
  applyProfileLanguage(language: string): void;
  t(key: StringKey): string;
  stage(stage: Stage): string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setState] = useState<Language>(() => savedLanguage() ?? "en");

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice simply will not be remembered.
    }
  }, []);

  const applyProfileLanguage = useCallback((profile: string) => {
    if (!savedLanguage()) setState(profile === "ta" ? "ta" : "en");
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      applyProfileLanguage,
      t: (key) => STRINGS[key][language],
      stage: (stage) => (language === "ta" ? STAGE_TAMIL : STAGE_ENGLISH)[stage],
    }),
    [language, setLanguage, applyProfileLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
}

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  const next: Language = language === "ta" ? "en" : "ta";
  return (
    <button type="button" className="linklike" lang={next} onClick={() => setLanguage(next)}>
      {next === "ta" ? "தமிழ்" : "English"}
    </button>
  );
}
