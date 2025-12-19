import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

interface RedactionEntity {
  id: string;
  type: string;
  value: string;
  maskedValue: string;
  startIndex: number;
  endIndex: number;
  shouldRedact: boolean;
}

interface ExportRequest {
  text: string;
  entities: RedactionEntity[];
  filename?: string;
}

/**
 * POST /api/export-pdf - Generate a redacted PDF from text and entities
 * 
 * This endpoint takes the extracted text and redaction entities,
 * applies the redactions, and generates a downloadable PDF.
 */
export async function POST(request: NextRequest) {
  try {
    const body: ExportRequest = await request.json();
    const { text, entities, filename = 'redacted-document.pdf' } = body;

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    // Filter entities that should be redacted
    const entitiesToRedact = entities.filter(e => e.shouldRedact);

    // Apply redactions to text by replacing all occurrences of each value
    let redactedText = text;
    for (const entity of entitiesToRedact) {
      // Escape special regex characters in the value
      const escapedValue = entity.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Replace all occurrences of the value with the masked value
      const regex = new RegExp(escapedValue, 'g');
      redactedText = redactedText.replace(regex, entity.maskedValue);
    }

    // Create PDF document
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Courier);
    
    // PDF settings
    const fontSize = 10;
    const lineHeight = fontSize * 1.4;
    const margin = 50;
    const pageWidth = 612; // Letter size
    const pageHeight = 792;
    const maxWidth = pageWidth - (margin * 2);
    const maxLinesPerPage = Math.floor((pageHeight - (margin * 2)) / lineHeight);

    // Split text into lines that fit the page width
    const lines: string[] = [];
    const paragraphs = redactedText.split('\n');
    
    for (const paragraph of paragraphs) {
      if (paragraph.trim() === '') {
        lines.push('');
        continue;
      }
      
      const words = paragraph.split(' ');
      let currentLine = '';
      
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const textWidth = font.widthOfTextAtSize(testLine, fontSize);
        
        if (textWidth > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      
      if (currentLine) {
        lines.push(currentLine);
      }
    }

    // Create pages and add text
    let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPosition = pageHeight - margin;
    let lineCount = 0;

    // Add header
    currentPage.drawText('REDACTED DOCUMENT', {
      x: margin,
      y: yPosition,
      size: 14,
      font,
      color: rgb(0.8, 0, 0),
    });
    yPosition -= lineHeight * 2;
    lineCount += 2;

    // Add redaction summary
    const summaryText = `Redactions applied: ${entitiesToRedact.length}`;
    currentPage.drawText(summaryText, {
      x: margin,
      y: yPosition,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    yPosition -= lineHeight * 2;
    lineCount += 2;

    // Draw separator line
    currentPage.drawLine({
      start: { x: margin, y: yPosition + lineHeight / 2 },
      end: { x: pageWidth - margin, y: yPosition + lineHeight / 2 },
      thickness: 0.5,
      color: rgb(0.7, 0.7, 0.7),
    });
    yPosition -= lineHeight;
    lineCount += 1;

    // Add content
    for (const line of lines) {
      if (lineCount >= maxLinesPerPage - 2) {
        // Add page number to current page
        currentPage.drawText(`Page ${pdfDoc.getPageCount()}`, {
          x: pageWidth / 2 - 20,
          y: margin / 2,
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
        });
        
        // Create new page
        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        yPosition = pageHeight - margin;
        lineCount = 0;
      }

      currentPage.drawText(line, {
        x: margin,
        y: yPosition,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
      
      yPosition -= lineHeight;
      lineCount++;
    }

    // Add page number to last page
    currentPage.drawText(`Page ${pdfDoc.getPageCount()}`, {
      x: pageWidth / 2 - 20,
      y: margin / 2,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    // Generate PDF bytes
    const pdfBytes = await pdfDoc.save();

    // Convert Uint8Array to Buffer for NextResponse
    const buffer = Buffer.from(pdfBytes);

    // Return PDF as downloadable file
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('[API] PDF export failed:', error);
    
    return NextResponse.json(
      { 
        error: 'PDF export failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
