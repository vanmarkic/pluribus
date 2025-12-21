/**
 * Awaiting Reply Integration Tests
 *
 * These tests make REAL calls to Ollama.
 * Requires: ollama running locally with qwen2.5:1.5b model pulled.
 *
 * Run with: npm test -- awaiting.integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { shouldTrackAwaiting } from './awaiting';
import { createOllamaTextGenerator } from '../../adapters/ollama';

const OLLAMA_URL = 'http://localhost:11434';
const MODEL = 'qwen2.5:1.5b';

// Create real Ollama generator
const llmGenerator = createOllamaTextGenerator(() => ({
  serverUrl: OLLAMA_URL,
  model: MODEL,
  timeoutMs: 30000,
}));

const checkAwaiting = shouldTrackAwaiting({ llm: llmGenerator });

// Check if Ollama is available
async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;

    const data = await response.json() as { models?: Array<{ name: string }> };
    const hasModel = data.models?.some(m => m.name.includes('qwen2.5:1.5b'));
    return hasModel ?? false;
  } catch {
    return false;
  }
}

// Helper that skips test if Ollama unavailable
async function requireOllama(): Promise<void> {
  const available = await isOllamaAvailable();
  if (!available) {
    console.log('⚠️  Ollama not available, skipping test');
    return Promise.reject(new Error('SKIP: Ollama not available'));
  }
}

describe('Awaiting Reply - Ollama Integration', () => {
  beforeAll(async () => {
    const available = await isOllamaAvailable();
    if (!available) {
      console.log('\n⚠️  Some tests will fail: Ollama not running or qwen2.5:1.5b not installed');
      console.log('   To run all tests:');
      console.log('   1. Start Ollama: ollama serve');
      console.log('   2. Pull model: ollama pull qwen2.5:1.5b\n');
    }
  });

  describe('Heuristic detection (no LLM needed)', () => {
    it('detects question marks', async () => {
      const result = await checkAwaiting('Can you send me the report?');
      expect(result).toBe(true);
    });

    it('detects French questions without ?', async () => {
      const result = await checkAwaiting('Pourriez-vous me confirmer la date de livraison.');
      expect(result).toBe(true);
    });

    it('detects English request patterns', async () => {
      const result = await checkAwaiting('Please let me know when you are available.');
      expect(result).toBe(true);
    });

    it('detects "looking forward" pattern', async () => {
      const result = await checkAwaiting('Looking forward to hearing from you soon.');
      expect(result).toBe(true);
    });

    it('returns false for short thank you messages', async () => {
      const result = await checkAwaiting('Thanks!');
      expect(result).toBe(false);
    });
  });

  describe('LLM classification (requires Ollama)', () => {
    // English emails expecting reply
    it('detects implicit request in English', async () => {
      const body = `Hi John,

I reviewed the proposal you sent last week. There are a few points I'd like to discuss before we proceed.

The budget section needs more detail, and I think the timeline is too aggressive.

Best,
Sarah`;

      const result = await checkAwaiting(body);
      expect(result).toBe(true);
    }, 35000);

    it('detects English email NOT expecting reply', async () => {
      const body = `Hi team,

Just a heads up that I'll be out of office tomorrow for a dentist appointment.

I've already handed off my tasks to Mike.

Thanks,
Alex`;

      const result = await checkAwaiting(body);
      expect(result).toBe(false);
    }, 35000);

    // French emails expecting reply
    it('detects implicit request in French', async () => {
      const body = `Bonjour Marie,

J'ai bien reçu votre devis pour le projet de rénovation.

Cependant, je souhaiterais avoir plus de détails sur les matériaux utilisés et les délais de livraison.

Cordialement,
Pierre`;

      const result = await checkAwaiting(body);
      expect(result).toBe(true);
    }, 35000);

    it('detects French email NOT expecting reply', async () => {
      const body = `Bonjour à tous,

Je vous informe que le serveur sera en maintenance ce soir de 22h à 2h.

Aucune action de votre part n'est requise.

Bonne journée,
L'équipe IT`;

      const result = await checkAwaiting(body);
      expect(result).toBe(false);
    }, 35000);

    // Edge cases
    it('handles mixed language email', async () => {
      const body = `Hi Pierre,

Thanks for the update on the Paris project.

Pouvez-vous m'envoyer le planning mis à jour?

Merci,
John`;

      const result = await checkAwaiting(body);
      expect(result).toBe(true);
    }, 35000);

    it('handles formal business request', async () => {
      const body = `Dear Mr. Thompson,

Following our conversation at the conference last week, I am writing to express our interest in exploring a potential partnership.

Our company specializes in sustainable packaging solutions, and we believe there could be significant synergies between our organizations.

I would be grateful for the opportunity to schedule a call at your earliest convenience.

Yours sincerely,
Emma Watson
Director of Business Development`;

      const result = await checkAwaiting(body);
      expect(result).toBe(true);
    }, 35000);

    it('handles automated notification (no reply needed)', async () => {
      const body = `This is an automated message. Please do not reply.

Your password was successfully changed on December 21, 2025 at 2:30 PM.

If you did not make this change, contact support immediately.

This email was sent automatically by the system.`;

      const result = await checkAwaiting(body);
      expect(result).toBe(false);
    }, 35000);
  });

  describe('Real sent emails from DB', () => {
    it('link sharing - no reply expected', async () => {
      const body = `L'AJD MARSEILLE – BEL ESPOIR
https://www.belespoir.com/l-ajd-marseille.html`;

      const result = await checkAwaiting(body);
      expect(result).toBe(false);
    }, 35000);

    it('proposing a call time (FR) - expects reply', async () => {
      const body = `Bonjour,

Oui, nous pouvons nous appeler quand vous le souhaitez, je suis libre ajd tout l'après midi à part entre 15h30 et 16h30.

Bien à vous,

Dragan Markovic
0486809823`;

      const result = await checkAwaiting(body);
      expect(result).toBe(true);
    }, 35000);

    it('just "test" - no reply expected', async () => {
      const body = `test`;

      const result = await checkAwaiting(body);
      expect(result).toBe(false);
    }, 35000);

    it('proposing meeting time (FR) - expects reply', async () => {
      const body = `rendez vous demain en ligne sur google meet 11:00`;

      const result = await checkAwaiting(body);
      expect(result).toBe(true);
    }, 35000);
  });
});
