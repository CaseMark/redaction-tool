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
 * RETROSPECTIVE AWARENESS: Look for PII where the label comes AFTER the data.
 */
const CONTEXTUAL_PII_DETECTION_PROMPT = `You are an AGGRESSIVE PII detection expert with RETROSPECTIVE AWARENESS. Your job is to find ALL potentially sensitive information, even if you're not 100% certain. It's better to flag something that might be PII than to miss actual sensitive data.

CRITICAL: Look for PII in BOTH directions:
- FORWARD patterns: "My SSN is 123-45-6789" (label before data)
- BACKWARD/RETROSPECTIVE patterns: "five one two three four five six seven eight nine is my social" (data before label)

SCAN THOROUGHLY for PII that may be:

**RETROSPECTIVE PATTERNS (data comes BEFORE the label):**
1. "five one two three are the numbers of my social" - numbers written as words, then identified as SSN
2. "123-45-6789 is my social security number" - data first, then label
3. "four one one one one one one one one one one one one one one one is my card number" - credit card as words
4. "January 15, 1985 is when I was born" - date before DOB label
5. "555-123-4567 is my phone" or "that's my number" - phone before label
6. "12345678 is my account" or "those are my account digits" - account number before label
7. Any sequence of numbers/words followed by "is my", "are my", "that's my", "those are my"
8. Numbers followed by references to "social", "SSN", "account", "card", "phone", "birthday", "DOB"

**FORWARD PATTERNS (label comes BEFORE the data):**
9. "SSN: one two three - four five - six seven eight nine" - SSN as words
10. "my social is the same as my phone but with dashes" - indirect references
11. "born on the fifteenth of January, nineteen eighty-five" - dates in natural language
12. "account number is one two three four five six seven eight" - account as words

**OTHER PATTERNS:**
13. Obfuscated or partially redacted but still identifiable
14. Split across multiple lines or sentences
15. Written with typos or OCR errors (e.g., "SS#: l23-45-6789" where 'l' is meant to be '1')
16. Using alternative separators or formats (e.g., "123.45.6789" for SSN)
17. Any sequence of 9 digits that could potentially be an SSN
18. Any sequence of 8-17 digits that could be an account number
19. Any 4-digit numbers that could be partial SSNs or PINs
20. Any numbers with dashes, spaces, or dots that look like identifiers
21. References to financial institutions near numbers
22. Spelled-out numbers that form SSN/account patterns (one, two, three, four, five, six, seven, eight, nine, zero)

BE AGGRESSIVE: When in doubt, flag it. The user can always unselect false positives.

IMPORTANT: Only report NEW findings. The following items have already been detected by pattern matching and should NOT be included in your response:
{ALREADY_FOUND}

Return ONLY a valid JSON array with objects containing:
- type: One of SSN, ACCOUNT_NUMBER, CREDIT_CARD, NAME, ADDRESS, PHONE, EMAIL, DOB
- value: The exact text as it appears in the document (include the full phrase if needed for context)
- normalizedValue: The standardized form (e.g., "123-45-6789" for an SSN written as words)
- startIndex: Character position where the value starts (estimate if needed)
- endIndex: Character position where the value ends (estimate if needed)
- context: Brief explanation of why this was flagged (mention if it's a retrospective pattern)

Example response:
[
  {"type": "SSN", "value": "five one two three four five six seven eight nine is my social", "normalizedValue": "512-34-5678", "startIndex": 45, "endIndex": 107, "context": "SSN written as words with retrospective label"},
  {"type": "SSN", "value": "one two three - four five - six seven eight nine", "normalizedValue": "123-45-6789", "startIndex": 200, "endIndex": 248, "context": "SSN written as words"},
  {"type": "DOB", "value": "January 15, 1985 is when I was born", "normalizedValue": "01/15/1985", "startIndex": 300, "endIndex": 335, "context": "Date of birth with retrospective label"},
  {"type": "ACCOUNT_NUMBER", "value": "12345678 is my account number", "normalizedValue": "12345678", "startIndex": 400, "endIndex": 429, "context": "Account number with retrospective label"}
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
    } catch {
      // Failed to parse LLM response - return empty array
      return [];
    }
  } catch {
    // LLM detection failed - return empty array
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
    } catch {
      // Failed to parse LLM response
      return [];
    }
  } catch {
    // LLM detection failed
    return [];
  }
}

/**
 * RETROSPECTIVE PASS: Find ALL occurrences of detected entities throughout the document
 * This ensures comprehensive redaction - if "Robert J. Patterson" is found once,
 * we find EVERY instance of that name in the document.
 */
function findAllOccurrences(text: string, entities: EnhancedPatternMatch[]): EnhancedPatternMatch[] {
  const additionalMatches: EnhancedPatternMatch[] = [];
  const lowerText = text.toLowerCase();
  
  // Get unique values to search for
  const uniqueValues = new Map<string, EnhancedPatternMatch>();
  for (const entity of entities) {
    const key = entity.value.toLowerCase();
    if (!uniqueValues.has(key) || entity.confidence > (uniqueValues.get(key)?.confidence || 0)) {
      uniqueValues.set(key, entity);
    }
  }
  
  // For each unique entity, find ALL occurrences in the text
  for (const [lowerValue, entity] of uniqueValues) {
    let searchIndex = 0;
    while (searchIndex < lowerText.length) {
      const foundIndex = lowerText.indexOf(lowerValue, searchIndex);
      if (foundIndex === -1) break;
      
      // Check if this position is already covered by an existing match
      const alreadyFound = entities.some(e => 
        e.startIndex === foundIndex && e.endIndex === foundIndex + entity.value.length
      );
      
      if (!alreadyFound) {
        // Get the actual text from the document (preserves original case)
        const actualValue = text.substring(foundIndex, foundIndex + entity.value.length);
        additionalMatches.push({
          type: entity.type,
          value: actualValue,
          startIndex: foundIndex,
          endIndex: foundIndex + entity.value.length,
          confidence: entity.confidence,
          context: `Additional occurrence of "${entity.value}" (retrospective scan)`,
        });
      }
      
      searchIndex = foundIndex + 1;
    }
  }
  
  return additionalMatches;
}

/**
 * LLM-powered retrospective analysis to find variations and aliases
 * For example, if we found "Robert J. Patterson", also find "Mr. Patterson", "Robert Patterson", "R. Patterson"
 */
async function findEntityVariations(
  text: string, 
  entities: EnhancedPatternMatch[]
): Promise<EnhancedPatternMatch[]> {
  // Only do this for names and addresses where variations are common
  const nameEntities = entities.filter(e => e.type === 'NAME');
  const addressEntities = entities.filter(e => e.type === 'ADDRESS');
  
  if (nameEntities.length === 0 && addressEntities.length === 0) {
    return [];
  }
  
  try {
    const client = createCaseDevClient();
    
    const namesList = nameEntities.map(e => e.value).join(', ');
    const addressList = addressEntities.map(e => e.value).join(', ');
    
    const prompt = `You are a PII detection expert performing a RETROSPECTIVE ANALYSIS.

