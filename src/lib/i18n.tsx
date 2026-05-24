import React, { createContext, useContext, useState, useEffect } from "react"

import en from "../locales/en.json"
import pl from "../locales/pl.json"

export type Language = "pl" | "en"

export const translations = {
  pl,
  en
} as const

type TranslationKeys = typeof pl

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: TranslationKeys
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("erp_lang")
      if (saved === "pl" || saved === "en") return saved
      return "pl"
    }
    return "pl"
  })

  useEffect(() => {
    localStorage.setItem("erp_lang", language)
    document.documentElement.lang = language
  }, [language])

  const value = {
    language,
    setLanguage,
    t: translations[language]
  }

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useTranslation() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error("useTranslation must be used within a LanguageProvider")
  }
  return context
}
