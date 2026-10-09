import { describe, it, expect } from 'vitest';
import { DATASET } from './dataset';
import { TRIAGE_FOLDERS } from '../core/domain';

const count = (pred: (e: (typeof DATASET)[number]) => boolean) => DATASET.filter(pred).length;

describe('golden dataset', () => {
  it('has unique ids and a language on every entry', () => {
    const ids = DATASET.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of DATASET) {
      expect(['fr', 'en']).toContain(entry.lang);
    }
  });

  it('is mostly French, like the real mailbox (95% French, 5% English)', () => {
    const french = count((e) => e.lang === 'fr');
    const english = count((e) => e.lang === 'en');
    expect(french).toBeGreaterThanOrEqual(48);
    expect(french).toBeGreaterThan(english);
    expect(french + english).toBe(DATASET.length);
  });

  it('has at least 3 French entries for every folder', () => {
    for (const folder of TRIAGE_FOLDERS) {
      expect(
        count((e) => e.lang === 'fr' && e.expectedFolder === folder),
        folder,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('still covers every folder in English too', () => {
    for (const folder of TRIAGE_FOLDERS) {
      expect(
        count((e) => e.lang === 'en' && e.expectedFolder === folder),
        folder,
      ).toBeGreaterThan(0);
    }
  });

  it('includes French requests that are not phrased as questions', () => {
    const text = DATASET.filter((e) => e.lang === 'fr')
      .map((e) => `${e.subject}\n${e.body}`)
      .join('\n');
    expect(text).toMatch(/Merci de me confirmer/);
    expect(text).toMatch(/pourriez-vous/i);
  });

  it('only uses synthetic addresses', () => {
    for (const entry of DATASET) {
      expect(entry.from.address, entry.id).toMatch(/example/);
    }
  });

  it('French entries read as French (guards against a mislabelled language)', () => {
    // Cheap check: French text has an accented letter or one of these very common words.
    const frenchWords =
      /[àâäçéèêëîïôöûùüÿœ]|\b(vous|votre|nous|pour|des|les|une?|est|merci|bonjour|sur|avec|du|ci-joint|que|qui|dans)\b/i;
    for (const entry of DATASET) {
      const text = `${entry.subject} ${entry.body}`;
      if (entry.lang === 'fr') expect(text, entry.id).toMatch(frenchWords);
    }
  });
});
