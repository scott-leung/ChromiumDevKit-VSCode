/**
 * Language Utilities
 *
 * Provides language code to display name mapping for the translation overlay feature.
 */

/**
 * Map of language codes to their display names
 * Based on Chromium's supported languages
 */
const LANGUAGE_NAMES: Record<string, string> = {
  'af': 'Afrikaans',
  'am': 'አማርኛ (Amharic)',
  'ar': 'العربية (Arabic)',
  'ar-XB': 'العربية (Arabic - Pseudolocale)',
  'as': 'অসমীয়া (Assamese)',
  'az': 'Azərbaycan (Azerbaijani)',
  'be': 'Беларуская (Belarusian)',
  'bg': 'Български (Bulgarian)',
  'bn': 'বাংলা (Bengali)',
  'bs': 'Bosanski (Bosnian)',
  'ca': 'Català (Catalan)',
  'cs': 'Čeština (Czech)',
  'cy': 'Cymraeg (Welsh)',
  'da': 'Dansk (Danish)',
  'de': 'Deutsch (German)',
  'el': 'Ελληνικά (Greek)',
  'en': 'English',
  'en-GB': 'English (UK)',
  'en-US': 'English (US)',
  'en-XA': 'English (Pseudolocale)',
  'es': 'Español (Spanish)',
  'es-419': 'Español (Latinoamérica)',
  'et': 'Eesti (Estonian)',
  'eu': 'Euskara (Basque)',
  'fa': 'فارسی (Persian)',
  'fi': 'Suomi (Finnish)',
  'fil': 'Filipino',
  'fr': 'Français (French)',
  'fr-CA': 'Français (Canada)',
  'gl': 'Galego (Galician)',
  'gu': 'ગુજરાતી (Gujarati)',
  'he': 'עברית (Hebrew)',
  'hi': 'हिन्दी (Hindi)',
  'hr': 'Hrvatski (Croatian)',
  'hu': 'Magyar (Hungarian)',
  'hy': 'Հայերեն (Armenian)',
  'id': 'Bahasa Indonesia (Indonesian)',
  'is': 'Íslenska (Icelandic)',
  'it': 'Italiano (Italian)',
  'iw': 'עברית (Hebrew - iw code)',
  'ja': 'Japanese',
  'ka': 'ქართული (Georgian)',
  'kk': 'Қазақ (Kazakh)',
  'km': 'ខ្មែរ (Khmer)',
  'kn': 'ಕನ್ನಡ (Kannada)',
  'ko': '한국어 (Korean)',
  'ky': 'Кыргызча (Kyrgyz)',
  'lo': 'ລາວ (Lao)',
  'lt': 'Lietuvių (Lithuanian)',
  'lv': 'Latviešu (Latvian)',
  'mk': 'Македонски (Macedonian)',
  'ml': 'മലയാളം (Malayalam)',
  'mn': 'Монгол (Mongolian)',
  'mr': 'मराठी (Marathi)',
  'ms': 'Bahasa Melayu (Malay)',
  'my': 'မြန်မာ (Burmese)',
  'ne': 'नेपाली (Nepali)',
  'nl': 'Nederlands (Dutch)',
  'no': 'Norsk (Norwegian)',
  'or': 'ଓଡ଼ିଆ (Odia)',
  'pa': 'ਪੰਜਾਬੀ (Punjabi)',
  'pl': 'Polski (Polish)',
  'pt-BR': 'Português (Brasil)',
  'pt-PT': 'Português (Portugal)',
  'ro': 'Română (Romanian)',
  'ru': 'Русский (Russian)',
  'si': 'සිංහල (Sinhala)',
  'sk': 'Slovenčina (Slovak)',
  'sl': 'Slovenščina (Slovenian)',
  'sq': 'Shqip (Albanian)',
  'sr': 'Српски (Serbian)',
  'sr-Latn': 'Srpski (Serbian - Latin)',
  'sv': 'Svenska (Swedish)',
  'sw': 'Kiswahili (Swahili)',
  'ta': 'தமிழ் (Tamil)',
  'te': 'తెలుగు (Telugu)',
  'th': 'ไทย (Thai)',
  'tr': 'Türkçe (Turkish)',
  'uk': 'Українська (Ukrainian)',
  'ur': 'اردو (Urdu)',
  'uz': 'Oʻzbek (Uzbek)',
  'vi': 'Tiếng Việt (Vietnamese)',
  'zh-CN': 'Simplified Chinese',
  'zh-HK': 'Traditional Chinese (Hong Kong)',
  'zh-TW': 'Traditional Chinese (Taiwan)',
  'zu': 'IsiZulu (Zulu)',
};

/**
 * Get display name for a language code
 * @param langCode Language code (e.g., 'zh-CN', 'ja', 'en-US')
 * @returns Display name or the language code if not found
 */
export function getLanguageDisplayName(langCode: string): string {
  return LANGUAGE_NAMES[langCode] || langCode;
}

/**
 * Get all supported language codes
 * @returns Array of language codes
 */
export function getAllSupportedLanguages(): string[] {
  return Object.keys(LANGUAGE_NAMES);
}

/**
 * Get all language codes sorted alphabetically by display name
 * Prioritizes commonly used languages at the top
 * @param availableLanguages Array of available language codes from database
 * @returns Sorted array of language codes
 */
export function getSortedLanguages(availableLanguages: string[]): string[] {
  // Priority languages (shown first)
  const priorityLangs = ['zh-CN', 'en-US', 'ja', 'ko', 'fr', 'de', 'es'];

  // Split into priority and others
  const priority = availableLanguages.filter((lang) => priorityLangs.includes(lang));
  const others = availableLanguages.filter((lang) => !priorityLangs.includes(lang));

  // Sort priority by defined order
  const sortedPriority = priority.sort(
    (a, b) => priorityLangs.indexOf(a) - priorityLangs.indexOf(b)
  );

  // Sort others alphabetically by display name
  const sortedOthers = others.sort((a, b) => {
    const nameA = getLanguageDisplayName(a);
    const nameB = getLanguageDisplayName(b);
    return nameA.localeCompare(nameB);
  });

  return [...sortedPriority, ...sortedOthers];
}
