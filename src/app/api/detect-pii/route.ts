import { NextRequest, NextResponse } from 'next/server';
import { detectAllPII, maskEntity, EnhancedPatternMatch } from '@/lib/redaction/detector';
import { EntityType } from '@/lib/redaction/patterns';

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
 * POST /api/detect-pii - Simple PII detection endpoint
 * 
 * This endpoint runs the two-pass detection:
 * 1. Regex patterns for standard formats
 * 2. LLM for contextual/semantic detection
 * 
 * Request body:
 * - text: string - The text to scan for PII
 * - types: EntityType[] - Types of PII to detect
 * 
 * Response:
 * - matches: DetectionResult[] - Detected PII entities
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, types } = body as { text: string; types?: EntityType[] };

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required and must be a string' },
        { status: 400 }
      );
    }

    console.log(`[API] Starting PII detection for ${text.length} characters`);
    console.log(`[API] Requested types: ${types?.join(', ') || 'all'}`);

    // Run the two-pass detection
    const matches = await detectAllPII(text, types);

    console.log(`[API] Detection complete. Found ${matches.length} matches`);

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

    return NextResponse.json({
      success: true,
      count: results.length,
      matches: results,
    });
  } catch (error) {
    console.error('[API] PII detection failed:', error);
    
    return NextResponse.json(
      { 
        error: 'PII detection failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