We have already identified these entities in a document:
${namesList ? `NAMES: ${namesList}` : ''}
${addressList ? `ADDRESSES: ${addressList}` : ''}

Your task is to find ALL VARIATIONS, ALIASES, and PARTIAL REFERENCES to these entities in the text below.

For NAMES, look for:
- Partial names (first name only, last name only)
- Name with different titles (Mr., Mrs., Dr., etc.)
- Initials (R.J. Patterson, R. Patterson)
- Nicknames or shortened forms (Bob for Robert, etc.)
- Misspellings or OCR errors
- References like "the plaintiff", "the defendant" if they clearly refer to a named person
- Possessive forms (Patterson's, Robert's)

For ADDRESSES, look for:
- Partial addresses (just street, just city/state)
- Abbreviated forms (St. for Street, Ave. for Avenue)
- References to "the property", "said address" if they refer to a specific address

Return ONLY a valid JSON array. Each object must have:
- type: "NAME" or "ADDRESS"
- value: The exact text as it appears in the document
- startIndex: Character position where it starts
- endIndex: Character position where it ends
- relatedTo: The original entity this is a variation of
- confidence: 0.0 to 1.0

Example: [{"type": "NAME", "value": "Mr. Patterson", "startIndex": 500, "endIndex": 513, "relatedTo": "Robert J. Patterson", "confidence": 0.9}]

If no variations found, return: []`;

    const response = await client.llm.chat({
      model: 'openai/gpt-4o',
      temperature: 0,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Find all variations of the identified entities in this text:\n\n${text}` },
      ],
    });

    const content = response.choices[0]?.message?.content || '[]';
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const parsed = JSON.parse(cleaned);
      return parsed.map((e: { 
        type: EntityType; 
        value: string; 
        startIndex: number; 
        endIndex: number;
        relatedTo?: string;
        confidence?: number;
      }) => ({
        type: e.type,
        value: e.value,
        startIndex: e.startIndex,
        endIndex: e.endIndex,
        confidence: e.confidence || 0.8,
        context: e.relatedTo ? `Variation of "${e.relatedTo}" (AI retrospective)` : 'AI retrospective analysis',
      }));
    } catch {
      // Failed to parse LLM variations response
      return [];
    }
  } catch {
    // LLM entity variations detection failed
    return [];
  }
}

/**
 * Main detection function - Three-pass approach with RETROSPECTIVE ANALYSIS
 * 
 * 1. First pass: Regex patterns for standard structured data
 * 2. Second pass: LLM for contextual/non-standard data AND unstructured data (names, addresses)
 * 3. Third pass: RETROSPECTIVE - Find ALL occurrences of detected entities + variations
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

  // ============================================
  // PASS 2: LLM detection for contextual data
  // ============================================
  // Finds non-standard representations that regex misses:
  // - "my social is one two three..."
  // - "SSN: 123.45.6789" (wrong separator)
  // - "born on January fifteenth"
  const contextualMatches = await detectContextualPII(text, regexMatches, types);
  allMatches.push(...contextualMatches);

  // ============================================
  // PASS 2b: LLM detection for unstructured data
  // ============================================
  // Names and addresses that can't be reliably detected with regex
  const unstructuredMatches = await detectUnstructuredPII(text, types);
  allMatches.push(...unstructuredMatches.map(m => ({ ...m, context: 'Detected by AI analysis' })));

  // Merge results so far
  const mergedSoFar = mergeResults(allMatches);

  // ============================================
  // PASS 3: RETROSPECTIVE ANALYSIS
  // ============================================
  // Now that we know what entities exist, find ALL occurrences
  // This is the key to comprehensive redaction!
  
  // 3a: Find all exact occurrences (case-insensitive)
  const additionalOccurrences = findAllOccurrences(text, mergedSoFar);
  
  // 3b: Find variations and aliases using LLM
  const variations = await findEntityVariations(text, mergedSoFar);
  
  // Combine all matches
  const finalMatches = [...mergedSoFar, ...additionalOccurrences, ...variations];
  
  // Final merge and deduplicate
  return mergeResults(finalMatches);
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
