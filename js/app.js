// Configure PDF.js worker (Chrome Extension & Local Offline Support)
if (window.pdfjsLib) {
  try {
    const isExtension = typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function';
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = isExtension
      ? chrome.runtime.getURL('js/libs/pdf.worker.min.js')
      : 'js/libs/pdf.worker.min.js';
  } catch (e) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/libs/pdf.worker.min.js';
  }
}

/**
 * PDFのフォントメタデータから、利用可能なフォントファミリ・太字・斜体を高精度に判別
 */
function detectMatchingFont(item, textContent, page) {
  try {
    const candidates = [];

    // 1. item.fontName
    if (item && item.fontName) candidates.push(item.fontName);

    // 2. textContent.styles[item.fontName]
    if (textContent && textContent.styles && item && item.fontName && textContent.styles[item.fontName]) {
      const s = textContent.styles[item.fontName];
      if (s && s.fontFamily) candidates.push(s.fontFamily);
    }

    // 3. page.commonObjs
    try {
      if (page && page.commonObjs && typeof page.commonObjs.has === 'function' && page.commonObjs.has(item.fontName)) {
        const fObj = page.commonObjs.get(item.fontName);
        if (fObj) {
          if (fObj.name) candidates.push(fObj.name);
          if (fObj.loadedName) candidates.push(fObj.loadedName);
          if (fObj.fallbackName) candidates.push(fObj.fallbackName);
        }
      }
    } catch (e) {}

    let isBold = false;
    let isItalic = false;

    // 太字・斜体判定
    for (const c of candidates) {
      if (typeof c === 'string') {
        if (/bold|black|heavy|w[6-9]|semibold/i.test(c)) isBold = true;
        if (/italic|oblique/i.test(c)) isItalic = true;
      }
    }

    // サブセット接頭辞 (例: "BCDFEE+MS-PGothic" -> "MS-PGothic") を除去してクリーニング
    const cleanCandidates = candidates
      .filter(c => typeof c === 'string')
      .map(c => c.replace(/^[A-Za-z0-9]{6}\+/, '').trim());

    // フォント定義マッピング（代表的な日本語・英数フォント）
    const fontRules = [
      // 游ゴシック
      { regex: /yugothic|yu-gothic|游ゴシック/i, value: "'Yu Gothic', '游ゴシック', sans-serif" },
      // メイリオ
      { regex: /meiryo|メイリオ/i, value: "'Meiryo', 'メイリオ', sans-serif" },
      // ＭＳ Ｐゴシック
      { regex: /ms-?p-?gothic|ｍｓ\s*ｐゴシック/i, value: "'MS PGothic', 'ＭＳ Ｐゴシック', sans-serif" },
      // ＭＳ ゴシック (等幅)
      { regex: /ms-?gothic|ｍｓ\s*ゴシック/i, value: "'MS Gothic', 'ＭＳ ゴシック', monospace" },
      // BIZ UDPゴシック
      { regex: /biz-?ud-?pgothic|biz\s*udpゴシック/i, value: "'BIZ UDPGothic', 'BIZ UDPゴシック', sans-serif" },
      // BIZ UDゴシック
      { regex: /biz-?ud-?gothic|biz\s*udゴシック/i, value: "'BIZ UDPGothic', 'BIZ UDPゴシック', sans-serif" },
      // ヒラギノ角ゴ
      { regex: /hiragino|ヒラギノ/i, value: "'Hiragino Sans', 'ヒラギノ角ゴ', sans-serif" },
      // Noto Sans JP
      { regex: /notosansjp|noto-sans-jp|notosans/i, value: "'Noto Sans JP', sans-serif" },
      // 游明朝
      { regex: /yumincho|yu-mincho|游明朝/i, value: "'Yu Mincho', '游明朝', serif" },
      // ＭＳ Ｐ明朝
      { regex: /ms-?p-?mincho|ｍｓ\s*ｐ明朝/i, value: "'MS PMincho', 'ＭＳ Ｐ明朝', serif" },
      // ＭＳ 明朝
      { regex: /ms-?mincho|ｍｓ\s*明朝/i, value: "'MS PMincho', 'ＭＳ Ｐ明朝', serif" },
      // BIZ UDP明朝
      { regex: /biz-?ud-?p?mincho|biz\s*udp?明朝/i, value: "'BIZ UDPMincho', 'BIZ UDP明朝', serif" },
      // Noto Serif JP
      { regex: /notoserifjp|noto-serif-jp|notoserif/i, value: "'Noto Serif JP', serif" },
      // Roboto Mono
      { regex: /robotomono|roboto-mono/i, value: "'Roboto Mono', monospace" },
      // Consolas
      { regex: /consolas/i, value: "'Consolas', monospace" },
      // Courier New / Courier
      { regex: /courier/i, value: "'Courier New', monospace" },
      // Arial
      { regex: /arial/i, value: "'Arial', sans-serif" },
      // Helvetica
      { regex: /helvetica/i, value: "'Helvetica', sans-serif" },
      // Times New Roman
      { regex: /timesnewroman|times-roman|times/i, value: "'Times New Roman', serif" },
      // Georgia
      { regex: /georgia/i, value: "'Georgia', serif" },
      // Inter
      { regex: /inter/i, value: "'Inter', sans-serif" }
    ];

    for (const name of cleanCandidates) {
      for (const rule of fontRules) {
        if (rule.regex.test(name)) {
          return {
            fontFamily: rule.value,
            bold: isBold,
            italic: isItalic,
            rawName: name
          };
        }
      }
    }

    // アプリ内のセレクトボックス内のoptionやPCから読み込んだローカルフォント一覧（fontMasterGroups）との照合
    if (typeof fontMasterGroups !== 'undefined' && fontMasterGroups && fontMasterGroups.length > 0) {
      for (const name of cleanCandidates) {
        const lower = name.toLowerCase();
        for (const grp of fontMasterGroups) {
          for (const opt of grp.options) {
            const optLower = opt.text.toLowerCase();
            const valLower = opt.value.toLowerCase();
            if (lower.includes(optLower) || optLower.includes(lower) || valLower.includes(lower)) {
              return {
                fontFamily: opt.value,
                bold: isBold,
                italic: isItalic,
                rawName: name
              };
            }
          }
        }
      }
    }

    // カテゴリによるフォールバック
    for (const name of cleanCandidates) {
      const lower = name.toLowerCase();
      if (/mincho|serif|明朝|kozmin|song|batang|sung/i.test(lower)) {
        return { fontFamily: "'Noto Serif JP', serif", bold: isBold, italic: isItalic, rawName: name };
      }
      if (/mono|code|courier|typewriter/i.test(lower)) {
        return { fontFamily: "'Roboto Mono', monospace", bold: isBold, italic: isItalic, rawName: name };
      }
    }

    return {
      fontFamily: "'Noto Sans JP', sans-serif",
      bold: isBold,
      italic: isItalic,
      rawName: cleanCandidates[0] || ''
    };
  } catch (err) {
    console.warn('detectMatchingFont error fallback:', err);
    return {
      fontFamily: "'Noto Sans JP', sans-serif",
      bold: false,
      italic: false,
      rawName: ''
    };
  }
}

class PDFEngine {
  constructor() {
    this.pdfLib = window.PDFLib;
    this.pdfjs = window.pdfjsLib;
  }

  async loadDocument(file) {
    const originalBuffer = await file.arrayBuffer();

    // 重要: PDF.jsのWorkerに渡すとArrayBufferがDetached（所有権移動で中身が空）になるため、
    // それぞれ独立したバッファを生成して渡す
    const pdfJsBuffer = originalBuffer.slice(0);
    const pdfLibBuffer = originalBuffer.slice(0);
    const savedBuffer = originalBuffer.slice(0);

    // 1. pdf-lib で読み込み（暗号化対応・フォールバック付き）
    let pdfLibDoc;
    try {
      pdfLibDoc = await this.pdfLib.PDFDocument.load(pdfLibBuffer, { ignoreEncryption: true });
    } catch (e1) {
      console.warn('pdf-lib load warning, retrying standard load:', e1);
      pdfLibDoc = await this.pdfLib.PDFDocument.load(pdfLibBuffer);
    }

    // 2. PDF.js でレンダリング用読み込み（日本語CMap & 標準フォント対応）
    const loadingTask = this.pdfjs.getDocument({
      data: new Uint8Array(pdfJsBuffer),
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/'
    });

    const pdfJsDoc = await loadingTask.promise;

    return {
      file,
      name: file.name,
      size: file.size,
      pageCount: pdfJsDoc.numPages,
      pdfJsDoc,
      pdfLibDoc,
      arrayBuffer: savedBuffer
    };
  }

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

