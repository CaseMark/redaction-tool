'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import { FileText, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { DetectedEntity } from './EntityList';

interface DocumentPreviewProps {
  files: Array<{ id: string; file: File }>;
  entities: DetectedEntity[];
  selectedEntityId: string | null;
  onEntityClick: (entityId: string) => void;
  extractedTexts?: Map<string, string>;
  className?: string;
}

export function DocumentPreview({ 
  files, 
  entities, 
  selectedEntityId, 
  onEntityClick,
  extractedTexts,
  className 
}: DocumentPreviewProps) {
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [viewMode, setViewMode] = useState<'document' | 'text'>('text');
  const [showRedacted, setShowRedacted] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const entityRefs = useRef<Map<string, HTMLSpanElement>>(new Map());

  const currentFile = files[currentFileIndex];

  // Create object URL for the current file
  useEffect(() => {
    if (currentFile?.file) {
      const url = URL.createObjectURL(currentFile.file);
      setFileUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setFileUrl(null);
  }, [currentFile]);

  // Scroll to selected entity
  useEffect(() => {
    if (selectedEntityId && viewMode === 'text') {
      const element = entityRefs.current.get(selectedEntityId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [selectedEntityId, viewMode]);

  // Get file type
  const fileType = useMemo(() => {
    if (!currentFile?.file) return null;
    const type = currentFile.file.type;
    if (type === 'application/pdf') return 'pdf';
    if (type.startsWith('image/')) return 'image';
    if (type === 'text/plain') return 'text';
    return 'unknown';
  }, [currentFile]);

  // Get extracted text for current file
  const currentExtractedText = useMemo(() => {
    if (!currentFile || !extractedTexts) return null;
    return extractedTexts.get(currentFile.id) || null;
  }, [currentFile, extractedTexts]);

  // Filter entities for current page/file
  const currentEntities = useMemo(() => {
    return entities.filter(e => e.pageNumber === currentFileIndex + 1);
  }, [entities, currentFileIndex]);

  // Create highlighted text content
  const highlightedContent = useMemo(() => {
    if (!currentExtractedText) return null;
    
    const text = currentExtractedText;
    const segments: Array<{ text: string; entity?: DetectedEntity; isHighlight: boolean }> = [];
    
    // Find all entity matches in the text
    const entityMatches: Array<{ start: number; end: number; entity: DetectedEntity }> = [];
    
    currentEntities.forEach((entity) => {
      const searchValue = entity.value;
      let index = text.indexOf(searchValue);
      while (index !== -1) {
        entityMatches.push({
          start: index,
          end: index + searchValue.length,
          entity,
        });
        index = text.indexOf(searchValue, index + 1);
      }
    });

    // Sort by start position
    entityMatches.sort((a, b) => a.start - b.start);

    // Remove overlapping matches (keep first)
    const filteredMatches: typeof entityMatches = [];
    for (const match of entityMatches) {
      const overlaps = filteredMatches.some(
        (m) => (match.start >= m.start && match.start < m.end) ||
               (match.end > m.start && match.end <= m.end)
      );
      if (!overlaps) {
        filteredMatches.push(match);
      }
    }

    // Build segments
    let lastIndex = 0;
    for (const match of filteredMatches) {
      if (match.start > lastIndex) {
        segments.push({
          text: text.substring(lastIndex, match.start),
          isHighlight: false,
        });
      }
      segments.push({
        text: text.substring(match.start, match.end),
        entity: match.entity,
        isHighlight: true,
      });
      lastIndex = match.end;
    }
    if (lastIndex < text.length) {
      segments.push({
        text: text.substring(lastIndex),
        isHighlight: false,
      });
    }

    return segments;
  }, [currentExtractedText, currentEntities]);

  const handlePrevFile = () => {
    setCurrentFileIndex(prev => Math.max(0, prev - 1));
  };

  const handleNextFile = () => {
    setCurrentFileIndex(prev => Math.min(files.length - 1, prev + 1));
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(200, prev + 25));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(50, prev - 25));
  };

  if (files.length === 0) {
    return (
      <Card className={cn('flex flex-col', className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold tracking-tight">Document Preview</CardTitle>
          <CardDescription className="text-xs">Upload documents to see preview</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No documents uploaded</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="pb-3 space-y-1 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold tracking-tight">Document Preview</CardTitle>
            <CardDescription className="text-xs truncate max-w-[200px]">
              {currentFile?.file.name}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'document' | 'text')} className="h-8">
              <TabsList className="h-7">
                <TabsTrigger value="text" className="text-xs h-6 px-2">Text</TabsTrigger>
                <TabsTrigger value="document" className="text-xs h-6 px-2">Original</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        
        {/* File navigation and controls */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-1">
            {files.length > 1 && (
              <>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handlePrevFile} disabled={currentFileIndex === 0}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground px-1">
                  {currentFileIndex + 1}/{files.length}
                </span>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleNextFile} disabled={currentFileIndex === files.length - 1}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
          
          <div className="flex items-center gap-1">
            {viewMode === 'text' && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 px-2 text-xs"
                onClick={() => setShowRedacted(!showRedacted)}
              >
                {showRedacted ? <EyeOff className="w-3.5 h-3.5 mr-1" /> : <Eye className="w-3.5 h-3.5 mr-1" />}
                {showRedacted ? 'Show Original' : 'Show Redacted'}
              </Button>
            )}
            {viewMode === 'document' && (
              <>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleZoomOut} disabled={zoom <= 50}>
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground w-10 text-center">{zoom}%</span>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleZoomIn} disabled={zoom >= 200}>
                  <ZoomIn className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Entity legend */}
        {currentEntities.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            <span className="text-xs text-muted-foreground">Detected:</span>
            {Array.from(new Set(currentEntities.map(e => e.type))).map((type) => (
              <span
                key={type}
                className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-zinc-800 text-white rounded"
              >
                {type.replace('_', ' ')}
              </span>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="flex-1 p-0 min-h-0 overflow-hidden" ref={containerRef}>
        {/* Text View - Shows extracted text with highlighted redactions */}
        {viewMode === 'text' && (
          <div className="h-full overflow-auto bg-white dark:bg-zinc-950 p-4">
            {highlightedContent ? (
              <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap">
                {highlightedContent.map((segment, index) => {
                  if (!segment.isHighlight || !segment.entity) {
                    return <span key={index}>{segment.text}</span>;
                  }

                  const entity = segment.entity;
                  const isSelected = selectedEntityId === entity.id;
                  const displayText = showRedacted && entity.shouldRedact 
                    ? entity.maskedValue 
                    : segment.text;

                  return (
                    <span
                      key={index}
                      ref={(el) => {
                        if (el) entityRefs.current.set(entity.id, el);
                      }}
                      onClick={() => onEntityClick(entity.id)}
                      className={cn(
                        'cursor-pointer px-1 py-0.5 rounded transition-all inline',
                        entity.shouldRedact 
                          ? 'bg-zinc-200 dark:bg-zinc-700' 
                          : 'bg-zinc-100 dark:bg-zinc-800 opacity-50',
                        isSelected && 'ring-2 ring-zinc-900 dark:ring-zinc-100 bg-zinc-300 dark:bg-zinc-600',
                        'hover:bg-zinc-300 dark:hover:bg-zinc-600'
                      )}
                      title={`${entity.type}: ${entity.shouldRedact ? 'Will be redacted' : 'Excluded from redaction'}`}
                    >
                      {displayText}
                    </span>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-muted-foreground">
                  <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No text extracted from this document</p>
                  <p className="text-xs mt-1">Try uploading a PDF or text file</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Document View - Shows original document */}
        {viewMode === 'document' && (
          <div className="h-full overflow-auto bg-zinc-100 dark:bg-zinc-900">
            {fileUrl && fileType === 'pdf' && (
              <div 
                className="flex items-start justify-center p-4"
                style={{ minHeight: '100%' }}
              >
                <div 
                  className="bg-white shadow-lg"
                  style={{ 
                    width: `${zoom}%`,
                    maxWidth: '100%',
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: 'top center'
                  }}
                >
                  <embed
                    src={`${fileUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                    type="application/pdf"
                    className="w-full"
                    style={{ height: '800px' }}
                  />
                </div>
              </div>
            )}

            {fileUrl && fileType === 'image' && (
              <div 
                className="flex items-start justify-center p-4"
                style={{ minHeight: '100%' }}
              >
                <img
                  src={fileUrl}
                  alt={currentFile?.file.name}
                  className="max-w-full shadow-lg bg-white"
                  style={{ 
                    width: `${zoom}%`,
                    maxWidth: 'none'
                  }}
                />
              </div>
            )}

            {fileType === 'text' && currentExtractedText && (
              <div className="p-4">
                <pre className="font-mono text-sm whitespace-pre-wrap bg-white dark:bg-zinc-950 p-4 rounded shadow">
                  {currentExtractedText}
                </pre>
              </div>
            )}

            {fileType === 'unknown' && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-muted-foreground p-8">
                  <FileText className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p className="text-sm font-medium mb-1">Preview not available</p>
                  <p className="text-xs">File type: {currentFile?.file.type || 'Unknown'}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Detected entities summary bar */}
      {currentEntities.length > 0 && (
        <div className="border-t p-3 shrink-0">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {currentEntities.filter(e => e.shouldRedact).length} redactions on this page
            </span>
            <div className="flex gap-1 overflow-x-auto">
              {currentEntities.slice(0, 5).map((entity) => (
                <button
                  key={entity.id}
                  onClick={() => onEntityClick(entity.id)}
                  className={cn(
                    'px-2 py-1 rounded text-[10px] font-mono transition-colors whitespace-nowrap',
                    'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                    selectedEntityId === entity.id && 'ring-2 ring-zinc-900 dark:ring-zinc-100',
                    !entity.shouldRedact && 'opacity-40 line-through'
                  )}
                >
                  {entity.maskedValue.length > 10 ? entity.maskedValue.slice(0, 10) + '...' : entity.maskedValue}
                </button>
              ))}
              {currentEntities.length > 5 && (
                <span className="px-2 py-1 text-[10px] text-muted-foreground">
                  +{currentEntities.length - 5} more
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
