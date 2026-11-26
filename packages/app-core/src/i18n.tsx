import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { langFromLocale, LANGUAGES, setDisplayLanguage, translate, type Lang, type Vars } from '@amruta/shared';
import { Chips } from './ui/kit';
import { rpc } from './api';

/**
 * App language (English / Marathi / Hindi). Saved on this phone; the first time,
 * the phone's own language is used. Screens call `const t = useT()` and
 * `t('English text', { name })`. Without a provider (owner/staff apps for now)
 * everything stays English.
 */
const KEY = 'amruta-language';

interface LangApi { lang: Lang; setLang: (l: Lang) => void }
const LangContext = createContext<LangApi>({ lang: 'en', setLang: () => {} });

function deviceLang(): Lang {
  try { return langFromLocale(Intl.DateTimeFormat().resolvedOptions().locale); } catch { return 'en'; }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(deviceLang);
  useEffect(() => {
    void AsyncStorage.getItem(KEY).then((v) => { if (v === 'en' || v === 'mr' || v === 'hi') setLangState(v); }).catch(() => undefined);
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    void AsyncStorage.setItem(KEY, l).catch(() => undefined);
  }, []);
  setDisplayLanguage(lang);   // shared date/time helpers follow the same language
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLanguage(): LangApi {
  return useContext(LangContext);
}

/** t('English text', { placeholder: value }) in the chosen language. */
export function useT(): (text: string, vars?: Vars) => string {
  const { lang } = useContext(LangContext);
  return useCallback((text: string, vars?: Vars) => translate(text, vars, lang), [lang]);
}

/**
 * Inside the signed-in area: saves the chosen language with the account, so the
 * alerts the kitchen's system writes (delivered, bill ready…) come in it too.
 */
export function LanguageSync() {
  const { lang } = useLanguage();
  useEffect(() => { rpc('set_my_language', { p_lang: lang }).catch(() => undefined); }, [lang]);
  return null;
}

export function LanguagePicker() {
  const { lang, setLang } = useLanguage();
  return <Chips options={LANGUAGES} value={lang} onChange={setLang} label="भाषा / Language" />;
}
