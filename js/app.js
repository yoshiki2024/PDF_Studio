// Configure PDF.js worker
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
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
      const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
      
      const x = tx[4];
      const y = tx[5] - fontSize;
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

      // 1. ハイライトを最背面（テキストの背面）に描画
      const highlights = edits.filter(e => e.type === 'highlight');
      for (const edit of highlights) {
        const scaleX = width / edit.canvasWidth;
        const scaleY = height / edit.canvasHeight;
        const pdfX = edit.x * scaleX;
        const pdfY = height - (edit.y * scaleY) - (edit.height * scaleY);
        const pdfWidth = edit.width * scaleX;
        const pdfHeight = edit.height * scaleY;
        const rgb = this.hexToRgb(edit.color || '#FFF275');
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: pdfWidth,
          height: pdfHeight,
          color: this.pdfLib.rgb(rgb.r / 255, rgb.g / 255, rgb.b / 255),
          opacity: 0.45,
          borderWidth: 0
        });
      }

      // 2. 移動されたテキストの「元位置の白塗りマスク」を描画（二重表示の完全防止！）
      for (const edit of edits) {
        if (edit.type === 'text' && edit.origX !== undefined && (Math.abs(edit.x - edit.origX) > 2 || Math.abs(edit.y - edit.origY) > 2)) {
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
  activeHighlightColor: '#FFF275',
  zoomLevel: 1.0,
  finalPreviewPage: 1
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
  textInteractionLayer: document.getElementById('text-interaction-layer'),
  userElementsLayer: document.getElementById('user-elements-layer'),
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

let currentTextItems = [];
let activeInlineEditor = null;

async function openSinglePageEditor(pageNum) {
  state.currentEditPage = pageNum;
  dom.currentEditPageNum.textContent = pageNum;

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

  // Extract texts for click-to-edit
  currentTextItems = await pdfEngine.extractTextItems(doc.pdfJsDoc, pageNum, scale);
  renderTextInteractionLayer(currentTextItems);

  // Render user created edits (text overlays, redactions, stamps)
  renderUserElements();
  updateLayerList();
}

function renderTextInteractionLayer(items) {
  const container = dom.textInteractionLayer;
  container.innerHTML = '';

  items.forEach((item) => {
    const box = document.createElement('div');
    box.className = 'text-item-box';
    box.style.left = `${item.x}px`;
    box.style.top = `${item.y}px`;
    box.style.width = `${item.width}px`;
    box.style.height = `${item.height}px`;
    box.title = state.activeTool === 'highlight'
      ? `クリックしてハイライトを適用/解除: "${item.str}"`
      : `クリックして文字選択・編集: "${item.str}"`;

    box.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.activeTool === 'highlight') {
        applyHighlightToTextItem(item);
      } else {
        selectAndEditText(item, box);
      }
    });

    box.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (state.activeTool !== 'highlight') {
        createInlineEditor(item);
      }
    });

    // プレビュー上の元文字を直接ドラッグ移動できるように設定
    makeRawTextDraggable(box, item);

    container.appendChild(box);
  });
}

