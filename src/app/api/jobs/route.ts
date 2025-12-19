import { NextRequest, NextResponse } from 'next/server';
import { db, redactionJobs, redactionLogs, documents, detectedEntities, JobStatus } from '@/lib/db';
import { eq, desc, sql } from 'drizzle-orm';

// POST /api/jobs - Create a new redaction job
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, redactionTypes, customPattern } = body;

    const [job] = await db.insert(redactionJobs).values({
      name: name || `Redaction Job ${new Date().toISOString()}`,
      redactionTypes: redactionTypes || [],
      customPattern: customPattern || null,
      status: JobStatus.PENDING,
    }).returning();

    // Log job creation
    await db.insert(redactionLogs).values({
      jobId: job.id,
      action: 'JOB_CREATED',
      details: `Job created with types: ${redactionTypes?.join(', ') || 'none'}`,
    });

    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    console.error('Failed to create job:', error);
    return NextResponse.json(
      { error: 'Failed to create redaction job' },
      { status: 500 }
    );
  }
}

// GET /api/jobs - List all jobs or get a specific job
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('id');

    if (jobId) {
      const job = await db.query.redactionJobs.findFirst({
        where: eq(redactionJobs.id, jobId),
        with: {
          documents: {
            with: {
              entities: true,
            },
          },
          redactionLogs: {
            orderBy: desc(redactionLogs.timestamp),
            limit: 50,
          },
        },
      });

      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      return NextResponse.json(job);
    }

    // List all jobs with document count
    const jobs = await db
      .select({
        id: redactionJobs.id,
        status: redactionJobs.status,
        name: redactionJobs.name,
        redactionTypes: redactionJobs.redactionTypes,
        customPattern: redactionJobs.customPattern,
        errorMessage: redactionJobs.errorMessage,
        createdAt: redactionJobs.createdAt,
        updatedAt: redactionJobs.updatedAt,
        _count: {
          documents: sql<number>`(SELECT COUNT(*) FROM document WHERE document.job_id = ${redactionJobs.id})`.as('document_count'),
        },
      })
      .from(redactionJobs)
      .orderBy(desc(redactionJobs.createdAt));

    return NextResponse.json(jobs);
  } catch (error) {
    console.error('Failed to fetch jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

// PATCH /api/jobs - Update job status or configuration
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status, redactionTypes, customPattern } = body;

    if (!id) {
      return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
    }

    const updateData: Partial<typeof redactionJobs.$inferInsert> = {};
    if (status) updateData.status = status;
    if (redactionTypes) updateData.redactionTypes = redactionTypes;
    if (customPattern !== undefined) updateData.customPattern = customPattern;

    const [job] = await db.update(redactionJobs)
      .set(updateData)
      .where(eq(redactionJobs.id, id))
      .returning();

    // Log status change
    if (status) {
      await db.insert(redactionLogs).values({
        jobId: id,
        action: 'STATUS_CHANGED',
        details: `Status changed to ${status}`,
      });
    }

    return NextResponse.json(job);
  } catch (error) {
    console.error('Failed to update job:', error);
    return NextResponse.json(
      { error: 'Failed to update job' },
      { status: 500 }
    );
  }
}
