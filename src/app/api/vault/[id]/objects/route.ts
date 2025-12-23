/**
 * Vault Objects API Routes - List and manage documents in a vault
 */

import { NextRequest, NextResponse } from 'next/server';
import { createCaseDevClient } from '@/lib/case-dev/client';

// GET /api/vault/[id]/objects - List all documents in a vault
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: vaultId } = await params;
    
    if (!vaultId) {
      return NextResponse.json({ error: 'Vault ID is required' }, { status: 400 });
    }

    const client = createCaseDevClient();
    const result = await client.vault.listObjects(vaultId);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to list vault objects:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list vault objects' },
      { status: 500 }
    );
  }
}