  async extractTextItems(pdfJsDoc, pageNum, scale = 1.0) {
    const page = await pdfJsDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale });

    const items = [];
    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === '') continue;

      const tx = this.pdfjs.Util.transform(viewport.transform, item.transform);
      // Y方向（垂直・高さ方向）のスケールが本来のフォント名目サイズ
      const fontHeight = Math.hypot(tx[2], tx[3]);
      const fontWidth = Math.hypot(tx[0], tx[1]);
      const nominalFontSize = fontHeight > 0 ? fontHeight : fontWidth;
      
      const width = item.width * scale;
      // item.height があれば実寸高さ、なければ名目サイズ×0.9
      const height = item.height ? item.height * scale : nominalFontSize * 0.9;
      const x = tx[4];
      const y = tx[5] - height;

      // 元フォントの自動判別（PostScript名・スタイル・太字・斜体）
      const detectedFont = detectMatchingFont(item, textContent, page);

      const rawItem = {
        str: item.str,
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: Math.max(width, 10),
        height: Math.max(height, 12),
        fontSize: nominalFontSize,
        fontName: item.fontName,
        detectedFont
      };

      // プレビュー画面上に表示されている文字の実寸フォントサイズを正確に計算してセット
      rawItem.fontSize = getTextItemFontSize(rawItem);
      items.push(rawItem);
    }

    return items;
  }

  /**
   * PDFページから埋め込まれている画像（ロゴ、写真、印鑑等）の位置とデータを抽出
   */
  async extractImageItems(pdfJsDoc, pageNum, scale = 1.0, renderedCanvas = null) {
    try {
      const page = await pdfJsDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const opList = await page.getOperatorList();
      const OPS = window.pdfjsLib ? window.pdfjsLib.OPS : null;
      if (!OPS) return [];

      let currentTransform = [1, 0, 0, 1, 0, 0];
      const transformStack = [];
      const imageItems = [];

      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i];

        if (fn === OPS.save) {
          transformStack.push([...currentTransform]);
        } else if (fn === OPS.restore) {
          if (transformStack.length > 0) {
            currentTransform = transformStack.pop();
          }
        } else if (fn === OPS.transform) {
          currentTransform = [
            currentTransform[0] * args[0] + currentTransform[2] * args[1],
            currentTransform[1] * args[0] + currentTransform[3] * args[1],
            currentTransform[0] * args[2] + currentTransform[2] * args[3],
            currentTransform[1] * args[2] + currentTransform[3] * args[3],
            currentTransform[0] * args[4] + currentTransform[2] * args[5] + currentTransform[4],
            currentTransform[1] * args[4] + currentTransform[3] * args[5] + currentTransform[5]
          ];
        } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
          const imgKey = args ? args[0] : null;

          // PDF.js Util.transform で viewport と合成
          const tx = this.pdfjs.Util.transform(viewport.transform, currentTransform);

          // PDFの画像空間 [0,0] 〜 [1,1] の4頂点をキャンバス座標へ変換
          const p1 = this.pdfjs.Util.applyTransform([0, 0], tx);
          const p2 = this.pdfjs.Util.applyTransform([1, 0], tx);
          const p3 = this.pdfjs.Util.applyTransform([0, 1], tx);
          const p4 = this.pdfjs.Util.applyTransform([1, 1], tx);

          const minX = Math.min(p1[0], p2[0], p3[0], p4[0]);
          const maxX = Math.max(p1[0], p2[0], p3[0], p4[0]);
          const minY = Math.min(p1[1], p2[1], p3[1], p4[1]);
          const maxY = Math.max(p1[1], p2[1], p3[1], p4[1]);

          const width = maxX - minX;
          const height = maxY - minY;
          const x = minX;
          const y = minY;

          // 微小なノイズ画像（線や1pxドット）や、ページ全体に及ぶ巨大背景画像は除外
          if (width < 8 || height < 8) continue;
          if (width >= viewport.width * 0.98 && height >= viewport.height * 0.98) continue;

          // 画像データの取得
          let dataUrl = null;
          try {
            if (typeof imgKey === 'string' && page.objs && page.objs.has(imgKey)) {
              const imgObj = page.objs.get(imgKey);
              dataUrl = this.convertPdfImageToDataUrl(imgObj);
            }
          } catch (objErr) {
            console.warn('PDF image obj extract notice:', objErr);
          }

          // フォールバック: レンダリング済みキャンバスの該当矩形から高画質切り抜き
          if (!dataUrl && renderedCanvas) {
            dataUrl = this.cropCanvasToDataUrl(renderedCanvas, x, y, width, height);
          }

          if (dataUrl) {
            imageItems.push({
              id: `pdf-img-${pageNum}-${imageItems.length}`,
              imgKey: typeof imgKey === 'string' ? imgKey : `inline-${imageItems.length}`,
              x: Math.round(x),
              y: Math.round(y),
              width: Math.round(width),
              height: Math.round(height),
              dataUrl,
              origX: Math.round(x),
              origY: Math.round(y),
              origWidth: Math.round(width),
              origHeight: Math.round(height)
            });
          }
        }
      }

      return imageItems;
    } catch (e) {
      console.error('Failed to extract image items:', e);
      return [];
    }
  }

  /**
   * PDF.js の内部画像オブジェクトを PNG データURL に変換
   */
  convertPdfImageToDataUrl(imgObj) {
    if (!imgObj) return null;
    try {
      const width = imgObj.width;
      const height = imgObj.height;
      if (!width || !height) return null;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (imgObj.bitmap) {
        ctx.drawImage(imgObj.bitmap, 0, 0);
        return canvas.toDataURL('image/png');
      }
      if (typeof ImageBitmap !== 'undefined' && imgObj instanceof ImageBitmap) {
        ctx.drawImage(imgObj, 0, 0);
        return canvas.toDataURL('image/png');
      }
      if (imgObj.data) {
        const imgData = ctx.createImageData(width, height);
        const dataLen = imgObj.data.length;
        if (dataLen === width * height * 4) {
          imgData.data.set(imgObj.data);
        } else if (dataLen === width * height * 3) {
          let s = 0, d = 0;
          for (let i = 0; i < width * height; i++) {
            imgData.data[d] = imgObj.data[s];
            imgData.data[d + 1] = imgObj.data[s + 1];
            imgData.data[d + 2] = imgObj.data[s + 2];
            imgData.data[d + 3] = 255;
            s += 3; d += 4;
          }
        } else if (dataLen === width * height) {
          let s = 0, d = 0;
          for (let i = 0; i < width * height; i++) {
            const v = imgObj.data[s++];
            imgData.data[d] = v;
            imgData.data[d + 1] = v;
            imgData.data[d + 2] = v;
            imgData.data[d + 3] = 255;
            d += 4;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        return canvas.toDataURL('image/png');
      }
    } catch (err) {
      console.warn('convertPdfImageToDataUrl error:', err);
    }
    return null;
  }

  /**
   * レンダリング済みキャンバスから該当エリアを高精度に切り抜いて PNG データURL を生成
   */
  cropCanvasToDataUrl(canvas, x, y, width, height) {
    try {
      const cropW = Math.max(1, Math.round(width));
      const cropH = Math.max(1, Math.round(height));
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      const ctx = cropCanvas.getContext('2d');
      const srcX = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
      const srcY = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
      const srcW = Math.min(canvas.width - srcX, cropW);
      const srcH = Math.min(canvas.height - srcY, cropH);
      ctx.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
      return cropCanvas.toDataURL('image/png');
    } catch (e) {
      console.warn('cropCanvasToDataUrl failed:', e);
      return null;
    }
  }


  async mergeDocuments(docList) {
    const mergedPdf = await this.pdfLib.PDFDocument.create();

    for (const item of docList) {
      const srcDoc = await this.pdfLib.PDFDocument.load(item.arrayBuffer.slice(0), { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    return await mergedPdf.save();
  }

  async splitDocument(doc, pageSelections) {
    const results = [];

    for (const sel of pageSelections) {
      const newDoc = await this.pdfLib.PDFDocument.create();
      const srcDoc = await this.pdfLib.PDFDocument.load(doc.arrayBuffer.slice(0), { ignoreEncryption: true });
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

  async rotateDocument(doc, rotationMap) {
    const srcDoc = await this.pdfLib.PDFDocument.load(doc.arrayBuffer.slice(0), { ignoreEncryption: true });
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

  async applyEditsToDocument(doc, pageEditsMap) {
    const srcDoc = await this.pdfLib.PDFDocument.load(doc.arrayBuffer.slice(0), { ignoreEncryption: true });
    const pages = srcDoc.getPages();

    for (let i = 0; i < pages.length; i++) {
      const pageNum = i + 1;
      const edits = pageEditsMap[pageNum];
      if (!edits || edits.length === 0) continue;

      const page = pages[i];
      const { width, height } = page.getSize();

      // 1. 個々のハイライト矩形を1個ずつPDFに乗算（Multiply）描画
      const highlights = edits.filter(e => e.type === 'highlight');
      for (const edit of highlights) {
        const scaleX = width / edit.canvasWidth;
        const scaleY = height / edit.canvasHeight;
        const pdfX = edit.x * scaleX;
        const pdfY = height - (edit.y * scaleY) - (edit.height * scaleY);
        const pdfWidth = edit.width * scaleX;
        const pdfHeight = edit.height * scaleY;
        const rgb = this.hexToRgb(edit.color || '#FFE600');
        const drawOpts = {
          x: pdfX,
          y: pdfY,
          width: pdfWidth,
          height: pdfHeight,
          color: this.pdfLib.rgb(rgb.r / 255, rgb.g / 255, rgb.b / 255),
          opacity: 0.85, // プレビューの opacity: 0.85 と完全一致
          borderWidth: 0
        };
        if (this.pdfLib.BlendMode && this.pdfLib.BlendMode.Multiply) {
          drawOpts.blendMode = this.pdfLib.BlendMode.Multiply;
        }
        page.drawRectangle(drawOpts);
      }

      // 2. 移動されたテキスト・画像の「元位置の白塗りマスク」を描画（二重表示の完全防止！）
      for (const edit of edits) {
        if ((edit.type === 'text' || edit.type === 'image') && edit.origX !== undefined && (Math.abs(edit.x - edit.origX) > 2 || Math.abs(edit.y - edit.origY) > 2)) {
          const scaleX = width / edit.canvasWidth;
          const scaleY = height / edit.canvasHeight;
          const pdfOrigX = edit.origX * scaleX - 1;
          const pdfOrigY = height - (edit.origY * scaleY) - (edit.origHeight * scaleY) - 1;
          const pdfOrigWidth = edit.origWidth * scaleX + 2;
          const pdfOrigHeight = edit.origHeight * scaleY + 2;
          page.drawRectangle({
            x: pdfOrigX,
            y: pdfOrigY,
            width: pdfOrigWidth,
            height: pdfOrigHeight,
            color: this.pdfLib.rgb(1, 1, 1),
            borderWidth: 0
          });
        }
      }

      // 3. 墨消し・白塗りを描画
      const redactions = edits.filter(e => e.type === 'redact');
      for (const edit of redactions) {
        const scaleX = width / edit.canvasWidth;
        const scaleY = height / edit.canvasHeight;
        const pdfX = edit.x * scaleX;
        const pdfY = height - (edit.y * scaleY) - (edit.height * scaleY);
        const pdfWidth = edit.width * scaleX;
        const pdfHeight = edit.height * scaleY;
        const isBlack = edit.color === '#000000';
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: pdfWidth,
          height: pdfHeight,
          color: isBlack ? this.pdfLib.rgb(0, 0, 0) : this.pdfLib.rgb(1, 1, 1),
          borderWidth: 0
        });
      }

      // 4. テキストを描画（最前面）
      const texts = edits.filter(e => e.type === 'text');
      for (const edit of texts) {
        const scaleX = width / edit.canvasWidth;
        const scaleY = height / edit.canvasHeight;
        const pdfX = edit.x * scaleX;
        const pdfY = height - (edit.y * scaleY) - (edit.height * scaleY);
        const pdfWidth = edit.width * scaleX;
        const pdfHeight = edit.height * scaleY;

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

        try {
          const dpr = 3.0; // 鮮明な印刷画質
          const measureCanvas = document.createElement('canvas');
          const mCtx = measureCanvas.getContext('2d');
          const fontSize = (edit.fontSize || 14) * scaleY;
          const fontFamily = edit.fontFamily || 'Noto Sans JP, sans-serif';
          let fontStyle = '';
          if (edit.italic) fontStyle += 'italic ';
          if (edit.bold) fontStyle += 'bold ';
          mCtx.font = `${fontStyle}${fontSize}px ${fontFamily}`;

          const textMetrics = mCtx.measureText(edit.text || '');
          const measuredWidth = Math.max(textMetrics.width + 8, pdfWidth);
          const measuredHeight = Math.max(fontSize * 1.35, pdfHeight);

          const textCanvas = document.createElement('canvas');
          textCanvas.width = Math.ceil(measuredWidth * dpr);
          textCanvas.height = Math.ceil(measuredHeight * dpr);

          const tCtx = textCanvas.getContext('2d');
          if (tCtx) {
            tCtx.scale(dpr, dpr);
            if (edit.maskBg) {
              tCtx.fillStyle = '#FFFFFF';
              tCtx.fillRect(0, 0, measuredWidth, measuredHeight);
            }
            tCtx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
            tCtx.fillStyle = edit.color || '#000000';
            tCtx.textBaseline = 'top';
            tCtx.fillText(edit.text || '', 1, 1);

            const pngUrl = textCanvas.toDataURL('image/png');
            const embeddedImg = await srcDoc.embedPng(pngUrl);
            page.drawImage(embeddedImg, {
              x: pdfX,
              y: height - (edit.y * scaleY) - measuredHeight,
              width: measuredWidth,
              height: measuredHeight
            });
          }
        } catch (textErr) {
          console.error('Text render fallback:', textErr);
        }
      }

      // 5. 画像を描画
      const images = edits.filter(e => e.type === 'image' && e.dataUrl);
      for (const edit of images) {
        const scaleX = width / edit.canvasWidth;
        const scaleY = height / edit.canvasHeight;
        const pdfX = edit.x * scaleX;
        const pdfY = height - (edit.y * scaleY) - (edit.height * scaleY);
        const pdfWidth = edit.width * scaleX;
        const pdfHeight = edit.height * scaleY;
        try {
          let embeddedImg;
          if (edit.dataUrl.startsWith('data:image/png')) {
            embeddedImg = await srcDoc.embedPng(edit.dataUrl);
          } else {
            embeddedImg = await srcDoc.embedJpg(edit.dataUrl);
          }
          page.drawImage(embeddedImg, {
            x: pdfX,
            y: pdfY,
            width: pdfWidth,
            height: pdfHeight
          });
        } catch (imgErr) {
          console.warn('Image embed fallback:', imgErr);
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

// State Container
const state = {
  currentView: 'upload', // 'upload', 'merge', 'split', 'rotate', 'edit-select', 'edit-page', 'final-preview'
  loadedDocs: [],        // Array of loaded documents
  selectedDocIndices: new Set(), // Set of selected indices in loadedDocs
  primaryDoc: null,      // Main document being processed
  
  // Merge State
  mergeItems: [],        // Ordered list of docs/pages to merge
  selectedMergeIds: new Set(),

  // Split State
  splitItems: [],        // [{ pageIndex: 0, filename: 'page_1.pdf', selected: true }]

  // Rotate State
  rotations: {},         // { [pageNum]: angleInDegrees (e.g. 90, 180, 270) }

  // Edit State
  pageEdits: {},         // { [pageNum]: [ { id, type, x, y, width, height, text, bold, italic, color, fontSize, dataUrl, ... } ] }
  currentEditPage: 1,
  activeTool: 'select',  // 'select', 'text', 'highlight', 'redact', 'image'
  selectedElementId: null,
  selectedTextItem: null, // Selected raw text item from PDF
  activeTextProp: {
    text: '',
    fontSize: 14,
    fontFamily: 'Noto Sans JP, sans-serif',
    color: '#000000',
    bold: false,
    italic: false,
    maskBg: true
  },
  activeHighlightColor: '#FFE600',
  zoomLevel: 1.0,
  finalPreviewPage: 1,
  undoStack: [],
  redoStack: []
};

const pdfEngine = new PDFEngine();

// UI Elements
const dom = {
  views: {
    upload: document.getElementById('view-upload'),
    merge: document.getElementById('view-merge'),
    split: document.getElementById('view-split'),
    rotate: document.getElementById('view-rotate'),
    editSelect: document.getElementById('view-edit-select'),
    editPage: document.getElementById('view-edit-page'),
    finalPreview: document.getElementById('view-final-preview')
  },
  breadcrumbs: document.getElementById('breadcrumbs'),
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  loadedSummary: document.getElementById('loaded-summary'),
  loadedCount: document.getElementById('loaded-count'),
  selectedCountBadge: document.getElementById('selected-count-badge'),
  loadedFileList: document.getElementById('loaded-file-list'),
  btnSelectAllLoaded: document.getElementById('btn-select-all-loaded'),
  btnDeselectAllLoaded: document.getElementById('btn-deselect-all-loaded'),
  btnClearFiles: document.getElementById('btn-clear-files'),
  btnResetApp: document.getElementById('btn-reset-app'),

  modeCards: {
    edit: document.getElementById('mode-card-edit'),
    merge: document.getElementById('mode-card-merge'),
    split: document.getElementById('mode-card-split'),
    rotate: document.getElementById('mode-card-rotate')
  },
  reqBadges: {
    edit: document.getElementById('req-edit'),
    merge: document.getElementById('req-merge'),
    split: document.getElementById('req-split'),
    rotate: document.getElementById('req-rotate')
  },

  // Merge
  mergeItemsContainer: document.getElementById('merge-items-container'),
  mergeFilename: document.getElementById('merge-filename'),
  btnRunMerge: document.getElementById('btn-run-merge'),
  btnMergeAddMore: document.getElementById('btn-merge-add-more'),
  mergeAddInput: document.getElementById('merge-add-input'),
  btnSelectAllMerge: document.getElementById('btn-select-all-merge'),

  // Split
  splitGridContainer: document.getElementById('split-grid-container'),
  splitPrefix: document.getElementById('split-prefix'),
  splitDigits: document.getElementById('split-digits'),
  splitStartNum: document.getElementById('split-start-num'),
  btnApplySplitNaming: document.getElementById('btn-apply-split-naming'),
  btnRunSplit: document.getElementById('btn-run-split'),
  btnSplitSelectAll: document.getElementById('btn-split-select-all'),
  btnSplitSelectOdd: document.getElementById('btn-split-select-odd'),
  btnSplitSelectEven: document.getElementById('btn-split-select-even'),
  btnSplitDeselectAll: document.getElementById('btn-split-deselect-all'),

  // Rotate
  rotateGridContainer: document.getElementById('rotate-grid-container'),
  btnRotateAllCW: document.getElementById('btn-rotate-all-cw'),
  btnRotateAllCCW: document.getElementById('btn-rotate-all-ccw'),
  btnRotateAll180: document.getElementById('btn-rotate-all-180'),
  btnRotateEven180: document.getElementById('btn-rotate-even-180'),
  btnRotateReset: document.getElementById('btn-rotate-reset'),
  btnRunRotate: document.getElementById('btn-run-rotate'),

  // Edit Select
  editSelectGrid: document.getElementById('edit-select-grid'),
  editModifiedCount: document.getElementById('edit-modified-count'),
  btnFinishAllEdits: document.getElementById('btn-finish-all-edits'),

  // Edit Page
  currentEditPageNum: document.getElementById('current-edit-page-num'),
  btnBackToPageSelect: document.getElementById('btn-back-to-page-select'),
  btnSaveSingleEdit: document.getElementById('btn-save-single-edit'),
  btnCancelSingleEdit: document.getElementById('btn-cancel-single-edit'),
  toolTabs: document.querySelectorAll('.tool-tab'),
  panelTextOptions: document.getElementById('panel-text-options'),
  panelHighlightOptions: document.getElementById('panel-highlight-options'),
  panelRedactOptions: document.getElementById('panel-redact-options'),
  panelImageOptions: document.getElementById('panel-image-options'),
  activeTextInput: document.getElementById('active-text-input'),
  textFontFamily: document.getElementById('text-font-family'),
  fontSearchInput: document.getElementById('font-search-input'),
  btnFontSearchClear: document.getElementById('btn-font-search-clear'),
  fontSuggestionsDropdown: document.getElementById('font-suggestions-dropdown'),
  fontCountBadge: document.getElementById('font-count-badge'),
  textFontSizeRange: document.getElementById('text-font-size-range'),
  textFontSizeVal: document.getElementById('text-font-size-val'),
  btnToggleBold: document.getElementById('btn-toggle-bold'),
  btnToggleItalic: document.getElementById('btn-toggle-italic'),
  textColor: document.getElementById('text-color'),
  textBgMask: document.getElementById('text-bg-mask'),
  redactColor: document.getElementById('redact-color'),
  imageUploadInput: document.getElementById('image-upload-input'),
  layerList: document.getElementById('layer-list'),
  layerCount: document.getElementById('layer-count'),
  canvasViewport: document.getElementById('canvas-viewport'),
  canvasStage: document.getElementById('canvas-stage'),
  dragGuideBox: document.getElementById('drag-guide-box'),
  pdfRenderCanvas: document.getElementById('pdf-render-canvas'),
  highlightElementsLayer: document.getElementById('highlight-elements-layer'),
  textInteractionLayer: document.getElementById('text-interaction-layer'),
  imageInteractionLayer: document.getElementById('image-interaction-layer'),
  userElementsLayer: document.getElementById('user-elements-layer'),
  btnApplySelectionHighlight: document.getElementById('btn-apply-selection-highlight'),
  quickHighlightPopup: document.getElementById('quick-highlight-popup'),
  btnQuickHlAction: document.getElementById('btn-quick-hl-action'),
  btnUndo: document.getElementById('btn-undo'),
  btnRedo: document.getElementById('btn-redo'),
  btnLoadPcFonts: document.getElementById('btn-load-pc-fonts'),
  zoomLevelText: document.getElementById('zoom-level-text'),
  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnZoomFit: document.getElementById('btn-zoom-fit'),

  // Final Preview
  finalPreviewCanvas: document.getElementById('final-preview-canvas'),
  finalCurrentPage: document.getElementById('final-current-page'),
  finalTotalPages: document.getElementById('final-total-pages'),
  btnFinalPrevPage: document.getElementById('btn-final-prev-page'),
  btnFinalNextPage: document.getElementById('btn-final-next-page'),
  btnBackToEditSelect: document.getElementById('btn-back-to-edit-select'),
  btnRunFinalExport: document.getElementById('btn-run-final-export'),
  finalExportFilename: document.getElementById('final-export-filename'),

  toastContainer: document.getElementById('toast-container')
};

// ==========================================================================
// Initialization & Global Event Listeners
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initDropZone();
  initLoadedSelectionListeners();
  initModeSelection();
  initMergeListeners();
  initSplitListeners();
  initRotateListeners();
  initEditListeners();
  initFinalPreviewListeners();
  initFontMasterData();

  dom.btnResetApp.addEventListener('click', resetApplication);
  if (window.lucide) window.lucide.createIcons();
});

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'success' ? 'toast-success' : (type === 'error' ? 'toast-error' : '')}`;
  toast.innerHTML = `<span>${message}</span>`;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function switchView(viewName, title = 'ホーム') {
  state.currentView = viewName;
  Object.keys(dom.views).forEach((key) => {
    dom.views[key].classList.toggle('active', key === viewName);
  });

  // Update Breadcrumb
  dom.breadcrumbs.innerHTML = `
    <span class="crumb" onclick="window.appNavHome()">ホーム</span>
    <span class="breadcrumb-separator">/</span>
    <span class="crumb active">${title}</span>
  `;

  if (window.lucide) window.lucide.createIcons();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.appNavHome = () => {
  switchView('upload', 'ホーム');
};

function resetApplication() {
  state.loadedDocs = [];
  state.selectedDocIndices.clear();
  state.primaryDoc = null;
  state.mergeItems = [];
  state.selectedMergeIds.clear();
  state.splitItems = [];
  state.rotations = {};
  state.pageEdits = {};
  state.currentEditPage = 1;
  state.selectedElementId = null;

  dom.loadedFileList.innerHTML = '';
  dom.loadedSummary.classList.add('hidden');
  dom.fileInput.value = '';
  updateModeCardsState();
  switchView('upload', 'ホーム');
  showToast('ワークスペースをリセットしました');
}

// ==========================================================================
// File Upload & Landing View
// ==========================================================================
function initDropZone() {
  const dropZone = dom.dropZone;
  const fileInput = dom.fileInput;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', async (e) => {
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (files.length > 0) {
      await handleIncomingFiles(files);
    } else {
      showToast('PDFファイルのみ対応しています', 'error');
    }
  });

  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      await handleIncomingFiles(files);
    }
  });

  dom.btnClearFiles.addEventListener('click', resetApplication);
}

function initLoadedSelectionListeners() {
  if (dom.btnSelectAllLoaded) {
    dom.btnSelectAllLoaded.addEventListener('click', () => {
      state.selectedDocIndices.clear();
      state.loadedDocs.forEach((_, idx) => state.selectedDocIndices.add(idx));
      renderLoadedSummary();
    });
  }
  if (dom.btnDeselectAllLoaded) {
    dom.btnDeselectAllLoaded.addEventListener('click', () => {
      state.selectedDocIndices.clear();
      renderLoadedSummary();
    });
  }
}

async function handleIncomingFiles(files) {
  showToast(`${files.length} 件のPDFを解析中...`);

  for (const file of files) {
    try {
      const doc = await pdfEngine.loadDocument(file);
      state.loadedDocs.push(doc);
    } catch (err) {
      console.error('PDF Load Error:', err);
      const msg = err && err.message ? err.message : String(err);
      showToast(`${file.name} の読み込みに失敗しました (${msg})`, 'error');
    }
  }

  if (state.loadedDocs.length > 0) {
    state.selectedDocIndices.clear();
    if (state.loadedDocs.length === 1) {
      // 1件読み込み時はその1件を自動選択
      state.selectedDocIndices.add(0);
      state.primaryDoc = state.loadedDocs[0];
    } else {
      // 複数件読み込み時は全選択（PDF結合がすぐに選択可能）
      state.loadedDocs.forEach((_, idx) => state.selectedDocIndices.add(idx));
    }
    renderLoadedSummary();
  }
}

function renderLoadedSummary() {
  dom.loadedCount.textContent = state.loadedDocs.length;
  dom.loadedSummary.classList.remove('hidden');
  dom.loadedFileList.innerHTML = '';

  const selectedCount = state.selectedDocIndices.size;
  if (dom.selectedCountBadge) {
    dom.selectedCountBadge.textContent = `${selectedCount}件選択中`;
  }

  state.loadedDocs.forEach((doc, idx) => {
    const isSelected = state.selectedDocIndices.has(idx);
    const item = document.createElement('div');
    item.className = `file-item-chip ${isSelected ? 'selected' : ''}`;
    const sizeKB = (doc.size / 1024).toFixed(1);
    item.innerHTML = `
      <div class="file-item-left" onclick="window.toggleDocSelection(${idx}, event)">
        <input type="checkbox" class="file-select-checkbox" data-idx="${idx}" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); window.toggleDocSelection(${idx}, event)">
        <span class="file-icon">📄</span>
        <strong>${doc.name}</strong>
        <span class="file-item-meta">(${doc.pageCount} ページ / ${sizeKB} KB)</span>
      </div>
      <button class="btn-ghost text-danger btn-sm" onclick="window.removeLoadedDoc(${idx})" title="削除">
        <i data-lucide="x"></i>
      </button>
    `;
    dom.loadedFileList.appendChild(item);
  });

  updateModeCardsState();
  if (window.lucide) window.lucide.createIcons();
}

window.toggleDocSelection = (idx, event) => {
  if (state.selectedDocIndices.has(idx)) {
    state.selectedDocIndices.delete(idx);
  } else {
    state.selectedDocIndices.add(idx);
  }
  renderLoadedSummary();
};

window.removeLoadedDoc = (idx) => {
  state.loadedDocs.splice(idx, 1);
  const newSelected = new Set();
  state.selectedDocIndices.forEach((selIdx) => {
    if (selIdx < idx) {
      newSelected.add(selIdx);
    } else if (selIdx > idx) {
      newSelected.add(selIdx - 1);
    }
  });
  state.selectedDocIndices = newSelected;

  if (state.loadedDocs.length === 0) {
    resetApplication();
  } else {
    if (state.selectedDocIndices.size === 1) {
      const singleIdx = Array.from(state.selectedDocIndices)[0];
      state.primaryDoc = state.loadedDocs[singleIdx];
    } else {
      state.primaryDoc = state.loadedDocs[0];
    }
    renderLoadedSummary();
  }
};

function updateModeCardsState() {
  const count = state.selectedDocIndices.size;
  const isSingle = (count === 1);
  const isMultiple = (count >= 2);

  if (isSingle) {
    const singleIdx = Array.from(state.selectedDocIndices)[0];
    state.primaryDoc = state.loadedDocs[singleIdx];
  }

  const setCardState = (cardEl, reqEl, enabled, reqText, reqIcon) => {
    if (!cardEl) return;
    if (enabled) {
      cardEl.classList.remove('disabled');
      cardEl.setAttribute('aria-disabled', 'false');
    } else {
      cardEl.classList.add('disabled');
      cardEl.setAttribute('aria-disabled', 'true');
    }
    if (reqEl) {
      reqEl.innerHTML = `<i data-lucide="${reqIcon}"></i> ${reqText}`;
    }
  };

  // ① PDF編集（1ファイル限定）
  if (isSingle) {
    setCardState(dom.modeCards.edit, dom.reqBadges.edit, true, '選択中（利用可能）', 'check');
  } else if (count === 0) {
    setCardState(dom.modeCards.edit, dom.reqBadges.edit, false, '1ファイル選択してください', 'alert-circle');
  } else {
    setCardState(dom.modeCards.edit, dom.reqBadges.edit, false, '複数選択時は利用不可（1ファイルのみ）', 'alert-circle');
  }

  // ② PDF結合（2ファイル以上限定）
  if (isMultiple) {
    setCardState(dom.modeCards.merge, dom.reqBadges.merge, true, `${count}件選択中（結合可能）`, 'check');
  } else if (count === 1) {
    setCardState(dom.modeCards.merge, dom.reqBadges.merge, false, '複数選択時のみ利用可能（2ファイル以上）', 'alert-circle');
  } else {
    setCardState(dom.modeCards.merge, dom.reqBadges.merge, false, '複数ファイル選択してください', 'alert-circle');
  }

  // ③ PDF分解（1ファイル限定）
  if (isSingle) {
    setCardState(dom.modeCards.split, dom.reqBadges.split, true, '選択中（利用可能）', 'check');
  } else if (count === 0) {
    setCardState(dom.modeCards.split, dom.reqBadges.split, false, '1ファイル選択してください', 'alert-circle');
  } else {
    setCardState(dom.modeCards.split, dom.reqBadges.split, false, '複数選択時は利用不可（1ファイルのみ）', 'alert-circle');
  }

  // ④ 向きの変更（1ファイル限定）
  if (isSingle) {
    setCardState(dom.modeCards.rotate, dom.reqBadges.rotate, true, '選択中（利用可能）', 'check');
  } else if (count === 0) {
    setCardState(dom.modeCards.rotate, dom.reqBadges.rotate, false, '1ファイル選択してください', 'alert-circle');
  } else {
    setCardState(dom.modeCards.rotate, dom.reqBadges.rotate, false, '複数選択時は利用不可（1ファイルのみ）', 'alert-circle');
  }
}

function initModeSelection() {
  const cards = document.querySelectorAll('.mode-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      if (state.loadedDocs.length === 0) {
        showToast('先にPDFファイルを読み込んでください', 'error');
        return;
      }
      if (card.classList.contains('disabled')) {
        const mode = card.dataset.mode;
        if (mode === 'merge') {
          showToast('PDF結合は2つ以上のファイルを選択してください', 'error');
        } else {
          showToast('この操作は1つのファイルを選択して実行してください', 'error');
        }
        return;
      }
      const mode = card.dataset.mode;
      navigateToMode(mode);
    });
  });
}

function navigateToMode(mode) {
  if (mode === 'merge') {
    setupMergeView();
    switchView('merge', 'PDF結合');
  } else if (mode === 'split') {
    setupSplitView();
    switchView('split', 'PDF分解');
  } else if (mode === 'rotate') {
    setupRotateView();
    switchView('rotate', '向きの変更');
  } else if (mode === 'edit') {
    setupEditSelectView();
    switchView('editSelect', 'PDF編集（ページ選択）');
  }
}

// ==========================================================================
// Mode ②: Merge (PDF結合 & D&D並び替え & 複数ブロック移動)
// ==========================================================================
function setupMergeView() {
  // 選択されているファイルのみを結合対象にする
  const targetDocs = Array.from(state.selectedDocIndices)
    .sort((a, b) => a - b)
    .map(idx => state.loadedDocs[idx]);

  state.mergeItems = targetDocs.map((doc, idx) => ({
    id: `merge-${idx}-${Date.now()}`,
    doc: doc,
    name: doc.name,
    pageCount: doc.pageCount,
    size: doc.size,
    arrayBuffer: doc.arrayBuffer
  }));
  state.selectedMergeIds.clear();

  dom.mergeFilename.value = `結合資料_${getFormattedDate()}.pdf`;
  renderMergeList();
}

function getFormattedDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function initMergeListeners() {
  dom.btnMergeAddMore.addEventListener('click', () => dom.mergeAddInput.click());
  dom.mergeAddInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const doc = await pdfEngine.loadDocument(file);
      state.loadedDocs.push(doc);
      state.mergeItems.push({
        id: `merge-${Date.now()}-${Math.random()}`,
        doc: doc,
        name: doc.name,
        pageCount: doc.pageCount,
        size: doc.size,
        arrayBuffer: doc.arrayBuffer
      });
    }
    renderMergeList();
  });

  dom.btnSelectAllMerge.addEventListener('click', () => {
    if (state.selectedMergeIds.size === state.mergeItems.length) {
      state.selectedMergeIds.clear();
    } else {
      state.mergeItems.forEach(item => state.selectedMergeIds.add(item.id));
    }
    renderMergeList();
  });

  dom.btnRunMerge.addEventListener('click', executeMerge);
}

function renderMergeList() {
  const container = dom.mergeItemsContainer;
  container.innerHTML = '';

  state.mergeItems.forEach((item, index) => {
    const isSelected = state.selectedMergeIds.has(item.id);
    const div = document.createElement('div');
    div.className = `merge-item ${isSelected ? 'selected' : ''}`;
    div.draggable = true;
    div.dataset.id = item.id;
    div.dataset.index = index;

    div.innerHTML = `
      <div class="merge-handle"><i data-lucide="grip-vertical"></i></div>
      <input type="checkbox" class="merge-checkbox" ${isSelected ? 'checked' : ''}>
      <span class="file-icon">📄</span>
      <div class="merge-info">
        <div class="merge-filename">${item.name}</div>
        <div class="merge-pages">${item.pageCount} ページ</div>
      </div>
      <button class="btn-ghost text-danger btn-sm" onclick="window.removeMergeItem('${item.id}')">
        <i data-lucide="trash-2"></i>
      </button>
    `;

    // Checkbox toggle
    const checkbox = div.querySelector('.merge-checkbox');
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (e.target.checked) {
        state.selectedMergeIds.add(item.id);
      } else {
        state.selectedMergeIds.delete(item.id);
      }
      div.classList.toggle('selected', e.target.checked);
    });

    // Multi-select with Shift/Ctrl Click
    div.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.closest('button')) return;
      if (e.shiftKey || e.ctrlKey) {
        if (state.selectedMergeIds.has(item.id)) {
          state.selectedMergeIds.delete(item.id);
        } else {
          state.selectedMergeIds.add(item.id);
        }
      } else {
        state.selectedMergeIds.clear();
        state.selectedMergeIds.add(item.id);
      }
      renderMergeList();
    });

    // Drag and Drop Events for Single and Multi-block
    setupMergeDragAndDrop(div, item, index);

    container.appendChild(div);
  });

  if (window.lucide) window.lucide.createIcons();
}

window.removeMergeItem = (id) => {
  state.mergeItems = state.mergeItems.filter(item => item.id !== id);
  state.selectedMergeIds.delete(id);
  renderMergeList();
};

let draggedItemIds = [];

function setupMergeDragAndDrop(element, item, index) {
  element.addEventListener('dragstart', (e) => {
    // If the dragged item is in the selected group, drag all selected items as a block!
    if (state.selectedMergeIds.has(item.id)) {
      draggedItemIds = Array.from(state.selectedMergeIds);
    } else {
      draggedItemIds = [item.id];
      state.selectedMergeIds.clear();
      state.selectedMergeIds.add(item.id);
    }

    e.dataTransfer.effectAllowed = 'move';
    element.classList.add('dragging');
  });

  element.addEventListener('dragend', () => {
    element.classList.remove('dragging');
    document.querySelectorAll('.merge-item').forEach(el => el.classList.remove('drag-over'));
  });

  element.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    element.classList.add('drag-over');
  });

  element.addEventListener('dragleave', () => {
    element.classList.remove('drag-over');
  });

  element.addEventListener('drop', (e) => {
    e.preventDefault();
    element.classList.remove('drag-over');

    const targetId = item.id;
    if (draggedItemIds.includes(targetId)) return;

    // Move dragged block to target position
    const draggedItems = state.mergeItems.filter(i => draggedItemIds.includes(i.id));
    const remainingItems = state.mergeItems.filter(i => !draggedItemIds.includes(i.id));

    const targetIndex = remainingItems.findIndex(i => i.id === targetId);
    remainingItems.splice(targetIndex, 0, ...draggedItems);

    state.mergeItems = remainingItems;
    renderMergeList();
  });
}

async function executeMerge() {
  if (state.mergeItems.length === 0) {
    showToast('結合するPDFがありません', 'error');
    return;
  }

  showToast('PDFを結合中...');
  try {
    const mergedBytes = await pdfEngine.mergeDocuments(state.mergeItems);
    const filename = dom.mergeFilename.value.trim() || '結合完了.pdf';

    await savePdfFile(mergedBytes, filename);
    showToast('結合が完了しました！新規ファイルとして保存されました。', 'success');
  } catch (err) {
    console.error(err);
    showToast('結合処理中にエラーが発生しました', 'error');
  }
}

// ==========================================================================
// Mode ③: Split (PDF分解 & 一括連番命名)
// ==========================================================================
async function setupSplitView() {
  const doc = state.primaryDoc;
  if (!doc) return;

  state.splitItems = [];
  const baseName = doc.name.replace(/\.[^/.]+$/, "");
  dom.splitPrefix.value = `${baseName}_P`;

  for (let i = 0; i < doc.pageCount; i++) {
    const pageNum = i + 1;
    const padded = String(pageNum).padStart(3, '0');
    state.splitItems.push({
      pageIndex: i,
      pageNum: pageNum,
      filename: `${baseName}_P${padded}.pdf`,
      selected: true
    });
  }

  await renderSplitGrid();
}

function initSplitListeners() {
  dom.btnApplySplitNaming.addEventListener('click', applySplitBulkNaming);
  dom.btnRunSplit.addEventListener('click', executeSplit);

  dom.btnSplitSelectAll.addEventListener('click', () => {
    state.splitItems.forEach(item => item.selected = true);
    updateSplitSelectionUI();
  });
  dom.btnSplitDeselectAll.addEventListener('click', () => {
    state.splitItems.forEach(item => item.selected = false);
    updateSplitSelectionUI();
  });
  dom.btnSplitSelectOdd.addEventListener('click', () => {
    state.splitItems.forEach(item => item.selected = (item.pageNum % 2 !== 0));
    updateSplitSelectionUI();
  });
  dom.btnSplitSelectEven.addEventListener('click', () => {
    state.splitItems.forEach(item => item.selected = (item.pageNum % 2 === 0));
    updateSplitSelectionUI();
  });
}

function applySplitBulkNaming() {
  const prefix = dom.splitPrefix.value.trim();
  const digits = parseInt(dom.splitDigits.value, 10);
  let startNum = parseInt(dom.splitStartNum.value, 10) || 1;

  state.splitItems.forEach((item) => {
    const numStr = String(startNum).padStart(digits, '0');
    item.filename = `${prefix}${numStr}.pdf`;
    startNum++;
  });

  // Update input fields
  document.querySelectorAll('.split-filename-input').forEach((input, idx) => {
    input.value = state.splitItems[idx].filename;
  });

  showToast('一括命名ルールを適用しました', 'success');
}

function updateSplitSelectionUI() {
  document.querySelectorAll('.split-page-card').forEach((card, idx) => {
    const item = state.splitItems[idx];
    const cb = card.querySelector('.split-checkbox');
    cb.checked = item.selected;
    card.style.opacity = item.selected ? '1' : '0.45';
  });
}

async function renderSplitGrid() {
  const container = dom.splitGridContainer;
  container.innerHTML = '';

  const doc = state.primaryDoc;

  for (let i = 0; i < state.splitItems.length; i++) {
    const item = state.splitItems[i];
    const card = document.createElement('div');
    card.className = 'split-page-card';
    card.innerHTML = `
      <div class="split-card-header">
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" class="split-checkbox" ${item.selected ? 'checked' : ''}>
          <span>ページ ${item.pageNum}</span>
        </label>
      </div>
      <div class="split-thumb-wrapper">
        <canvas id="split-thumb-${item.pageNum}"></canvas>
      </div>
      <input type="text" class="notion-input split-filename-input" value="${item.filename}">
    `;

    // Checkbox listener
    const cb = card.querySelector('.split-checkbox');
    cb.addEventListener('change', (e) => {
      item.selected = e.target.checked;
      card.style.opacity = item.selected ? '1' : '0.45';
    });

    // Filename input listener
    const fnInput = card.querySelector('.split-filename-input');
    fnInput.addEventListener('input', (e) => {
      item.filename = e.target.value;
    });

    container.appendChild(card);

    // Render thumbnail
    const canvas = card.querySelector(`#split-thumb-${item.pageNum}`);
    pdfEngine.renderPageToCanvas(doc.pdfJsDoc, item.pageNum, canvas, 0.25);
  }
}

async function executeSplit() {
  const selectedItems = state.splitItems.filter(i => i.selected);
  if (selectedItems.length === 0) {
    showToast('分解対象のページが選択されていません', 'error');
    return;
  }

  showToast(`${selectedItems.length} ページを分解出力中...`);
  try {
    const splitResults = await pdfEngine.splitDocument(state.primaryDoc, selectedItems);

    // Save directly to folder or zip
    await saveMultiplePdfFiles(splitResults);
    showToast('分解処理が完了しました！新規ファイル群として出力されました。', 'success');
  } catch (err) {
    console.error(err);
    showToast('分解処理中にエラーが発生しました', 'error');
  }
}

// ==========================================================================
// Mode ④: Rotate (向きの変更 & 一括回転)
// ==========================================================================
async function setupRotateView() {
  const doc = state.primaryDoc;
  if (!doc) return;

  state.rotations = {};
  for (let i = 1; i <= doc.pageCount; i++) {
    state.rotations[i] = 0;
  }

  await renderRotateGrid();
}

function initRotateListeners() {
  dom.btnRotateAllCW.addEventListener('click', () => {
    Object.keys(state.rotations).forEach(p => {
      state.rotations[p] = (state.rotations[p] + 90) % 360;
    });
    updateRotateThumbnails();
  });

  dom.btnRotateAllCCW.addEventListener('click', () => {
    Object.keys(state.rotations).forEach(p => {
      state.rotations[p] = (state.rotations[p] + 270) % 360;
    });
    updateRotateThumbnails();
  });

  dom.btnRotateAll180.addEventListener('click', () => {
    Object.keys(state.rotations).forEach(p => {
      state.rotations[p] = (state.rotations[p] + 180) % 360;
    });
    updateRotateThumbnails();
  });

  dom.btnRotateEven180.addEventListener('click', () => {
    Object.keys(state.rotations).forEach(p => {
      if (parseInt(p, 10) % 2 === 0) {
        state.rotations[p] = (state.rotations[p] + 180) % 360;
      }
    });
    updateRotateThumbnails();
    showToast('偶数ページを180°反転しました', 'success');
  });

  dom.btnRotateReset.addEventListener('click', () => {
    Object.keys(state.rotations).forEach(p => {
      state.rotations[p] = 0;
    });
    updateRotateThumbnails();
  });

  dom.btnRunRotate.addEventListener('click', executeRotate);
}

async function renderRotateGrid() {
  const container = dom.rotateGridContainer;
  container.innerHTML = '';
  const doc = state.primaryDoc;

  for (let pageNum = 1; pageNum <= doc.pageCount; pageNum++) {
    const card = document.createElement('div');
    card.className = 'rotate-card';
    card.innerHTML = `
      <div class="split-card-header">
        <span>ページ ${pageNum}</span>
        <span class="rotate-angle-badge" id="rot-badge-${pageNum}">0°</span>
      </div>
      <div class="rotate-thumb-container">
        <canvas id="rot-canvas-${pageNum}"></canvas>
      </div>
      <div class="rotate-actions">
        <button class="btn-icon" title="左へ90°" onclick="window.rotatePageSingle(${pageNum}, -90)">
          <i data-lucide="rotate-ccw"></i>
        </button>
        <button class="btn-icon" title="180°反転" onclick="window.rotatePageSingle(${pageNum}, 180)">
          <i data-lucide="arrow-up-down"></i>
        </button>
        <button class="btn-icon" title="右へ90°" onclick="window.rotatePageSingle(${pageNum}, 90)">
          <i data-lucide="rotate-cw"></i>
        </button>
      </div>
    `;
    container.appendChild(card);

    const canvas = card.querySelector(`#rot-canvas-${pageNum}`);
    pdfEngine.renderPageToCanvas(doc.pdfJsDoc, pageNum, canvas, 0.28);
  }

  if (window.lucide) window.lucide.createIcons();
}

window.rotatePageSingle = (pageNum, delta) => {
  state.rotations[pageNum] = (state.rotations[pageNum] + delta + 360) % 360;
  updateRotateThumbnails();
};

function updateRotateThumbnails() {
  Object.keys(state.rotations).forEach(p => {
    const angle = state.rotations[p];
    const canvas = document.getElementById(`rot-canvas-${p}`);
    const badge = document.getElementById(`rot-badge-${p}`);
    if (canvas) {
      canvas.style.transform = `rotate(${angle}deg)`;
    }
    if (badge) {
      badge.textContent = `${angle}°`;
    }
  });
}

async function executeRotate() {
  showToast('PDFの向きを変更中...');
  try {
    const rotatedBytes = await pdfEngine.rotateDocument(state.primaryDoc, state.rotations);
    const baseName = state.primaryDoc.name.replace(/\.[^/.]+$/, "");
    const filename = `${baseName}_向き修正.pdf`;

    await savePdfFile(rotatedBytes, filename);
    showToast('向きの変更が完了しました！新規ファイルとして保存されました。', 'success');
  } catch (err) {
    console.error(err);
    showToast('向き変更の保存中にエラーが発生しました', 'error');
  }
}

// ==========================================================================
// Mode ①: Edit (ページ選択 -> 1ページ編集 -> 最終プレビュー)
// ==========================================================================
async function setupEditSelectView() {
  const doc = state.primaryDoc;
  if (!doc) return;

  const modifiedPages = Object.keys(state.pageEdits).filter(p => state.pageEdits[p] && state.pageEdits[p].length > 0);
  dom.editModifiedCount.textContent = modifiedPages.length;

  const grid = dom.editSelectGrid;
  grid.innerHTML = '';

  for (let pageNum = 1; pageNum <= doc.pageCount; pageNum++) {
    const isEdited = state.pageEdits[pageNum] && state.pageEdits[pageNum].length > 0;
    const card = document.createElement('div');
    card.className = 'edit-page-card';
    card.innerHTML = `
      <div class="edit-page-thumb">
        <canvas id="edit-select-canvas-${pageNum}"></canvas>
      </div>
      <div class="edit-page-footer">
        <span>ページ ${pageNum}</span>
        ${isEdited ? '<span class="edited-pill">編集済</span>' : ''}
      </div>
    `;

    card.addEventListener('click', () => {
      openSinglePageEditor(pageNum);
    });

    grid.appendChild(card);

    const canvas = card.querySelector(`#edit-select-canvas-${pageNum}`);
    pdfEngine.renderPageToCanvas(doc.pdfJsDoc, pageNum, canvas, 0.28);
  }

  dom.btnFinishAllEdits.onclick = () => {
    setupFinalPreviewView();
  };
}

// ==========================================================================
// History (Undo / Redo) Management
// ==========================================================================
function pushHistoryState() {
  const currentEdits = state.pageEdits[state.currentEditPage] || [];
  const snapshot = JSON.stringify(currentEdits);
  if (state.undoStack.length > 0 && JSON.stringify(state.undoStack[state.undoStack.length - 1]) === snapshot) {
    return;
  }
  state.undoStack.push(JSON.parse(snapshot));
  if (state.undoStack.length > 40) {
    state.undoStack.shift();
  }
  state.redoStack = [];
  updateHistoryButtons();
}

function undo() {
  if (state.undoStack.length === 0) return;
  const currentEdits = state.pageEdits[state.currentEditPage] || [];
  state.redoStack.push(JSON.parse(JSON.stringify(currentEdits)));

  const prevEdits = state.undoStack.pop();
  state.pageEdits[state.currentEditPage] = prevEdits;
  state.selectedElementId = null;

  renderUserElements();
  updateLayerList();
  updateHistoryButtons();
  showToast('操作を元に戻しました');
}

function redo() {
  if (state.redoStack.length === 0) return;
  const currentEdits = state.pageEdits[state.currentEditPage] || [];
  state.undoStack.push(JSON.parse(JSON.stringify(currentEdits)));

  const nextEdits = state.redoStack.pop();
  state.pageEdits[state.currentEditPage] = nextEdits;
  state.selectedElementId = null;

  renderUserElements();
  updateLayerList();
  updateHistoryButtons();
  showToast('操作をやり直しました');
}

function updateHistoryButtons() {
  if (dom.btnUndo) {
    dom.btnUndo.disabled = state.undoStack.length === 0;
  }
  if (dom.btnRedo) {
    dom.btnRedo.disabled = state.redoStack.length === 0;
  }
}

// ==========================================================================
// Font Management & Dynamic Incremental Search
// ==========================================================================
let fontMasterGroups = [];

function initFontMasterData() {
  const select = dom.textFontFamily;
  if (!select) return;
  fontMasterGroups = [];
  const groups = select.querySelectorAll('optgroup');
  groups.forEach(g => {
    const opts = [];
    g.querySelectorAll('option').forEach(o => {
      opts.push({
        value: o.value,
        text: o.textContent,
        selected: o.selected
      });
    });
    fontMasterGroups.push({
      label: g.label,
      group: g.dataset.group || '',
      options: opts
    });
  });
}

function closeFontSuggestions() {
  if (dom.fontSuggestionsDropdown) {
    dom.fontSuggestionsDropdown.classList.add('hidden');
    dom.fontSuggestionsDropdown.innerHTML = '';
  }
}

function selectFontFamily(fontValue, fontName = '') {
  state.activeTextProp.fontFamily = fontValue;
  if (dom.textFontFamily) {
    dom.textFontFamily.value = fontValue;
  }
  if (dom.fontSearchInput) {
    dom.fontSearchInput.value = '';
  }
  const clearBtn = dom.btnFontSearchClear;
  if (clearBtn) clearBtn.classList.add('hidden');

  closeFontSuggestions();

  // ネイティブセレクトボックスも通常表示にリセット
  renderFontSelectOptions(fontValue, '');

  // 選択中のテキスト要素に即座に反映
  let selected = (state.pageEdits[state.currentEditPage] || []).find(el => el.id === state.selectedElementId);
  if (!selected && state.selectedTextItem) {
    selected = ensureTextEditElement(state.selectedTextItem);
    state.selectedElementId = selected.id;
  }
  if (selected && selected.type === 'text') {
    pushHistoryState();
    selected.fontFamily = fontValue;
    renderUserElements();
  }

  showToast(`フォント「${fontName || fontValue}」を適用しました`, 'success');
}

function renderFontSuggestions(query) {
  const dropdown = dom.fontSuggestionsDropdown;
  if (!dropdown) return;

  const q = (query || '').trim().toLowerCase();
  if (!q) {
    closeFontSuggestions();
    return;
  }

  if (fontMasterGroups.length === 0) {
    initFontMasterData();
  }

  dropdown.innerHTML = '';
  let matchCount = 0;
  let firstItem = null;

  fontMasterGroups.forEach(grp => {
    const matchedOpts = grp.options.filter(opt => 
      opt.text.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q)
    );

    if (matchedOpts.length > 0) {
      const titleEl = document.createElement('div');
      titleEl.className = 'font-sugg-group-title';
      titleEl.textContent = grp.label;
      dropdown.appendChild(titleEl);

      matchedOpts.forEach(opt => {
        const itemEl = document.createElement('div');
        itemEl.className = 'font-sugg-item';
        itemEl.dataset.value = opt.value;
        itemEl.dataset.text = opt.text;
        itemEl.style.fontFamily = opt.value;

        const isCurrent = (state.activeTextProp.fontFamily === opt.value) || 
                          (dom.textFontFamily && dom.textFontFamily.value === opt.value);
        if (isCurrent) {
          itemEl.classList.add('selected');
        }

        itemEl.innerHTML = `<span>${opt.text}</span>`;
        if (isCurrent) {
          itemEl.innerHTML += `<span style="font-size: 11px; opacity: 0.7;">✓ 選択中</span>`;
        }

        itemEl.addEventListener('mousedown', (e) => {
          e.preventDefault();
          selectFontFamily(opt.value, opt.text);
        });

        dropdown.appendChild(itemEl);
        matchCount++;
        if (!firstItem) firstItem = itemEl;
      });
    }
  });

  if (matchCount === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'font-sugg-empty';
    emptyEl.innerHTML = `一致するフォントがありません<br><span style="font-size: 10px; color: var(--notion-blue); cursor: pointer; text-decoration: underline;">[Enter] で「${query}」を手動指定フォントとして追加</span>`;
    emptyEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      applyCustomFontDirect(query);
      closeFontSuggestions();
    });
    dropdown.appendChild(emptyEl);
  } else if (firstItem) {
    firstItem.classList.add('active');
  }

  dropdown.classList.remove('hidden');
}

function renderFontSelectOptions(currentVal = null, query = '') {
  const select = dom.textFontFamily;
  if (!select) return { matchCount: 0, firstMatchedOpt: null };

  if (fontMasterGroups.length === 0) {
    initFontMasterData();
  }

  const targetVal = currentVal || select.value || (state.activeTextProp && state.activeTextProp.fontFamily) || "'Noto Sans JP', sans-serif";
  const q = (query || '').trim().toLowerCase();

  select.innerHTML = '';
  let matchCount = 0;
  let firstMatchedOpt = null;
  let foundTarget = false;

  fontMasterGroups.forEach(grp => {
    const matchedOpts = grp.options.filter(opt => {
      if (!q) return true;
      return opt.text.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q);
    });

    if (matchedOpts.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = grp.label;
      if (grp.group) optgroup.dataset.group = grp.group;

      matchedOpts.forEach(opt => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.textContent = opt.text;
        if (opt.value === targetVal) {
          optionEl.selected = true;
          foundTarget = true;
        }
        optgroup.appendChild(optionEl);
        matchCount++;
        if (!firstMatchedOpt) firstMatchedOpt = optionEl;
      });

      select.appendChild(optgroup);
    }
  });

  if (matchCount === 0 && q) {
    const emptyOpt = document.createElement('option');
    emptyOpt.disabled = true;
    emptyOpt.selected = true;
    emptyOpt.textContent = `⚠️ 一致なし (Enterで「${query}」を手動指定)`;
    select.appendChild(emptyOpt);
  } else if (!foundTarget && firstMatchedOpt) {
    firstMatchedOpt.selected = true;
  }

  return { matchCount, firstMatchedOpt };
}

