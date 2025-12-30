/**
 * OCR API Route - Process PDF uploads via Case.dev OCR API
 * 
 * This endpoint handles PDF uploads and extracts text using Case.dev's OCR service.
 * It replaces the client-side pdf.js extraction with server-side OCR.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createCaseDevClient } from '@/lib/case-dev/client';
import { validateFileUpload } from '@/lib/validation/schemas';

// Maximum time to wait for OCR processing (in milliseconds)
const MAX_POLL_TIME = 120000; // 2 minutes
const POLL_INTERVAL = 1000; // 1 second

/**
 * POST /api/ocr - Upload a PDF and extract text via Case.dev OCR
 * 
 * Accepts: multipart/form-data with a 'file' field
 * Returns: { text: string, pageCount?: number, processingTime?: number }
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file
    const validation = validateFileUpload(file);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Only process PDFs and images through OCR
    const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: `OCR only supports PDF and image files. Received: ${file.type}` },
        { status: 400 }
      );
    }

    const client = createCaseDevClient();

    // Step 1: Get a presigned upload URL from Case.dev
    const uploadUrlResponse = await getUploadUrl(client, file.name, file.type);
    
    // Step 2: Upload the file to the presigned URL
    const documentUrl = await uploadFile(uploadUrlResponse.uploadUrl, file, uploadUrlResponse.downloadUrl);

    // Step 3: Start OCR processing
    const ocrJob = await client.ocr.process({
      document_url: documentUrl,
      engine: 'auto', // Let Case.dev choose the best engine
      document_id: uploadUrlResponse.objectId,
    });

    // Step 4: Poll for completion
    const result = await pollForCompletion(client, ocrJob.id);

    if (result.status === 'failed') {
      return NextResponse.json(
        { error: result.error || 'OCR processing failed' },
        { status: 500 }
      );
    }

    // Step 5: Download the extracted text
    const text = await client.ocr.downloadText(ocrJob.id);

    // Optionally get structured JSON for page count
    let pageCount: number | undefined;
    let processingTime: number | undefined;
    try {
      const jsonResult = await client.ocr.downloadJson(ocrJob.id);
      pageCount = jsonResult.metadata?.page_count;
      processingTime = jsonResult.metadata?.processing_time_ms;
    } catch {
      // JSON download is optional, continue without it
    }

    return NextResponse.json({
      text,
      pageCount,
      processingTime,
      jobId: ocrJob.id,
    });

  } catch (error) {
    console.error('OCR processing error:', error);
    const message = error instanceof Error ? error.message : 'OCR processing failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Get a presigned upload URL from Case.dev
 */
async function getUploadUrl(
  client: ReturnType<typeof createCaseDevClient>,
  filename: string,
  contentType: string
): Promise<{ uploadUrl: string; downloadUrl: string; objectId: string }> {
  const apiKey = process.env.CASEDEV_API_KEY;
  if (!apiKey) throw new Error('CASEDEV_API_KEY is required');

  // Use Case.dev's direct upload endpoint for OCR
  const response = await fetch('https://api.case.dev/ocr/v1/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename,
      content_type: contentType,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to get upload URL' }));
    throw new Error(error.error || error.message || 'Failed to get upload URL');
  }

  return response.json();
}

/**
 * Upload file to the presigned URL
 */
async function uploadFile(uploadUrl: string, file: File, downloadUrl: string): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: arrayBuffer,
    headers: {
      'Content-Type': file.type,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to upload file to storage');
  }

  // Return the download URL that Case.dev can access for OCR
  return downloadUrl;
}

/**
 * Poll for OCR job completion
 */
async function pollForCompletion(
  client: ReturnType<typeof createCaseDevClient>,
  jobId: string
): Promise<{ status: string; error?: string }> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_TIME) {
    const status = await client.ocr.getStatus(jobId);
    
    if (status.status === 'completed') {
      return { status: 'completed' };
    }
    
    if (status.status === 'failed') {
      return { status: 'failed', error: status.error };
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }

  throw new Error('OCR processing timed out');
}

