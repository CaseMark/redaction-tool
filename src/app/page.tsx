'use client';

import { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Scissors, Download, FileText, Loader2, AlertCircle, CheckCircle, Database, Trash2, Upload, FolderOpen, Info, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { DropZone, UploadedFile } from '@/components/upload/DropZone';
import { VaultBrowser } from '@/components/vault/VaultBrowser';
import { PatternSelector } from '@/components/redaction/PatternSelector';
import { EntityList, DetectedEntity } from '@/components/redaction/EntityList';
import { DocumentPreview } from '@/components/redaction/DocumentPreview';
import { EntityType } from '@/lib/redaction/patterns';
import { 
  addMultipleToCache, 
  findCachedMatches, 
  clearCache,
  getCacheStats,
} from '@/lib/redaction/cache';

type WorkflowStep = 'upload' | 'configure' | 'review' | 'export';
type UploadMode = 'new' | 'vault';

interface ProcessingStatus {
  step: string;
  progress: number;
  message: string;
}

// Extended file type with extracted text
interface ProcessedFile extends UploadedFile {
  extractedText?: string;
}

// Vault context for enhanced detection
interface VaultContext {
  vaultId: string;
  objectId: string;
  filename: string;
}

export default function RedactionTool() {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('upload');
  const [uploadMode, setUploadMode] = useState<UploadMode>('new');
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [vaultContext, setVaultContext] = useState<VaultContext | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<EntityType[]>(['SSN', 'ACCOUNT_NUMBER', 'CREDIT_CARD']);
  const [entities, setEntities] = useState<DetectedEntity[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [extractedTexts, setExtractedTexts] = useState<Map<string, string>>(new Map());
  const [cacheStats, setCacheStats] = useState<{ totalItems: number; totalUsage: number } | null>(null);
  
  // Vault creation state
  const [showVaultCreation, setShowVaultCreation] = useState(false);
  const [newVaultName, setNewVaultName] = useState('');
  const [isCreatingVault, setIsCreatingVault] = useState(false);

  // Load cache stats on mount
  useEffect(() => {
    const stats = getCacheStats();
    setCacheStats({ totalItems: stats.totalItems, totalUsage: stats.totalUsage });
  }, []);

  // Update cache stats when entities change
  const updateCacheStats = useCallback(() => {
    const stats = getCacheStats();
    setCacheStats({ totalItems: stats.totalItems, totalUsage: stats.totalUsage });
  }, []);

  const handleFilesSelected = useCallback((newFiles: File[]) => {
    // Only allow single file for redaction
    const file = newFiles[0];
    if (!file) return;
    
    const uploadedFile: ProcessedFile = {
      id: uuidv4(),
      file,
      progress: 100,
      status: 'complete' as const,
    };
    setFiles([uploadedFile]); // Replace, not append - single document only
    setVaultContext(null); // Clear vault context when uploading new file
    setError(null);
  }, []);

  const handleFileRemove = useCallback((fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    setExtractedTexts((prev) => {
      const newMap = new Map(prev);
      newMap.delete(fileId);
      return newMap;
    });
  }, []);

  // Handle document selection from vault
  const handleVaultDocumentSelect = useCallback(async (vaultId: string, document: { id: string; filename: string; sizeBytes: number }) => {
    setIsProcessing(true);
    setProcessingStatus({ step: 'Loading document...', progress: 20, message: `Fetching ${document.filename} from vault` });
    setError(null);
    
    try {
      // Fetch the document text from the vault
      const response = await fetch(`/api/vault/${vaultId}/objects/${document.id}/text`);
      if (!response.ok) {
        throw new Error('Failed to load document text');
      }
      const data = await response.json();
      
      // Create a virtual file entry for the vault document
      const virtualFile: ProcessedFile = {
        id: document.id,
        file: new File([data.text], document.filename, { type: 'text/plain' }),
        progress: 100,
        status: 'complete',
        extractedText: data.text,
      };
      
      setFiles([virtualFile]);
      setExtractedTexts(new Map([[document.id, data.text]]));
      setVaultContext({
        vaultId,
        objectId: document.id,
        filename: document.filename,
      });
      
      setProcessingStatus({ step: 'Document loaded', progress: 100, message: 'Ready for redaction' });
      
      // Auto-advance to configure step
      setTimeout(() => {
        setCurrentStep('configure');
        setProcessingStatus(null);
      }, 500);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document');
      setProcessingStatus(null);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleEntityToggle = useCallback((entityId: string, shouldRedact: boolean) => {
    setEntities((prev) =>
      prev.map((e) => (e.id === entityId ? { ...e, shouldRedact } : e))
    );
  }, []);

  const handleEntitySelect = useCallback((entityId: string) => {
    setSelectedEntityId(entityId);
  }, []);

  const handleSelectAll = useCallback((shouldRedact: boolean) => {
    setEntities((prev) => prev.map((e) => ({ ...e, shouldRedact })));
  }, []);

  const handleMaskedValueUpdate = useCallback((entityId: string, newMaskedValue: string) => {
    setEntities((prev) =>
      prev.map((e) => (e.id === entityId ? { ...e, maskedValue: newMaskedValue } : e))
    );
  }, []);

  const handleAddCustomRedaction = useCallback((text: string, pageNumber: number) => {
    // Create a new custom entity for the selected text
    const newEntity: DetectedEntity = {
      id: uuidv4(),
      type: 'CUSTOM' as EntityType,
      value: text,
      maskedValue: '[REDACTED]',
      pageNumber,
      confidence: 1.0,
      detectionMethod: 'regex', // Mark as manual/custom
      context: 'Manually selected for redaction',
      shouldRedact: true,
    };
    
    setEntities((prev) => [...prev, newEntity]);
    setSelectedEntityId(newEntity.id);
  }, []);

  // Extract text from a file using Case.dev OCR API
  const extractTextFromFile = async (file: File): Promise<string> => {
    const fileType = file.type;
    
    // For text files, read directly
    if (fileType === 'text/plain') {
      return await file.text();
    }
    
    // For PDFs and images, use Case.dev OCR API
    if (fileType === 'application/pdf' || fileType.startsWith('image/')) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/api/ocr', {
          method: 'POST',
          body: formData,
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'OCR failed' }));
          throw new Error(errorData.error || 'OCR processing failed');
        }
        
        const result = await response.json();
        return result.text || '';
      } catch (ocrError) {
        console.error('OCR extraction failed:', ocrError);
        // Return a message indicating text couldn't be extracted
        return `[OCR extraction failed for: ${file.name}. Error: ${ocrError instanceof Error ? ocrError.message : 'Unknown error'}]`;
      }
    }
    
    return `[Unsupported file type: ${fileType}]`;
  };

  const processDocuments = async () => {
    if (files.length === 0 || selectedTypes.length === 0) return;

    setIsProcessing(true);
    setError(null);
    setProcessingStatus({ step: 'Extracting text via OCR...', progress: 5, message: 'Uploading document to Case.dev OCR' });

    try {
      const allEntities: DetectedEntity[] = [];
      const newExtractedTexts = new Map<string, string>();
      
      // Process each file (should be just one in single-document mode)
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileProgress = (i / files.length) * 100;
        
        setProcessingStatus({ 
          step: 'Extracting text via OCR...', 
          progress: 5 + (fileProgress * 0.2), 
          message: `OCR processing ${file.file.name}` 
        });
        
        // Extract text from the file (or use pre-extracted for vault docs)
        let extractedText = file.extractedText || extractedTexts.get(file.id);
        if (!extractedText) {
          extractedText = await extractTextFromFile(file.file);
          newExtractedTexts.set(file.id, extractedText);
        } else {
          newExtractedTexts.set(file.id, extractedText);
        }
        
        setProcessingStatus({ 
          step: vaultContext ? 'Detecting PII (4-pass vault-enhanced scan)...' : 'Detecting PII (3-pass comprehensive scan)...', 
          progress: 25 + (fileProgress * 0.2), 
          message: `Pass 1: Pattern matching on ${file.file.name}` 
        });
        
        // Small delay to show progress
        await new Promise(resolve => setTimeout(resolve, 100));
        
        setProcessingStatus({ 
          step: vaultContext ? 'Detecting PII (4-pass vault-enhanced scan)...' : 'Detecting PII (3-pass comprehensive scan)...', 
          progress: 35 + (fileProgress * 0.2), 
          message: `Pass 2: AI contextual analysis on ${file.file.name}` 
        });
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        setProcessingStatus({ 
          step: vaultContext ? 'Detecting PII (4-pass vault-enhanced scan)...' : 'Detecting PII (3-pass comprehensive scan)...', 
          progress: 50 + (fileProgress * 0.2), 
          message: `Pass 3: Retrospective scan - finding ALL occurrences` 
        });
        
        // Call the API for detection (with vault context if available)
        const response = await fetch('/api/detect-pii', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: extractedText,
            types: selectedTypes,
            vaultContext: vaultContext ? {
              vaultId: vaultContext.vaultId,
              objectId: vaultContext.objectId,
            } : undefined,
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Detection failed');
        }
        
        const result = await response.json();
        
        // Convert API matches to entities
        result.matches.forEach((match: {
          id: string;
          type: EntityType;
          value: string;
          maskedValue: string;
          startIndex: number;
          endIndex: number;
          confidence: number;
          context?: string;
          detectionMethod: 'regex' | 'llm' | 'vault';
        }) => {
          allEntities.push({
            id: match.id,
            type: match.type,
            value: match.value,
            maskedValue: match.maskedValue,
            pageNumber: i + 1, // File index as page number
            confidence: match.confidence,
            detectionMethod: match.detectionMethod,
            context: match.context || `Found in ${file.file.name} at position ${match.startIndex}`,
            shouldRedact: true,
          });
        });
        
        setProcessingStatus({ 
          step: 'Processing...', 
          progress: 70 + (fileProgress * 0.1), 
          message: `Found ${result.count} items in ${file.file.name}` 
        });
        
        // Check for cached redactions in this file
        setProcessingStatus({ 
          step: 'Applying cached redactions...', 
          progress: 80 + (fileProgress * 0.1), 
          message: `Checking cache for ${file.file.name}` 
        });
        
        const cachedMatches = findCachedMatches(extractedText);
        cachedMatches.forEach((match) => {
          // Get the actual text from the document at this position
          const actualText = extractedText.substring(match.startIndex, match.endIndex);
          
          // Check if this exact position/value is already detected
          const alreadyDetected = allEntities.some(
            e => e.value === actualText && e.pageNumber === i + 1
          );
          
          if (!alreadyDetected) {
            allEntities.push({
              id: uuidv4(),
              type: match.cached.type,
              value: actualText, // Use actual text from document for proper highlighting
              maskedValue: match.cached.maskedValue,
              pageNumber: i + 1,
              confidence: 1.0,
              detectionMethod: 'regex',
              context: 'Previously redacted (from cache)',
              shouldRedact: true,
            });
          }
        });
      }
      
      // Update extracted texts state
      setExtractedTexts((prev) => {
        const merged = new Map(prev);
        newExtractedTexts.forEach((value, key) => merged.set(key, value));
        return merged;
      });

      // Count how many came from cache
      const cachedCount = allEntities.filter(e => e.context === 'Previously redacted (from cache)').length;
      const vaultCount = allEntities.filter(e => e.detectionMethod === 'vault').length;
      let message = `Found ${allEntities.length} items total`;
      if (cachedCount > 0) message += ` (${cachedCount} from cache)`;
      if (vaultCount > 0) message += ` (${vaultCount} from vault search)`;
      
      setProcessingStatus({ 
        step: 'Complete', 
        progress: 100, 
        message 
      });

      setEntities(allEntities);
      setSelectedEntityId(null);
      setCurrentStep('review');
    } catch (err) {
      console.error('Processing error:', err);
      setError(err instanceof Error ? err.message : 'Processing failed');
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const exportRedactedDocuments = async () => {
    const toRedact = entities.filter((e) => e.shouldRedact);
    if (toRedact.length === 0) return;

    setIsProcessing(true);
    setProcessingStatus({ step: 'Generating redacted PDFs...', progress: 30, message: 'Applying redactions' });

    try {
      // Combine all extracted texts
      const allText = Array.from(extractedTexts.values()).join('\n\n--- Document Break ---\n\n');
      
      setProcessingStatus({ step: 'Creating PDF...', progress: 60, message: 'Building redacted document' });
      
      // Call the export API
      const response = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: allText,
          entities: entities.map(e => ({
            id: e.id,
            type: e.type,
            value: e.value,
            maskedValue: e.maskedValue,
            startIndex: 0, // We'll need to recalculate for combined text
            endIndex: 0,
            shouldRedact: e.shouldRedact,
          })),
          filename: `redacted-${new Date().toISOString().split('T')[0]}.pdf`,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Export failed');
      }
      
      setProcessingStatus({ step: 'Saving to cache...', progress: 85, message: 'Remembering redactions for future use' });
      
      // Save redacted entities to cache for future use
      const redactedEntities = entities.filter(e => e.shouldRedact);
      addMultipleToCache(
        redactedEntities.map(e => ({
          value: e.value,
          maskedValue: e.maskedValue,
          type: e.type,
        }))
      );
      updateCacheStats();
      
      setProcessingStatus({ step: 'Finalizing...', progress: 95, message: 'Preparing download' });
      
      // Get the PDF blob and create download URL
      const pdfBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(pdfBlob);
      
      setExportUrl(downloadUrl);
      setCurrentStep('export');
    } catch (err) {
      console.error('Export error:', err);
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const downloadRedactedPdf = async () => {
    if (!exportUrl) return;
    
    // If we already have a blob URL, use it directly
    if (exportUrl.startsWith('blob:')) {
      const link = document.createElement('a');
      link.href = exportUrl;
      link.download = `redacted-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
    
    // Otherwise, generate a new PDF
    setIsProcessing(true);
    setProcessingStatus({ step: 'Generating PDF...', progress: 50, message: 'Creating download' });
    
    try {
      const allText = Array.from(extractedTexts.values()).join('\n\n--- Document Break ---\n\n');
      
      const response = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: allText,
          entities: entities.map(e => ({
            id: e.id,
            type: e.type,
            value: e.value,
            maskedValue: e.maskedValue,
            startIndex: 0,
            endIndex: 0,
            shouldRedact: e.shouldRedact,
          })),
          filename: `redacted-${new Date().toISOString().split('T')[0]}.pdf`,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }
      
      const pdfBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(pdfBlob);
      
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `redacted-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the blob URL
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setIsProcessing(false);
      setProcessingStatus(null);
    }
  };

  const downloadAuditLog = () => {
    const auditLog = {
      generatedAt: new Date().toISOString(),
      documentsProcessed: files.length,
      totalEntitiesFound: entities.length,
      entitiesRedacted: entities.filter(e => e.shouldRedact).length,
      redactionTypes: selectedTypes,
      vaultContext: vaultContext ? {
        vaultId: vaultContext.vaultId,
        objectId: vaultContext.objectId,
        filename: vaultContext.filename,
      } : null,
      entities: entities.map(e => ({
        type: e.type,
        originalValue: e.value,
        maskedValue: e.maskedValue,
        wasRedacted: e.shouldRedact,
        confidence: e.confidence,
        detectionMethod: e.detectionMethod,
      })),
    };
    
    const blob = new Blob([JSON.stringify(auditLog, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-log-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  };

  const resetWorkflow = () => {
    setCurrentStep('upload');
    setUploadMode('new');
    setFiles([]);
    setVaultContext(null);
    setEntities([]);
    setSelectedEntityId(null);
    setExportUrl(null);
    setError(null);
    setExtractedTexts(new Map());
    setShowVaultCreation(false);
    setNewVaultName('');
  };

  // Create a new vault and upload the current file to it
  const handleCreateVaultAndUpload = async () => {
    if (!files[0] || !newVaultName.trim()) return;
    
    setIsCreatingVault(true);
    setError(null);
    setProcessingStatus({ step: 'Creating vault...', progress: 10, message: `Creating vault "${newVaultName}"` });
    
    try {
      // Step 1: Create the vault
      const createResponse = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newVaultName.trim() }),
      });
      
      if (!createResponse.ok) {
        const errorData = await createResponse.json();
        throw new Error(errorData.error || 'Failed to create vault');
      }
      
      const vault = await createResponse.json();
      
      setProcessingStatus({ step: 'Getting upload URL...', progress: 30, message: 'Preparing file upload' });
      
      // Step 2: Get presigned upload URL
      const file = files[0].file;
      const uploadUrlResponse = await fetch(`/api/vault/${vault.id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
        }),
      });
      
      if (!uploadUrlResponse.ok) {
        throw new Error('Failed to get upload URL');
      }
      
      const { uploadUrl, objectId } = await uploadUrlResponse.json();
      
      setProcessingStatus({ step: 'Uploading file...', progress: 50, message: `Uploading ${file.name}` });
      
      // Step 3: Upload the file to the presigned URL
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      });
      
      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file');
      }
      
      setProcessingStatus({ step: 'Processing document...', progress: 70, message: 'Starting ingestion (OCR + indexing)' });
      
      // Step 4: Trigger ingestion
      const ingestResponse = await fetch(`/api/vault/${vault.id}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectId }),
      });
      
      if (!ingestResponse.ok) {
        throw new Error('Failed to start document processing');
      }
      
      setProcessingStatus({ step: 'Waiting for processing...', progress: 85, message: 'Document is being processed. This may take a moment...' });
      
      // Step 5: Poll for completion (with longer timeout for OCR)
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes max for OCR processing
      let documentReady = false;
      let lastStatus = 'pending';
      
      while (attempts < maxAttempts && !documentReady) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const objectsResponse = await fetch(`/api/vault/${vault.id}/objects`);
        if (objectsResponse.ok) {
          const { objects } = await objectsResponse.json();
          const doc = objects.find((o: { id: string; ingestionStatus: string }) => o.id === objectId);
          lastStatus = doc?.ingestionStatus || 'pending';
          if (doc?.ingestionStatus === 'completed') {
            documentReady = true;
          } else if (doc?.ingestionStatus === 'failed') {
            throw new Error('Document processing failed. The file may be corrupted or unsupported.');
          }
        }
        attempts++;
        const progressPercent = 85 + (attempts / maxAttempts) * 10;
        setProcessingStatus({ 
          step: 'Waiting for processing...', 
          progress: Math.min(progressPercent, 95), 
          message: `OCR processing in progress (${attempts}s)... Status: ${lastStatus}` 
        });
      }
      
      // Step 6: Fetch the document text (or proceed without vault context if still processing)
      let text = '';
      
      if (documentReady) {
        setProcessingStatus({ step: 'Loading document...', progress: 98, message: 'Fetching processed text' });
        
        const textResponse = await fetch(`/api/vault/${vault.id}/objects/${objectId}/text`);
        if (textResponse.ok) {
          const data = await textResponse.json();
          text = data.text;
        }
      }
      
      // If we couldn't get text from vault, fall back to local OCR
      if (!text) {
        setProcessingStatus({ 
          step: 'Processing locally...', 
          progress: 96, 
          message: 'Vault processing still in progress. Using local OCR instead...' 
        });
        
        // Use local OCR as fallback
        text = await extractTextFromFile(file);
        
        // Still set vault context so user can benefit from it later
        // but proceed with local text for now
      }
      
      // Update state with vault context
      const virtualFile: ProcessedFile = {
        id: objectId,
        file: new File([text], file.name, { type: 'text/plain' }),
        progress: 100,
        status: 'complete',
        extractedText: text,
      };
      
      setFiles([virtualFile]);
      setExtractedTexts(new Map([[objectId, text]]));
      setVaultContext({
        vaultId: vault.id,
        objectId,
        filename: file.name,
      });
      
      setProcessingStatus({ step: 'Complete!', progress: 100, message: `Document uploaded to vault "${newVaultName}"` });
      setShowVaultCreation(false);
      setNewVaultName('');
      
      // Auto-advance to configure step
      setTimeout(() => {
        setCurrentStep('configure');
        setProcessingStatus(null);
      }, 1000);
      
    } catch (err) {
      console.error('Vault creation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create vault');
      setProcessingStatus(null);
    } finally {
      setIsCreatingVault(false);
    }
  };

  // Check if we can proceed from upload step
  const canProceedFromUpload = files.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
                <Scissors className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Smart Redaction Tool</h1>
                <p className="text-sm text-muted-foreground">Auto-detect and redact PII with vault-enhanced detection</p>
              </div>
            </div>
            
            {/* Cache indicator */}
            {cacheStats && cacheStats.totalItems > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg">
                  <Database className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    <strong className="text-foreground">{cacheStats.totalItems}</strong> cached redactions
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (confirm('Clear all cached redactions? This cannot be undone.')) {
                      clearCache();
                      updateCacheStats();
                    }
                  }}
                  title="Clear cache"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {processingStatus && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{processingStatus.step}</p>
                  <p className="text-xs text-muted-foreground">{processingStatus.message}</p>
                  <Progress value={processingStatus.progress} className="h-2 mt-2" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={currentStep} onValueChange={(v) => setCurrentStep(v as WorkflowStep)} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="upload" disabled={isProcessing}>1. Select Document</TabsTrigger>
            <TabsTrigger value="configure" disabled={isProcessing || files.length === 0}>2. Configure</TabsTrigger>
            <TabsTrigger value="review" disabled={isProcessing || entities.length === 0}>3. Review</TabsTrigger>
            <TabsTrigger value="export" disabled={isProcessing || !exportUrl}>4. Export</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-6">
            {/* Two-tab upload interface */}
            <Card>
              <CardHeader>
                <CardTitle>Select a Document to Redact</CardTitle>
                <CardDescription>
                  Upload a new document or select one from your vaults for enhanced detection
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={uploadMode} onValueChange={(v) => setUploadMode(v as UploadMode)} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="new" className="flex items-center gap-2">
                      <Upload className="w-4 h-4" />
                      Upload New Document
                    </TabsTrigger>
                    <TabsTrigger value="vault" className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4" />
                      Select from Vault
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="new" className="space-y-4">
                    <DropZone 
                      files={files} 
                      onFilesSelected={handleFilesSelected} 
                      onFileRemove={handleFileRemove} 
                      disabled={isProcessing || isCreatingVault}
                      maxFiles={1}
                    />
                    
                    {/* Vault creation option after file upload */}
                    {files.length > 0 && !vaultContext && (
                      <div className="space-y-3">
                        {!showVaultCreation ? (
                          <Alert className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
                            <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            <AlertDescription className="text-blue-800 dark:text-blue-200">
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div>
                                  <strong>Tip:</strong> For more comprehensive redaction detection, upload your document to a vault. 
                                  Vault documents benefit from semantic search and cross-document entity recognition.
                                </div>
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  className="shrink-0 border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900"
                                  onClick={() => {
                                    setShowVaultCreation(true);
                                    // Default vault name based on filename
                                    const filename = files[0]?.file.name || '';
                                    const baseName = filename.replace(/\.[^/.]+$/, ''); // Remove extension
                                    setNewVaultName(baseName || 'New Vault');
                                  }}
                                >
                                  <Plus className="w-4 h-4 mr-1.5" />
                                  Create Vault
                                </Button>
                              </div>
                            </AlertDescription>
                          </Alert>
                        ) : (
                          <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
                            <CardContent className="pt-4">
                              <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                  <FolderOpen className="w-5 h-5 text-green-600 dark:text-green-400" />
                                  <h4 className="font-medium text-green-800 dark:text-green-200">Create New Vault</h4>
                                </div>
                                <p className="text-sm text-green-700 dark:text-green-300">
                                  Create a vault to store &quot;{files[0]?.file.name}&quot; for enhanced detection with semantic search.
                                </p>
                                <div className="space-y-2">
                                  <label htmlFor="vault-name" className="text-sm font-medium text-green-800 dark:text-green-200">
                                    Vault Name
                                  </label>
                                  <input
                                    id="vault-name"
                                    type="text"
                                    value={newVaultName}
                                    onChange={(e) => setNewVaultName(e.target.value)}
                                    placeholder="Enter vault name..."
                                    className="w-full px-3 py-2 text-sm border border-green-300 dark:border-green-700 rounded-md bg-white dark:bg-green-900 focus:outline-none focus:ring-2 focus:ring-green-500"
                                    disabled={isCreatingVault}
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    onClick={handleCreateVaultAndUpload}
                                    disabled={!newVaultName.trim() || isCreatingVault}
                                    className="bg-green-600 hover:bg-green-700 text-white"
                                  >
                                    {isCreatingVault ? (
                                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</>
                                    ) : (
                                      <><Plus className="w-4 h-4 mr-2" />Create Vault & Upload</>
                                    )}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      setShowVaultCreation(false);
                                      setNewVaultName('');
                                    }}
                                    disabled={isCreatingVault}
                                    className="border-green-300 text-green-700 hover:bg-green-100 dark:border-green-700 dark:text-green-300 dark:hover:bg-green-900"
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="vault">
                    <VaultBrowser 
                      onDocumentSelect={handleVaultDocumentSelect}
                    />
                    
                    {/* Show selected vault document */}
                    {vaultContext && (
                      <div className="mt-4 p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-lg">
                        <div className="flex items-center gap-3">
                          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                          <div>
                            <p className="text-sm font-medium text-green-800 dark:text-green-200">
                              Document selected: {vaultContext.filename}
                            </p>
                            <p className="text-xs text-green-600 dark:text-green-400">
                              Enhanced detection enabled via vault semantic search
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {canProceedFromUpload && (
              <div className="flex justify-end">
                <Button onClick={() => setCurrentStep('configure')}>
                  Continue to Configure <FileText className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="configure" className="space-y-6">
            {/* Show vault context badge if applicable */}
            {vaultContext && (
              <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
                <FolderOpen className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertTitle className="text-green-800 dark:text-green-200">Vault-Enhanced Detection</AlertTitle>
                <AlertDescription className="text-green-700 dark:text-green-300">
                  Processing <strong>{vaultContext.filename}</strong> with semantic search for improved entity detection.
                </AlertDescription>
              </Alert>
            )}
            
            <Card>
              <CardHeader>
                <CardTitle>Select Redaction Types</CardTitle>
                <CardDescription>Choose what types of sensitive information to detect and redact</CardDescription>
              </CardHeader>
              <CardContent>
                <PatternSelector selectedTypes={selectedTypes} onSelectionChange={setSelectedTypes} />
              </CardContent>
            </Card>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setCurrentStep('upload')}>Back</Button>
              <Button onClick={processDocuments} disabled={isProcessing || selectedTypes.length === 0}>
                {isProcessing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</> : <>Scan Document</>}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="review" className="space-y-4">
            {/* Navigation bar with configuration summary */}
            <div className="flex justify-between items-center py-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentStep('configure')}>
                Back
              </Button>
              <div className="flex items-center gap-4">
                {vaultContext && (
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-green-100 dark:bg-green-900 rounded text-xs">
                    <FolderOpen className="w-3 h-3 text-green-600 dark:text-green-400" />
                    <span className="text-green-700 dark:text-green-300">Vault-enhanced</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Detecting:</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedTypes.map((type) => (
                      <span key={type} className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-zinc-800 text-white rounded">
                        {type.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="text-border">|</span>
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">{entities.filter((e) => e.shouldRedact).length}</span> of {entities.length} items selected
                </div>
              </div>
              <Button size="sm" onClick={exportRedactedDocuments} disabled={isProcessing || entities.filter((e) => e.shouldRedact).length === 0}>
                {isProcessing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</> : <>Generate Redacted PDF</>}
              </Button>
            </div>

            {/* Two-column layout with document preview and entity list */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-280px)] min-h-[500px]">
              {/* Document Preview - shows document with highlighted redactions */}
              <DocumentPreview
                files={files}
                entities={entities}
                selectedEntityId={selectedEntityId}
                onEntityClick={handleEntitySelect}
                onAddCustomRedaction={handleAddCustomRedaction}
                extractedTexts={extractedTexts}
                className="h-full overflow-hidden"
              />

              {/* Entity List - scrollable panel with entity details */}
              <EntityList 
                entities={entities}
                selectedEntityId={selectedEntityId}
                onEntityToggle={handleEntityToggle}
                onEntitySelect={handleEntitySelect}
                onSelectAll={handleSelectAll}
                onMaskedValueUpdate={handleMaskedValueUpdate}
                className="h-full overflow-hidden"
              />
            </div>
          </TabsContent>

          <TabsContent value="export" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <CardTitle>Redaction Complete!</CardTitle>
                    <CardDescription>Your document has been processed and redacted</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-muted rounded-lg">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className="text-muted-foreground">Document processed:</span> <strong>{files[0]?.file.name || 'Unknown'}</strong></div>
                    <div><span className="text-muted-foreground">Items redacted:</span> <strong>{entities.filter((e) => e.shouldRedact).length}</strong></div>
                    {vaultContext && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Detection method:</span>{' '}
                        <strong className="text-green-600">Vault-enhanced (semantic search)</strong>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button className="flex-1" onClick={downloadRedactedPdf} disabled={isProcessing}>
                    {isProcessing ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
                    ) : (
                      <><Download className="w-4 h-4 mr-2" />Download Redacted PDF</>
                    )}
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={downloadAuditLog}>
                    <FileText className="w-4 h-4 mr-2" />Download Audit Log
                  </Button>
                </div>
              </CardContent>
            </Card>
            <div className="flex justify-center">
              <Button variant="outline" onClick={resetWorkflow}>Start New Redaction Job</Button>
            </div>
          </TabsContent>
        </Tabs>
      </main>
      
    </div>
  );
}
