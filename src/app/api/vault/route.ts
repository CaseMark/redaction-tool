/**
 * Vault API Routes - Proxy to Case.dev Vault API
 */

import { NextRequest, NextResponse } from 'next/server';
import { createCaseDevClient } from '@/lib/case-dev/client';
import { validateRequestBody, CreateVaultRequestSchema } from '@/lib/validation/schemas';
import { checkRateLimit, rateLimitExceededResponse, addRateLimitHeaders, RateLimits } from '@/lib/security/rate-limit';

// GET /api/vault - List all vaults
export async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimit = checkRateLimit(request, RateLimits.vault, 'vault-list');
  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit.resetIn);
  }

  try {
    const client = createCaseDevClient();
    const result = await client.vault.list();
    const response = NextResponse.json(result);
    return addRateLimitHeaders(response, rateLimit.remaining, rateLimit.resetIn);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list vaults';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/vault - Create a new vault
export async function POST(request: NextRequest) {
  // Rate limiting
  const rateLimit = checkRateLimit(request, RateLimits.vault, 'vault-create');
  if (!rateLimit.allowed) {
    return rateLimitExceededResponse(rateLimit.resetIn);
  }

  try {
    // Validate request body
    const validation = await validateRequestBody(request, CreateVaultRequestSchema);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { name, description } = validation.data;

    const client = createCaseDevClient();
    const result = await client.vault.create({ name, description });
    const response = NextResponse.json(result);
    return addRateLimitHeaders(response, rateLimit.remaining, rateLimit.resetIn);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create vault';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
