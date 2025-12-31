# PII Detection Reference

Two-pass PII detection patterns and AI prompts for the redaction tool.

## Detection Architecture

```
Input Text
    ↓
┌─────────────────────────┐
│  Pass 1: Regex Patterns │  ← Fast, high-precision standard formats
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│  Pass 2: AI/LLM Analysis│  ← Semantic, contextual, non-standard
└─────────────────────────┘
    ↓
Merged & Deduplicated Results
```

## Pass 1: Regex Patterns

### Social Security Numbers
```typescript
const SSN_PATTERNS = [
  // Standard format: 123-45-6789
  /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  
  // No dashes: 123456789
  /\b(?!000|666|9\d{2})\d{3}(?!00)\d{2}(?!0000)\d{4}\b/g,
  
  // Spaces: 123 45 6789
  /\b(?!000|666|9\d{2})\d{3}\s(?!00)\d{2}\s(?!0000)\d{4}\b/g,
];

// Validation: First 3 digits not 000, 666, or 9xx
// Middle 2 digits not 00
// Last 4 digits not 0000
```

### Credit Card Numbers
```typescript
const CREDIT_CARD_PATTERNS = [
  // Visa: 4xxx xxxx xxxx xxxx
  /\b4\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  
  // Mastercard: 5[1-5]xx or 2[2-7]xx
  /\b(?:5[1-5]\d{2}|2[2-7]\d{2})[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  
  // Amex: 3[47]xx xxxxxx xxxxx
  /\b3[47]\d{2}[\s-]?\d{6}[\s-]?\d{5}\b/g,
  
  // Discover: 6011, 65, 644-649
  /\b(?:6011|65\d{2}|64[4-9]\d)[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
];

// Luhn validation
function isValidLuhn(number: string): boolean {
  const digits = number.replace(/\D/g, '');
  let sum = 0;
  let isEven = false;
  
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }
  
  return sum % 10 === 0;
}
```

### Bank Account Numbers
```typescript
const BANK_ACCOUNT_PATTERNS = [
  // Account number context
  /(?:account|acct)[\s#.:]*(\d{8,17})/gi,
  
  // Routing + account
  /\b\d{9}[\s-]+\d{8,17}\b/g,
];
```

### Phone Numbers
```typescript
const PHONE_PATTERNS = [
  // (123) 456-7890
  /\(\d{3}\)\s*\d{3}[-.\s]?\d{4}\b/g,
  
  // 123-456-7890
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g,
  
  // +1 123 456 7890
  /\+1?\s*\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
];
```

### Email Addresses
```typescript
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
```

### Dates of Birth
```typescript
const DOB_PATTERNS = [
  // MM/DD/YYYY or MM-DD-YYYY
  /\b(?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g,
  
  // YYYY-MM-DD (ISO)
  /\b(?:19|20)\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])\b/g,
  
  // Month DD, YYYY
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(?:19|20)\d{2}\b/gi,
];
```

## Pass 2: AI/LLM Detection

### Detection Prompt
```typescript
const AI_DETECTION_PROMPT = `You are a PII detection system. Analyze the following text and identify ALL personally identifiable information.

Be MODERATELY AGGRESSIVE - it's better to flag potential PII that users can unselect than to miss actual sensitive data.

DETECT THESE TYPES:
1. SSN - Social Security Numbers (any format, including spelled out)
2. CREDIT_CARD - Credit card numbers (any format)
3. BANK_ACCOUNT - Bank account numbers
4. NAME - Full names of individuals (not company names)
5. ADDRESS - Street addresses, city/state/zip
6. PHONE - Phone numbers (any format)
7. EMAIL - Email addresses
8. DOB - Dates of birth (with context suggesting it's a birthdate)

IMPORTANT:
- Find non-standard formats (e.g., "my social is one two three...")
- Find contextual references (e.g., "born on January 5th")
- Find obfuscated data (e.g., "SSN: ***-**-1234")
- Find partial data that reveals PII
- DO NOT flag generic dates without birth context
- DO NOT flag company names as NAME type

For each finding, provide:
- type: The PII type from the list above
- value: The exact text found
- context: Brief explanation of why this is PII
- confidence: 0.0-1.0 confidence score

TEXT TO ANALYZE:
{text}

Respond in JSON format:
{
  "findings": [
    {"type": "SSN", "value": "123-45-6789", "context": "Preceded by 'SSN:'", "confidence": 0.95}
  ]
}`;
```

### Confidence Thresholds
```typescript
const CONFIDENCE_THRESHOLDS = {
  SSN: 0.7,
  CREDIT_CARD: 0.8,
  BANK_ACCOUNT: 0.6,
  NAME: 0.5,  // Lower - names are contextual
  ADDRESS: 0.6,
  PHONE: 0.7,
  EMAIL: 0.9,  // High - regex catches most
  DOB: 0.6,
};
```

## Masking Functions

```typescript
const MASKING_FUNCTIONS: Record<PIIType, (value: string) => string> = {
  SSN: (v) => `***-**-${v.slice(-4)}`,
  CREDIT_CARD: (v) => `****-****-****-${v.replace(/\D/g, '').slice(-4)}`,
  BANK_ACCOUNT: (v) => `****${v.slice(-4)}`,
  NAME: () => '[REDACTED NAME]',
  ADDRESS: () => '[REDACTED ADDRESS]',
  PHONE: (v) => `***-***-${v.replace(/\D/g, '').slice(-4)}`,
  EMAIL: (v) => {
    const [local, domain] = v.split('@');
    return `${local[0]}***@${domain}`;
  },
  DOB: () => '[REDACTED DOB]',
};
```

## Merging Results

```typescript
interface DetectedEntity {
  id: string;
  type: PIIType;
  value: string;
  maskedValue: string;
  confidence: number;
  detectionMethod: 'regex' | 'ai';
  startIndex: number;
  endIndex: number;
}

function mergeDetections(
  regexResults: DetectedEntity[],
  aiResults: DetectedEntity[]
): DetectedEntity[] {
  const merged: DetectedEntity[] = [...regexResults];
  
  for (const aiResult of aiResults) {
    // Check if AI result overlaps with existing regex result
    const overlap = merged.find(r => 
      (aiResult.startIndex >= r.startIndex && aiResult.startIndex <= r.endIndex) ||
      (aiResult.endIndex >= r.startIndex && aiResult.endIndex <= r.endIndex)
    );
    
    if (!overlap) {
      // New finding from AI
      merged.push(aiResult);
    } else if (aiResult.confidence > overlap.confidence) {
      // AI has higher confidence - update
      Object.assign(overlap, aiResult);
    }
  }
  
  return merged.sort((a, b) => a.startIndex - b.startIndex);
}
```

## Exclusion Patterns

```typescript
// Common false positives to exclude
const EXCLUSIONS = {
  SSN: [
    /\b123-45-6789\b/,  // Example SSN
    /\b000-00-0000\b/,  // Placeholder
  ],
  PHONE: [
    /\b555-\d{3}-\d{4}\b/,  // Fictional numbers
    /\b800-\d{3}-\d{4}\b/,  // Toll-free (often public)
  ],
  EMAIL: [
    /example\.com$/,
    /test\.com$/,
  ],
};
```

## Tuning Detection

### Too Many False Positives
1. Raise confidence threshold for that type
2. Add to exclusion patterns
3. Refine AI prompt to be less aggressive

### Missing PII
1. Add new regex pattern for the format
2. Lower confidence threshold
3. Adjust AI prompt to specifically look for that pattern
4. Check if text extraction is working correctly
