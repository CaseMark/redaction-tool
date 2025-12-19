/**
 * PII Detection Patterns - Regex patterns for detecting sensitive information
 */

export type EntityType = 'SSN' | 'ACCOUNT_NUMBER' | 'CREDIT_CARD' | 'NAME' | 'ADDRESS' | 'PHONE' | 'EMAIL' | 'DOB' | 'CUSTOM';

export interface PatternMatch {
  type: EntityType;
  value: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
}

interface PIIPattern {
  type: EntityType;
  regex: RegExp;
  mask: (value: string) => string;
  confidence: number;
}

const PII_PATTERNS: PIIPattern[] = [
  {
    type: 'SSN',
    regex: /\b(?!000|666|9\d{2})([0-8]\d{2}|7([0-6]\d|7[012]))([-\s]?)(?!00)\d{2}\3(?!0000)\d{4}\b/g,
    mask: (v) => `***-**-${v.replace(/\D/g, '').slice(-4)}`,
    confidence: 0.95,
  },
  {
    type: 'CREDIT_CARD',
    regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    mask: (v) => `****-****-****-${v.replace(/\D/g, '').slice(-4)}`,
    confidence: 0.95,
  },
  {
    type: 'ACCOUNT_NUMBER',
    regex: /\b(?:account\s*(?:number|#|no\.?)?:?\s*)?([0-9]{8,17})\b/gi,
    mask: (v) => `****${v.replace(/\D/g, '').slice(-4)}`,
    confidence: 0.8,
  },
  {
    type: 'PHONE',
    regex: /\b(?:\+?1[-.\s]?)?(?:\(?[2-9][0-9]{2}\)?[-.\s]?)?[2-9][0-9]{2}[-.\s]?[0-9]{4}\b/g,
    mask: (v) => `(***) ***-${v.replace(/\D/g, '').slice(-4)}`,
    confidence: 0.85,
  },
  {
    type: 'EMAIL',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    mask: (v) => `${v.charAt(0)}***@${v.split('@')[1]}`,
    confidence: 0.95,
  },
  {
    type: 'DOB',
    regex: /\b(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12][0-9]|3[01])[-/](?:19|20)\d{2}\b/g,
    mask: () => '**/**/****',
    confidence: 0.7,
  },
];

export function detectPIIWithRegex(text: string, types?: EntityType[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  const patterns = types ? PII_PATTERNS.filter((p) => types.includes(p.type)) : PII_PATTERNS;

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      matches.push({
        type: pattern.type,
        value: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        confidence: pattern.confidence,
      });
    }
  }

  return deduplicateMatches(matches);
}

function deduplicateMatches(matches: PatternMatch[]): PatternMatch[] {
  if (matches.length === 0) return [];
  const sorted = [...matches].sort((a, b) => a.startIndex - b.startIndex);
  const result: PatternMatch[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = result[result.length - 1];
    if (current.startIndex < last.endIndex) {
      if (current.confidence > last.confidence) result[result.length - 1] = current;
    } else {
      result.push(current);
    }
  }
  return result;
}

export function getMaskFunction(type: EntityType): (value: string) => string {
  const pattern = PII_PATTERNS.find((p) => p.type === type);
  return pattern?.mask || ((v) => '*'.repeat(v.length));
}

export const REDACTION_PRESETS = {
  'ssn-financial': {
    label: 'SSNs and Financial Account Numbers',
    description: 'Redact Social Security Numbers, bank accounts, and credit cards',
    types: ['SSN', 'ACCOUNT_NUMBER', 'CREDIT_CARD'] as EntityType[],
  },
  'all-pii': {
    label: 'All Personal Information',
    description: 'Redact all detectable PII including names, addresses, and contact info',
    types: ['SSN', 'ACCOUNT_NUMBER', 'CREDIT_CARD', 'NAME', 'ADDRESS', 'PHONE', 'EMAIL', 'DOB'] as EntityType[],
  },
  'contact-info': {
    label: 'Contact Information Only',
    description: 'Redact phone numbers and email addresses',
    types: ['PHONE', 'EMAIL'] as EntityType[],
  },
  'financial-only': {
    label: 'Financial Information Only',
    description: 'Redact bank accounts and credit card numbers',
    types: ['ACCOUNT_NUMBER', 'CREDIT_CARD'] as EntityType[],
  },
};

export type RedactionPresetKey = keyof typeof REDACTION_PRESETS;
