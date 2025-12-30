import { NextRequest, NextResponse } from 'next/server';
import { detectAllPII, maskEntity, EnhancedPatternMatch } from '@/lib/redaction/detector';
import { EntityType } from '@/lib/redaction/patterns';
import { validateRequestBody, DetectPIIRequestSchema } from '@/lib/validation/schemas';
import { checkRateLimit, rateLimitExceededResponse, addRateLimitHeaders, RateLimits } from '@/lib/security/rate-limit';
import { createCaseDevClient } from '@/lib/case-dev/client';

export interface DetectionResult {
  id: string;
  type: EntityType;
  value: string;
  maskedValue: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
  context?: string;
  detectionMethod: 'regex' | 'llm' | 'vault';
}

/**
 * Semantic search queries optimized for finding PII in legal documents.
 * These queries leverage the vault's semantic index to find contextual references.
 */
const PII_SEMANTIC_QUERIES: Partial<Record<EntityType, string[]>> = {
  SSN: [
    'social security number',
    'SSN or taxpayer identification',
  ],
  ACCOUNT_NUMBER: [
    'bank account number or routing number',
    'financial account information',
  ],
  CREDIT_CARD: [
    'credit card or debit card number',
  ],
  NAME: [
    'names of individuals or parties mentioned',
    'person names in signatures or identification',
  ],
  ADDRESS: [
    'physical addresses or mailing locations',
    'residential or business address',
  ],
  PHONE: [
    'phone numbers or telephone contact',
  ],
  EMAIL: [
    'email addresses',
  ],
  DOB: [
    'date of birth or birthday',
    'age or birth date information',
  ],
};

/**
 * Extract PII values from semantic search chunk text.
 * Uses regex patterns to find actual values within the semantic context.
 */
function extractValuesFromChunk(
  chunkText: string, 
  type: EntityType, 
  originalText: string
): EnhancedPatternMatch[] {
  const matches: EnhancedPatternMatch[] = [];
  
  // Quick patterns to extract actual values from semantic chunks
  const extractionPatterns: Partial<Record<EntityType, RegExp[]>> = {
    SSN: [
      /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    ],
    ACCOUNT_NUMBER: [
      /\b\d{8,17}\b/g,
    ],
    CREDIT_CARD: [
      /\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13})\b/g,
    ],
    PHONE: [
      /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
    ],
    EMAIL: [
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
    ],
    DOB: [
      /\b(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g,
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
    ],
  };

  const patterns = extractionPatterns[type] || [];
  
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(chunkText)) !== null) {
      const value = match[0];
      
      // Find this value in the original text to get accurate positions
      let searchStart = 0;
      let foundIndex = originalText.indexOf(value, searchStart);
      
      while (foundIndex !== -1) {
        matches.push({
          type,
          value,
          startIndex: foundIndex,
          endIndex: foundIndex + value.length,
          confidence: 0.85,
          context: `Found via vault semantic search`,
        });
        searchStart = foundIndex + 1;
        foundIndex = originalText.indexOf(value, searchStart);
      }
    }
  }

  return matches;
}

/**
 * Pass 4: Vault Semantic Search
 * Uses the vault's semantic index to find PII through contextual queries.
 * Only runs when vault context is provided.
 */
async function detectPIIWithVaultSearch(
  text: string,
  types: EntityType[],
  vaultId: string,
  objectId: string
): Promise<EnhancedPatternMatch[]> {
  const matches: EnhancedPatternMatch[] = [];
  
  try {
    const client = createCaseDevClient();
    
    // Run semantic searches for each requested PII type
    for (const type of types) {
      const queries = PII_SEMANTIC_QUERIES[type];
      if (!queries) continue;
      
      for (const query of queries) {
        try {
          const results = await client.vault.search(vaultId, {
            query,
            method: 'hybrid',
            topK: 10,
            filters: { object_id: objectId }, // Filter to single document
          });
          
          // Extract actual PII values from semantic chunks
          for (const chunk of results.chunks) {
            if (chunk.object_id === objectId || !chunk.object_id) {
              const extracted = extractValuesFromChunk(chunk.text, type, text);
              matches.push(...extracted);
            }
          }
        } catch {
          // Individual query failed, continue with others
          continue;
        }
      }
    }
  } catch {
    // Vault search unavailable, return empty (graceful degradation)
    return [];
  }
  
  return matches;
}

/**
 * Merge and deduplicate detection results, preferring higher confidence matches.
 */
function mergeDetectionResults(matches: EnhancedPatternMatch[]): EnhancedPatternMatch[] {
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
      // Prefer higher confidence
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
 * POST /api/detect-pii - PII detection endpoint
 * 
 * This endpoint runs multi-pass detection:
 * 1. Regex patterns for standard formats
 * 2. LLM for contextual/semantic detection
 * 3. Retrospective scan for all occurrences
 * 4. Vault semantic search (when vault context provided)
 * 
 * Request body:
 * - text: string - The text to scan for PII
 * - types: EntityType[] - Types of PII to detect
 * - vaultContext: { vaultId, objectId } - Optional vault context for enhanced detection
 * 
 * Response:
 * - matches: DetectionResult[] - Detected PII entities
 */
export async function POST(request: NextRequest) {
  // Rate limiting
  const rateLimit = checkRateLimit(request, RateLimits.detectPII, 'detect-pii');
  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit.resetIn);
  }

  try {
    // Validate request body
    const validation = await validateRequestBody(request, DetectPIIRequestSchema);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { text, types, vaultContext } = validation.data;

    // ============================================
    // PASSES 1-3: Standard multi-pass detection
    // ============================================
    const standardMatches = await detectAllPII(text, types);
    
    let allMatches = [...standardMatches];

    // ============================================
    // PASS 4: Vault Semantic Search (optional)
    // ============================================
    // Only runs when vault context is provided for enhanced detection
    if (vaultContext?.vaultId && vaultContext?.objectId) {
      const vaultMatches = await detectPIIWithVaultSearch(
        text,
        types || [],
        vaultContext.vaultId,
        vaultContext.objectId
      );
      
      // Merge vault matches with standard matches
      allMatches = [...allMatches, ...vaultMatches];
    }

    // Deduplicate and merge overlapping matches
    const mergedMatches = mergeDetectionResults(allMatches);

    // Convert to response format with IDs and masked values
    const results: DetectionResult[] = mergedMatches.map((match, index) => {
      // Determine detection method based on context
      let detectionMethod: 'regex' | 'llm' | 'vault' = 'llm';
      if (match.context?.includes('vault semantic search')) {
        detectionMethod = 'vault';
      } else if (match.confidence > 0.9) {
        detectionMethod = 'regex';
      }
      
      return {
        id: `entity-${Date.now()}-${index}`,
        type: match.type,
        value: match.value,
        maskedValue: maskEntity(match.type, match.value),
        startIndex: match.startIndex,
        endIndex: match.endIndex,
        confidence: match.confidence,
        context: match.context,
        detectionMethod,
      };
    });

    const response = NextResponse.json({
      success: true,
      count: results.length,
      matches: results,
      vaultEnhanced: !!vaultContext,
    });

    return addRateLimitHeaders(response, rateLimit.remaining, rateLimit.resetIn);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PII detection failed';
    return NextResponse.json(
      { error: 'PII detection failed', details: message },
      { status: 500 }
    );
  }
}
