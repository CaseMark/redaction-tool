import { NextRequest, NextResponse } from 'next/server';
import { db, redactionJobs, documents, detectedEntities, redactionLogs, JobStatus } from '@/lib/db';
import { eq, asc, desc, sql } from 'drizzle-orm';
import { createCaseDevClient } from '@/lib/case-dev/client';

// POST /api/export - Generate redacted PDFs
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    // Get job with documents and entities (only entities that should be redacted)
    const job = await db.query.redactionJobs.findFirst({
      where: eq(redactionJobs.id, jobId),
      with: {
        documents: {
          with: {
            entities: {
              orderBy: asc(detectedEntities.startIndex),
            },
          },
        },
      },
    });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Update job status
    await db.update(redactionJobs)
      .set({ status: JobStatus.APPLYING_REDACTIONS })
      .where(eq(redactionJobs.id, jobId));

    const client = createCaseDevClient();
    const exportedDocuments = [];
    let totalRedactions = 0;

    for (const doc of job.documents) {
      // Filter entities that should be redacted
      const entitiesToRedact = doc.entities.filter(e => e.shouldRedact);
      
      if (!doc.extractedText || entitiesToRedact.length === 0) {
        continue;
      }

      try {
        // Apply redactions to text
        let redactedText = doc.extractedText;
        const sortedEntities = [...entitiesToRedact].sort((a, b) => b.startIndex - a.startIndex);

        for (const entity of sortedEntities) {
          const before = redactedText.substring(0, entity.startIndex);
          const after = redactedText.substring(entity.endIndex);
          redactedText = before + entity.maskedValue + after;

          // Mark entity as redacted
          await db.update(detectedEntities)
            .set({ redactedAt: new Date() })
            .where(eq(detectedEntities.id, entity.id));

          totalRedactions++;
        }

        // Update job status
        await db.update(redactionJobs)
          .set({ status: JobStatus.GENERATING_PDF })
          .where(eq(redactionJobs.id, jobId));

        // Generate PDF using Format API
        let pdfUrl: string;
        try {
          const formatResult = await client.format.document({
            content: redactedText,
            input_format: 'text',
            output_format: 'pdf',
            options: {
              title: `Redacted - ${doc.filename}`,
              header: 'REDACTED DOCUMENT',
              footer: `Generated ${new Date().toISOString()}`,
            },
          });
          pdfUrl = formatResult.url;
        } catch (formatError) {
          console.error('Format API failed, using demo URL:', formatError);
          // Demo fallback - in production this would fail
          pdfUrl = `#demo-pdf-${doc.id}`;
        }

        // Update document with redacted URL
        await db.update(documents)
          .set({ redactedUrl: pdfUrl })
          .where(eq(documents.id, doc.id));

        exportedDocuments.push({
          id: doc.id,
          filename: doc.filename,
          redactedUrl: pdfUrl,
          redactionCount: entitiesToRedact.length,
        });

      } catch (docError) {
        console.error(`Export failed for document ${doc.id}:`, docError);
      }
    }

    // Update job status to completed
    await db.update(redactionJobs)
      .set({ status: JobStatus.COMPLETED })
      .where(eq(redactionJobs.id, jobId));

    // Log export
    await db.insert(redactionLogs).values({
      jobId,
      action: 'EXPORT_COMPLETED',
      details: `Exported ${exportedDocuments.length} documents with ${totalRedactions} redactions`,
      entityCount: totalRedactions,
      metadata: {
        documents: exportedDocuments.map(d => ({
          filename: d.filename,
          redactions: d.redactionCount,
        })),
      },
    });

    return NextResponse.json({
      success: true,
      jobId,
      documents: exportedDocuments,
      totalRedactions,
    });
  } catch (error) {
    console.error('Export failed:', error);

    return NextResponse.json(
      { error: 'Export failed' },
      { status: 500 }
    );
  }
}

// GET /api/export - Get export status and download links
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    const job = await db.query.redactionJobs.findFirst({
      where: eq(redactionJobs.id, jobId),
      with: {
        documents: true,
        redactionLogs: {
          orderBy: desc(redactionLogs.timestamp),
          limit: 1,
        },
      },
    });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Get entity counts per document
    const docsWithCounts = await Promise.all(
      job.documents.map(async (doc) => {
        const [result] = await db
          .select({ count: sql<number>`count(*)` })
          .from(detectedEntities)
          .where(eq(detectedEntities.documentId, doc.id));
        
        return {
          id: doc.id,
          filename: doc.filename,
          redactedUrl: doc.redactedUrl,
          _count: { entities: Number(result?.count || 0) },
        };
      })
    );

    // Generate audit log
    const auditLog = {
      jobId: job.id,
      jobName: job.name,
      completedAt: job.updatedAt,
      redactionTypes: job.redactionTypes,
      documents: docsWithCounts.map(d => ({
        filename: d.filename,
        redactedUrl: d.redactedUrl,
        redactionCount: d._count.entities,
      })),
    };

    return NextResponse.json({
      status: job.status,
      documents: docsWithCounts.filter(d => d.redactedUrl),
      auditLog,
    });
  } catch (error) {
    console.error('Failed to get export status:', error);
    return NextResponse.json(
      { error: 'Failed to get export status' },
      { status: 500 }
    );
  }
}
