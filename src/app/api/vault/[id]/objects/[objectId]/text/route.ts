/**
 * Vault Object Text API Route - Get extracted text from a document
 */

import { NextRequest, NextResponse } from 'next/server';
import { createCaseDevClient } from '@/lib/case-dev/client';

// GET /api/vault/[id]/objects/[objectId]/text - Get document text
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; objectId: string }> }
) {
  try {
    const { id: vaultId, objectId } = await params;
    
    if (!vaultId || !objectId) {
      return NextResponse.json(
        { error: 'Vault ID and Object ID are required' },
        { status: 400 }
      );
    }

    const client = createCaseDevClient();
    const text = await client.vault.getText(vaultId, objectId);
    
    return NextResponse.json({ text });
  } catch (error) {
    console.error('Failed to get document text:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get document text' },
      { status: 500 }
    );
  }
}
