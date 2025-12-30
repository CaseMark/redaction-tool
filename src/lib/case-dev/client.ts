/**
 * Case.dev API Client - Unified client for OCR, LLM, Vault, and Format APIs
 */

const CASE_DEV_BASE_URL = 'https://api.case.dev';

class CaseDevClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || CASE_DEV_BASE_URL;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Case.dev API Error: ${error.error || response.statusText}`);
    }

    return response.json();
  }

  // OCR API
  ocr = {
    process: async (params: { document_url: string; engine?: string; document_id?: string }) => {
      return this.request<{ id: string; status: string; links: Record<string, string> }>('/ocr/v1/process', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    getStatus: async (jobId: string) => {
      return this.request<{ id: string; status: string; error?: string }>(`/ocr/v1/${jobId}`);
    },

    downloadText: async (jobId: string): Promise<string> => {
      const response = await fetch(`${this.baseUrl}/ocr/v1/${jobId}/download/text`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.text();
    },

    downloadJson: async (jobId: string) => {
      return this.request<OCRJsonOutput>(`/ocr/v1/${jobId}/download/json`);
    },
  };

  // LLM API
  llm = {
    chat: async (params: { model?: string; messages: Array<{ role: string; content: string }>; temperature?: number; max_tokens?: number }) => {
      return this.request<{ choices: Array<{ message: { content: string } }> }>('/llm/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },
  };

  // Format API
  format = {
    document: async (params: { content: string; input_format: string; output_format: string; options?: Record<string, unknown> }) => {
      return this.request<{ url: string; format: string }>('/format/v1/document', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },
  };

  // Vault API - Per docs: https://docs.case.dev/vaults/manage
  vault = {
    // List all vaults - GET /vault
    list: async () => {
      return this.request<{ vaults: VaultInfo[]; total: number }>('/vault', {
        method: 'GET',
      });
    },

    // Get vault details - GET /vault/:id
    get: async (vaultId: string) => {
      return this.request<VaultInfo>(`/vault/${vaultId}`, {
        method: 'GET',
      });
    },

    // Create a new vault - POST /vault
    create: async (params: { name: string; description?: string }) => {
      return this.request<VaultInfo>('/vault', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    // List documents in a vault - GET /vault/:id/objects
    listObjects: async (vaultId: string) => {
      return this.request<{ objects: VaultObject[]; count: number }>(`/vault/${vaultId}/objects`, {
        method: 'GET',
      });
    },

    // Get extracted text from a document - GET /vault/:vaultId/objects/:objectId/text
    getText: async (vaultId: string, objectId: string): Promise<string> => {
      const response = await fetch(`${this.baseUrl}/vault/${vaultId}/objects/${objectId}/text`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (!response.ok) {
        throw new Error(`Failed to get text: ${response.statusText}`);
      }
      return response.text();
    },

    // Get presigned URL for upload - POST /vault/:id/upload
    getUploadUrl: async (vaultId: string, params: { filename: string; contentType: string }) => {
      return this.request<{ uploadUrl: string; objectId: string }>(`/vault/${vaultId}/upload`, {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    // Ingest (index) a document after upload - POST /vault/:vaultId/ingest/:objectId
    ingest: async (vaultId: string, objectId: string, params?: { metadata?: Record<string, unknown> }) => {
      return this.request<{ status: string; objectId: string }>(`/vault/${vaultId}/ingest/${objectId}`, {
        method: 'POST',
        body: params ? JSON.stringify(params) : undefined,
      });
    },

    // Search vault with different methods (hybrid, fast, local, global)
    // POST /vault/:id/search
    search: async (vaultId: string, params: { 
      query: string; 
      method?: 'hybrid' | 'fast' | 'local' | 'global';
      topK?: number;
      filters?: Record<string, unknown>;
    }) => {
      return this.request<VaultSearchResult>(`/vault/${vaultId}/search`, {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    // Initialize GraphRAG on a vault - POST /vault/:id/graphrag/init
    initGraphRAG: async (vaultId: string) => {
      return this.request<{ status: string; message: string }>(`/vault/${vaultId}/graphrag/init`, {
        method: 'POST',
      });
    },

    // Delete a vault - DELETE /vault/:id
    delete: async (vaultId: string, asyncDelete?: boolean) => {
      const url = asyncDelete ? `/vault/${vaultId}?async=true` : `/vault/${vaultId}`;
      return this.request<{ success: boolean }>(url, {
        method: 'DELETE',
      });
    },
  };
}

// Type definitions
export interface VaultInfo {
  id: string;
  name: string;
  totalObjects?: number;
  totalBytes?: number;
  createdAt?: string;
}

export interface VaultObject {
  id: string;
  filename: string;
  sizeBytes: number;
  ingestionStatus: 'pending' | 'processing' | 'completed' | 'failed';
  pageCount?: number;
  createdAt?: string;
}

export interface VaultSearchResult {
  chunks: Array<{
    text: string;
    filename?: string;
    page?: number;
    score: number;
    object_id?: string;
  }>;
  sources?: Array<{
    id: string;
    filename: string;
  }>;
  response?: string; // For GraphRAG global/local queries
}

export interface OCRJsonOutput {
  pages: Array<{
    page_number: number;
    width: number;
    height: number;
    blocks: Array<{
      text: string;
      confidence: number;
      bounding_box: { x: number; y: number; width: number; height: number };
      words?: Array<{
        text: string;
        confidence: number;
        bounding_box: { x: number; y: number; width: number; height: number };
      }>;
    }>;
  }>;
  metadata: { page_count: number; processing_time_ms: number };
}

export function createCaseDevClient(apiKey?: string): CaseDevClient {
  const key = apiKey || process.env.CASEDEV_API_KEY;
  if (!key) throw new Error('CASEDEV_API_KEY is required');
  return new CaseDevClient(key);
}

export default CaseDevClient;
