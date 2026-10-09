import { describe, it, expect } from 'vitest';
import { pickSystemLocale } from './system-locale';
import { resolveDigestLocale } from '../core/digest-i18n';

describe('pickSystemLocale', () => {
  it('prefers the first preferred system language', () => {
    expect(
      pickSystemLocale({
        getPreferredSystemLanguages: () => ['fr-BE', 'en-US'],
        getLocale: () => 'en-US',
      }),
    ).toBe('fr-BE');
  });

  it('is not fooled by an app locale that disagrees with the system language', () => {
    // macOS often reports 'en-US' for the app bundle even for a French user.
    const tag = pickSystemLocale({
      getPreferredSystemLanguages: () => ['fr-FR'],
      getLocale: () => 'en-US',
    });
    expect(resolveDigestLocale(tag)).toBe('fr');
  });

  it('falls back to the app locale when there is no preferred language', () => {
    expect(pickSystemLocale({ getPreferredSystemLanguages: () => [], getLocale: () => 'fr' })).toBe(
      'fr',
    );
    expect(pickSystemLocale({ getLocale: () => 'de-DE' })).toBe('de-DE');
  });

  it('skips blank entries', () => {
    expect(pickSystemLocale({ getPreferredSystemLanguages: () => ['', '  ', 'fr-CH'] })).toBe(
      'fr-CH',
    );
  });

  it('falls back to the app locale when reading the preferred languages throws', () => {
    expect(
      pickSystemLocale({
        getPreferredSystemLanguages: () => {
          throw new Error('not available');
        },
        getLocale: () => 'fr',
      }),
    ).toBe('fr');
  });

  it('never throws and defaults to English', () => {
    expect(pickSystemLocale({})).toBe('en');
    expect(
      pickSystemLocale({
        getPreferredSystemLanguages: () => {
          throw new Error('x');
        },
        getLocale: () => {
          throw new Error('y');
        },
      }),
    ).toBe('en');
  });
});
