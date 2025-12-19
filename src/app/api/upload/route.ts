import { NextRequest, NextResponse } from 'next/server';
import { db, redactionJobs, documents, redactionLogs } from '@/lib/db';
import { eq, asc } from 'drizzle-orm';

// POST /api/upload - Upload documents to a job
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const jobId = formData.get('jobId') as string;
    const files = formData.getAll('files') as File[];

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    // Verify job exists
    const job = await db.query.redactionJobs.findFirst({
      where: eq(redactionJobs.id, jobId),
    });
    
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const uploadedDocuments = [];

    for (const file of files) {
      // In production, upload to cloud storage (S3, GCS, etc.)
      // For now, we'll store a reference and the file data
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      
      // Create a data URL for demo purposes
      // In production, this would be a cloud storage URL
      const dataUrl = `data:${file.type};base64,${base64}`;

      const [document] = await db.insert(documents).values({
        jobId,
        filename: file.name,
        originalUrl: dataUrl,
        fileSize: file.size,
        mimeType: file.type,
        ocrStatus: 'pending',
        detectionStatus: 'pending',
      }).returning();

      uploadedDocuments.push(document);
    }

    // Log upload
    await db.insert(redactionLogs).values({
      jobId,
      action: 'DOCUMENTS_UPLOADED',
      details: `Uploaded ${files.length} document(s)`,
      entityCount: files.length,
      metadata: { filenames: files.map(f => f.name) },
    });

    return NextResponse.json({
      success: true,
      documents: uploadedDocuments,
      count: uploadedDocuments.length,
    });
  } catch (error) {
    console.error('Upload failed:', error);
    return NextResponse.json(
      { error: 'Failed to upload documents' },
      { status: 500 }
    );
  }
}

// GET /api/upload - Get documents for a job
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    const docs = await db.query.documents.findMany({
      where: eq(documents.jobId, jobId),
      with: {
        entities: true,
      },
      orderBy: asc(documents.createdAt),
    });

    return NextResponse.json(docs);
  } catch (error) {
    console.error('Failed to fetch documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}