function applyHighlightToTextItem(item) {
  const edits = state.pageEdits[state.currentEditPage] || [];
  const padX = 2;
  const padY = 2;
  const targetX = Math.max(0, item.x - padX);
  const targetY = Math.max(0, item.y - padY);
  const targetW = item.width + padX * 2;
  const targetH = item.height + padY * 2;

  // 既存の同一位置ハイライトがあればトグル解除
  const existingIdx = edits.findIndex(e =>
    e.type === 'highlight' &&
    Math.abs(e.x - targetX) < 8 &&
    Math.abs(e.y - targetY) < 8
  );

  if (existingIdx !== -1) {
    edits.splice(existingIdx, 1);
    state.selectedElementId = null;
    showToast('ハイライトを解除しました');
  } else {
    const newHighlight = {
      id: `highlight-${Date.now()}`,
      type: 'highlight',
      x: targetX,
      y: targetY,
      width: targetW,
      height: targetH,
      color: state.activeHighlightColor || '#FFF275',
      canvasWidth: dom.pdfRenderCanvas.width,
      canvasHeight: dom.pdfRenderCanvas.height
    };
    edits.push(newHighlight);
    state.selectedElementId = newHighlight.id;
    showToast(`「${item.str}」にハイライトを適用しました`);
  }

  renderUserElements();
  updateLayerList();
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
    const calculatedFontSize = Math.max(9, Math.min(48, Math.round(item.height ? item.height * 0.72 : (item.fontSize || 14))));
    existing = {
      id: `edit-text-${Date.now()}`,
      type: 'text',
      x: item.x,
      y: item.y,
      origX: item.x,
      origY: item.y,
      origWidth: item.width,
      origHeight: item.height,
      width: Math.max(item.width, 30),
      height: Math.max(item.height, 16),
      text: item.str,
      fontSize: calculatedFontSize,
      fontFamily: dom.textFontFamily.value,
      color: state.activeTextProp.color || '#000000',
      bold: state.activeTextProp.bold || false,
      italic: state.activeTextProp.italic || false,
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

  // 見た目の高さから自然なフォントサイズを算出（em-heightによる巨大化を防ぐ）
  const calculatedFontSize = Math.max(9, Math.min(48, Math.round(textItem.height ? textItem.height * 0.72 : (textItem.fontSize || 14))));

  if (existing) {
    state.selectedElementId = existing.id;
    dom.activeTextInput.value = existing.text;
    dom.textFontSizeRange.value = existing.fontSize || calculatedFontSize;
    dom.textFontSizeVal.textContent = `${existing.fontSize || calculatedFontSize}px`;
    dom.btnToggleBold.classList.toggle('active', !!existing.bold);
    dom.btnToggleItalic.classList.toggle('active', !!existing.italic);
  } else {
    // クリックしただけでは編集要素を追加せず、サイドバーに入力情報を同期するのみ
    state.selectedElementId = null;
    dom.activeTextInput.value = textItem.str;
    dom.textFontSizeRange.value = calculatedFontSize;
    dom.textFontSizeVal.textContent = `${calculatedFontSize}px`;
    dom.btnToggleBold.classList.remove('active');
    dom.btnToggleItalic.classList.remove('active');
  }

  renderUserElements();
  updateLayerList();

  // サイドバーのテキスト入力欄にフォーカス
  dom.activeTextInput.focus();
  dom.activeTextInput.select();
}

function createInlineEditor(textItem, targetEdit = null) {
  if (activeInlineEditor) activeInlineEditor.remove();

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-text-editor';
  input.value = targetEdit ? targetEdit.text : textItem.str;
  const currentX = targetEdit ? targetEdit.x : textItem.x;
  const currentY = targetEdit ? targetEdit.y : textItem.y;
  const currentWidth = targetEdit ? Math.max(targetEdit.width + 30, 140) : Math.max(textItem.width + 30, 140);
  const currentSize = targetEdit ? targetEdit.fontSize : Math.max(9, Math.min(48, Math.round(textItem.height ? textItem.height * 0.72 : (textItem.fontSize || 14))));

  input.style.left = `${currentX}px`;
  input.style.top = `${currentY}px`;
  input.style.minWidth = `${currentWidth}px`;
  input.style.fontSize = `${currentSize}px`;
  input.style.fontFamily = targetEdit ? (targetEdit.fontFamily || 'Noto Sans JP, sans-serif') : dom.textFontFamily.value;
  input.style.color = targetEdit ? (targetEdit.color || '#000000') : (state.activeTextProp.color || '#000000');
  if (targetEdit ? targetEdit.bold : state.activeTextProp.bold) input.style.fontWeight = 'bold';
  if (targetEdit ? targetEdit.italic : state.activeTextProp.italic) input.style.fontStyle = 'italic';

  dom.canvasStage.appendChild(input);
  input.focus();
  input.select();
  activeInlineEditor = input;

  const commitEdit = () => {
    const val = input.value.trim();
    if (val) {
      if (targetEdit) {
        targetEdit.text = val;
        dom.activeTextInput.value = val;
      } else {
        const newEdit = ensureTextEditElement(textItem);
        newEdit.text = val;
        state.selectedElementId = newEdit.id;
        dom.activeTextInput.value = val;
      }
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

      if (hasMoved && targetEdit) {
        targetEdit.x = Math.max(0, targetEdit.x + currentDx);
        targetEdit.y = Math.max(0, targetEdit.y + currentDy);
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

function renderUserElements() {
  const container = dom.userElementsLayer;
  container.innerHTML = '';

  const edits = state.pageEdits[state.currentEditPage] || [];

  // 移動されたテキストの「元位置の白塗りマスク」を先に描画（二重表示の防止）
  edits.forEach((edit) => {
    if (edit.type === 'text' && edit.origX !== undefined && (Math.abs(edit.x - edit.origX) > 2 || Math.abs(edit.y - edit.origY) > 2)) {
      const origMask = document.createElement('div');
      origMask.className = 'user-orig-mask';
      origMask.style.left = `${edit.origX - 1}px`;
      origMask.style.top = `${edit.origY - 1}px`;
      origMask.style.width = `${edit.origWidth + 2}px`;
      origMask.style.height = `${edit.origHeight + 2}px`;
      container.appendChild(origMask);
    }
  });

  edits.forEach((edit) => {
    const el = document.createElement('div');
    const isSelected = state.selectedElementId === edit.id;
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
        document.querySelectorAll('.user-el').forEach(elem => elem.classList.remove('selected'));
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
        document.querySelectorAll('.user-el').forEach(elem => elem.classList.remove('selected'));
        el.classList.add('selected');
        updateLayerList();
      });

    } else if (edit.type === 'highlight') {
      el.className += ' user-highlight-el';
      el.style.width = `${edit.width}px`;
      el.style.height = `${edit.height}px`;
      el.style.backgroundColor = edit.color || '#FFF275';

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedElementId = edit.id;
        document.querySelectorAll('.user-el').forEach(elem => elem.classList.remove('selected'));
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
        document.querySelectorAll('.user-el').forEach(elem => elem.classList.remove('selected'));
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

    // テキスト要素で元位置情報が未保存の場合は保存
    if (edit.type === 'text' && edit.origX === undefined) {
      edit.origX = edit.x;
      edit.origY = edit.y;
      edit.origWidth = edit.width || 30;
      edit.origHeight = edit.height || 16;
    }

    // Fast selection without destroying DOM
    state.selectedElementId = edit.id;
    document.querySelectorAll('.user-el').forEach(elem => elem.classList.remove('selected'));
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
      label = `🔲 墨消し (${edit.color === '#FFFFFF' ? '白塗り' : '黒塗り'})`;
    } else if (edit.type === 'highlight') {
      label = `🖍️ ハイライト`;
    } else if (edit.type === 'image') {
      label = `🖼️ 画像埋め込み (${edit.width}x${edit.height})`;
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
  state.pageEdits[state.currentEditPage] = state.pageEdits[state.currentEditPage].filter(e => e.id !== id);
  if (state.selectedElementId === id) state.selectedElementId = null;
  renderUserElements();
  updateLayerList();
};

function activateTool(toolName) {
  state.activeTool = toolName;
  dom.toolTabs.forEach(t => t.classList.toggle('active', t.dataset.tool === toolName));

  dom.panelTextOptions.classList.toggle('hidden', toolName !== 'select' && toolName !== 'text');
  dom.panelHighlightOptions.classList.toggle('hidden', toolName !== 'highlight');
  dom.panelRedactOptions.classList.toggle('hidden', toolName !== 'redact');
  dom.panelImageOptions.classList.toggle('hidden', toolName !== 'image');

  if (toolName === 'highlight') {
    dom.textInteractionLayer.style.pointerEvents = 'auto';
    dom.textInteractionLayer.classList.add('highlight-cursor');
    dom.canvasStage.style.cursor = 'pointer';
  } else if (toolName === 'redact') {
    dom.textInteractionLayer.style.pointerEvents = 'none';
    dom.textInteractionLayer.classList.remove('highlight-cursor');
    dom.canvasStage.style.cursor = 'crosshair';
  } else if (toolName === 'text') {
    dom.textInteractionLayer.style.pointerEvents = 'none';
    dom.textInteractionLayer.classList.remove('highlight-cursor');
    dom.canvasStage.style.cursor = 'text';
  } else {
    dom.textInteractionLayer.style.pointerEvents = 'auto';
    dom.textInteractionLayer.classList.remove('highlight-cursor');
    dom.canvasStage.style.cursor = 'default';
  }
}

function initEditListeners() {
  // Global Delete / Backspace key shortcut to remove selected edit element
  window.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.currentView === 'editPage' && state.selectedElementId) {
        e.preventDefault();
        window.removePageEdit(state.selectedElementId);
        showToast('選択した要素を削除しました');
      }
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
    state.activeTextProp.fontFamily = e.target.value;
    const selected = getOrInitSelectedTextEdit();
    if (selected && selected.type === 'text') {
      selected.fontFamily = e.target.value;
      renderUserElements();
    }
  });

  // Bold Toggle
  dom.btnToggleBold.addEventListener('click', () => {
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
    state.activeTextProp.italic = !state.activeTextProp.italic;
    dom.btnToggleItalic.classList.toggle('active', state.activeTextProp.italic);

    const selected = getOrInitSelectedTextEdit();
    if (selected && selected.type === 'text') {
      selected.italic = state.activeTextProp.italic;
      renderUserElements();
    }
  });

  // Font Size Slider
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
    const checked = e.target.checked;
    state.activeTextProp.maskBg = checked;
    const selected = getOrInitSelectedTextEdit();
    if (selected && selected.type === 'text') {
      selected.maskBg = checked;
      renderUserElements();
    }
  });

  // Highlight Color Preset Chips
  document.querySelectorAll('.color-chip[data-hl-color]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.color-chip[data-hl-color]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeHighlightColor = chip.dataset.hlColor;
    });
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
