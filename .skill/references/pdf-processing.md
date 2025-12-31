# PDF Processing Reference

Patterns for PDF text extraction and redacted PDF generation.

## Text Extraction with pdf.js

### Setup
```typescript
import * as pdfjsLib from 'pdfjs-dist';

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = 
  `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
```

### Extract Text from PDF
```typescript
interface ExtractedPage {
  pageNumber: number;
  text: string;
  textItems: TextItem[];
}

interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
}

async function extractTextFromPDF(file: File): Promise<ExtractedPage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: ExtractedPage[] = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    const textItems: TextItem[] = textContent.items.map((item: any) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      height: item.height,
      fontName: item.fontName,
    }));
    
    const text = textItems.map(item => item.text).join(' ');
    
    pages.push({
      pageNumber: i,
      text,
      textItems,
    });
  }
  
  return pages;
}
```

### Handle Scanned PDFs (OCR Fallback)
```typescript
async function extractWithOCRFallback(file: File): Promise<ExtractedPage[]> {
  const pages = await extractTextFromPDF(file);
  
  // Check if text extraction yielded meaningful content
  const totalText = pages.reduce((acc, p) => acc + p.text, '');
  
  if (totalText.trim().length < 100) {
    // Likely a scanned PDF - use OCR
    return await extractWithOCR(file);
  }
  
  return pages;
}

async function extractWithOCR(file: File): Promise<ExtractedPage[]> {
  // Use Case.dev OCR API
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch('/api/ocr', {
    method: 'POST',
    body: formData,
  });
  
  return response.json();
}
```

## PDF Generation with pdf-lib

### Setup
```typescript
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
```

### Create Redacted PDF
```typescript
interface RedactionBox {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;  // Optional label like "[SSN]"
}

async function createRedactedPDF(
  originalPdf: ArrayBuffer,
  redactions: RedactionBox[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdf);
  const pages = pdfDoc.getPages();
  
  // Group redactions by page
  const redactionsByPage = groupBy(redactions, 'pageNumber');
  
  for (const [pageNum, pageRedactions] of Object.entries(redactionsByPage)) {
    const page = pages[parseInt(pageNum) - 1];
    const { height } = page.getSize();
    
    for (const redaction of pageRedactions) {
      // Draw black rectangle
      page.drawRectangle({
        x: redaction.x,
        y: height - redaction.y - redaction.height,  // PDF coordinates are bottom-up
        width: redaction.width,
        height: redaction.height,
        color: rgb(0, 0, 0),
      });
      
      // Optional: Add label
      if (redaction.label) {
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontSize = Math.min(redaction.height * 0.6, 10);
        
        page.drawText(redaction.label, {
          x: redaction.x + 2,
          y: height - redaction.y - redaction.height + 2,
          size: fontSize,
          font,
          color: rgb(1, 1, 1),  // White text
        });
      }
    }
  }
  
  return pdfDoc.save();
}
```

### Generate New PDF from Text
```typescript
async function generatePDFFromText(
  text: string,
  redactedEntities: DetectedEntity[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontSize = 12;
  const lineHeight = fontSize * 1.2;
  const margin = 72;  // 1 inch
  const pageWidth = 612;  // Letter size
  const pageHeight = 792;
  const textWidth = pageWidth - (margin * 2);
  
  // Apply redactions to text
  let redactedText = text;
  // Sort by position descending to maintain indices
  const sortedEntities = [...redactedEntities]
    .filter(e => e.enabled !== false)
    .sort((a, b) => b.startIndex - a.startIndex);
  
  for (const entity of sortedEntities) {
    redactedText = 
      redactedText.slice(0, entity.startIndex) +
      entity.maskedValue +
      redactedText.slice(entity.endIndex);
  }
  
  // Split into lines
  const words = redactedText.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';
  
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    
    if (width > textWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  
  // Create pages
  let y = pageHeight - margin;
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  
  for (const line of lines) {
    if (y < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    
    page.drawText(line, {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    
    y -= lineHeight;
  }
  
  return pdfDoc.save();
}
```

## Mapping Text Positions

### Find Entity Positions in PDF
```typescript
function findEntityPositions(
  textItems: TextItem[],
  entity: DetectedEntity
): RedactionBox | null {
  let currentIndex = 0;
  let startItem: TextItem | null = null;
  let endItem: TextItem | null = null;
  
  for (const item of textItems) {
    const itemStart = currentIndex;
    const itemEnd = currentIndex + item.text.length;
    
    // Check if entity starts in this item
    if (entity.startIndex >= itemStart && entity.startIndex < itemEnd) {
      startItem = item;
    }
    
    // Check if entity ends in this item
    if (entity.endIndex > itemStart && entity.endIndex <= itemEnd) {
      endItem = item;
      break;
    }
    
    currentIndex = itemEnd + 1;  // +1 for space
  }
  
  if (!startItem || !endItem) return null;
  
  return {
    x: startItem.x,
    y: startItem.y,
    width: endItem.x + endItem.width - startItem.x,
    height: Math.max(startItem.height, endItem.height),
  };
}
```

## Audit Log Generation

```typescript
interface AuditLogEntry {
  timestamp: string;
  documentName: string;
  totalEntitiesFound: number;
  entitiesRedacted: number;
  entitiesSkipped: number;
  redactionsByType: Record<string, number>;
  processingTimeMs: number;
}

function generateAuditLog(
  documentName: string,
  entities: DetectedEntity[],
  startTime: number
): AuditLogEntry {
  const redacted = entities.filter(e => e.enabled !== false);
  const skipped = entities.filter(e => e.enabled === false);
  
  const byType: Record<string, number> = {};
  for (const entity of redacted) {
    byType[entity.type] = (byType[entity.type] || 0) + 1;
  }
  
  return {
    timestamp: new Date().toISOString(),
    documentName,
    totalEntitiesFound: entities.length,
    entitiesRedacted: redacted.length,
    entitiesSkipped: skipped.length,
    redactionsByType: byType,
    processingTimeMs: Date.now() - startTime,
  };
}

async function appendAuditLogToPDF(
  pdfBytes: Uint8Array,
  auditLog: AuditLogEntry
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Courier);
  
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  
  let y = height - 72;
  const lines = [
    'REDACTION AUDIT LOG',
    '==================',
    '',
    `Document: ${auditLog.documentName}`,
    `Processed: ${auditLog.timestamp}`,
    `Processing Time: ${auditLog.processingTimeMs}ms`,
    '',
    `Total PII Found: ${auditLog.totalEntitiesFound}`,
    `Entities Redacted: ${auditLog.entitiesRedacted}`,
    `Entities Skipped: ${auditLog.entitiesSkipped}`,
    '',
    'Redactions by Type:',
    ...Object.entries(auditLog.redactionsByType)
      .map(([type, count]) => `  ${type}: ${count}`),
  ];
  
  for (const line of lines) {
    page.drawText(line, {
      x: 72,
      y,
      size: 10,
      font,
      color: rgb(0, 0, 0),
    });
    y -= 14;
  }
  
  return pdfDoc.save();
}
```

## Download Helper

```typescript
function downloadPDF(pdfBytes: Uint8Array, filename: string): void {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}
```
