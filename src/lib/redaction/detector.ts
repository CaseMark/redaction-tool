/**
 * PII Detection Service - Two-pass detection combining regex and LLM
 * 
 * Pass 1: Regex patterns for standard structured data formats
 * Pass 2: LLM for contextual/non-standard representations that regex misses
 */

import { createCaseDevClient } from '../case-dev/client';
import { detectPIIWithRegex, getMaskFunction, EntityType, PatternMatch } from './patterns';

/**
 * Prompt for LLM to find contextual PII that regex patterns might miss.
 * This includes non-standard formats, obfuscated data, and contextually identifiable information.
 * 
 * AGGRESSIVE MODE: Better to flag something that might be PII than to miss actual PII.
 */
const CONTEXTUAL_PII_DETECTION_PROMPT = `You are an AGGRESSIVE PII detection expert. Your job is to find ALL potentially sensitive information, even if you're not 100% certain. It's better to flag something that might be PII than to miss actual sensitive data.

SCAN THOROUGHLY for PII that may be:
1. Written in non-standard formats (e.g., "SSN: one two three - four five - six seven eight nine")
2. Obfuscated or partially redacted but still identifiable
3. Contextually identifiable (e.g., "my social is the same as my phone but with dashes")
4. Split across multiple lines or sentences
5. Written with typos or OCR errors (e.g., "SS#: l23-45-6789" where 'l' is meant to be '1')
6. Embedded in natural language (e.g., "born on the fifteenth of January, nineteen eighty-five")
7. Using alternative separators or formats (e.g., "123.45.6789" for SSN, "4111 1111 1111 1111" for credit card)
8. Any sequence of 9 digits that could potentially be an SSN
9. Any sequence of 8-17 digits that could be an account number
10. Any 4-digit numbers that could be partial SSNs or PINs
11. Any dates that could be birth dates (even if just month/day or year)
12. Any numbers with dashes, spaces, or dots that look like identifiers
13. References to financial institutions followed by numbers
14. Any text that mentions "account", "number", "ID", "social", "SSN", "DOB", "born" near numbers

BE AGGRESSIVE: When in doubt, flag it. The user can always unselect false positives.

IMPORTANT: Only report NEW findings. The following items have already been detected by pattern matching and should NOT be included in your response:
{ALREADY_FOUND}

Return ONLY a valid JSON array with objects containing:
- type: One of SSN, ACCOUNT_NUMBER, CREDIT_CARD, NAME, ADDRESS, PHONE, EMAIL, DOB
- value: The exact text as it appears in the document
- normalizedValue: The standardized form (e.g., "123-45-6789" for an SSN written as words)
- startIndex: Character position where the value starts (estimate if needed)
- endIndex: Character position where the value ends (estimate if needed)
- context: Brief explanation of why this was flagged

Example response:
[
  {"type": "SSN", "value": "one two three - four five - six seven eight nine", "normalizedValue": "123-45-6789", "startIndex": 45, "endIndex": 93, "context": "SSN written as words"},
  {"type": "DOB", "value": "born January fifteenth, eighty-five", "normalizedValue": "01/15/1985", "startIndex": 120, "endIndex": 155, "context": "Date of birth in natural language"},
  {"type": "ACCOUNT_NUMBER", "value": "acct 12345678", "normalizedValue": "12345678", "startIndex": 200, "endIndex": 213, "context": "Account reference with number"}
]

If no additional PII found, return: []`;

/**
 * Prompt for LLM to detect unstructured PII like names and addresses
 * AGGRESSIVE MODE: Flag anything that could potentially be a name or address
 */
