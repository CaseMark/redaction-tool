import { NextRequest, NextResponse } from 'next/server';
import { validateFileUpload, FileUploadConstraints } from '@/lib/validation/schemas';

/**
 * POST /api/upload - Upload documents for redaction
 * 
 * SECURITY: Files are NOT stored in the database.
 * For persistent storage, use Case.dev Vault via the /api/vault endpoints.
 * This endpoint processes files in-memory only.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    if (files.length > FileUploadConstraints.maxFiles) {
      return NextResponse.json(
        { error: `Maximum ${FileUploadConstraints.maxFiles} files allowed` },
        { status: 400 }
      );
    }

    const processedFiles = [];
    const errors = [];

    for (const file of files) {
      // Validate file
      const validation = validateFileUpload(file);
      if (!validation.valid) {
        errors.push({ filename: file.name, error: validation.error });
        continue;
      }

      // Process file in memory - extract basic info
      // Actual text extraction happens client-side or via Case.dev Vault
      processedFiles.push({
        id: crypto.randomUUID(),
        filename: file.name,
        size: file.size,
        mimeType: file.type,
        // Note: File content is NOT stored - only metadata
        // Use Case.dev Vault for persistent storage
      });
    }

    if (processedFiles.length === 0 && errors.length > 0) {
      return NextResponse.json(
        { error: 'All files failed validation', details: errors },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      files: processedFiles,
      count: processedFiles.length,
      errors: errors.length > 0 ? errors : undefined,
      message: 'Files validated. For persistent storage, use Case.dev Vault.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/upload - Not supported
 * Use Case.dev Vault API for document retrieval
 */
export async function GET() {
  return NextResponse.json(
    { 
      error: 'Direct file retrieval not supported. Use Case.dev Vault API.',
      documentation: 'https://docs.case.dev/vaults'
    },
    { status: 400 }
  );
}
