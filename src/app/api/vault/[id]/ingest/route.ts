/**
 * Vault Ingest API Route - Trigger document ingestion (OCR + embedding)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createCaseDevClient } from '@/lib/case-dev/client';

// POST /api/vault/[id]/ingest - Ingest a document after upload
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: vaultId } = await params;
    
    if (!vaultId) {
      return NextResponse.json({ error: 'Vault ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { objectId, metadata } = body;

    if (!objectId) {
      return NextResponse.json({ error: 'Object ID is required' }, { status: 400 });
    }

    const client = createCaseDevClient();
    
    // Trigger ingestion (OCR + embedding)
    const result = await client.vault.ingest(vaultId, objectId, { metadata });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to ingest document:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to ingest document' },
      { status: 500 }
    );
  }
}
