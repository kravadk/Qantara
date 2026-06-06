import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import uk from '../locales/uk.json';

export const SUPPORTED_LANGS = ['en', 'uk'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

const LS_KEY = 'qantara-lang';

function detectInitialLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(LS_KEY);
  if (stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)) return stored as Lang;
  const browser = window.navigator.language?.slice(0, 2);
  return browser === 'uk' ? 'uk' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, uk: { translation: uk } },
  lng: detectInitialLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLang(lang: Lang) {
  void i18n.changeLanguage(lang);
  if (typeof window !== 'undefined') window.localStorage.setItem(LS_KEY, lang);
}

export function getLang(): Lang {
  return (i18n.language as Lang) ?? 'en';
}

export default i18n;
export { useTranslation } from 'react-i18next';
