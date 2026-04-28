/**
 * Prompt-injection detector (#102).
 *
 * Baseline defence layered on top of the XML delimiting and "treat content as
 * untrusted" rule already in the system prompt. The detector is deliberately
 * conservative — it flags rather than rejects, because false positives on
 * legitimate emails ("please ignore my previous email") are worse than
 * occasional misses.
 */

export type InjectionFinding = {
  matched: string;
  category: 'instruction_override' | 'role_reassignment' | 'system_prompt_exfil' | 'confidence_forcing' | 'encoded_payload';
  severity: 'low' | 'medium' | 'high';
};

// Case-insensitive patterns. Tuned on OWASP LLM01 sample payloads.
// Narrower phrases = fewer false positives.
const PATTERNS: Array<{
  re: RegExp;
  category: InjectionFinding['category'];
  severity: InjectionFinding['severity'];
}> = [
  { re: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?|rules?|messages)/i,
    category: 'instruction_override', severity: 'high' },
  { re: /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?)/i,
    category: 'instruction_override', severity: 'high' },
  { re: /you\s+are\s+now\s+a\s+/i,
    category: 'role_reassignment', severity: 'high' },
  { re: /act\s+as\s+(if\s+you\s+are\s+)?(an?|the)\s+\w+/i,
    category: 'role_reassignment', severity: 'medium' },
  { re: /(reveal|print|show|dump|leak|repeat)\s+(your\s+)?(system\s+)?(prompt|instructions|rules)/i,
    category: 'system_prompt_exfil', severity: 'high' },
  { re: /(classify|categorise|categorize|sort)\s+(this|me|it)\s+as\s+\w+.*confidence\s*[=:]?\s*1(\.0+)?/i,
    category: 'confidence_forcing', severity: 'high' },
  { re: /confidence\s*[:=]\s*1(\.0+)?\b/i,
    category: 'confidence_forcing', severity: 'medium' },
  // A very long unbroken base64-looking blob is a common obfuscation vector.
  { re: /[A-Za-z0-9+/]{400,}={0,2}/,
    category: 'encoded_payload', severity: 'low' },
];

/**
 * Scan an email body (and subject) for prompt-injection patterns. Returns
 * all findings; callers decide whether any single finding warrants action.
 */
export function detectPromptInjection(subject: string, body: string): InjectionFinding[] {
  const haystack = `${subject}\n${body}`;
  const findings: InjectionFinding[] = [];
  for (const pattern of PATTERNS) {
    const match = haystack.match(pattern.re);
    if (match) {
      findings.push({
        matched: match[0].slice(0, 120),
        category: pattern.category,
        severity: pattern.severity,
      });
    }
  }
  return findings;
}

/**
 * True if we should block the classification from being cached and/or
 * auto-applied. Threshold: any finding with severity 'high' OR two+ findings
 * of any severity.
 */
export function shouldQuarantine(findings: InjectionFinding[]): boolean {
  if (findings.some(f => f.severity === 'high')) return true;
  return findings.length >= 2;
}
