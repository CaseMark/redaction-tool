/**
 * API Authentication Middleware
 * 
 * Simple API key authentication for protecting API routes.
 * In production, consider using NextAuth.js, Clerk, or similar for user authentication.
 */

import { NextRequest, NextResponse } from 'next/server';

// API key for server-to-server authentication (optional, for external integrations)
const API_KEY = process.env.API_SECRET_KEY;

// Session-based authentication check
// For now, we'll use a simple approach - in production, integrate with your auth provider
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';

export interface AuthResult {
  authenticated: boolean;
  error?: string;
  userId?: string;
}

/**
 * Validate API request authentication
 * 
 * Supports:
 * 1. API Key authentication via Authorization header (Bearer token)
 * 2. Session-based authentication (when integrated with auth provider)
 */
export function validateAuth(request: NextRequest): AuthResult {
  // If auth is not required (development mode), allow all requests
  if (!REQUIRE_AUTH) {
    return { authenticated: true, userId: 'anonymous' };
  }

  // Check for API key in Authorization header
  const authHeader = request.headers.get('Authorization');
  
  if (authHeader) {
    const [type, token] = authHeader.split(' ');
    
    if (type === 'Bearer' && token) {
      // Validate API key
      if (API_KEY && token === API_KEY) {
        return { authenticated: true, userId: 'api-key-user' };
      }
      
      return { authenticated: false, error: 'Invalid API key' };
    }
  }

  // No valid authentication found
  return { authenticated: false, error: 'Authentication required' };
}

/**
 * Create an unauthorized response
 */
export function unauthorizedResponse(message: string = 'Unauthorized'): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: 401 }
  );
}

/**
 * Middleware wrapper for protected API routes
 */
export function withAuth<T>(
  handler: (request: NextRequest, auth: AuthResult) => Promise<NextResponse<T>>
) {
  return async (request: NextRequest): Promise<NextResponse<T | { error: string }>> => {
    const auth = validateAuth(request);
    
    if (!auth.authenticated) {
      return unauthorizedResponse(auth.error) as NextResponse<{ error: string }>;
    }
    
    return handler(request, auth);
  };
}
