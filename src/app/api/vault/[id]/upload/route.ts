/**
 * Vault Upload API Route - Upload files to a vault
 */

import { NextRequest, NextResponse } from 'next/server';
import { createCaseDevClient } from '@/lib/case-dev/client';

// POST /api/vault/[id]/upload - Get presigned URL and upload file
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
    const { filename, contentType } = body;

    if (!filename || !contentType) {
      return NextResponse.json(
        { error: 'Filename and contentType are required' },
        { status: 400 }
      );
    }

    const client = createCaseDevClient();
    
    // Get presigned upload URL from Case.dev
    const uploadResult = await client.vault.getUploadUrl(vaultId, {
      filename,
      contentType,
    });

    return NextResponse.json(uploadResult);
  } catch (error) {
    console.error('Failed to get upload URL:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get upload URL' },
      { status: 500 }
    );
  }
}