function filterFontSelect(query) {
  const clearBtn = dom.btnFontSearchClear;
  const q = (query || '').trim();
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', !q);
  }
  renderFontSelectOptions(null, q);
  renderFontSuggestions(q);
}

function applyCustomFontDirect(fontName) {
  const select = dom.textFontFamily;
  if (!select || !fontName) return;

  const cleanName = fontName.trim();
  if (!cleanName) return;

  // マスターデータから既存の一致を探索
  let matchedVal = null;
  let matchedText = '';
  for (const grp of fontMasterGroups) {
    const found = grp.options.find(o => 
      o.text.toLowerCase().includes(cleanName.toLowerCase()) || 
      o.value.toLowerCase().includes(cleanName.toLowerCase())
    );
    if (found) {
      matchedVal = found.value;
      matchedText = found.text;
      break;
    }
  }

  if (matchedVal) {
    if (dom.fontSearchInput) dom.fontSearchInput.value = '';
    filterFontSelect('');
    select.value = matchedVal;
    state.activeTextProp.fontFamily = matchedVal;
    closeFontSuggestions();
    showToast(`フォント「${matchedText}」を適用しました`, 'success');
  } else {
    // 完全新規の手動指定フォントとしてマスターデータの先頭に追加
    const customVal = `'${cleanName}', sans-serif`;
    let customGroup = fontMasterGroups.find(g => g.group === 'custom');
    if (!customGroup) {
      customGroup = {
        label: '✏️ 手動指定フォント',
        group: 'custom',
        options: []
      };
      fontMasterGroups.unshift(customGroup);
    }
    if (!customGroup.options.some(o => o.value === customVal)) {
      customGroup.options.unshift({ value: customVal, text: cleanName });
    }

    if (dom.fontSearchInput) dom.fontSearchInput.value = '';
    filterFontSelect('');
    select.value = customVal;
    state.activeTextProp.fontFamily = customVal;
    closeFontSuggestions();
    showToast(`手動指定フォント「${cleanName}」を適用しました`, 'success');
  }

  // アクティブな要素に即座に反映
  let selected = (state.pageEdits[state.currentEditPage] || []).find(el => el.id === state.selectedElementId);
  if (!selected && state.selectedTextItem) {
    selected = ensureTextEditElement(state.selectedTextItem);
    state.selectedElementId = selected.id;
  }
  if (selected && selected.type === 'text') {
    pushHistoryState();
    selected.fontFamily = select.value;
    renderUserElements();
  }
}

