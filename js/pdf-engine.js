/**
 * PDF Engine - Wrapper for pdf-lib and PDF.js
 * Handles document loading, rendering, manipulation, text extraction, and export
 */

// Configure PDF.js worker
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

export class PDFEngine {
  constructor() {
    this.pdfLib = window.PDFLib;
    this.pdfjs = window.pdfjsLib;
  }

  /**
   * Load a PDF file and return metadata + page count
   */
  async loadDocument(file) {
    const arrayBuffer = await file.arrayBuffer();
    const typedArray = new Uint8Array(arrayBuffer);

    // Load with PDF.js for rendering
    const pdfJsDoc = await this.pdfjs.getDocument({ data: typedArray }).promise;
    
    // Load with pdf-lib for manipulation
    const pdfLibDoc = await this.pdfLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

    return {
      file,
      name: file.name,
      size: file.size,
      pageCount: pdfJsDoc.numPages,
      pdfJsDoc,
      pdfLibDoc,
      arrayBuffer
    };
  }

  /**
   * Render a specific page to an HTML canvas
   */
  async renderPageToCanvas(pdfJsDoc, pageNum, canvas, scale = 1.0, rotation = 0) {
    const page = await pdfJsDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale, rotation });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport: viewport
    }).promise;

    return { viewport, page };
  }

  /**
   * Extract text elements with bounding boxes from a page
   */
  async extractTextItems(pdfJsDoc, pageNum, scale = 1.0) {
    const page = await pdfJsDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale });

    const items = [];
    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === '') continue;

      // Transform PDF coordinate system to canvas viewport
      const tx = this.pdfjs.Util.transform(viewport.transform, item.transform);
      const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
      
      const x = tx[4];
      const y = tx[5] - fontSize; // Baseline adjustment
      const width = item.width * scale;
      const height = item.height ? item.height * scale : fontSize * 1.2;

      items.push({
        str: item.str,
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: Math.max(width, 10),
        height: Math.max(height, 12),
        fontSize,
        fontName: item.fontName
      });
    }

    return items;
  }

  /**
   * Merge multiple PDFs into one
   */
  async mergeDocuments(docList) {
    const mergedPdf = await this.pdfLib.PDFDocument.create();

    for (const item of docList) {
      const srcDoc = await this.pdfLib.PDFDocument.load(item.arrayBuffer);
      const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    return await mergedPdf.save();
  }

  /**
   * Split a PDF into individual pages
   */
  async splitDocument(doc, pageSelections) {
    const results = [];

    for (const sel of pageSelections) {
      const newDoc = await this.pdfLib.PDFDocument.create();
      const srcDoc = await this.pdfLib.PDFDocument.load(doc.arrayBuffer);
      const [copiedPage] = await newDoc.copyPages(srcDoc, [sel.pageIndex]);
      newDoc.addPage(copiedPage);
      const pdfBytes = await newDoc.save();
      results.push({
        filename: sel.filename,
        bytes: pdfBytes
      });
    }

    return results;
  }

  /**
   * Apply page rotations
   */
  async rotateDocument(doc, rotationMap) {
    const srcDoc = await this.pdfLib.PDFDocument.load(doc.arrayBuffer);
    const pages = srcDoc.getPages();

    pages.forEach((page, index) => {
      const pageNum = index + 1;
      const additionalRotation = rotationMap[pageNum] || 0;
      if (additionalRotation !== 0) {
        const currentRot = page.getRotation().angle;
        page.setRotation(this.pdfLib.degrees((currentRot + additionalRotation) % 360));
      }
    });

    return await srcDoc.save();
  }

  /**
   * Apply edits (text replace/add, redact, stamps) to PDF
   */
  async applyEditsToDocument(doc, pageEditsMap) {
    const srcDoc = await this.pdfLib.PDFDocument.load(doc.arrayBuffer);
    const pages = srcDoc.getPages();

    // Standard fonts for pdf-lib
    const fontHelvetica = await srcDoc.embedFont(this.pdfLib.StandardFonts.Helvetica);
    const fontHelveticaBold = await srcDoc.embedFont(this.pdfLib.StandardFonts.HelveticaBold);

    for (let i = 0; i < pages.length; i++) {
      const pageNum = i + 1;
      const edits = pageEditsMap[pageNum];
      if (!edits || edits.length === 0) continue;

      const page = pages[i];
      const { width, height } = page.getSize();

      for (const edit of edits) {
        // Handle coordinate translation:
        // HTML Canvas coords (origin top-left) -> PDF coords (origin bottom-left)
        const scaleX = width / edit.canvasWidth;
        const scaleY = height / edit.canvasHeight;

        const pdfX = edit.x * scaleX;
        const pdfY = height - (edit.y * scaleY) - (edit.height * scaleY);
        const pdfWidth = edit.width * scaleX;
        const pdfHeight = edit.height * scaleY;

        if (edit.type === 'redact') {
          // Draw rectangle mask (whiteout or blackout)
          const isBlack = edit.color === '#000000';
          page.drawRectangle({
            x: pdfX,
            y: pdfY,
            width: pdfWidth,
            height: pdfHeight,
            color: isBlack ? this.pdfLib.rgb(0, 0, 0) : this.pdfLib.rgb(1, 1, 1),
            borderWidth: 0
          });
        } else if (edit.type === 'text') {
          // If mask original text
          if (edit.maskBg) {
            page.drawRectangle({
              x: pdfX - 1,
              y: pdfY - 1,
              width: pdfWidth + 2,
              height: pdfHeight + 2,
              color: this.pdfLib.rgb(1, 1, 1),
              borderWidth: 0
            });
          }

          // Parse text color
          const rgb = this.hexToRgb(edit.color || '#000000');
          const pdfFontSize = (edit.fontSize || 12) * scaleY;

          page.drawText(edit.text, {
            x: pdfX,
            y: pdfY + (pdfHeight * 0.15), // baseline tweak
            size: pdfFontSize,
            font: fontHelvetica,
            color: this.pdfLib.rgb(rgb.r / 255, rgb.g / 255, rgb.b / 255)
          });
        } else if (edit.type === 'stamp') {
          // Stamp Box & Text
          const rgb = edit.color === 'red' 
            ? { r: 235, g: 87, b: 87 }
            : (edit.color === 'blue' ? { r: 35, g: 131, b: 226 } : { r: 39, g: 174, b: 96 });

          const colorLib = this.pdfLib.rgb(rgb.r / 255, rgb.g / 255, rgb.b / 255);

          // Draw stamp border
          page.drawRectangle({
            x: pdfX,
            y: pdfY,
            width: pdfWidth,
            height: pdfHeight,
            borderColor: colorLib,
            borderWidth: 2,
            color: this.pdfLib.rgb(1, 1, 1),
            opacity: 0.9
          });

          // Draw stamp label
          page.drawText(edit.text, {
            x: pdfX + 6,
            y: pdfY + (pdfHeight * 0.28),
            size: pdfHeight * 0.45,
            font: fontHelveticaBold,
            color: colorLib
          });
        }
      }
    }

    return await srcDoc.save();
  }

  hexToRgb(hex) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }
}
