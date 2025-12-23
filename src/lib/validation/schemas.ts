/**
 * Input Validation Schemas using Zod
 * 
 * Centralized validation for all API inputs to prevent injection attacks
 * and ensure data integrity.
 */

import { z } from 'zod';

// Entity types enum
export const EntityTypeSchema = z.enum([
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

// PII Detection request
export const DetectPIIRequestSchema = z.object({
  text: z.string()
    .min(1, 'Text is required')
    .max(1_000_000, 'Text exceeds maximum length of 1MB'), // ~1MB of text
  types: z.array(EntityTypeSchema).optional(),
  vaultContext: z.object({
    vaultId: z.string().min(1),
    objectId: z.string().min(1),
  }).optional(),
});

// Redaction entity for export
export const RedactionEntitySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  value: z.string(),
  maskedValue: z.string(),
  startIndex: z.number().int().min(0),
  endIndex: z.number().int().min(0),
  shouldRedact: z.boolean(),
});

// PDF Export request
export const ExportPDFRequestSchema = z.object({
  text: z.string()
    .min(1, 'Text is required')
    .max(5_000_000, 'Text exceeds maximum length'), // ~5MB
  entities: z.array(RedactionEntitySchema),
  filename: z.string()
    .max(255, 'Filename too long')
    .regex(/^[\w\-. ]+$/, 'Invalid filename characters')
    .optional()
    .default('redacted-document.pdf'),
});

// Vault creation request
export const CreateVaultRequestSchema = z.object({
  name: z.string()
    .min(1, 'Vault name is required')
    .max(100, 'Vault name too long')
    .regex(/^[\w\-. ]+$/, 'Invalid vault name characters'),
  description: z.string().max(500).optional(),
});

// Vault upload request
export const VaultUploadRequestSchema = z.object({
  filename: z.string()
    .min(1, 'Filename is required')
    .max(255, 'Filename too long'),
  contentType: z.string()
    .min(1, 'Content type is required')
    .regex(/^[\w\-+./]+$/, 'Invalid content type'),
});

// Vault ingest request
export const VaultIngestRequestSchema = z.object({
  objectId: z.string().min(1, 'Object ID is required'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Job creation request
export const CreateJobRequestSchema = z.object({
  name: z.string().max(255).optional(),
  redactionTypes: z.array(EntityTypeSchema).optional().default([]),
  customPattern: z.string().max(1000).optional(),
});

// File upload constraints
export const FileUploadConstraints = {
  maxFileSize: 50 * 1024 * 1024, // 50MB
  allowedMimeTypes: [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/tiff',
    'image/gif',
    'text/plain',
  ] as const,
  maxFiles: 10,
};

/**
 * Validate file upload
 */
export function validateFileUpload(file: { size: number; type: string }): { valid: boolean; error?: string } {
  if (file.size > FileUploadConstraints.maxFileSize) {
    return { 
      valid: false, 
      error: `File size exceeds maximum of ${FileUploadConstraints.maxFileSize / 1024 / 1024}MB` 
    };
  }

  const allowedTypes: readonly string[] = FileUploadConstraints.allowedMimeTypes;
  if (!allowedTypes.includes(file.type)) {
    return { 
      valid: false, 
      error: `File type ${file.type} is not allowed. Allowed types: ${allowedTypes.join(', ')}` 
    };
  }

  return { valid: true };
}

/**
 * Sanitize string input to prevent XSS
 */
export function sanitizeString(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validate and parse request body with a schema
 */
export async function validateRequestBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const body = await request.json();
    const result = schema.safeParse(body);
    
    if (!result.success) {
      // Zod v4 uses 'issues' instead of 'errors'
      const issues = result.error.issues || [];
      const errorMessages = issues.map((issue: z.ZodIssue) => 
        `${issue.path.join('.')}: ${issue.message}`
      ).join(', ');
      return { success: false, error: `Validation failed: ${errorMessages || 'Unknown error'}` };
    }
    
    return { success: true, data: result.data };
  } catch {
    return { success: false, error: 'Invalid JSON body' };
  }
}