async function loadLocalPcFonts() {
  if (!('queryLocalFonts' in window)) {
    showToast('お使いのブラウザはフォント一括読込API未対応です。上の検索バーに直接フォント名を入力してEnterを押してください', 'info');
    return;
  }

  try {
    showToast('PC内のフォントを読み込み中...');
    const availableFonts = await window.queryLocalFonts();
    const fontFamilies = Array.from(new Set(availableFonts.map(f => f.family))).sort((a, b) => a.localeCompare(b, 'ja'));

    let localGroup = fontMasterGroups.find(g => g.group === 'local');
    if (!localGroup) {
      localGroup = {
        label: `💻 PCローカルフォント (${fontFamilies.length}種類)`,
        group: 'local',
        options: []
      };
      fontMasterGroups.push(localGroup);
    } else {
      localGroup.label = `💻 PCローカルフォント (${fontFamilies.length}種類)`;
    }

    localGroup.options = fontFamilies.map(family => ({
      value: `'${family}', sans-serif`,
      text: family
    }));

    // 再描画
    const curQuery = dom.fontSearchInput ? dom.fontSearchInput.value : '';
    filterFontSelect(curQuery);

    if (dom.fontCountBadge) {
      dom.fontCountBadge.textContent = `${fontFamilies.length}種のPCフォント読込済`;
    }

    dom.btnLoadPcFonts.innerHTML = `<i data-lucide="check"></i> <span>PCフォント読込完了 (${fontFamilies.length}種)</span>`;
    dom.btnLoadPcFonts.classList.add('btn-success-subtle');
    if (window.lucide) window.lucide.createIcons();
    showToast(`${fontFamilies.length}種類のPCフォントを読み込みました！下の選択欄に追加されています。`, 'success');
  } catch (err) {
    console.warn('Font query failed', err);
    if (err.name === 'NotAllowedError') {
      showToast('フォントアクセスが拒否されました', 'error');
    } else {
      showToast('フォントの取得に失敗しました', 'error');
    }
  }
}

