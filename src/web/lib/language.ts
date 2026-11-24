// Language of the interface. English is the default; a browser set to Chinese
// starts in Chinese. The choice is stored in localStorage ('oi.language').
//
// Kept in a plain .ts module with no DOM or JSX references, so non-React code
// like lib/format.ts — which the test project also imports, with a no-DOM lib —
// can read the current language without importing the .tsx i18n module (that
// breaks projects without '--jsx'). The <html lang> side effect lives in
// i18n.tsx, which is web-only.

export type Language = 'en' | 'zh';

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

const KEY = 'oi.language';

// Guarded storage access: no localStorage in the test/worker runtimes.
const storage = (globalThis as unknown as { localStorage?: Storage }).localStorage;

function readStored(): Language | null {
  try {
    const raw = storage?.getItem(KEY);
    if (raw == null) return null;
    const v: unknown = JSON.parse(raw);
    return v === 'zh' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

function writeStored(lang: Language): void {
  try {
    storage?.setItem(KEY, JSON.stringify(lang));
  } catch {
    // private mode or storage full: not critical
  }
}

function defaultLanguage(): Language {
  const navLang = (globalThis as unknown as { navigator?: { language?: string } }).navigator?.language;
  if (navLang?.toLowerCase().startsWith('zh')) return 'zh';
  return 'en';
}

let current: Language = readStored() ?? defaultLanguage();
const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}

export function getLanguage(): Language {
  return current;
}

export function subscribeLanguage(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function setLanguage(lang: Language): void {
  if (lang === current) return;
  current = lang;
  writeStored(lang);
  emit();
}
