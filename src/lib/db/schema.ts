import { pgTable, text, timestamp, integer, boolean, real, pgEnum, index, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

// Enums
export const jobStatusEnum = pgEnum('job_status', [
  'PENDING',
  'PROCESSING_OCR',
  'DETECTING_PII',
  'AWAITING_REVIEW',
  'APPLYING_REDACTIONS',
  'GENERATING_PDF',
  'COMPLETED',
  'FAILED',
]);

export const entityTypeEnum = pgEnum('entity_type', [
  'SSN',
  'ACCOUNT_NUMBER',
  'CREDIT_CARD',
  'NAME',
  'ADDRESS',
  'PHONE',
  'EMAIL',
  'DOB',
  'CUSTOM',
]);

// TypeScript types for enums
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type EntityType = (typeof entityTypeEnum.enumValues)[number];

export const JobStatus = {
  PENDING: 'PENDING',
  PROCESSING_OCR: 'PROCESSING_OCR',
  DETECTING_PII: 'DETECTING_PII',
  AWAITING_REVIEW: 'AWAITING_REVIEW',
  APPLYING_REDACTIONS: 'APPLYING_REDACTIONS',
  GENERATING_PDF: 'GENERATING_PDF',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export const EntityType = {
  SSN: 'SSN',
  ACCOUNT_NUMBER: 'ACCOUNT_NUMBER',
  CREDIT_CARD: 'CREDIT_CARD',
  NAME: 'NAME',
  ADDRESS: 'ADDRESS',
  PHONE: 'PHONE',
  EMAIL: 'EMAIL',
  DOB: 'DOB',
  CUSTOM: 'CUSTOM',
} as const;

// Tables
export const redactionJobs = pgTable('redaction_job', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  status: jobStatusEnum('status').default('PENDING').notNull(),
  name: text('name'),
  redactionTypes: text('redaction_types').array().notNull().default([]),
  customPattern: text('custom_pattern'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
});

export const documents = pgTable('document', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  jobId: text('job_id').notNull().references(() => redactionJobs.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  originalUrl: text('original_url').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: text('mime_type').notNull(),
  pageCount: integer('page_count'),
  ocrJobId: text('ocr_job_id'),
  ocrStatus: text('ocr_status').default('pending'),
  extractedText: text('extracted_text'),
  ocrData: jsonb('ocr_data'),
  detectionStatus: text('detection_status').default('pending'),
  redactedUrl: text('redacted_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  index('document_job_id_idx').on(table.jobId),
]);

export const detectedEntities = pgTable('detected_entity', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  type: entityTypeEnum('type').notNull(),
  value: text('value').notNull(),
  maskedValue: text('masked_value').notNull(),
  startIndex: integer('start_index').notNull(),
  endIndex: integer('end_index').notNull(),
  pageNumber: integer('page_number').default(1).notNull(),
  boundingBox: jsonb('bounding_box'),
  confidence: real('confidence').default(1.0).notNull(),
  detectionMethod: text('detection_method').default('regex').notNull(),
  shouldRedact: boolean('should_redact').default(true).notNull(),
  redactedAt: timestamp('redacted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('detected_entity_document_id_idx').on(table.documentId),
  index('detected_entity_type_idx').on(table.type),
]);

export const redactionLogs = pgTable('redaction_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  jobId: text('job_id').notNull().references(() => redactionJobs.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  details: text('details'),
  entityCount: integer('entity_count'),
  metadata: jsonb('metadata'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (table) => [
  index('redaction_log_job_id_idx').on(table.jobId),
]);

// Relations
export const redactionJobsRelations = relations(redactionJobs, ({ many }) => ({
  documents: many(documents),
  redactionLogs: many(redactionLogs),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  job: one(redactionJobs, {
    fields: [documents.jobId],
    references: [redactionJobs.id],
  }),
  entities: many(detectedEntities),
}));

export const detectedEntitiesRelations = relations(detectedEntities, ({ one }) => ({
  document: one(documents, {
    fields: [detectedEntities.documentId],
    references: [documents.id],
  }),
}));

export const redactionLogsRelations = relations(redactionLogs, ({ one }) => ({
  job: one(redactionJobs, {
    fields: [redactionLogs.jobId],
    references: [redactionJobs.id],
  }),
}));

// Type exports for insert/select
export type RedactionJob = typeof redactionJobs.$inferSelect;
export type NewRedactionJob = typeof redactionJobs.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DetectedEntity = typeof detectedEntities.$inferSelect;
export type NewDetectedEntity = typeof detectedEntities.$inferInsert;
export type RedactionLog = typeof redactionLogs.$inferSelect;
export type NewRedactionLog = typeof redactionLogs.$inferInsert;