let currentTextItems = [];
let currentImageItems = [];
let selectedEmbeddedImage = null;
let activeInlineEditor = null;

async function openSinglePageEditor(pageNum) {
  state.currentEditPage = pageNum;
  dom.currentEditPageNum.textContent = pageNum;
  selectedEmbeddedImage = null;

  // ページ初期化時に履歴スタックを初期化
  state.undoStack = [];
  state.redoStack = [];
  updateHistoryButtons();

  if (dom.fontSearchInput) {
    dom.fontSearchInput.value = '';
    filterFontSelect('');
  }
  if (dom.textFontFamily) {
    dom.textFontFamily.value = state.activeTextProp.fontFamily || "'Noto Sans JP', sans-serif";
  }

  switchView('editPage', `編集 (ページ ${pageNum})`);

  // Ensure edits container exists
  if (!state.pageEdits[pageNum]) {
    state.pageEdits[pageNum] = [];
  }

  await renderEditCanvas(pageNum);
}

async function renderEditCanvas(pageNum) {
  const doc = state.primaryDoc;
  const canvas = dom.pdfRenderCanvas;
  const scale = 1.2 * state.zoomLevel;

  const { viewport } = await pdfEngine.renderPageToCanvas(doc.pdfJsDoc, pageNum, canvas, scale);

  dom.canvasStage.style.width = `${viewport.width}px`;
  dom.canvasStage.style.height = `${viewport.height}px`;

  // 1. テキスト抽出（クリック＆ダブルクリック編集用）
  currentTextItems = await pdfEngine.extractTextItems(doc.pdfJsDoc, pageNum, scale);
  renderTextInteractionLayer(currentTextItems);

  // 2. 埋め込み画像・ロゴ抽出（移動＆消去用）
  currentImageItems = await pdfEngine.extractImageItems(doc.pdfJsDoc, pageNum, scale, canvas);
  renderImageInteractionLayer(currentImageItems);

  // 3. ユーザー作成編集要素（テキスト、白塗り、移動画像等）を描画
  renderUserElements();
  updateLayerList();
}

function renderImageInteractionLayer(imageItems) {
  let container = dom.imageInteractionLayer || document.getElementById('image-interaction-layer');
  if (!container) return;
  container.innerHTML = '';
  container.classList.toggle('select-mode', state.activeTool === 'select');
  container.style.pointerEvents = 'none';

  const edits = state.pageEdits[state.currentEditPage] || [];

  imageItems.forEach((imgItem) => {
    // すでに移動された画像、または白塗り消去された画像は元位置のボックスを表示しない
    const alreadyHandled = edits.some(e => 
      (e.type === 'image' && e.origX !== undefined && Math.abs(e.origX - imgItem.x) < 4 && Math.abs(e.origY - imgItem.y) < 4) ||
      (e.type === 'redact' && e.isImageMask && Math.abs(e.x - imgItem.x) < 4 && Math.abs(e.y - imgItem.y) < 4)
    );
    if (alreadyHandled) return;

    const box = document.createElement('div');
    box.className = 'image-item-box';
    if (selectedEmbeddedImage && selectedEmbeddedImage.id === imgItem.id) {
      box.classList.add('selected');
    }
    box.style.left = `${imgItem.x}px`;
    box.style.top = `${imgItem.y}px`;
    box.style.width = `${imgItem.width}px`;
    box.style.height = `${imgItem.height}px`;
    box.title = `埋め込み画像 (ドラッグして移動 / クリックしてDeleteで消去)`;

    // バッジ
    const badge = document.createElement('div');
    badge.className = 'image-item-badge';
    badge.innerHTML = `<i data-lucide="image"></i><span>画像/ロゴ</span>`;
    box.appendChild(badge);

    // クイック削除ボタン
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-quick-img-delete';
    deleteBtn.title = 'この画像を消去 (白塗り)';
    deleteBtn.innerHTML = `×`;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteEmbeddedImage(imgItem);
    });
    box.appendChild(deleteBtn);

    // クリックで選択
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      selectEmbeddedImage(imgItem, box);
    });

    // ドラッグ移動ハンドラ
    makeRawImageDraggable(box, imgItem);

    container.appendChild(box);
  });

  if (window.lucide) window.lucide.createIcons();
}

function selectEmbeddedImage(imgItem, boxElement) {
  document.querySelectorAll('.image-item-box').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.text-item-box').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.user-el').forEach(el => el.classList.remove('selected'));
  if (boxElement) boxElement.classList.add('selected');
  selectedEmbeddedImage = imgItem;
  state.selectedElementId = null;
  activateTool('select');
  showToast(`埋め込み画像 (${imgItem.width}x${imgItem.height}px) を選択中。ドラッグで移動、Deleteキーで消去できます`);
}

function deleteEmbeddedImage(imgItem) {
  pushHistoryState();
  const edits = state.pageEdits[state.currentEditPage] || [];
  const redactEdit = {
    id: `edit-redact-${Date.now()}`,
    type: 'redact',
    isImageMask: true,
    origImgId: imgItem.id,
    x: imgItem.x - 1,
    y: imgItem.y - 1,
    width: imgItem.width + 2,
    height: imgItem.height + 2,
    color: '#FFFFFF',
    canvasWidth: dom.pdfRenderCanvas.width,
    canvasHeight: dom.pdfRenderCanvas.height
  };
  edits.push(redactEdit);
  state.selectedElementId = redactEdit.id;
  selectedEmbeddedImage = null;
  renderUserElements();
  renderImageInteractionLayer(currentImageItems);
  updateLayerList();
  showToast('埋め込み画像を消去（白塗り）しました');
}

function ensureImageEditElement(imgItem) {
  const edits = state.pageEdits[state.currentEditPage] || [];
  let existing = edits.find(
    e => e.type === 'image' && e.origX !== undefined &&
         Math.abs(e.origX - imgItem.x) < 4 && Math.abs(e.origY - imgItem.y) < 4
  );

  if (!existing) {
    existing = {
      id: `edit-image-${Date.now()}`,
      type: 'image',
      isEmbedded: true,
      x: imgItem.x,
      y: imgItem.y,
      origX: imgItem.x,
      origY: imgItem.y,
      origWidth: imgItem.width,
      origHeight: imgItem.height,
      width: imgItem.width,
      height: imgItem.height,
      dataUrl: imgItem.dataUrl,
      canvasWidth: dom.pdfRenderCanvas.width,
      canvasHeight: dom.pdfRenderCanvas.height
    };
    edits.push(existing);
  }
  return existing;
}

function makeRawImageDraggable(box, imgItem) {
  let isDragging = false;
  let startX, startY;
  let hasMoved = false;
  let targetEdit = null;
  let currentDx = 0, currentDy = 0;
  let rafId = null;

  box.addEventListener('mousedown', (e) => {
    if (state.activeTool !== 'select') return;
    if (e.button !== 0) return;
    if (e.target.classList.contains('btn-quick-img-delete')) return;

    startX = e.clientX;
    startY = e.clientY;
    hasMoved = false;
    isDragging = true;
    targetEdit = null;

    const onMouseMove = (ev) => {
      if (!isDragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      if (!hasMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        hasMoved = true;
        targetEdit = ensureImageEditElement(imgItem);
        state.selectedElementId = targetEdit.id;
        renderUserElements();
        renderImageInteractionLayer(currentImageItems);
      }

      if (hasMoved && targetEdit) {
        currentDx = dx;
        currentDy = dy;
        if (!rafId) {
          rafId = requestAnimationFrame(() => {
            if (!isDragging) return;
            const userEl = document.querySelector(`.user-el[data-id="${targetEdit.id}"]`);
            if (userEl) {
              userEl.style.transform = `translate3d(${currentDx}px, ${currentDy}px, 0)`;
              userEl.classList.add('is-dragging');
            }
            rafId = null;
          });
        }
      }
    };

    const onMouseUp = (ev) => {
      if (!isDragging) return;
      isDragging = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      if (hasMoved && targetEdit) {
        const finalDx = ev.clientX - startX;
        const finalDy = ev.clientY - startY;
        pushHistoryState();
        targetEdit.x = Math.round(targetEdit.origX + finalDx);
        targetEdit.y = Math.round(targetEdit.origY + finalDy);
        state.selectedElementId = targetEdit.id;
        renderUserElements();
        renderImageInteractionLayer(currentImageItems);
        updateLayerList();
        showToast('画像を移動しました（元の位置は白塗り消去されます）');
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}


function renderTextInteractionLayer(items) {
  const container = dom.textInteractionLayer;
  container.innerHTML = '';
  container.classList.toggle('select-mode', state.activeTool === 'select');

  items.forEach((item) => {
    const box = document.createElement('div');
    box.className = 'text-item-box';
    box.style.left = `${item.x}px`;
    box.style.top = `${item.y}px`;
    box.style.width = `${item.width}px`;
    box.style.height = `${item.height}px`;
    box.style.fontSize = `${item.fontSize}px`;
    box.textContent = item.str;

    box.title = state.activeTool === 'highlight'
      ? `マウスで文字をドラッグ選択してハイライト`
      : `クリックして文字選択・編集: "${item.str}"`;

    box.addEventListener('click', (e) => {
      // マウスドラッグで文字を選択した直後は通常の文字編集化をスキップ
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) {
        return;
      }
      if (state.activeTool === 'select') {
        selectAndEditText(item, box);
      }
    });

    box.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (state.activeTool === 'select') {
        createInlineEditor(item);
      }
    });

    // プレビュー上の元文字を直接ドラッグ移動できるように設定 (selectモード時)
    makeRawTextDraggable(box, item);

    container.appendChild(box);
  });
}

function applyHighlightToCurrentSelection(customColor = null) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    showToast('文字が選択されていません。プレビュー上の文字をマウスでドラッグして選択してください', 'error');
    return false;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    showToast('文字が選択されていません', 'error');
    return false;
  }

  const range = selection.getRangeAt(0);
  const stageRect = dom.canvasStage.getBoundingClientRect();
  const clientRects = Array.from(range.getClientRects());

  if (clientRects.length === 0) {
    showToast('選択範囲の取得に失敗しました', 'error');
    return false;
  }

  const color = customColor || state.activeHighlightColor || '#FFE600';
  const edits = state.pageEdits[state.currentEditPage] || [];
  let addedCount = 0;

  if (clientRects.length > 0) {
    pushHistoryState();
  }

  clientRects.forEach((r, idx) => {
    if (r.width < 1 || r.height < 1) return;

    // canvasStage相対座標に変換（上下に1pxのゆとりを持たせ、Adobe Readerのように文字を美しく包み込む）
    const x = Math.max(0, Math.round(r.left - stageRect.left - 1));
    const y = Math.max(0, Math.round(r.top - stageRect.top - 1));
    const width = Math.max(Math.round(r.width + 2), 4);
    const height = Math.max(Math.round(r.height + 2), 8);

    const newHighlight = {
      id: `highlight-${Date.now()}-${idx}`,
      type: 'highlight',
      x: x,
      y: y,
      width: width,
      height: height,
      color: color,
      canvasWidth: dom.pdfRenderCanvas.width,
      canvasHeight: dom.pdfRenderCanvas.height
    };

    edits.push(newHighlight);
    addedCount++;
  });

  // 選択解除＆選択ボックスの枠線クリーンアップ
  selection.removeAllRanges();
  document.querySelectorAll('.text-item-box.selected').forEach(b => b.classList.remove('selected'));
  hideQuickHighlightPopup();

  renderUserElements();
  updateLayerList();

  const previewStr = selectedText.length > 12 ? selectedText.substring(0, 12) + '...' : selectedText;
  showToast(`「${previewStr}」にハイライトを適用しました`, 'success');
  return true;
}