const UNSTRUCTURED_PII_PROMPT = `You are an AGGRESSIVE PII detection expert. Your job is to find ALL names and addresses, even if you're not 100% certain. It's better to flag something that might be PII than to miss actual sensitive data.

For NAMES, AGGRESSIVELY look for:
- Full names (first and last)
- First names only if they appear to identify a specific person
- Last names only if they appear to identify a specific person
- Names with titles (Mr., Mrs., Dr., Prof., etc.)
- Names in signatures or "Signed by" sections
- Names in "To:", "From:", "Attn:", "Re:", "CC:" fields
- Names mentioned in any context ("spoke with John", "per Sarah's request")
- Names in email-style formats (before @ symbols)
- Names that appear to be parties to a document
- Witness names, notary names, attorney names
- Any capitalized words that could be names
- Names in headers, footers, or letterheads
- Names in "Dear X" or "Sincerely, X" patterns

For ADDRESSES, AGGRESSIVELY look for:
- Street addresses with numbers
- Street names even without numbers
- City names
- State names or abbreviations
- ZIP codes (5 or 9 digit)
- City, State, ZIP combinations (partial or complete)
- PO Box addresses
- Suite, Apt, Unit numbers
- Building names
- International addresses
- Any location that could identify where someone lives or works

BE AGGRESSIVE: When in doubt, flag it. The user can always unselect false positives.

Return ONLY a valid JSON array with objects containing:
- type: Either "NAME" or "ADDRESS"
- value: The exact text as it appears
- startIndex: Character position where the value starts (estimate if needed)
- endIndex: Character position where the value ends (estimate if needed)
- confidence: Your confidence level (0.0 to 1.0)

Example: [{"type": "NAME", "value": "John Smith", "startIndex": 45, "endIndex": 55, "confidence": 0.95}, {"type": "NAME", "value": "Sarah", "startIndex": 100, "endIndex": 105, "confidence": 0.7}]
If no PII found, return: []`;

export interface EnhancedPatternMatch extends PatternMatch {
  normalizedValue?: string;
  context?: string;
}

/**
 * Pass 1: Detect PII using regex patterns for standard formats
 */
export function detectStructuredPII(text: string, types?: EntityType[]): PatternMatch[] {
  return detectPIIWithRegex(text, types);
}

/**
 * Pass 2: Use LLM to find contextual/non-standard PII that regex missed
 */
