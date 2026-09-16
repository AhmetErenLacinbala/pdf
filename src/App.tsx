import {
  Check, CloudOff, Download, FileImage, FileText, Files, GitFork,
  GripVertical, ImagePlus, Layers3, LoaderCircle, MousePointer2, Plus, Redo2,
  Presentation, RotateCcw, RotateCw, Scissors, Sparkles, Trash2, Undo2, Upload, X,
  ZoomIn, ZoomOut,
} from 'lucide-react';
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';

type SourceFile = {
  id: string;
  name: string;
  bytes: Uint8Array;
  pageImages?: Uint8Array[];
  pageCount: number;
  color: string;
  kind: 'pdf' | 'image' | 'docx' | 'pptx';
};

type PreparedPage = {
  bytes: Uint8Array;
  thumbnail: string;
  width: number;
  height: number;
};

type PageItem = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourcePageIndex: number;
  originalPageNumber: number;
  width: number;
  height: number;
  rotation: number;
  thumbnail: string;
  outputId: string;
};

type OutputGroup = { id: string; name: string };
type Toast = { id: number; message: string; tone?: 'success' | 'error' };

const SOURCE_COLORS = ['#7c3aed', '#2563eb', '#ea580c', '#059669', '#db2777'];
const DEFAULT_OUTPUT: OutputGroup = { id: 'output-1', name: 'PDF 1' };
const uid = () => crypto.randomUUID();
const pdfjsAssetUrl = (relativePath: string) => new URL(relativePath, document.baseURI).href;
const IMAGE_FILE_PATTERN = /\.(?:png|jpe?g|webp|gif|bmp|avif)$/i;
const IMAGE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif',
]);
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const OFFICE_FILE_SIZE_LIMIT = 60 * 1024 * 1024;

const isPdfFile = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
const isImageFile = (file: File) => IMAGE_MIME_TYPES.has(file.type) || IMAGE_FILE_PATTERN.test(file.name);
const isDocxFile = (file: File) => file.type === DOCX_MIME_TYPE || file.name.toLowerCase().endsWith('.docx');
const isPptxFile = (file: File) => file.type === PPTX_MIME_TYPE || file.name.toLowerCase().endsWith('.pptx');
const isSupportedFile = (file: File) => isPdfFile(file) || isImageFile(file) || isDocxFile(file) || isPptxFile(file);

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Görsel dönüştürülemedi.')), type, quality);
  });
}