function checkAndShowQuickHighlightPopup() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    hideQuickHighlightPopup();
    return;
  }

  const text = selection.toString().trim();
  if (!text) {
    hideQuickHighlightPopup();
    return;
  }

  const range = selection.getRangeAt(0);
  const stageRect = dom.canvasStage.getBoundingClientRect();
  const rect = range.getBoundingClientRect();

  // stageの範囲外なら表示しない
  if (rect.bottom < stageRect.top || rect.top > stageRect.bottom ||
      rect.right < stageRect.left || rect.left > stageRect.right) {
    hideQuickHighlightPopup();
    return;
  }

  const popup = dom.quickHighlightPopup;
  if (!popup) return;

  const popupX = (rect.left + rect.width / 2) - stageRect.left;
  const popupY = (rect.top - stageRect.top) - 10;

  popup.style.left = `${Math.max(30, popupX)}px`;
  popup.style.top = `${Math.max(10, popupY)}px`;
  popup.classList.remove('hidden');

  if (window.lucide) window.lucide.createIcons();
}

function hideQuickHighlightPopup() {
  if (dom.quickHighlightPopup) {
    dom.quickHighlightPopup.classList.add('hidden');
  }
}

function getTextItemFontSize(item) {
  if (!item) return 14;

  const actualHeight = (typeof item.height === 'number' && item.height > 0) ? item.height : 0;
  const nominalSize = (typeof item.fontSize === 'number' && item.fontSize > 0) ? item.fontSize : 0;

  let visualSize = 14;

  if (actualHeight > 0 && nominalSize > 0) {
    // PDFではフォントのem square設定やスケーリングにより、
    // 名目サイズ(nominalSize)が実際の文字の描画高さ(actualHeight)よりも大幅に大きいケースが頻出する。
    // その場合、名目サイズを採用するとプレビュー表示時よりも文字が巨大化してしまうため、
    // 画面上で見えている実際の文字高さ（actualHeight）を基準に正確に合わせる。
    if (nominalSize > actualHeight * 1.1) {
      visualSize = actualHeight * 0.95;
    } else if (nominalSize < actualHeight * 0.6) {
      visualSize = actualHeight * 0.85;
    } else {
      visualSize = Math.min(nominalSize, actualHeight * 0.95);
    }
  } else if (actualHeight > 0) {
    visualSize = actualHeight * 0.9;
  } else if (nominalSize > 0) {
    visualSize = nominalSize;
  }

  // 文字列の幅と文字数から、1文字あたりの幅による検証・微調整
  if (item.str && item.str.trim().length > 0 && typeof item.width === 'number' && item.width > 0) {
    const text = item.str.trim();
    let weight = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 128 || (code >= 0xff61 && code <= 0xff9f)) {
        weight += 0.55;
      } else {
        weight += 1.0;
      }
    }
    if (weight > 0) {
      const avgCharWidth = item.width / weight;
      // 日本語の全角文字は幅と高さがほぼ等しいため、計算されたsizeが文字幅より著しく大きい場合は文字幅に合わせる
      if (visualSize > avgCharWidth * 1.25) {
        visualSize = avgCharWidth;
      }
    }
  }

  return Math.max(8, Math.min(72, Math.round(visualSize)));
}

function ensureTextEditElement(item) {
  const edits = state.pageEdits[state.currentEditPage] || [];
  let existing = edits.find(
    e => e.type === 'text' && (
      (Math.abs(e.x - item.x) < 3 && Math.abs(e.y - item.y) < 3) ||
      (e.origX !== undefined && Math.abs(e.origX - item.x) < 3 && Math.abs(e.origY - item.y) < 3)
    )
  );

  if (!existing) {
    const calculatedFontSize = getTextItemFontSize(item);
    const fontToUse = (item && item.detectedFont && item.detectedFont.fontFamily)
      ? item.detectedFont.fontFamily
      : (dom.textFontFamily ? dom.textFontFamily.value : "'Noto Sans JP', sans-serif");
    const isBold = (item && item.detectedFont) ? !!item.detectedFont.bold : (state.activeTextProp.bold || false);
    const isItalic = (item && item.detectedFont) ? !!item.detectedFont.italic : (state.activeTextProp.italic || false);

    existing = {
      id: `edit-text-${Date.now()}`,
      type: 'text',
      x: item.x,
      y: item.y,
      origX: item.x,
      origY: item.y,
      origWidth: item.width,
      origHeight: item.height,
      origText: item.str,
      width: Math.max(item.width, 30),
      height: Math.max(item.height, 16),
      text: item.str,
      fontSize: calculatedFontSize,
      fontFamily: fontToUse,
      color: state.activeTextProp.color || '#000000',
      bold: isBold,
      italic: isItalic,
      maskBg: dom.textBgMask.checked,
      canvasWidth: dom.pdfRenderCanvas.width,
      canvasHeight: dom.pdfRenderCanvas.height
    };
    edits.push(existing);
  }
  return existing;
}

function selectAndEditText(textItem, boxElement) {
  // 全テキストボックスの選択クラスを外す
  document.querySelectorAll('.text-item-box').forEach(b => b.classList.remove('selected'));
  if (boxElement) boxElement.classList.add('selected');

  // 選択ツールのモードにする
  activateTool('select');

  // 選択中の元テキスト情報を保持
  state.selectedTextItem = textItem;

  const edits = state.pageEdits[state.currentEditPage] || [];
  const existing = edits.find(
    e => e.type === 'text' && (
      (Math.abs(e.x - textItem.x) < 3 && Math.abs(e.y - textItem.y) < 3) ||
      (e.origX !== undefined && Math.abs(e.origX - textItem.x) < 3 && Math.abs(e.origY - textItem.y) < 3)
    )
  );

  const calculatedFontSize = getTextItemFontSize(textItem);

  if (existing) {
    state.selectedElementId = existing.id;
    dom.activeTextInput.value = existing.text;
    const finalSize = existing.fontSize || calculatedFontSize;
    dom.textFontSizeRange.value = finalSize;
    dom.textFontSizeVal.textContent = `${finalSize}px`;
    dom.btnToggleBold.classList.toggle('active', !!existing.bold);
    dom.btnToggleItalic.classList.toggle('active', !!existing.italic);
    if (dom.textFontFamily && existing.fontFamily) {
      dom.textFontFamily.value = existing.fontFamily;
    }
  } else {
    // クリックしただけでは編集要素を追加せず、サイドバーに入力情報を同期
    state.selectedElementId = null;
    dom.activeTextInput.value = textItem.str;
    dom.textFontSizeRange.value = calculatedFontSize;
    dom.textFontSizeVal.textContent = `${calculatedFontSize}px`;

    // 検出された元フォント・スタイルをサイドバーのデフォルト値に適用
    if (textItem.detectedFont) {
      selectFontFamily(textItem.detectedFont.fontFamily);
      dom.btnToggleBold.classList.toggle('active', !!textItem.detectedFont.bold);
      dom.btnToggleItalic.classList.toggle('active', !!textItem.detectedFont.italic);
      state.activeTextProp.bold = !!textItem.detectedFont.bold;
      state.activeTextProp.italic = !!textItem.detectedFont.italic;
    } else {
      dom.btnToggleBold.classList.remove('active');
      dom.btnToggleItalic.classList.remove('active');
      if (dom.textFontFamily) {
        dom.textFontFamily.value = state.activeTextProp.fontFamily || "'Noto Sans JP', sans-serif";
      }
    }
  }

  renderUserElements();
  updateLayerList();

  // サイドバーのテキスト入力欄にフォーカス
  dom.activeTextInput.focus();
  dom.activeTextInput.select();
}

function createInlineEditor(textItem, targetEdit = null) {
  if (activeInlineEditor) activeInlineEditor.remove();

  // targetEditが未指定なら、同一座標の既存 edit を探す
  if (!targetEdit) {
    const edits = state.pageEdits[state.currentEditPage] || [];
    targetEdit = edits.find(
      e => e.type === 'text' && (
        (Math.abs(e.x - textItem.x) < 3 && Math.abs(e.y - textItem.y) < 3) ||
        (e.origX !== undefined && Math.abs(e.origX - textItem.x) < 3 && Math.abs(e.origY - textItem.y) < 3)
      )
    );
  }

  // 検出されたフォント・スタイル情報を取得
  const detected = textItem ? textItem.detectedFont : null;
  const initialFont = targetEdit
    ? (targetEdit.fontFamily || 'Noto Sans JP, sans-serif')
    : (detected ? detected.fontFamily : (state.activeTextProp.fontFamily || dom.textFontFamily.value));
  const initialBold = targetEdit
    ? !!targetEdit.bold
    : (detected ? !!detected.bold : !!state.activeTextProp.bold);
  const initialItalic = targetEdit
    ? !!targetEdit.italic
    : (detected ? !!detected.italic : !!state.activeTextProp.italic);

  // サイドバーのフォントセレクタ・スタイルボタンも元テキストのフォントと同期
  selectFontFamily(initialFont);
  dom.btnToggleBold.classList.toggle('active', initialBold);
  dom.btnToggleItalic.classList.toggle('active', initialItalic);
  state.activeTextProp.bold = initialBold;
  state.activeTextProp.italic = initialItalic;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-text-editor';
  input.value = targetEdit ? targetEdit.text : textItem.str;
  const currentX = targetEdit ? targetEdit.x : textItem.x;
  const currentY = targetEdit ? targetEdit.y : textItem.y;
  const currentWidth = targetEdit ? Math.max(targetEdit.width + 30, 140) : Math.max(textItem.width + 30, 140);
  const currentSize = targetEdit ? targetEdit.fontSize : getTextItemFontSize(textItem);

  const currentHeight = targetEdit ? Math.max(targetEdit.height, currentSize * 1.2) : Math.max(textItem.height, currentSize * 1.2);

  input.style.left = `${currentX}px`;
  input.style.top = `${currentY}px`;
  input.style.minWidth = `${currentWidth}px`;
  input.style.height = `${Math.round(currentHeight + 2)}px`;
  input.style.fontSize = `${currentSize}px`;
  input.style.lineHeight = `${Math.round(currentHeight)}px`;
  input.style.fontFamily = initialFont;
  input.style.color = targetEdit ? (targetEdit.color || '#000000') : (state.activeTextProp.color || '#000000');
  if (initialBold) input.style.fontWeight = 'bold';
  if (initialItalic) input.style.fontStyle = 'italic';

  dom.canvasStage.appendChild(input);
  input.focus();
  input.select();
  activeInlineEditor = input;

  const commitEdit = () => {
    const val = input.value.trim();
    if (val) {
      const oldVal = targetEdit ? targetEdit.text : (textItem ? textItem.str : '');
      if (oldVal !== val) {
        pushHistoryState();
      }
      let editObj = targetEdit;
      if (!editObj) {
        editObj = ensureTextEditElement(textItem);
        state.selectedElementId = editObj.id;
      }
      editObj.text = val;
      editObj.fontSize = currentSize; // 編集時の原寸フォントサイズを完全維持
      dom.activeTextInput.value = val;
      dom.textFontSizeRange.value = currentSize;
      dom.textFontSizeVal.textContent = `${currentSize}px`;
      renderUserElements();
      updateLayerList();
    }
    input.remove();
    activeInlineEditor = null;
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') {
      input.remove();
      activeInlineEditor = null;
    }
  });

  input.addEventListener('blur', commitEdit);
}

