/**
 * Case.dev API Client - Unified client for OCR, LLM, and Format APIs
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
