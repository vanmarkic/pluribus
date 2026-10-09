/**
 * The user's system language, for the digest (French or English).
 *
 * `app.getLocale()` can be misleading on macOS: it reports the language the app
 * bundle was matched against, which for an app without localized resources is
 * often 'en-US' whatever the user's system language. The user's preferred
 * languages list is the reliable source, so it goes first.
 *
 * Electron is injected so this runs under vitest.
 */

export type LocaleSource = {
  getPreferredSystemLanguages?: () => string[];
  getLocale?: () => string;
};

/** First preferred system language, else the app locale, else 'en'. Never throws. */
export function pickSystemLocale(source: LocaleSource): string {
  try {
    const preferred = source.getPreferredSystemLanguages?.() ?? [];
    const first = preferred.find((tag) => typeof tag === 'string' && tag.trim() !== '');
    if (first) return first;
  } catch {
    // fall through to the app locale
  }
  try {
    const locale = source.getLocale?.();
    if (typeof locale === 'string' && locale.trim() !== '') return locale;
  } catch {
    // fall through to the default
  }
  return 'en';
}
