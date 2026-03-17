import { bg } from './bg.js';
import { en } from './en.js';

type Language = 'en' | 'bg';

const TRANSLATIONS: Record<Language, Record<string, string>> = {
    en,
    bg,
};

let currentLanguage: Language = 'bg';

export function setLanguage(language: Language): void {
    currentLanguage = language;
}

export function getLanguage(): Language {
    return currentLanguage;
}

export function t(key: string): string {
    return TRANSLATIONS[currentLanguage][key] ?? key;
}