function makeRawTextDraggable(box, item) {
  let isDragging = false;
  let startX, startY;
  let hasMoved = false;
  let targetEdit = null;
  let currentDx = 0, currentDy = 0;
  let rafId = null;

  box.addEventListener('mousedown', (e) => {
    if (state.activeTool === 'highlight') return;
    if (e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    hasMoved = false;
    isDragging = true;
    targetEdit = null;

    let beforeDragEdits = JSON.parse(JSON.stringify(state.pageEdits[state.currentEditPage] || []));

    const onMouseMove = (ev) => {
      if (!isDragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      if (!hasMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        hasMoved = true;
        targetEdit = ensureTextEditElement(item);
        state.selectedElementId = targetEdit.id;
        renderUserElements();
      }

      if (hasMoved && targetEdit) {
        currentDx = dx;
        currentDy = dy;
        if (!rafId) {
          rafId = requestAnimationFrame(() => {
            if (!isDragging) return;
            const userEl = document.querySelector(`.user-el[data-id="${targetEdit.id}"]`);
            if (userEl) {
              userEl.style.transform = `translate3d(${currentDx}px, ${currentDy}px, 0)`;
              userEl.classList.add('is-dragging');
            }
            rafId = null;
          });
        }
      }
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      if (hasMoved && targetEdit && (currentDx !== 0 || currentDy !== 0)) {
        // ドラッグ前のクリーンな状態（targetEdit作成前）をUndoスタックに保存！
        if (state.undoStack.length === 0 || JSON.stringify(state.undoStack[state.undoStack.length - 1]) !== JSON.stringify(beforeDragEdits)) {
          state.undoStack.push(beforeDragEdits);
          if (state.undoStack.length > 40) state.undoStack.shift();
          state.redoStack = [];
          updateHistoryButtons();
        }
        targetEdit.x = Math.max(0, targetEdit.x + currentDx);
        targetEdit.y = Math.max(0, targetEdit.y + currentDy);
        renderUserElements();
        updateLayerList();
      } else if (targetEdit && currentDx === 0 && currentDy === 0) {
        // 動かさなかった場合は自動生成されたゴミ要素を除去して文字ダブりを完全防護
        state.pageEdits[state.currentEditPage] = state.pageEdits[state.currentEditPage].filter(el => el.id !== targetEdit.id);
        if (state.selectedElementId === targetEdit.id) state.selectedElementId = null;
        renderUserElements();
        updateLayerList();
      }

      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function cleanupPristineEdits() {
  const currentEdits = state.pageEdits[state.currentEditPage];
  if (!currentEdits || currentEdits.length === 0) return;

  state.pageEdits[state.currentEditPage] = currentEdits.filter(edit => {
    if (edit.type === 'text' && edit.origX !== undefined) {
      const isSamePos = Math.abs(edit.x - edit.origX) <= 2 && Math.abs(edit.y - edit.origY) <= 2;
      const isSameText = edit.origText !== undefined ? edit.text === edit.origText : false;
      const isDefaultStyle = !edit.bold && !edit.italic && (!edit.color || edit.color === '#000000');
      // 位置も文字もスタイルも元のままなら、文字ダブりを防止するために自動除去
      if (isSamePos && isSameText && isDefaultStyle) {
        if (state.selectedElementId === edit.id) state.selectedElementId = null;
        return false;
      }
    }
    return true;
  });
}

function renderUserElements() {
  cleanupPristineEdits();
  const container = dom.userElementsLayer;
  container.innerHTML = '';
  if (dom.highlightElementsLayer) {
    dom.highlightElementsLayer.innerHTML = '';
  }

  const edits = state.pageEdits[state.currentEditPage] || [];

  // 移動または変更されたテキスト・画像の「元位置の白塗りマスク」を先に描画（ダブりの完全防止！）
  edits.forEach((edit) => {
    if (edit.origX !== undefined) {
      const isMoved = Math.abs(edit.x - edit.origX) > 2 || Math.abs(edit.y - edit.origY) > 2;
      const isTextChanged = edit.type === 'text' && edit.origText !== undefined && edit.text !== edit.origText;
      if (isMoved || isTextChanged || edit.maskBg) {
        const origMask = document.createElement('div');
        origMask.className = 'user-orig-mask';
        origMask.style.left = `${edit.origX - 1}px`;
        origMask.style.top = `${edit.origY - 1}px`;
        origMask.style.width = `${edit.origWidth + 2}px`;
        origMask.style.height = `${edit.origHeight + 2}px`;
        container.appendChild(origMask);
      }
    }
  });

  edits.forEach((edit) => {
    const isSelected = state.selectedElementId === edit.id;

    // ハイライト要素は直下のCanvasと真の乗算合成（multiply）を行うため専用レイヤーに配置
    if (edit.type === 'highlight') {
      const hlContainer = dom.highlightElementsLayer || container;
      const hlEl = document.createElement('div');
      hlEl.className = `user-highlight-el ${isSelected ? 'selected' : ''}`;
      hlEl.style.left = `${edit.x}px`;
      hlEl.style.top = `${edit.y}px`;
      hlEl.style.width = `${edit.width}px`;
      hlEl.style.height = `${edit.height}px`;
      hlEl.style.backgroundColor = edit.color || '#FFE600';
      hlEl.dataset.id = edit.id;

      hlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedElementId = edit.id;
        document.querySelectorAll('.user-el, .user-highlight-el').forEach(elem => elem.classList.remove('selected'));
        hlEl.classList.add('selected');
        updateLayerList();
      });

      hlContainer.appendChild(hlEl);
      return;
    }

    const el = document.createElement('div');
    el.className = `user-el ${isSelected ? 'selected' : ''}`;
    el.style.left = `${edit.x}px`;
    el.style.top = `${edit.y}px`;
    el.dataset.id = edit.id;

    if (edit.type === 'text') {
      el.className += ' user-text-el';
      el.style.fontSize = `${edit.fontSize || 14}px`;
      el.style.fontFamily = edit.fontFamily || 'Noto Sans JP, sans-serif';
      el.style.color = edit.color || '#000000';
      el.style.fontWeight = edit.bold ? 'bold' : 'normal';
      el.style.fontStyle = edit.italic ? 'italic' : 'normal';
      el.style.backgroundColor = edit.maskBg ? '#FFFFFF' : 'transparent';
      el.textContent = edit.text;

      // Click to select this text element & sync sidebar
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedElementId = edit.id;
        dom.activeTextInput.value = edit.text;
        dom.textFontSizeRange.value = edit.fontSize || 14;
        dom.textFontSizeVal.textContent = `${edit.fontSize || 14}px`;
        dom.btnToggleBold.classList.toggle('active', !!edit.bold);
        dom.btnToggleItalic.classList.toggle('active', !!edit.italic);
        if (dom.textFontFamily && edit.fontFamily) {
          dom.textFontFamily.value = edit.fontFamily;
        }
        document.querySelectorAll('.user-el, .user-highlight-el').forEach(elem => elem.classList.remove('selected'));
        el.classList.add('selected');
        updateLayerList();
      });

      // Double-click to inline edit directly on preview
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        createInlineEditor({ str: edit.text, x: edit.x, y: edit.y, width: edit.width, height: edit.height }, edit);
      });

    } else if (edit.type === 'redact') {
      el.className += ' user-redact-el';
      el.style.width = `${edit.width}px`;
      el.style.height = `${edit.height}px`;
      el.style.backgroundColor = edit.color;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedElementId = edit.id;
        document.querySelectorAll('.user-el, .user-highlight-el').forEach(elem => elem.classList.remove('selected'));
        el.classList.add('selected');
        updateLayerList();
      });

    } else if (edit.type === 'image') {
      el.className += ' user-image-el';
      el.style.width = `${edit.width}px`;
      el.style.height = `${edit.height}px`;
      const img = document.createElement('img');
      img.src = edit.dataUrl;
      el.appendChild(img);

      // Resize handle for images
      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      makeImageResizable(handle, el, edit);
      el.appendChild(handle);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedElementId = edit.id;
        document.querySelectorAll('.user-el, .user-highlight-el').forEach(elem => elem.classList.remove('selected'));
        el.classList.add('selected');
        updateLayerList();
      });
    }

    // Draggable element (High performance GPU smooth dragging)
    makeElementDraggable(el, edit);

    container.appendChild(el);
  });
}

function makeElementDraggable(el, edit) {
  let isDragging = false;
  let startX, startY, origX, origY;
  let currentDx = 0, currentDy = 0;
  let rafId = null;

  el.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.classList.contains('resize-handle')) return;
    if (e.button !== 0) return; // Only primary button
    e.stopPropagation();

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origX = edit.x;
    origY = edit.y;
    currentDx = 0;
    currentDy = 0;

    let beforeDragEdits = JSON.parse(JSON.stringify(state.pageEdits[state.currentEditPage] || []));

    // テキスト要素または埋め込み画像で元位置情報が未保存の場合は保存
    if (edit.origX === undefined && (edit.type === 'text' || edit.isEmbedded)) {
      edit.origX = edit.x;
      edit.origY = edit.y;
      edit.origWidth = edit.width || 30;
      edit.origHeight = edit.height || 16;
      if (edit.type === 'text') edit.origText = edit.text;
    }

    // Fast selection without destroying DOM
    state.selectedElementId = edit.id;
    document.querySelectorAll('.user-el, .user-highlight-el').forEach(elem => elem.classList.remove('selected'));
    el.classList.add('selected');
    el.classList.add('is-dragging');
    updateLayerList();

    if (edit.type === 'text') {
      dom.activeTextInput.value = edit.text;
      dom.textFontSizeRange.value = edit.fontSize || 14;
      dom.textFontSizeVal.textContent = `${edit.fontSize || 14}px`;
      dom.btnToggleBold.classList.toggle('active', !!edit.bold);
      dom.btnToggleItalic.classList.toggle('active', !!edit.italic);
    }

    const onMouseMove = (ev) => {
      if (!isDragging) return;
      currentDx = ev.clientX - startX;
      currentDy = ev.clientY - startY;

      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          if (!isDragging) return;
          el.style.transform = `translate3d(${currentDx}px, ${currentDy}px, 0)`;
          rafId = null;
        });
      }
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      el.classList.remove('is-dragging');
      el.style.transform = '';

      if (currentDx !== 0 || currentDy !== 0) {
        if (state.undoStack.length === 0 || JSON.stringify(state.undoStack[state.undoStack.length - 1]) !== JSON.stringify(beforeDragEdits)) {
          state.undoStack.push(beforeDragEdits);
          if (state.undoStack.length > 40) state.undoStack.shift();
          state.redoStack = [];
          updateHistoryButtons();
        }
      }
      edit.x = Math.max(0, origX + currentDx);
      edit.y = Math.max(0, origY + currentDy);
      el.style.left = `${edit.x}px`;
      el.style.top = `${edit.y}px`;

      // 元位置マスクの再描画などを確実に反映
      renderUserElements();
      updateLayerList();

      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function makeImageResizable(handle, el, edit) {
  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    let startX = e.clientX;
    let startY = e.clientY;
    let startW = edit.width;
    let startH = edit.height;

    const onMouseMove = (ev) => {
      const dw = ev.clientX - startX;
      const dh = ev.clientY - startY;
      edit.width = Math.max(20, startW + dw);
      edit.height = Math.max(20, startH + dh);
      el.style.width = `${edit.width}px`;
      el.style.height = `${edit.height}px`;
    };

    const onMouseUp = () => {
      if (edit.width !== startW || edit.height !== startH) {
        pushHistoryState();
      }
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function updateLayerList() {
  const container = dom.layerList;
  container.innerHTML = '';
  const edits = state.pageEdits[state.currentEditPage] || [];
  dom.layerCount.textContent = edits.length;

  if (edits.length === 0) {
    container.innerHTML = '<p class="text-xs text-muted">編集項目がありません</p>';
    return;
  }

  // 最新の編集要素を最上部にして並び替え（配列を逆順でレンダリング）
  const reversedEdits = [...edits].reverse();

  reversedEdits.forEach((edit) => {
    const div = document.createElement('div');
    div.className = `layer-item ${state.selectedElementId === edit.id ? 'selected' : ''}`;
    let label = '';
    if (edit.type === 'text') {
      label = `✏️ "${edit.text}"`;
    } else if (edit.type === 'redact') {
      label = edit.isImageMask ? `⬜ 埋め込み画像の消去` : `🔲 墨消し (${edit.color === '#FFFFFF' ? '白塗り' : '黒塗り'})`;
    } else if (edit.type === 'highlight') {
      label = `🖍️ ハイライト`;
    } else if (edit.type === 'image') {
      label = edit.isEmbedded ? `🖼️ 埋め込み画像 (移動)` : `🖼️ 画像埋め込み (${edit.width}x${edit.height})`;
    }

    div.innerHTML = `
      <span class="layer-item-title">${label}</span>
      <button class="btn-ghost text-danger btn-sm" onclick="window.removePageEdit('${edit.id}')" title="削除">
        <i data-lucide="trash-2"></i>
      </button>
    `;

    div.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      state.selectedElementId = edit.id;
      renderUserElements();
      updateLayerList();
    });

    container.appendChild(div);
  });

  if (window.lucide) window.lucide.createIcons();
}

window.removePageEdit = (id) => {
  pushHistoryState();
  state.pageEdits[state.currentEditPage] = state.pageEdits[state.currentEditPage].filter(e => e.id !== id);
  if (state.selectedElementId === id) state.selectedElementId = null;
  renderUserElements();
  renderImageInteractionLayer(currentImageItems);
  updateLayerList();
};

function activateTool(toolName) {
  state.activeTool = toolName;
  dom.toolTabs.forEach(t => t.classList.toggle('active', t.dataset.tool === toolName));

  dom.panelTextOptions.classList.toggle('hidden', toolName !== 'select' && toolName !== 'text');
  dom.panelHighlightOptions.classList.toggle('hidden', toolName !== 'highlight');
  dom.panelRedactOptions.classList.toggle('hidden', toolName !== 'redact');
  dom.panelImageOptions.classList.toggle('hidden', toolName !== 'image');

  dom.textInteractionLayer.classList.toggle('select-mode', toolName === 'select');
  if (dom.imageInteractionLayer) {
    dom.imageInteractionLayer.classList.toggle('select-mode', toolName === 'select');
    dom.imageInteractionLayer.style.pointerEvents = 'none';
  }

  if (toolName === 'highlight') {
    dom.textInteractionLayer.style.pointerEvents = 'auto';
    dom.canvasStage.style.cursor = 'text';
  } else if (toolName === 'redact') {
    dom.textInteractionLayer.style.pointerEvents = 'none';
    dom.canvasStage.style.cursor = 'crosshair';
    hideQuickHighlightPopup();
  } else if (toolName === 'text') {
    dom.textInteractionLayer.style.pointerEvents = 'none';
    dom.canvasStage.style.cursor = 'text';
    hideQuickHighlightPopup();
  } else {
    dom.textInteractionLayer.style.pointerEvents = 'auto';
    dom.canvasStage.style.cursor = 'default';
  }
}

