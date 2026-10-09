import { describe, it, expect } from 'vitest';
import { system1Text, SYSTEM1_BODY_CHARS } from './text';
import { readSystem1Settings } from './settings';
import { DEFAULT_SYSTEM1_SETTINGS } from '../domain';

const email = {
  subject: '  Devis   pour la rénovation ',
  from: { address: 'Marie.Dupont@Atelier-Bois.be', name: 'Marie  Dupont' },
};

describe('system1Text', () => {
  it('uses sender name, lowercased domain and collapsed subject', () => {
    expect(system1Text(email)).toBe(
      'From: Marie Dupont <atelier-bois.be>\nSubject: Devis pour la rénovation',
    );
  });

  it('never includes the full sender address', () => {
    expect(system1Text(email)).not.toContain('marie.dupont@');
  });

  it('appends a collapsed body excerpt capped at SYSTEM1_BODY_CHARS', () => {
    const body = 'Bonjour,\n\n  pourriez-vous me confirmer ' + 'x'.repeat(2000);
    const text = system1Text(email, body);
    const excerpt = text.split('\n\n')[1] ?? '';
    expect(excerpt.startsWith('Bonjour, pourriez-vous me confirmer')).toBe(true);
    expect(excerpt.length).toBe(SYSTEM1_BODY_CHARS);
  });

  it('is identical with no preview and with an empty preview', () => {
    expect(system1Text(email, '')).toBe(system1Text(email));
    expect(system1Text(email, '   \n ')).toBe(system1Text(email));
  });

  it('handles a sender without a name', () => {
    const text = system1Text({ subject: 'Hi', from: { address: 'a@b.com', name: null } });
    expect(text).toBe('From: <b.com>\nSubject: Hi');
  });
});

describe('readSystem1Settings', () => {
  it('falls back to defaults when the port has no getter', () => {
    expect(readSystem1Settings({})).toEqual(DEFAULT_SYSTEM1_SETTINGS);
  });

  it('fills missing fields from defaults', () => {
    const partial = { enabled: false } as ReturnType<
      NonNullable<Parameters<typeof readSystem1Settings>[0]['getSystem1Settings']>
    >;
    expect(readSystem1Settings({ getSystem1Settings: () => partial })).toEqual({
      ...DEFAULT_SYSTEM1_SETTINGS,
      enabled: false,
    });
  });
});
