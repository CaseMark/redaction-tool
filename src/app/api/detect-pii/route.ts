import { NextRequest, NextResponse } from 'next/server';
import { detectAllPII, maskEntity } from '@/lib/redaction/detector';
import { EntityType } from '@/lib/redaction/patterns';
import { validateRequestBody, DetectPIIRequestSchema } from '@/lib/validation/schemas';
import { checkRateLimit, rateLimitExceededResponse, addRateLimitHeaders, RateLimits } from '@/lib/security/rate-limit';

export interface DetectionResult {
  id: string;
  type: EntityType;
  value: string;
  maskedValue: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
  context?: string;
  detectionMethod: 'regex' | 'llm';
}

/**
 * POST /api/detect-pii - PII detection endpoint
 * 
 * This endpoint runs multi-pass detection:
 * 1. Regex patterns for standard formats
 * 2. LLM for contextual/semantic detection
 * 3. Retrospective scan for all occurrences
 * 
 * Request body:
 * - text: string - The text to scan for PII
 * - types: EntityType[] - Types of PII to detect
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

    const { text, types } = validation.data;

    // Run the multi-pass detection
    const matches = await detectAllPII(text, types);

    // Convert to response format with IDs and masked values
    const results: DetectionResult[] = matches.map((match, index) => ({
      id: `entity-${Date.now()}-${index}`,
      type: match.type,
      value: match.value,
      maskedValue: maskEntity(match.type, match.value),
      startIndex: match.startIndex,
      endIndex: match.endIndex,
      confidence: match.confidence,
      context: match.context,
      detectionMethod: match.confidence > 0.9 ? 'regex' : 'llm',
    }));

    const response = NextResponse.json({
      success: true,
      count: results.length,
      matches: results,
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