function initEditListeners() {
  // Global Keyboard Shortcuts (Delete, Undo, Redo)
  window.addEventListener('keydown', (e) => {
    if (state.currentView !== 'editPage') return;
    const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedEmbeddedImage) {
        e.preventDefault();
        deleteEmbeddedImage(selectedEmbeddedImage);
        selectedEmbeddedImage = null;
        return;
      }
      if (state.selectedElementId) {
        e.preventDefault();
        window.removePageEdit(state.selectedElementId);
        showToast('選択した要素を削除しました');
      }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redo();
    }
  });

  // Tool switching
  dom.toolTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activateTool(tab.dataset.tool);
    });
  });

  // Helper to get currently selected text edit or create one from selected text item
  function getOrInitSelectedTextEdit() {
    let selected = (state.pageEdits[state.currentEditPage] || []).find(el => el.id === state.selectedElementId);
    if (!selected && state.selectedTextItem) {
      selected = ensureTextEditElement(state.selectedTextItem);
      state.selectedElementId = selected.id;
    }
    return selected;
  }

  // Text Properties Syncing (Realtime editing)
  dom.activeTextInput.addEventListener('focus', () => {
    pushHistoryState();
  });

  dom.activeTextInput.addEventListener('input', (e) => {
    const val = e.target.value;
    const selected = getOrInitSelectedTextEdit();
    if (selected && selected.type === 'text') {
      selected.text = val;
      renderUserElements();
      updateLayerList();
    }
  });

  // Font Family
  dom.textFontFamily.addEventListener('change', (e) => {
    pushHistoryState();
    state.activeTextProp.fontFamily = e.target.value;
    const selected = getOrInitSelectedTextEdit();
    if (selected && selected.type === 'text') {
      selected.fontFamily = e.target.value;
      renderUserElements();
    }
  });

  // Bold Toggle
  dom.btnToggleBold.addEventListener('click', () => {
    pushHistoryState();
    state.activeTextProp.bold = !state.activeTextProp.bold;
    dom.btnToggleBold.classList.toggle('active', state.activeTextProp.bold);

    const selected = getOrInitSelectedTextEdit();
    if (selected && selected.type === 'text') {
      selected.bold = state.activeTextProp.bold;
      renderUserElements();
    }
  });

  // Italic Toggle
  dom.btnToggleItalic.addEventListener('click', () => {
    pushHistoryState();
    state.activeTextProp.italic = !state.activeTextProp.italic;
    dom.btnToggleItalic.classList.toggle('active', state.activeTextProp.italic);

    const selected = getOrInitSelectedTextEdit();
    if (selected && selected.type === 'text') {
      selected.italic = state.activeTextProp.italic;
      renderUserElements();
    }
  });

  // Font Size Slider
  dom.textFontSizeRange.addEventListener('change', () => {
    pushHistoryState();
  });

  dom.textFontSizeRange.addEventListener('input', (e) => {
    const size = parseInt(e.target.value, 10);
    dom.textFontSizeVal.textContent = `${size}px`;
    state.activeTextProp.fontSize = size;

    const selected = getOrInitSelectedTextEdit();
    if (selected && selected.type === 'text') {
      selected.fontSize = size;
      renderUserElements();
    }
  });

  // Color Preset Chips for Text
  document.querySelectorAll('.color-chip[data-color]').forEach(chip => {
    chip.addEventListener('click', () => {
      pushHistoryState();
      document.querySelectorAll('.color-chip[data-color]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const color = chip.dataset.color;
      state.activeTextProp.color = color;
      dom.textColor.value = color;

      const selected = getOrInitSelectedTextEdit();
      if (selected && selected.type === 'text') {
        selected.color = color;
        renderUserElements();
      }
    });
  });

  // Custom Color Input
  dom.textColor.addEventListener('change', () => {
    pushHistoryState();
  });

  dom.textColor.addEventListener('input', (e) => {
    const color = e.target.value;
    state.activeTextProp.color = color;
    const selected = getOrInitSelectedTextEdit();
    if (selected && selected.type === 'text') {
      selected.color = color;
      renderUserElements();
    }
  });

  // Background Mask Toggle
  dom.textBgMask.addEventListener('change', (e) => {
    pushHistoryState();
    const checked = e.target.checked;
    state.activeTextProp.maskBg = checked;
    const selected = getOrInitSelectedTextEdit();
    if (selected && selected.type === 'text') {
      selected.maskBg = checked;
      renderUserElements();
    }
  });

  // Undo / Redo Click Handlers
  if (dom.btnUndo) {
    dom.btnUndo.addEventListener('click', () => {
      undo();
    });
  }
  if (dom.btnRedo) {
    dom.btnRedo.addEventListener('click', () => {
      redo();
    });
  }

  // Local PC Fonts Loader
  if (dom.btnLoadPcFonts) {
    dom.btnLoadPcFonts.addEventListener('click', loadLocalPcFonts);
  }

  // Font Search (Incremental Search & Floating Suggestion Dropdown)
  if (dom.fontSearchInput) {
    dom.fontSearchInput.addEventListener('input', (e) => {
      filterFontSelect(e.target.value);
    });

    dom.fontSearchInput.addEventListener('focus', () => {
      if (dom.fontSearchInput.value.trim()) {
        renderFontSuggestions(dom.fontSearchInput.value.trim());
      }
    });

    dom.fontSearchInput.addEventListener('keydown', (e) => {
      const dropdown = dom.fontSuggestionsDropdown;
      const isOpen = dropdown && !dropdown.classList.contains('hidden');

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (isOpen) {
          e.preventDefault();
          const items = Array.from(dropdown.querySelectorAll('.font-sugg-item'));
          if (items.length > 0) {
            let activeIdx = items.findIndex(it => it.classList.contains('active'));
            if (activeIdx >= 0) items[activeIdx].classList.remove('active');

            if (e.key === 'ArrowDown') {
              activeIdx = (activeIdx + 1) % items.length;
            } else {
              activeIdx = (activeIdx - 1 + items.length) % items.length;
            }

            const nextActive = items[activeIdx];
            nextActive.classList.add('active');
            nextActive.scrollIntoView({ block: 'nearest' });
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (dom.textFontFamily) dom.textFontFamily.focus();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const val = dom.fontSearchInput.value.trim();
        if (isOpen) {
          const activeItem = dropdown.querySelector('.font-sugg-item.active') || 
                             dropdown.querySelector('.font-sugg-item');
          if (activeItem) {
            selectFontFamily(activeItem.dataset.value, activeItem.dataset.text);
            return;
          }
        }
        if (val) {
          applyCustomFontDirect(val);
          closeFontSuggestions();
        }
      } else if (e.key === 'Escape') {
        closeFontSuggestions();
      }
    });
  }

  if (dom.btnFontSearchClear) {
    dom.btnFontSearchClear.addEventListener('click', () => {
      if (dom.fontSearchInput) {
        dom.fontSearchInput.value = '';
        filterFontSelect('');
        closeFontSuggestions();
        dom.fontSearchInput.focus();
      }
    });
  }

  // ドロップダウンの外側クリックで閉じる
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.font-search-bar-wrap')) {
      closeFontSuggestions();
    }
  });

  // Font Family Select Change
  if (dom.textFontFamily) {
    dom.textFontFamily.addEventListener('change', (e) => {
      pushHistoryState();
      state.activeTextProp.fontFamily = e.target.value;
      const selected = getOrInitSelectedTextEdit();
      if (selected && selected.type === 'text') {
        selected.fontFamily = e.target.value;
        renderUserElements();
      }
      showToast(`フォントを変更しました`, 'info');
    });
  }

  // Highlight Button (サイドバー「選択した文字をハイライト」ボタン)
  if (dom.btnApplySelectionHighlight) {
    dom.btnApplySelectionHighlight.addEventListener('click', () => {
      applyHighlightToCurrentSelection();
    });
  }

  // Floating Quick Highlight Popup Button
  if (dom.btnQuickHlAction) {
    dom.btnQuickHlAction.addEventListener('click', () => {
      applyHighlightToCurrentSelection();
    });
  }

  // Quick Highlight Color Dots
  document.querySelectorAll('.quick-color-dot[data-hl-color]').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = dot.dataset.hlColor;
      state.activeHighlightColor = color;
      document.querySelectorAll('.quick-color-dot').forEach(d => d.classList.toggle('active', d === dot));
      document.querySelectorAll('.color-chip[data-hl-color]').forEach(c => c.classList.toggle('active', c.dataset.hlColor === color));
      applyHighlightToCurrentSelection(color);
    });
  });

  // Highlight Color Preset Chips (サイドバー)
  document.querySelectorAll('.color-chip[data-hl-color]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.color-chip[data-hl-color]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const color = chip.dataset.hlColor;
      state.activeHighlightColor = color;
      document.querySelectorAll('.quick-color-dot').forEach(d => d.classList.toggle('active', d.dataset.hlColor === color));

      // もし文字が選択状態にあれば、その色で即座にハイライトを適用！
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) {
        applyHighlightToCurrentSelection(color);
      }
    });
  });

  // Canvas Stage Mouseup - 文字ドラッグ選択完了時の挙動
  dom.canvasStage.addEventListener('mouseup', () => {
    setTimeout(() => {
      // 「文字ハイライト」ツールがアクティブな場合は、ドラッグ選択完了直後にAdobe Reader同様に即座にハイライトを自動適用！
      if (state.activeTool === 'highlight') {
        const sel = window.getSelection();
        if (sel && sel.toString().trim().length > 0) {
          applyHighlightToCurrentSelection();
          return;
        }
      }
      checkAndShowQuickHighlightPopup();
    }, 40);
  });

  // 画面クリックで選択解除されたらポップアップを閉じる
  document.addEventListener('mousedown', (e) => {
    if (dom.quickHighlightPopup && !dom.quickHighlightPopup.contains(e.target) && !dom.btnApplySelectionHighlight?.contains(e.target)) {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          hideQuickHighlightPopup();
        }
      }, 60);
    }
  });

  // Image Upload Listener
  dom.imageUploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > 200) {
          h = Math.round((200 / w) * h);
          w = 200;
        }
        const newImg = {
          id: `img-${Date.now()}`,
          type: 'image',
          dataUrl: dataUrl,
          x: 50,
          y: 50,
          width: w,
          height: h,
          canvasWidth: dom.pdfRenderCanvas.width,
          canvasHeight: dom.pdfRenderCanvas.height
        };
        pushHistoryState();
        state.pageEdits[state.currentEditPage].push(newImg);
        state.selectedElementId = newImg.id;
        renderUserElements();
        updateLayerList();
        showToast('画像を配置しました。ドラッグで移動、右下ハンドルでサイズ変更できます。');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  // Drag Drawing for Redaction (墨消し・白塗りのみ矩形ドラッグで作成)
  let isDrawingRect = false;
  let rectStartX = 0;
  let rectStartY = 0;

  dom.canvasStage.addEventListener('mousedown', (e) => {
    if (state.activeTool !== 'redact') return;
    if (e.target.closest('.inline-text-editor')) return;
    if (e.button !== 0) return; // Only left click

    e.preventDefault();
    const rect = dom.canvasStage.getBoundingClientRect();
    isDrawingRect = true;
    rectStartX = e.clientX - rect.left;
    rectStartY = e.clientY - rect.top;

    dom.dragGuideBox.style.left = `${rectStartX}px`;
    dom.dragGuideBox.style.top = `${rectStartY}px`;
    dom.dragGuideBox.style.width = '0px';
    dom.dragGuideBox.style.height = '0px';
    dom.dragGuideBox.classList.remove('hidden');

    dom.dragGuideBox.style.backgroundColor = dom.redactColor.value === '#FFFFFF' ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.5)';
    dom.dragGuideBox.style.borderColor = 'var(--notion-blue)';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDrawingRect) return;
    const rect = dom.canvasStage.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const currentY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const x = Math.min(rectStartX, currentX);
    const y = Math.min(rectStartY, currentY);
    const w = Math.abs(currentX - rectStartX);
    const h = Math.abs(currentY - rectStartY);

    dom.dragGuideBox.style.left = `${x}px`;
    dom.dragGuideBox.style.top = `${y}px`;
    dom.dragGuideBox.style.width = `${w}px`;
    dom.dragGuideBox.style.height = `${h}px`;
  });

  window.addEventListener('mouseup', (e) => {
    if (!isDrawingRect) return;
    isDrawingRect = false;
    dom.dragGuideBox.classList.add('hidden');

    const rect = dom.canvasStage.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const currentY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const x = Math.min(rectStartX, currentX);
    const y = Math.min(rectStartY, currentY);
    const w = Math.abs(currentX - rectStartX);
    const h = Math.abs(currentY - rectStartY);

    if (w < 6 || h < 6) return; // Ignore accidental micro-clicks

    if (state.activeTool === 'redact') {
      pushHistoryState();
      const isWhite = dom.redactColor.value === '#FFFFFF';
      const newRedact = {
        id: `redact-${Date.now()}`,
        type: 'redact',
        x,
        y,
        width: w,
        height: h,
        color: dom.redactColor.value,
        canvasWidth: dom.pdfRenderCanvas.width,
        canvasHeight: dom.pdfRenderCanvas.height
      };
      state.pageEdits[state.currentEditPage].push(newRedact);
      state.selectedElementId = newRedact.id;
      renderUserElements();
      updateLayerList();
      showToast(isWhite ? '白塗りを配置しました' : '墨消しを配置しました');
    }
  });

  // Canvas Stage Click for adding new text
  dom.canvasStage.addEventListener('click', (e) => {
    if (state.activeTool === 'text') {
      const rect = dom.canvasStage.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      createInlineEditor({ str: '新規テキスト', x, y, width: 80, height: 20 });
    }
  });

  // Zoom controls
  dom.btnZoomIn.addEventListener('click', () => {
    state.zoomLevel = Math.min(state.zoomLevel + 0.2, 2.5);
    dom.zoomLevelText.textContent = `${Math.round(state.zoomLevel * 100)}%`;
    renderEditCanvas(state.currentEditPage);
  });
  dom.btnZoomOut.addEventListener('click', () => {
    state.zoomLevel = Math.max(state.zoomLevel - 0.2, 0.6);
    dom.zoomLevelText.textContent = `${Math.round(state.zoomLevel * 100)}%`;
    renderEditCanvas(state.currentEditPage);
  });
  dom.btnZoomFit.addEventListener('click', () => {
    state.zoomLevel = 1.0;
    dom.zoomLevelText.textContent = '100%';
    renderEditCanvas(state.currentEditPage);
  });

  // Navigation back / complete
  dom.btnBackToPageSelect.addEventListener('click', () => {
    setupEditSelectView();
    switchView('editSelect', 'PDF編集（ページ選択）');
  });

  dom.btnSaveSingleEdit.addEventListener('click', () => {
    showToast(`ページ ${state.currentEditPage} の編集を保存しました`, 'success');
    setupEditSelectView();
    switchView('editSelect', 'PDF編集（ページ選択）');
  });

  dom.btnCancelSingleEdit.addEventListener('click', () => {
    setupEditSelectView();
    switchView('editSelect', 'PDF編集（ページ選択）');
  });
}

// ==========================================================================
// Final Preview & Output
// ==========================================================================
let editedPdfDocCache = null;

async function setupFinalPreviewView() {
  switchView('finalPreview', '完成後イメージ確認');
  showToast('編集を反映した最終プレビューを生成中...');

  state.finalPreviewPage = 1;
  const baseName = state.primaryDoc.name.replace(/\.[^/.]+$/, "");
  dom.finalExportFilename.value = `${baseName}_編集完了.pdf`;

  try {
    // Generate modified PDF bytes
    const pdfBytes = await pdfEngine.applyEditsToDocument(state.primaryDoc, state.pageEdits);
    // Reload into PDF.js for rendering
    editedPdfDocCache = await pdfEngine.pdfjs.getDocument({ data: pdfBytes }).promise;
    
    dom.finalTotalPages.textContent = editedPdfDocCache.numPages;
    await renderFinalPreviewPage(1);
  } catch (err) {
    console.error(err);
    showToast('最終プレビューの生成に失敗しました', 'error');
  }
}

async function renderFinalPreviewPage(pageNum) {
  if (!editedPdfDocCache) return;
  state.finalPreviewPage = pageNum;
  dom.finalCurrentPage.textContent = pageNum;

  const canvas = dom.finalPreviewCanvas;
  await pdfEngine.renderPageToCanvas(editedPdfDocCache, pageNum, canvas, 1.2);
}

function initFinalPreviewListeners() {
  dom.btnFinalPrevPage.addEventListener('click', () => {
    if (state.finalPreviewPage > 1) {
      renderFinalPreviewPage(state.finalPreviewPage - 1);
    }
  });

  dom.btnFinalNextPage.addEventListener('click', () => {
    if (editedPdfDocCache && state.finalPreviewPage < editedPdfDocCache.numPages) {
      renderFinalPreviewPage(state.finalPreviewPage + 1);
    }
  });

  dom.btnBackToEditSelect.addEventListener('click', () => {
    setupEditSelectView();
    switchView('editSelect', 'PDF編集（ページ選択）');
  });

  dom.btnRunFinalExport.addEventListener('click', executeFinalExport);
}

async function executeFinalExport() {
  showToast('PDFを書き出し中...');
  try {
    const pdfBytes = await pdfEngine.applyEditsToDocument(state.primaryDoc, state.pageEdits);
    const filename = dom.finalExportFilename.value.trim() || '完成書類.pdf';

    await savePdfFile(pdfBytes, filename);
    showToast('新規PDFとして正常に出力保存されました！', 'success');
  } catch (err) {
    console.error(err);
    showToast('出力保存中にエラーが発生しました', 'error');
  }
}

// ==========================================================================
// Safe File System Output (Non-destructive, User picks folder/file)
// ==========================================================================
async function savePdfFile(pdfBytes, defaultFilename) {
  // 1. Try Modern File System Access API (showSaveFilePicker)
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultFilename,
        types: [{
          description: 'PDF Document',
          accept: { 'application/pdf': ['.pdf'] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(pdfBytes);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // User cancelled
      console.warn('showSaveFilePicker fallback to download', err);
    }
  }

  // 2. Fallback: Browser Download Anchor
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function saveMultiplePdfFiles(files) {
  // 1. Try Modern Directory Picker (showDirectoryPicker) to save all files directly into user-selected folder
  if ('showDirectoryPicker' in window) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      for (const f of files) {
        const fileHandle = await dirHandle.getFileHandle(f.filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(f.bytes);
        await writable.close();
      }
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('showDirectoryPicker fallback to zip download', err);
    }
  }

  // 2. Fallback: Package into a ZIP using JSZip
  if (window.JSZip) {
    const zip = new window.JSZip();
    files.forEach(f => {
      zip.file(f.filename, f.bytes);
    });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `分解ファイルまとめ_${getFormattedDate()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