export async function detectContextualPII(
  text: string, 
  alreadyFound: PatternMatch[],
  types?: EntityType[]
): Promise<EnhancedPatternMatch[]> {
  try {
    const client = createCaseDevClient();
    
    // Format already found items for the prompt
    const alreadyFoundStr = alreadyFound.length > 0
      ? alreadyFound.map(m => `- ${m.type}: "${m.value}"`).join('\n')
      : 'None';
    
    // Filter to types that might have non-standard representations
    const contextualTypes = types?.filter(t => 
      ['SSN', 'ACCOUNT_NUMBER', 'CREDIT_CARD', 'PHONE', 'DOB'].includes(t)
    ) || ['SSN', 'ACCOUNT_NUMBER', 'CREDIT_CARD', 'PHONE', 'DOB'];
    
    if (contextualTypes.length === 0) {
      return [];
    }

    const prompt = CONTEXTUAL_PII_DETECTION_PROMPT
      .replace('{ALREADY_FOUND}', alreadyFoundStr);

    const response = await client.llm.chat({
      model: 'openai/gpt-4o',
      temperature: 0,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Find non-standard PII representations in this text. Focus on: ${contextualTypes.join(', ')}\n\nText:\n${text}` },
      ],
    });

    const content = response.choices[0]?.message?.content || '[]';
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const parsed = JSON.parse(cleaned);
      return parsed.map((e: { 
        type: EntityType; 
        value: string; 
        normalizedValue?: string;
        startIndex: number; 
        endIndex: number;
        context?: string;
      }) => ({
        type: e.type,
        value: e.value,
        normalizedValue: e.normalizedValue,
        startIndex: e.startIndex,
        endIndex: e.endIndex,
        confidence: 0.75, // Lower confidence for contextual matches
        context: e.context,
      }));
    } catch (parseError) {
      console.error('Failed to parse LLM contextual response:', parseError);
      return [];
    }
  } catch (error) {
    console.error('LLM contextual PII detection failed:', error);
    return [];
  }
}

/**
 * Detect unstructured PII (names, addresses) using LLM
 */
export async function detectUnstructuredPII(
  text: string, 
  types?: EntityType[]
): Promise<PatternMatch[]> {
  // Only run if names or addresses are requested
  const unstructuredTypes = types?.filter(t => ['NAME', 'ADDRESS'].includes(t)) || ['NAME', 'ADDRESS'];
  if (unstructuredTypes.length === 0) {
    return [];
  }

  try {
    const client = createCaseDevClient();

    const response = await client.llm.chat({
      model: 'openai/gpt-4o',
      temperature: 0,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: UNSTRUCTURED_PII_PROMPT },
        { role: 'user', content: `Find names and addresses in this text:\n\n${text}` },
      ],
    });

    const content = response.choices[0]?.message?.content || '[]';
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const parsed = JSON.parse(cleaned);
      return parsed
        .filter((e: { type: EntityType }) => unstructuredTypes.includes(e.type))
        .map((e: { 
          type: EntityType; 
          value: string; 
          startIndex: number; 
          endIndex: number;
          confidence?: number;
        }) => ({
          type: e.type,
          value: e.value,
          startIndex: e.startIndex,
          endIndex: e.endIndex,
          confidence: e.confidence || 0.85,
        }));
    } catch (parseError) {
      console.error('Failed to parse LLM unstructured response:', parseError);
      return [];
    }
  } catch (error) {
    console.error('LLM unstructured PII detection failed:', error);
    return [];
  }
}

/**
 * Main detection function - Two-pass approach
 * 
 * 1. First pass: Regex patterns for standard structured data
 * 2. Second pass: LLM for contextual/non-standard data AND unstructured data (names, addresses)
 */
export async function detectAllPII(text: string, types?: EntityType[]): Promise<EnhancedPatternMatch[]> {
  const allMatches: EnhancedPatternMatch[] = [];

  // ============================================
  // PASS 1: Regex detection for structured data
  // ============================================
  // Fast, high precision for standard formats like:
  // - SSN: 123-45-6789
  // - Credit Card: 4111111111111111
  // - Phone: (555) 123-4567
  // - Email: user@example.com
  const regexMatches = detectStructuredPII(text, types);
  allMatches.push(...regexMatches.map(m => ({ ...m, context: 'Standard format detected by pattern matching' })));
  
  console.log(`[Detector] Pass 1 (Regex): Found ${regexMatches.length} matches`);

  // ============================================
  // PASS 2: LLM detection for contextual data
  // ============================================
  // Finds non-standard representations that regex misses:
  // - "my social is one two three..."
  // - "SSN: 123.45.6789" (wrong separator)
  // - "born on January fifteenth"
  const contextualMatches = await detectContextualPII(text, regexMatches, types);
  allMatches.push(...contextualMatches);
  
  console.log(`[Detector] Pass 2a (LLM Contextual): Found ${contextualMatches.length} additional matches`);

  // ============================================
  // PASS 2b: LLM detection for unstructured data
  // ============================================
  // Names and addresses that can't be reliably detected with regex
  const unstructuredMatches = await detectUnstructuredPII(text, types);
  allMatches.push(...unstructuredMatches.map(m => ({ ...m, context: 'Detected by AI analysis' })));
  
  console.log(`[Detector] Pass 2b (LLM Unstructured): Found ${unstructuredMatches.length} matches`);

  // Merge and deduplicate results
  const merged = mergeResults(allMatches);
  console.log(`[Detector] Total unique matches after merge: ${merged.length}`);
  
  return merged;
}

/**
 * Merge results, removing duplicates and preferring higher confidence matches
 */
function mergeResults(matches: EnhancedPatternMatch[]): EnhancedPatternMatch[] {
  if (matches.length === 0) return [];
  
  // Sort by start position
  const sorted = [...matches].sort((a, b) => a.startIndex - b.startIndex);
  const result: EnhancedPatternMatch[] = [];

  for (const match of sorted) {
    // Check for overlapping matches
    const overlappingIndex = result.findIndex(
      (e) => (match.startIndex >= e.startIndex && match.startIndex < e.endIndex) ||
             (match.endIndex > e.startIndex && match.endIndex <= e.endIndex) ||
             (match.startIndex <= e.startIndex && match.endIndex >= e.endIndex)
    );
    
    if (overlappingIndex !== -1) {
      const existing = result[overlappingIndex];
      // Prefer higher confidence, or regex over LLM for same confidence
      if (match.confidence > existing.confidence) {
        result[overlappingIndex] = match;
      }
    } else {
      result.push(match);
    }
  }
  
  return result;
}

/**
 * Get the appropriate mask for an entity
 */
export function maskEntity(type: EntityType, value: string): string {
  return getMaskFunction(type)(value);
}

/**
 * Legacy function for backward compatibility
 */
export async function detectPIIWithLLM(text: string, types?: EntityType[]): Promise<PatternMatch[]> {
  const unstructured = await detectUnstructuredPII(text, types);
  const contextual = await detectContextualPII(text, [], types);
  return mergeResults([...unstructured, ...contextual]);
}
