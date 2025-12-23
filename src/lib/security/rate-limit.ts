/**
 * Simple In-Memory Rate Limiter
 * 
 * For production with multiple instances, use Redis-based rate limiting
 * like @upstash/ratelimit or similar.
 * 
 * This implementation is suitable for single-instance deployments.
 */

import { NextRequest, NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store (cleared on server restart)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up old entries periodically
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  
  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Time window in seconds */
  windowSeconds: number;
}

// Default rate limits for different endpoints
export const RateLimits = {
  // General API endpoints
  default: { limit: 100, windowSeconds: 60 },
  
  // PII detection (expensive LLM calls)
  detectPII: { limit: 20, windowSeconds: 60 },
  
  // PDF export
  exportPDF: { limit: 10, windowSeconds: 60 },
  
  // Vault operations
  vault: { limit: 50, windowSeconds: 60 },
  
  // File upload
  upload: { limit: 30, windowSeconds: 60 },
} as const;

/**
 * Get client identifier from request
 * Uses IP address or forwarded header
 */
function getClientId(request: NextRequest): string {
  // Check for forwarded IP (when behind proxy/load balancer)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  // Check for real IP header
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  
  // Fallback to a generic identifier
  return 'unknown-client';
}

/**
 * Check rate limit for a request
 */
export function checkRateLimit(
  request: NextRequest,
  config: RateLimitConfig = RateLimits.default,
  keyPrefix: string = 'api'
): { allowed: boolean; remaining: number; resetIn: number } {
  cleanup();
  
  const clientId = getClientId(request);
  const key = `${keyPrefix}:${clientId}`;
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  
  const entry = rateLimitStore.get(key);
  
  if (!entry || entry.resetTime < now) {
    // New window
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + windowMs,
    });
    return {
      allowed: true,
      remaining: config.limit - 1,
      resetIn: config.windowSeconds,
    };
  }
  
  if (entry.count >= config.limit) {
    // Rate limited
    const resetIn = Math.ceil((entry.resetTime - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetIn,
    };
  }
  
  // Increment counter
  entry.count += 1;
  const remaining = config.limit - entry.count;
  const resetIn = Math.ceil((entry.resetTime - now) / 1000);
  
  return {
    allowed: true,
    remaining,
    resetIn,
  };
}

/**
 * Create rate limit exceeded response
 */
export function rateLimitExceededResponse(resetIn: number): NextResponse {
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      message: `Too many requests. Please try again in ${resetIn} seconds.`,
      retryAfter: resetIn,
    },
    {
      status: 429,
      headers: {
        'Retry-After': resetIn.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': resetIn.toString(),
      },
    }
  );
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(
  response: NextResponse,
  remaining: number,
  resetIn: number
): NextResponse {
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  response.headers.set('X-RateLimit-Reset', resetIn.toString());
  return response;
}

/**
 * Rate limit middleware wrapper
 */
export function withRateLimit<T>(
  handler: (request: NextRequest) => Promise<NextResponse<T>>,
  config: RateLimitConfig = RateLimits.default,
  keyPrefix: string = 'api'
) {
  return async (request: NextRequest): Promise<NextResponse<T | { error: string; message: string; retryAfter: number }>> => {
    const { allowed, remaining, resetIn } = checkRateLimit(request, config, keyPrefix);
    
    if (!allowed) {
      return rateLimitExceededResponse(resetIn) as NextResponse<{ error: string; message: string; retryAfter: number }>;
    }
    
    const response = await handler(request);
    return addRateLimitHeaders(response, remaining, resetIn) as NextResponse<T>;
  };
}