async function prepareImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`${file.name} tarayıcı tarafından okunamadı.`));
      image.src = objectUrl;
    });

    const maxDimension = 4096;
    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Görsel işleme alanı oluşturulamadı.');
    context.drawImage(image, 0, 0, width, height);

    return await canvasToPreparedPage(canvas, width, height);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function canvasToPreparedPage(
  inputCanvas: HTMLCanvasElement,
  logicalWidth = inputCanvas.width,
  logicalHeight = inputCanvas.height,
): Promise<PreparedPage> {
  const maxDimension = 4096;
  const scale = Math.min(1, maxDimension / Math.max(inputCanvas.width, inputCanvas.height));
  const width = Math.max(1, Math.round(inputCanvas.width * scale));
  const height = Math.max(1, Math.round(inputCanvas.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Sayfa işleme alanı oluşturulamadı.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(inputCanvas, 0, 0, width, height);

  const thumbnailCanvas = document.createElement('canvas');
  const thumbnailScale = Math.min(1, 250 / width);
  thumbnailCanvas.width = Math.max(1, Math.round(width * thumbnailScale));
  thumbnailCanvas.height = Math.max(1, Math.round(height * thumbnailScale));
  const thumbnailContext = thumbnailCanvas.getContext('2d', { alpha: false });
  if (!thumbnailContext) throw new Error('Sayfa önizlemesi oluşturulamadı.');
  thumbnailContext.fillStyle = '#fff';
  thumbnailContext.fillRect(0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
  thumbnailContext.drawImage(canvas, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);

  const normalizedBlob = await canvasToBlob(canvas, 'image/png');
  return {
    bytes: new Uint8Array(await normalizedBlob.arrayBuffer()),
    thumbnail: thumbnailCanvas.toDataURL('image/jpeg', 0.82),
    width: logicalWidth,
    height: logicalHeight,
  };
}

function createOfficeRenderHost(width = 1200) {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${width}px`,
    minHeight: '1px',
    overflow: 'visible',
    pointerEvents: 'none',
    background: '#fff',
    zIndex: '-1',
  });
  document.body.appendChild(host);
  return host;
}

async function waitForRenderedAssets(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map((image) => image.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    })));
  await document.fonts?.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function captureOfficePage(element: HTMLElement): Promise<PreparedPage> {
  await waitForRenderedAssets(element);
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width || element.offsetWidth));
  const height = Math.max(1, Math.ceil(rect.height || element.offsetHeight));
  const maxPixelRatio = Math.min(
    1.75,
    4096 / Math.max(width, height),
    Math.sqrt(14_000_000 / (width * height)),
  );
  const { toCanvas } = await import('html-to-image');
  const canvas = await toCanvas(element, {
    width,
    height,
    pixelRatio: Math.max(0.75, maxPixelRatio),
    backgroundColor: '#fff',
    cacheBust: false,
  });
  return canvasToPreparedPage(canvas, width, height);
}

async function prepareDocx(file: File, onProgress: (page: number, total: number) => void) {
  if (file.size > OFFICE_FILE_SIZE_LIMIT) {
    throw new Error('Word dosyası 60 MB sınırını aşıyor.');
  }
  const buffer = await file.arrayBuffer();
  const host = createOfficeRenderHost();
  try {
    const { renderAsync } = await import('docx-preview');
    await renderAsync(buffer, host, host, {
      inWrapper: true,
      breakPages: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: true,
    });
    const elements = Array.from(host.querySelectorAll<HTMLElement>('section.docx'));
    if (!elements.length) throw new Error('Word belgesinde görüntülenebilir sayfa bulunamadı.');
    const preparedPages: PreparedPage[] = [];
    for (let index = 0; index < elements.length; index += 1) {
      onProgress(index + 1, elements.length);
      preparedPages.push(await captureOfficePage(elements[index]));
    }
    return { bytes: new Uint8Array(buffer), pages: preparedPages };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Bilinmeyen hata';
    throw new Error(`Word belgesi işlenemedi: ${detail}`, { cause: error });
  } finally {
    host.remove();
  }
}

async function preparePptx(file: File, onProgress: (page: number, total: number) => void) {
  if (file.size > OFFICE_FILE_SIZE_LIMIT) {
    throw new Error('PowerPoint dosyası 60 MB sınırını aşıyor.');
  }
  const buffer = await file.arrayBuffer();
  const host = createOfficeRenderHost(1000);
  try {
    const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer');
    const viewer = await PptxViewer.open(buffer, host, {
      renderMode: 'slide',
      fitMode: 'none',
      width: 960,
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      lazyMedia: true,
      lazySlides: true,
      pdfjs: false,
    });
    try {
      if (!viewer.slideCount) throw new Error('Sunumda görüntülenebilir slayt bulunamadı.');
      const slideHost = document.createElement('div');
      host.appendChild(slideHost);
      const preparedPages: PreparedPage[] = [];
      for (let index = 0; index < viewer.slideCount; index += 1) {
        onProgress(index + 1, viewer.slideCount);
        slideHost.replaceChildren();
        const handle = viewer.renderSlideToContainer(index, slideHost, 1);
        if (!handle) throw new Error(`${index + 1}. slayt oluşturulamadı.`);
        try {
          await handle.ready;
          preparedPages.push(await captureOfficePage(handle.element));
        } finally {
          handle.dispose();
        }
      }
      return { bytes: new Uint8Array(buffer), pages: preparedPages };
    } finally {
      viewer.destroy();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Bilinmeyen hata';
    throw new Error(`PowerPoint sunumu işlenemedi: ${detail}`, { cause: error });
  } finally {
    host.remove();
  }
}

function pdfImportErrorMessage(error: unknown) {
  const err = error as { name?: string; message?: string };
  const message = err?.message ?? '';
  if (err?.name === 'PasswordException' || /password/i.test(message)) {
    return 'Bu PDF parola korumalı. Parolayı kaldırıp tekrar dene.';
  }
  if (/word|docx|belge/i.test(message)) {
    return message.includes('60 MB') ? message : 'Word belgesi okunamadı. Geçerli bir .docx dosyası olduğundan emin olun.';
  }
  if (/powerpoint|pptx|slayt|sunum/i.test(message)) {
    return message.includes('60 MB') ? message : 'PowerPoint sunumu okunamadı. Geçerli bir .pptx dosyası olduğundan emin olun.';
  }
  if (/görsel|tarayıcı tarafından/i.test(message)) {
    return 'Görsel okunamadı. Desteklenen biçimlerden birini deneyin.';
  }
  return 'Dosya okunamadı. Dosya bozuk veya desteklenmeyen bir biçimde olabilir.';
}

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"
      />
    </svg>
  );
}

function safeFileName(name: string) {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '-');
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const insertImageAfterRef = useRef<string | null>(null);
  const pastRef = useRef<PageItem[][]>([]);
  const futureRef = useRef<PageItem[][]>([]);
  const dragIdRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sources, setSources] = useState<SourceFile[]>([]);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [outputs, setOutputs] = useState<OutputGroup[]>([DEFAULT_OUTPUT]);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeOutput, setActiveOutput] = useState<string>('all');
  const [zoom, setZoom] = useState(100);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const visiblePages = useMemo(
    () => (activeOutput === 'all' ? pages : pages.filter((page) => page.outputId === activeOutput)),
    [activeOutput, pages],
  );
  const orderedOutputs = useMemo(() => {
    const outputIds = [...new Set(pages.map((page) => page.outputId))];
    return outputIds.flatMap((id) => {
      const output = outputs.find((item) => item.id === id);
      return output ? [output] : [];
    });
  }, [outputs, pages]);

  const notify = (message: string, tone: Toast['tone'] = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), message, tone });
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  };

  const remember = () => {
    pastRef.current = [...pastRef.current.slice(-29), pages];
    futureRef.current = [];
  };

  const updatePages = (updater: (current: PageItem[]) => PageItem[]) => {
    remember();
    setPages(updater);
  };

  const undo = () => {
    const previous = pastRef.current.at(-1);
    if (!previous) return;
    futureRef.current = [pages, ...futureRef.current].slice(0, 30);
    pastRef.current = pastRef.current.slice(0, -1);
    setPages(previous);
    setSelected([]);
  };

  const redo = () => {
    const next = futureRef.current[0];
    if (!next) return;
    pastRef.current = [...pastRef.current, pages].slice(-30);
    futureRef.current = futureRef.current.slice(1);
    setPages(next);
    setSelected([]);
  };

  const deleteSelected = () => {
    if (!selected.length) return;
    const count = selected.length;
    updatePages((current) => current.filter((page) => !selected.includes(page.id)));
    setSelected([]);
    notify(`${count} sayfa kaldırıldı.`);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && selected.length) {
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const renderThumbnail = async (pdfPage: PDFPageProxy) => {
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = Math.min(1.25, 250 / base.width);
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas oluşturulamadı.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: context, viewport, canvas }).promise;
    return { thumbnail: canvas.toDataURL('image/jpeg', 0.76), width: base.width, height: base.height };
  };

  const importFiles = async (fileList: FileList | File[], insertAfterPageId: string | null = null) => {
    const files = Array.from(fileList).filter(isSupportedFile);
    if (!files.length) {
      notify('PDF, DOCX, PPTX veya desteklenen bir görsel seçin.', 'error');
      return;
    }

    setIsImporting(true);
    setImportProgress('Dosya işleme motoru hazırlanıyor…');
    try {
      let pdfjs: typeof import('pdfjs-dist') | null = null;
      const loadPdfjs = async () => {
        if (pdfjs) return pdfjs;
        pdfjs = await import('pdfjs-dist');
        const workerSrc = new URL('pdfjs/pdf.worker.min.mjs', document.baseURI);
        workerSrc.searchParams.set('v', pdfjs.version);
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc.href;
        return pdfjs;
      };
      const newSources: SourceFile[] = [];
      const newPages: PageItem[] = [];
      const insertAfterIndex = insertAfterPageId
        ? pages.findIndex((page) => page.id === insertAfterPageId)
        : -1;
      const appendOutputId = (insertAfterIndex >= 0 ? pages[insertAfterIndex] : pages.at(-1))?.outputId
        ?? DEFAULT_OUTPUT.id;
      const documentOptions = {
        wasmUrl: pdfjsAssetUrl('pdfjs/wasm/'),
        cMapUrl: pdfjsAssetUrl('pdfjs/cmaps/'),
        cMapPacked: true,
        iccUrl: pdfjsAssetUrl('pdfjs/iccs/'),
        standardFontDataUrl: pdfjsAssetUrl('pdfjs/standard_fonts/'),
        useSystemFonts: true,
        useWorkerFetch: false,
      };

      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];
        const sourceId = uid();
        const color = SOURCE_COLORS[(sources.length + fileIndex) % SOURCE_COLORS.length];

        if (isPdfFile(file)) {
          const pdfEngine = await loadPdfjs();
          const bytes = new Uint8Array(await file.arrayBuffer());
          const loadingTask = pdfEngine.getDocument({ data: bytes.slice(), ...documentOptions });
          const pdf = await loadingTask.promise;
          newSources.push({ id: sourceId, name: file.name, bytes, pageCount: pdf.numPages, color, kind: 'pdf' });

          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            setImportProgress(`${file.name} · ${pageNumber}/${pdf.numPages} sayfa hazırlanıyor`);
            const pdfPage = await pdf.getPage(pageNumber);
            const rendered = await renderThumbnail(pdfPage);
            newPages.push({
              id: uid(), sourceId, sourceName: file.name,
              sourcePageIndex: pageNumber - 1, originalPageNumber: pageNumber,
              width: rendered.width, height: rendered.height, rotation: 0,
              thumbnail: rendered.thumbnail, outputId: appendOutputId,
            });
            pdfPage.cleanup();
          }
          await loadingTask.destroy();
        } else if (isImageFile(file)) {
          setImportProgress(`${file.name} · görsel sayfası hazırlanıyor`);
          const rendered = await prepareImage(file);
          newSources.push({
            id: sourceId, name: file.name, bytes: rendered.bytes, pageImages: [rendered.bytes], pageCount: 1,
            color, kind: 'image',
          });
          newPages.push({
            id: uid(), sourceId, sourceName: file.name,
            sourcePageIndex: 0, originalPageNumber: 1,
            width: rendered.width, height: rendered.height, rotation: 0,
            thumbnail: rendered.thumbnail, outputId: appendOutputId,
          });
        } else {
          const kind = isDocxFile(file) ? 'docx' : 'pptx';
          const label = kind === 'docx' ? 'sayfa' : 'slayt';
          const prepared = kind === 'docx'
            ? await prepareDocx(file, (page, total) => {
              setImportProgress(`${file.name} · ${page}/${total} ${label} hazırlanıyor`);
            })
            : await preparePptx(file, (page, total) => {
              setImportProgress(`${file.name} · ${page}/${total} ${label} hazırlanıyor`);
            });
          newSources.push({
            id: sourceId,
            name: file.name,
            bytes: prepared.bytes,
            pageImages: prepared.pages.map((page) => page.bytes),
            pageCount: prepared.pages.length,
            color,
            kind,
          });
          prepared.pages.forEach((rendered, pageIndex) => {
            newPages.push({
              id: uid(), sourceId, sourceName: file.name,
              sourcePageIndex: pageIndex, originalPageNumber: pageIndex + 1,
              width: rendered.width, height: rendered.height, rotation: 0,
              thumbnail: rendered.thumbnail, outputId: appendOutputId,
            });
          });
        }
      }

      remember();
      setSources((current) => [...current, ...newSources]);
      setPages((current) => {
        if (!insertAfterPageId) return [...current, ...newPages];
        const targetIndex = current.findIndex((page) => page.id === insertAfterPageId);
        if (targetIndex < 0) return [...current, ...newPages];
        const next = [...current];
        next.splice(targetIndex + 1, 0, ...newPages);
        return next;
      });
      setActiveOutput('all');
      notify(`${newSources.length} dosyadan ${newPages.length} sayfa eklendi.`);
    } catch (error) {
      console.error(error);
      notify(pdfImportErrorMessage(error), 'error');
    } finally {
      setIsImporting(false);
      setImportProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (imageInputRef.current) imageInputRef.current.value = '';
      insertImageAfterRef.current = null;
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void importFiles(event.target.files);
  };

  const handleImageInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void importFiles(event.target.files, insertImageAfterRef.current);
  };

  const openImagePicker = (insertAfterPageId: string | null = null) => {
    insertImageAfterRef.current = insertAfterPageId;
    imageInputRef.current?.click();
  };

  const handleFileDrop = (event: DragEvent) => {
    event.preventDefault();
    setIsDraggingFiles(false);
    if (event.dataTransfer.files.length) void importFiles(event.dataTransfer.files);
  };

  const selectPage = (id: string, additive: boolean) => {
    setSelected((current) => {
      if (additive) return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      return current.length === 1 && current[0] === id ? [] : [id];
    });
  };

  const rotateSelected = (direction: 1 | -1) => {
    if (!selected.length) return;
    updatePages((current) => current.map((page) => selected.includes(page.id)
      ? { ...page, rotation: (page.rotation + direction * 90 + 360) % 360 } : page));
  };

  const toggleSplitAfter = (pageId: string) => {
    const boundaryIndex = pages.findIndex((page) => page.id === pageId);
    if (boundaryIndex < 0 || boundaryIndex >= pages.length - 1) return;

    const leftOutputId = pages[boundaryIndex].outputId;
    const rightOutputId = pages[boundaryIndex + 1].outputId;
    remember();

    if (leftOutputId !== rightOutputId) {
      let segmentEnded = false;
      setPages((current) => current.map((page, index) => {
        if (index <= boundaryIndex || segmentEnded) return page;
        if (page.outputId !== rightOutputId) {
          segmentEnded = true;
          return page;
        }
        return { ...page, outputId: leftOutputId };
      }));
      notify('Ayrım kaldırıldı; iki parça birleştirildi.');
    } else {
      const output: OutputGroup = { id: uid(), name: `PDF ${orderedOutputs.length + 1}` };
      let segmentEnded = false;
      setOutputs((current) => [...current, output]);
      setPages((current) => current.map((page, index) => {
        if (index <= boundaryIndex || segmentEnded) return page;
        if (page.outputId !== rightOutputId) {
          segmentEnded = true;
          return page;
        }
        return { ...page, outputId: output.id };
      }));
      notify('Yeni bir PDF ayrımı oluşturuldu.');
    }

    setActiveOutput('all');
    setSelected([]);
  };

  const handlePageDrop = (targetId: string) => {
    const draggedId = dragIdRef.current;
    dragIdRef.current = null;
    if (!draggedId || draggedId === targetId) return;
    updatePages((current) => {
      const next = [...current];
      const from = next.findIndex((page) => page.id === draggedId);
      const to = next.findIndex((page) => page.id === targetId);
      if (from < 0 || to < 0) return current;
      const targetOutputId = next[to].outputId;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, { ...moved, outputId: targetOutputId });
      return next;
    });
  };

  const exportGroup = async (group: OutputGroup) => {
    const groupPages = pages.filter((page) => page.outputId === group.id);
    if (!groupPages.length) return;
    if (!group.name.trim()) {
      notify('Her PDF için bir dosya adı yazmalısın.', 'error');
      return;
    }
    const { PDFDocument, degrees } = await import('pdf-lib');
    const outputDocument = await PDFDocument.create();
    const loadedSources = new Map<string, Awaited<ReturnType<typeof PDFDocument.load>>>();
    const embeddedImages = new Map<string, Awaited<ReturnType<typeof outputDocument.embedPng>>>();

    for (const pageItem of groupPages) {
      const source = sources.find((item) => item.id === pageItem.sourceId);
      if (!source) continue;

      if (source.kind !== 'pdf') {
        const imageKey = `${source.id}:${pageItem.sourcePageIndex}`;
        let embeddedImage = embeddedImages.get(imageKey);
        if (!embeddedImage) {
          const pageBytes = source.pageImages?.[pageItem.sourcePageIndex]
            ?? (source.kind === 'image' ? source.bytes : undefined);
          if (!pageBytes) throw new Error(`${source.name} için sayfa görüntüsü bulunamadı.`);
          embeddedImage = await outputDocument.embedPng(pageBytes.slice());
          embeddedImages.set(imageKey, embeddedImage);
        }
        const isLooseImage = source.kind === 'image';
        const landscape = pageItem.width > pageItem.height;
        const pageWidth = isLooseImage
          ? (landscape ? 841.89 : 595.28)
          : pageItem.width * 0.75;
        const pageHeight = isLooseImage
          ? (landscape ? 595.28 : 841.89)
          : pageItem.height * 0.75;
        const margin = isLooseImage ? 24 : 0;
        const scale = Math.min(
          (pageWidth - margin * 2) / embeddedImage.width,
          (pageHeight - margin * 2) / embeddedImage.height,
        );
        const imageWidth = embeddedImage.width * scale;
        const imageHeight = embeddedImage.height * scale;
        const imagePage = outputDocument.addPage([pageWidth, pageHeight]);
        imagePage.drawImage(embeddedImage, {
          x: (pageWidth - imageWidth) / 2,
          y: (pageHeight - imageHeight) / 2,
          width: imageWidth,
          height: imageHeight,
        });
        imagePage.setRotation(degrees(pageItem.rotation));
        continue;
      }

      let sourceDocument = loadedSources.get(pageItem.sourceId);
      if (!sourceDocument) {
        sourceDocument = await PDFDocument.load(source.bytes.slice(), { ignoreEncryption: true });
        loadedSources.set(pageItem.sourceId, sourceDocument);
      }
      const [copiedPage] = await outputDocument.copyPages(sourceDocument, [pageItem.sourcePageIndex]);
      copiedPage.setRotation(degrees(pageItem.rotation));
      outputDocument.addPage(copiedPage);
    }

    const bytes = await outputDocument.save();
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeFileName(group.name);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const exportAll = async () => {
    if (orderedOutputs.some((output) => !output.name.trim())) {
      notify('Her PDF için bir dosya adı yazmalısın.', 'error');
      return;
    }
    setIsExporting(true);
    try {
      for (const output of orderedOutputs) await exportGroup(output);
      notify(`${orderedOutputs.length} PDF dışa aktarıldı.`);
      setExportOpen(false);
    } catch (error) {
      console.error(error);
      notify('PDF oluşturulurken bir sorun yaşandı.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const emptyState = pages.length === 0;

  return (
    <main className="app-shell" onDragEnter={(event) => {
      if (event.dataTransfer.types.includes('Files')) setIsDraggingFiles(true);
    }} onDragOver={(event) => event.preventDefault()} onDrop={handleFileDrop}>
      <input ref={fileInputRef} className="sr-only" type="file"
        accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx,image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"
        multiple onChange={handleFileInput} />
      <input ref={imageInputRef} className="sr-only" type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"
        multiple onChange={handleImageInput} />

      <header className="topbar">
        <div className="brand" aria-label="Kâğıt PDF Studio">
          <span className="brand-mark"><span /></span><span className="brand-name">Kâğıt</span>
        </div>
        <div className="document-title">
          <strong>{emptyState ? 'Yeni çalışma' : 'PDF düzenleme alanı'}</strong>
          <span><CloudOff size={13} /> Yalnızca bu cihazda</span>
        </div>
        <div className="top-actions">
          <button className="button button-ghost desktop-only" onClick={() => fileInputRef.current?.click()}>
            <Plus size={17} /> Dosya ekle
          </button>
          <button className="button button-primary" disabled={emptyState} onClick={() => setExportOpen(true)}>
            <Download size={17} /> Dışa aktar
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <section>
          <div className="sidebar-heading"><span>Dosyalar</span>
            <button aria-label="PDF, Word, PowerPoint veya görsel ekle" onClick={() => fileInputRef.current?.click()}><Plus size={16} /></button>
          </div>
          {sources.length ? <div className="source-list">{sources.map((source) => (
            <button key={source.id} className="source-row" onClick={() => setActiveOutput('all')}>
              <span className="source-icon" style={{ '--source-color': source.color } as React.CSSProperties}>
                {source.kind === 'image' ? <FileImage size={15} />
                  : source.kind === 'docx' ? <FileText size={15} />
                    : source.kind === 'pptx' ? <Presentation size={15} /> : <Files size={15} />}
              </span>
              <span className="source-copy"><strong title={source.name}>{source.name}</strong>
                <small>{source.kind === 'image' ? 'Görsel sayfası'
                  : source.kind === 'pptx' ? `${source.pageCount} slayt`
                    : source.kind === 'docx' ? `${source.pageCount} Word sayfası`
                      : `${source.pageCount} sayfa`}</small></span>
            </button>
          ))}</div> : <button className="sidebar-empty" onClick={() => fileInputRef.current?.click()}>
            <Plus size={15} /> İlk dosyanı ekle
          </button>}
        </section>

        <section className="outputs-section">
          <div className="sidebar-heading"><span>Çıktılar</span></div>
          <button className={`output-row ${activeOutput === 'all' ? 'active' : ''}`} onClick={() => setActiveOutput('all')}>
            <Layers3 size={16} /><span>Tüm sayfalar</span><small>{pages.length}</small>
          </button>
          {orderedOutputs.map((output, index) => {
            const count = pages.filter((page) => page.outputId === output.id).length;
            return <button key={output.id} className={`output-row ${activeOutput === output.id ? 'active' : ''}`}
              onClick={() => setActiveOutput(output.id)}>
              <span className="output-number">{index + 1}</span><span title={output.name}>{output.name}</span><small>{count}</small>
            </button>;
          })}
        </section>

        <div className="privacy-note"><span><CloudOff size={15} /></span>
          <div><strong>Dosyaların sende kalır</strong><small>Hiçbir şey sunucuya yüklenmez.</small></div>
        </div>
      </aside>

      <section className="workspace">
        <div className="toolbar" aria-label="Düzenleme araçları">
          <div className="tool-group">
            <button className="tool active" title="Seçim aracı"><MousePointer2 size={17} /></button>
            <button className="tool" title="Görsel sayfası ekle" onClick={() => openImagePicker()}><ImagePlus size={17} /></button>
          </div>
          <span className="divider" />
          <div className="tool-group">
            <button className="tool" title="Geri al" disabled={!pastRef.current.length} onClick={undo}><Undo2 size={17} /></button>
            <button className="tool" title="Yinele" disabled={!futureRef.current.length} onClick={redo}><Redo2 size={17} /></button>
          </div>
          <span className="toolbar-spacer" />
          {selected.length > 0 && <div className="selection-actions">
            <span>{selected.length} seçili</span>
            <button onClick={() => rotateSelected(-1)} title="Sola döndür"><RotateCcw size={16} /></button>
            <button onClick={() => rotateSelected(1)} title="Sağa döndür"><RotateCw size={16} /></button>
            <button className="danger" onClick={deleteSelected} title="Sil"><Trash2 size={16} /></button>
          </div>}
          <div className="zoom-control">
            <button aria-label="Uzaklaştır" onClick={() => setZoom((value) => Math.max(70, value - 10))}><ZoomOut size={16} /></button>
            <span>{zoom}%</span>
            <button aria-label="Yakınlaştır" onClick={() => setZoom((value) => Math.min(130, value + 10))}><ZoomIn size={16} /></button>
          </div>
        </div>

        {emptyState ? <div className="welcome-wrap">
          <div className="welcome-copy">
            <span className="eyebrow"><Sparkles size={14} /> Tarayıcıda. Hızlı. Güvenli.</span>
            <h1>PDF’lerini tek bir<br /><em>akışta düzenle.</em></h1>
            <p>PDF’leri, Word belgelerini, PowerPoint sunumlarını ve görselleri birleştir, sırala, döndür ve dilediğin yerden böl. Dosyaların bilgisayarından hiç ayrılmadan.</p>
          </div>
          <button className={`drop-card ${isDraggingFiles ? 'dragging' : ''}`}
            onClick={() => fileInputRef.current?.click()} onDragLeave={() => setIsDraggingFiles(false)}>
            <span className="drop-visual"><span className="paper paper-back" />
              <span className="paper paper-front"><span>PDF</span></span><span className="upload-badge"><Upload size={20} /></span>
            </span>
            <strong>Dosyalarını buraya bırak</strong><span>veya bilgisayarından seç</span>
            <small>PDF, DOCX, PPTX, PNG, JPG, WebP, GIF, BMP ve AVIF</small>
          </button>
          <div className="feature-strip">
            <span><GripVertical size={16} /> Sürükle & sırala</span>
            <span><Scissors size={16} /> Dilediğin yerden böl</span>
            <span><Presentation size={16} /> Word & PowerPoint’tan PDF</span>
            <span><ImagePlus size={16} /> Görseli PDF sayfasına çevir</span>
          </div>
        </div> : <div className="page-stage">
          <div className="stage-heading"><div><span className="eyebrow">DÜZENLEME ALANI</span>
            <h1>{activeOutput === 'all' ? 'Tüm sayfalar' : outputs.find((item) => item.id === activeOutput)?.name}</h1>
            {activeOutput === 'all' && <p className="stage-hint"><ImagePlus size={13} /> Sayfa aralarına görsel ekle veya makasla böl</p>}</div>
            <div className="stage-meta"><span>{visiblePages.length} sayfa</span><span>{orderedOutputs.length} PDF</span></div>
          </div>
          <div className="page-grid" style={{ '--card-width': `${Math.round(176 * zoom / 100)}px` } as React.CSSProperties}>
            {visiblePages.map((page, visibleIndex) => {
              const isSelected = selected.includes(page.id);
              const source = sources.find((item) => item.id === page.sourceId);
              const globalIndex = pages.findIndex((item) => item.id === page.id);
              const nextPage = pages[globalIndex + 1];
              const hasSplitAfter = Boolean(nextPage && nextPage.outputId !== page.outputId);
              const canSplitAfter = activeOutput === 'all' && globalIndex < pages.length - 1;
              return <article key={page.id} className={`page-card ${isSelected ? 'selected' : ''}`} draggable
                onDragStart={(event) => {
                  if ((event.target as HTMLElement).closest('.page-gap-controls')) {
                    event.preventDefault();
                    return;
                  }
                  dragIdRef.current = page.id;
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); handlePageDrop(page.id); }}
                onClick={(event) => selectPage(page.id, event.metaKey || event.ctrlKey || event.shiftKey)}>
                <div className="page-sheet" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
                  <img src={page.thumbnail} alt={source?.kind === 'image'
                    ? `${page.sourceName} görsel sayfası`
                    : source?.kind === 'pptx'
                      ? `${page.sourceName}, slayt ${page.originalPageNumber}`
                      : `${page.sourceName}, sayfa ${page.originalPageNumber}`}
                    style={{ transform: `rotate(${page.rotation}deg) scale(${page.rotation % 180 === 0 ? 1 : page.height / page.width})` }} />
                  <span className="page-index">{visibleIndex + 1}</span>
                  <span className="select-check">{isSelected && <Check size={13} strokeWidth={3} />}</span>
                </div>
                <div className="page-caption"><span className="source-dot" style={{ background: source?.color }} />
                  <span title={page.sourceName}>{page.sourceName.replace(/\.(?:pdf|docx|pptx|png|jpe?g|webp|gif|bmp|avif)$/i, '')}</span>
                  <small>{source?.kind === 'image' ? 'görsel'
                    : source?.kind === 'pptx' ? `slayt ${page.originalPageNumber}`
                      : `s.${page.originalPageNumber}`}</small>
                </div>
                {canSplitAfter && <div className={`page-gap-controls ${hasSplitAfter ? 'active' : ''}`}
                  draggable={false} onMouseDown={(event) => event.stopPropagation()}>
                  <button className="gap-action image-insert" aria-label="Bu araya görsel ekle" title="Bu araya görsel ekle"
                    onClick={(event) => { event.stopPropagation(); openImagePicker(page.id); }}>
                    <ImagePlus size={14} />
                  </button>
                  <button className={`gap-action split-handle ${hasSplitAfter ? 'active' : ''}`}
                    aria-label={hasSplitAfter ? 'Bu ayrımı kaldır' : `Sayfa ${globalIndex + 1} sonrasından ayır`}
                    title={hasSplitAfter ? 'Ayrımı kaldır' : 'Buradan ayır'}
                    onClick={(event) => { event.stopPropagation(); toggleSplitAfter(page.id); }}>
                    <Scissors size={14} />
                  </button>
                </div>}
              </article>;
            })}
            <button className="add-page-card" onClick={() => fileInputRef.current?.click()}><Plus size={22} /><span>PDF, Office veya görsel ekle</span></button>
          </div>
        </div>}
      </section>

      {!emptyState && <aside className="inspector">
        <div className="inspector-head"><span>Özellikler</span>{selected.length > 0 && <small>{selected.length} seçili</small>}</div>
        {!selected.length ? <div className="inspector-empty"><MousePointer2 size={22} /><strong>Bir sayfa seç</strong>
          <p>Döndürmek veya kaldırmak için bir ya da daha fazla sayfaya tıkla.</p></div> : <>
          <section className="inspector-section"><label>Sayfa işlemleri</label><div className="button-grid">
            <button onClick={() => rotateSelected(-1)}><RotateCcw size={16} /> Sola</button>
            <button onClick={() => rotateSelected(1)}><RotateCw size={16} /> Sağa</button>
          </div><button className="inspector-button danger-text" onClick={deleteSelected}><Trash2 size={16} /> Sayfayı kaldır</button></section>
        </>}
      </aside>}

      <footer className="site-footer">
        <div><GitFork size={15} /><span><strong>Açık kaynak.</strong> Her zaman ücretsiz.</span></div>
        <a className="footer-github" href="https://github.com/AhmetErenLacinbala/pdf" target="_blank" rel="noreferrer" aria-label="GitHub">
          <GithubMark />
        </a>
      </footer>

      {exportOpen && <div className="modal-backdrop" onMouseDown={() => setExportOpen(false)}><section className="export-modal"
        role="dialog" aria-modal="true" aria-label="PDF'leri dışa aktar" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><span className="modal-icon"><Download size={20} /></span><div><h2>PDF adlarını belirle</h2>
          <p>İndirmeden önce oluşturulacak her dosyaya bir ad ver.</p></div></div><button onClick={() => setExportOpen(false)}><X size={19} /></button></div>
        <div className="export-list">{orderedOutputs.map((output, outputIndex) => {
          const groupPages = pages.filter((page) => page.outputId === output.id);
          if (!groupPages.length) return null;
          return <div key={output.id}><span className="pdf-badge">PDF</span><div><label className="export-name-label" htmlFor={`output-name-${output.id}`}>PDF {outputIndex + 1} adı</label>
            <span className="export-name-field"><input id={`output-name-${output.id}`} aria-label={`PDF ${outputIndex + 1} dosya adı`} value={output.name}
              onChange={(event) => setOutputs((current) => current.map((item) => item.id === output.id
                ? { ...item, name: event.target.value.replace(/\.pdf$/i, '') } : item))} />
              <span>.pdf</span></span>
            <small>{groupPages.length} sayfa · tahmini {formatBytes(groupPages.length * 118000)}</small></div>
            <button aria-label={`${output.name || `PDF ${outputIndex + 1}`} indir`} disabled={isExporting || !output.name.trim()} onClick={() => void exportGroup(output)}><Download size={17} /></button></div>;
        })}</div>
        <div className="export-footer"><span><CloudOff size={14} /> Yerel olarak oluşturulur</span>
          <button className="button button-primary" disabled={isExporting || orderedOutputs.some((output) => !output.name.trim())} onClick={() => void exportAll()}>
            {isExporting ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
            {isExporting ? 'Hazırlanıyor…' : orderedOutputs.length > 1 ? `${orderedOutputs.length} PDF’i indir` : 'PDF’i indir'}
          </button></div>
      </section></div>}

      {isImporting && <div className="processing" role="status"><LoaderCircle className="spin" size={18} />
        <span><strong>Dosyalar hazırlanıyor</strong>{importProgress}</span></div>}
      {isDraggingFiles && !isImporting && <div className="drop-overlay" onDragLeave={() => setIsDraggingFiles(false)}>
        <div><Upload size={28} /><strong>Dosyaları bırak</strong><span>PDF, DOCX, PPTX ve görseller sayfa akışına eklenecek</span></div></div>}
      {toast && <div className={`toast ${toast.tone === 'error' ? 'error' : ''}`} role="status">
        {toast.tone === 'error' ? <X size={15} /> : <Check size={15} />} {toast.message}</div>}
    </main>
  );
}
