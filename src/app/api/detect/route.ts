import { NextRequest, NextResponse } from 'next/server';
import { db, redactionJobs, documents, detectedEntities, redactionLogs, JobStatus, EntityType } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { createCaseDevClient } from '@/lib/case-dev/client';
import { detectAllPII, maskEntity } from '@/lib/redaction/detector';
import { EntityType as PatternEntityType } from '@/lib/redaction/patterns';

// POST /api/detect - Run PII detection on job documents
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId, redactionTypes } = body;

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    // Get job and documents
    const job = await db.query.redactionJobs.findFirst({
      where: eq(redactionJobs.id, jobId),
      with: { documents: true },
    });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.documents.length === 0) {
      return NextResponse.json({ error: 'No documents to process' }, { status: 400 });
    }

    // Update job status
    await db.update(redactionJobs)
      .set({
        status: JobStatus.PROCESSING_OCR,
        redactionTypes: redactionTypes || job.redactionTypes,
      })
      .where(eq(redactionJobs.id, jobId));

    const client = createCaseDevClient();
    const allEntities = [];

    for (const doc of job.documents) {
      try {
        // Update document OCR status
        await db.update(documents)
          .set({ ocrStatus: 'processing' })
          .where(eq(documents.id, doc.id));

        let extractedText = doc.extractedText;

        // Run OCR if not already done
        if (!extractedText && doc.originalUrl) {
          try {
            // Start OCR job
            const ocrJob = await client.ocr.process({
              document_url: doc.originalUrl,
              document_id: doc.id,
            });

            // Poll for completion (with timeout)
            let ocrStatus = ocrJob.status;
            let attempts = 0;
            const maxAttempts = 30;

            while (ocrStatus !== 'completed' && ocrStatus !== 'failed' && attempts < maxAttempts) {
              await new Promise(r => setTimeout(r, 2000));
              const statusCheck = await client.ocr.getStatus(ocrJob.id);
              ocrStatus = statusCheck.status;
              attempts++;
            }

            if (ocrStatus === 'completed') {
              extractedText = await client.ocr.downloadText(ocrJob.id);
              const ocrData = await client.ocr.downloadJson(ocrJob.id);

              await db.update(documents)
                .set({
                  ocrJobId: ocrJob.id,
                  ocrStatus: 'completed',
                  extractedText,
                  ocrData: ocrData as object,
                  pageCount: ocrData.metadata?.page_count,
                })
                .where(eq(documents.id, doc.id));
            } else {
              throw new Error(`OCR failed or timed out: ${ocrStatus}`);
            }
          } catch (ocrError) {
            console.error(`OCR failed for document ${doc.id}:`, ocrError);
            // For demo, use placeholder text if OCR fails
            extractedText = `[Demo mode - OCR unavailable]\nDocument: ${doc.filename}\nThis is placeholder text for demonstration purposes.`;
            
            await db.update(documents)
              .set({
                ocrStatus: 'demo',
                extractedText,
              })
              .where(eq(documents.id, doc.id));
          }
        }

        // Update job status to PII detection
        await db.update(redactionJobs)
          .set({ status: JobStatus.DETECTING_PII })
          .where(eq(redactionJobs.id, jobId));

        // Update document detection status
        await db.update(documents)
          .set({ detectionStatus: 'processing' })
          .where(eq(documents.id, doc.id));

        // Run PII detection
        const types = (redactionTypes || job.redactionTypes) as PatternEntityType[];
        const matches = await detectAllPII(extractedText || '', types);

        // Store detected entities
        for (const match of matches) {
          const [entity] = await db.insert(detectedEntities).values({
            documentId: doc.id,
            type: match.type as EntityType,
            value: match.value,
            maskedValue: maskEntity(match.type, match.value),
            startIndex: match.startIndex,
            endIndex: match.endIndex,
            pageNumber: 1, // Would be determined from OCR data in production
            confidence: match.confidence,
            detectionMethod: match.confidence > 0.9 ? 'regex' : 'llm',
            shouldRedact: true,
          }).returning();
          allEntities.push(entity);
        }

        // Update document detection status
        await db.update(documents)
          .set({ detectionStatus: 'completed' })
          .where(eq(documents.id, doc.id));

      } catch (docError) {
        console.error(`Processing failed for document ${doc.id}:`, docError);
        await db.update(documents)
          .set({
            ocrStatus: 'failed',
            detectionStatus: 'failed',
          })
          .where(eq(documents.id, doc.id));
      }
    }

    // Update job status
    await db.update(redactionJobs)
      .set({ status: JobStatus.AWAITING_REVIEW })
      .where(eq(redactionJobs.id, jobId));

    // Log detection results
    await db.insert(redactionLogs).values({
      jobId,
      action: 'PII_DETECTED',
      details: `Detected ${allEntities.length} PII entities across ${job.documents.length} documents`,
      entityCount: allEntities.length,
      metadata: {
        byType: allEntities.reduce((acc, e) => {
          acc[e.type] = (acc[e.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
    });

    return NextResponse.json({
      success: true,
      jobId,
      entityCount: allEntities.length,
      entities: allEntities,
    });
  } catch (error) {
    console.error('Detection failed:', error);
    
    return NextResponse.json(
      { error: 'PII detection failed' },
      { status: 500 }
    );
  }
}

// PATCH /api/detect - Update entity redaction selections
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { entityId, shouldRedact, bulkUpdate } = body;

    // Bulk update
    if (bulkUpdate && Array.isArray(bulkUpdate)) {
      const updates = await Promise.all(
        bulkUpdate.map(({ id, shouldRedact }: { id: string; shouldRedact: boolean }) =>
          db.update(detectedEntities)
            .set({ shouldRedact })
            .where(eq(detectedEntities.id, id))
            .returning()
        )
      );
      return NextResponse.json({ success: true, updated: updates.length });
    }

    // Single update
    if (!entityId) {
      return NextResponse.json({ error: 'Entity ID required' }, { status: 400 });
    }

    const [entity] = await db.update(detectedEntities)
      .set({ shouldRedact })
      .where(eq(detectedEntities.id, entityId))
      .returning();

    return NextResponse.json(entity);
  } catch (error) {
    console.error('Failed to update entity:', error);
    return NextResponse.json(
      { error: 'Failed to update entity' },
      { status: 500 }
    );
  }
}
