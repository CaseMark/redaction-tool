'use client';

import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Scissors, Download, FileText, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { DropZone, UploadedFile } from '@/components/upload/DropZone';
import { PatternSelector } from '@/components/redaction/PatternSelector';
import { EntityList, DetectedEntity } from '@/components/redaction/EntityList';
import { DocumentPreview } from '@/components/redaction/DocumentPreview';
import { EntityType } from '@/lib/redaction/patterns';

type WorkflowStep = 'upload' | 'configure' | 'review' | 'export';

interface ProcessingStatus {
  step: string;
  progress: number;
  message: string;
}

// Extended file type with extracted text
interface ProcessedFile extends UploadedFile {
  extractedText?: string;
}

export default function RedactionTool() {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('upload');
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<EntityType[]>(['SSN', 'ACCOUNT_NUMBER', 'CREDIT_CARD']);
  const [entities, setEntities] = useState<DetectedEntity[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [extractedTexts, setExtractedTexts] = useState<Map<string, string>>(new Map());

  const handleFilesSelected = useCallback((newFiles: File[]) => {
    const uploadedFiles: ProcessedFile[] = newFiles.map((file) => ({
      id: uuidv4(),
      file,
      progress: 100,
      status: 'complete' as const,
    }));
    setFiles((prev) => [...prev, ...uploadedFiles]);
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

  // Extract text from a file
  const extractTextFromFile = async (file: File): Promise<string> => {
    const fileType = file.type;
    
    // For text files, read directly
    if (fileType === 'text/plain') {
      return await file.text();
    }
    
    // For PDFs, we'll use pdf.js (loaded dynamically)
    if (fileType === 'application/pdf') {
      try {
        // Dynamic import of pdf.js
        const pdfjsLib = await import('pdfjs-dist');
        
        // Use local worker file from public folder
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item) => {
              // TextItem has 'str' property, TextMarkedContent does not
              if ('str' in item && typeof item.str === 'string') {
                return item.str;
              }
              return '';
            })
            .join(' ');
          fullText += pageText + '\n\n';
        }
        
        return fullText.trim();
      } catch (pdfError) {
        console.error('PDF extraction failed:', pdfError);
        // Return a message indicating PDF text couldn't be extracted
        return `[PDF text extraction unavailable - file: ${file.name}]`;
      }
    }
    
    // For images, we would use OCR (Tesseract.js or server-side)
    // For now, return a placeholder indicating OCR is needed
    if (fileType.startsWith('image/')) {
      return `[Image file - OCR processing required for: ${file.name}]`;
    }
    
    return `[Unsupported file type: ${fileType}]`;
  };

  const processDocuments = async () => {
    if (files.length === 0 || selectedTypes.length === 0) return;

    setIsProcessing(true);
    setError(null);
    setProcessingStatus({ step: 'Extracting text...', progress: 5, message: 'Reading document content' });

    try {
      const allEntities: DetectedEntity[] = [];
      const newExtractedTexts = new Map<string, string>();
      
      // Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileProgress = (i / files.length) * 100;
        
        setProcessingStatus({ 
          step: 'Extracting text...', 
          progress: 5 + (fileProgress * 0.2), 
          message: `Processing ${file.file.name}` 
        });
        
        // Extract text from the file
        let extractedText = extractedTexts.get(file.id);
        if (!extractedText) {
          extractedText = await extractTextFromFile(file.file);
          newExtractedTexts.set(file.id, extractedText);
        }
        
        setProcessingStatus({ 
          step: 'Detecting PII (Pass 1: Pattern matching)...', 
          progress: 25 + (fileProgress * 0.2), 
          message: `Scanning ${file.file.name} with regex patterns` 
        });
        
        setProcessingStatus({ 
          step: 'Detecting PII (Pass 2: AI analysis)...', 
          progress: 45 + (fileProgress * 0.3), 
          message: `Running AI detection on ${file.file.name}` 
        });
        
        // Call the API for two-pass detection (regex + LLM)
        const response = await fetch('/api/detect-pii', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: extractedText,
            types: selectedTypes,
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
          detectionMethod: 'regex' | 'llm';
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
          progress: 75 + (fileProgress * 0.2), 
          message: `Found ${result.count} items in ${file.file.name}` 
        });
      }
      
      // Update extracted texts state
      setExtractedTexts((prev) => {
        const merged = new Map(prev);
        newExtractedTexts.forEach((value, key) => merged.set(key, value));
        return merged;
      });

      setProcessingStatus({ step: 'Complete', progress: 100, message: `Found ${allEntities.length} items total` });

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
      
      setProcessingStatus({ step: 'Finalizing...', progress: 90, message: 'Preparing download' });
      
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
    setFiles([]);
    setEntities([]);
    setSelectedEntityId(null);
    setExportUrl(null);
    setError(null);
    setExtractedTexts(new Map());
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <Scissors className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Smart Redaction Tool</h1>
              <p className="text-sm text-muted-foreground">Auto-detect and redact PII across document sets</p>
            </div>
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
            <TabsTrigger value="upload" disabled={isProcessing}>1. Upload</TabsTrigger>
            <TabsTrigger value="configure" disabled={isProcessing || files.length === 0}>2. Configure</TabsTrigger>
            <TabsTrigger value="review" disabled={isProcessing || entities.length === 0}>3. Review</TabsTrigger>
            <TabsTrigger value="export" disabled={isProcessing || !exportUrl}>4. Export</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Upload Documents</CardTitle>
                <CardDescription>Upload PDFs, images, or text files to scan for sensitive information</CardDescription>
              </CardHeader>
              <CardContent>
                <DropZone files={files} onFilesSelected={handleFilesSelected} onFileRemove={handleFileRemove} disabled={isProcessing} />
              </CardContent>
            </Card>
            {files.length > 0 && (
              <div className="flex justify-end">
                <Button onClick={() => setCurrentStep('configure')}>
                  Continue to Configure <FileText className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="configure" className="space-y-6">
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
                {isProcessing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Processing...</> : <>Scan Documents</>}
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
                {isProcessing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</> : <>Generate Redacted PDFs</>}
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
                    <CardDescription>Your documents have been processed and redacted</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-muted rounded-lg">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className="text-muted-foreground">Documents processed:</span> <strong>{files.length}</strong></div>
                    <div><span className="text-muted-foreground">Items redacted:</span> <strong>{entities.filter((e) => e.shouldRedact).length}</strong></div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button className="flex-1" onClick={downloadRedactedPdf} disabled={isProcessing}>
                    {isProcessing ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
                    ) : (
                      <><Download className="w-4 h-4 mr-2" />Download Redacted PDFs</>
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
