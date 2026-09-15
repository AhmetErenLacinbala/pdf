import {
  AlignCenter, AlignLeft, AlignRight, Check, ChevronDown, CloudOff, Download,
  Files, GripVertical, Layers3, LoaderCircle, MousePointer2, Plus, Redo2,
  RotateCcw, RotateCw, Scissors, Sparkles, Trash2, Type, Undo2, Upload, X,
  ZoomIn, ZoomOut,
} from 'lucide-react';
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';

type SourceFile = {
  id: string; name: string; bytes: Uint8Array; pageCount: number; color: string;
};

type TextAnnotation = {
  id: string;
  text: string;
  size: number;
  color: string;
  position: 'top' | 'center' | 'bottom';
  align: 'left' | 'center' | 'right';
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
  annotations: TextAnnotation[];
};

type OutputGroup = { id: string; name: string };
type Toast = { id: number; message: string; tone?: 'success' | 'error' };

const SOURCE_COLORS = ['#7c3aed', '#2563eb', '#ea580c', '#059669', '#db2777'];
const DEFAULT_OUTPUT: OutputGroup = { id: 'output-1', name: 'Birleştirilmiş PDF' };
const uid = () => crypto.randomUUID();

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
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [textDraft, setTextDraft] = useState('Onaylandı');
  const [textSize, setTextSize] = useState(18);
  const [textColor, setTextColor] = useState('#171717');
  const [textPosition, setTextPosition] = useState<TextAnnotation['position']>('center');
  const [textAlign, setTextAlign] = useState<TextAnnotation['align']>('center');
  const [toast, setToast] = useState<Toast | null>(null);

  const visiblePages = useMemo(
    () => (activeOutput === 'all' ? pages : pages.filter((page) => page.outputId === activeOutput)),
    [activeOutput, pages],
  );
  const selectedPages = useMemo(() => pages.filter((page) => selected.includes(page.id)), [pages, selected]);
  const totalAnnotations = useMemo(
    () => pages.reduce((total, page) => total + page.annotations.length, 0),
    [pages],
  );

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

  const importFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    );
    if (!files.length) {
      notify('Lütfen PDF biçiminde bir dosya seçin.', 'error');
      return;
    }

    setIsImporting(true);
    setImportProgress('PDF motoru hazırlanıyor…');
    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url,
      ).toString();
      const newSources: SourceFile[] = [];
      const newPages: PageItem[] = [];

      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];
        const bytes = new Uint8Array(await file.arrayBuffer());
        const sourceId = uid();
        const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
        const pdf = await loadingTask.promise;
        const color = SOURCE_COLORS[(sources.length + fileIndex) % SOURCE_COLORS.length];
        newSources.push({ id: sourceId, name: file.name, bytes, pageCount: pdf.numPages, color });

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          setImportProgress(`${file.name} · ${pageNumber}/${pdf.numPages} sayfa hazırlanıyor`);
          const pdfPage = await pdf.getPage(pageNumber);
          const rendered = await renderThumbnail(pdfPage);
          newPages.push({
            id: uid(), sourceId, sourceName: file.name,
            sourcePageIndex: pageNumber - 1, originalPageNumber: pageNumber,
            width: rendered.width, height: rendered.height, rotation: 0,
            thumbnail: rendered.thumbnail, outputId: DEFAULT_OUTPUT.id, annotations: [],
          });
          pdfPage.cleanup();
        }
        await loadingTask.destroy();
      }

      remember();
      setSources((current) => [...current, ...newSources]);
      setPages((current) => [...current, ...newPages]);
      setActiveOutput('all');
      notify(`${newSources.length} PDF’den ${newPages.length} sayfa eklendi.`);
    } catch (error) {
      console.error(error);
      notify('PDF okunamadı. Dosya bozuk veya parola korumalı olabilir.', 'error');
    } finally {
      setIsImporting(false);
      setImportProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void importFiles(event.target.files);
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

  const splitSelected = () => {
    if (!selected.length) return;
    const output: OutputGroup = { id: uid(), name: `Ayrılmış PDF ${outputs.length}` };
    setOutputs((current) => [...current, output]);
    updatePages((current) => current.map((page) => selected.includes(page.id)
      ? { ...page, outputId: output.id } : page));
    setActiveOutput(output.id);
    setSelected([]);
    notify(`Seçilen sayfalar “${output.name}” içine ayrıldı.`);
  };

  const moveSelectedToOutput = (outputId: string) => {
    if (!selected.length || !outputId) return;
    updatePages((current) => current.map((page) => selected.includes(page.id)
      ? { ...page, outputId } : page));
    setSelected([]);
    notify('Sayfaların çıktı hedefi güncellendi.');
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
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const addText = () => {
    if (selected.length !== 1 || !textDraft.trim()) return;
    const annotation: TextAnnotation = {
      id: uid(), text: textDraft.trim(), size: textSize, color: textColor,
      position: textPosition, align: textAlign,
    };
    updatePages((current) => current.map((page) => page.id === selected[0]
      ? { ...page, annotations: [...page.annotations, annotation] } : page));
    setAnnotationOpen(false);
    notify('Metin sayfaya eklendi.');
  };

  const removeAnnotation = (pageId: string, annotationId: string) => {
    updatePages((current) => current.map((page) => page.id === pageId
      ? { ...page, annotations: page.annotations.filter((item) => item.id !== annotationId) } : page));
  };

  const exportGroup = async (group: OutputGroup) => {
    const groupPages = pages.filter((page) => page.outputId === group.id);
    if (!groupPages.length) return;
    const [{ PDFDocument, degrees, rgb }, { default: fontkit }] = await Promise.all([
      import('pdf-lib'),
      import('@pdf-lib/fontkit'),
    ]);
    const outputDocument = await PDFDocument.create();
    outputDocument.registerFontkit(fontkit);
    const fontResponse = await fetch('/noto-sans-latin-ext-400-normal.woff');
    if (!fontResponse.ok) throw new Error('PDF yazı tipi yüklenemedi.');
    const font = await outputDocument.embedFont(await fontResponse.arrayBuffer(), { subset: true });
    const loadedSources = new Map<string, Awaited<ReturnType<typeof PDFDocument.load>>>();

    for (const pageItem of groupPages) {
      let sourceDocument = loadedSources.get(pageItem.sourceId);
      if (!sourceDocument) {
        const source = sources.find((item) => item.id === pageItem.sourceId);
        if (!source) continue;
        sourceDocument = await PDFDocument.load(source.bytes.slice(), { ignoreEncryption: true });
        loadedSources.set(pageItem.sourceId, sourceDocument);
      }
      const [copiedPage] = await outputDocument.copyPages(sourceDocument, [pageItem.sourcePageIndex]);
      copiedPage.setRotation(degrees(pageItem.rotation));
      const { width, height } = copiedPage.getSize();

      for (const annotation of pageItem.annotations) {
        const hex = annotation.color.replace('#', '');
        const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
        const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
        const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
        const textWidth = font.widthOfTextAtSize(annotation.text, annotation.size);
        const x = annotation.align === 'left' ? 42 : annotation.align === 'right'
          ? width - textWidth - 42 : (width - textWidth) / 2;
        const y = annotation.position === 'top' ? height - annotation.size - 42
          : annotation.position === 'bottom' ? 42 : (height - annotation.size) / 2;
        copiedPage.drawText(annotation.text, {
          x: Math.max(16, x), y, size: annotation.size, font,
          color: rgb(red, green, blue),
        });
      }
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
    setIsExporting(true);
    try {
      const nonEmptyOutputs = outputs.filter((output) => pages.some((page) => page.outputId === output.id));
      for (const output of nonEmptyOutputs) await exportGroup(output);
      notify(`${nonEmptyOutputs.length} PDF dışa aktarıldı.`);
      setExportOpen(false);
    } catch (error) {
      console.error(error);
      notify('PDF oluşturulurken bir sorun yaşandı.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const selectedPage = selectedPages.length === 1 ? selectedPages[0] : null;
  const emptyState = pages.length === 0;

  return (
    <main className="app-shell" onDragEnter={(event) => {
      if (event.dataTransfer.types.includes('Files')) setIsDraggingFiles(true);
    }} onDragOver={(event) => event.preventDefault()} onDrop={handleFileDrop}>
      <input ref={fileInputRef} className="sr-only" type="file" accept="application/pdf,.pdf"
        multiple onChange={handleFileInput} />

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
            <Plus size={17} /> PDF ekle
          </button>
          <button className="button button-primary" disabled={emptyState} onClick={() => setExportOpen(true)}>
            <Download size={17} /> Dışa aktar
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <section>
          <div className="sidebar-heading"><span>Dosyalar</span>
            <button aria-label="PDF ekle" onClick={() => fileInputRef.current?.click()}><Plus size={16} /></button>
          </div>
          {sources.length ? <div className="source-list">{sources.map((source) => (
            <button key={source.id} className="source-row" onClick={() => setActiveOutput('all')}>
              <span className="source-icon" style={{ '--source-color': source.color } as React.CSSProperties}><Files size={15} /></span>
              <span className="source-copy"><strong title={source.name}>{source.name}</strong><small>{source.pageCount} sayfa</small></span>
            </button>
          ))}</div> : <button className="sidebar-empty" onClick={() => fileInputRef.current?.click()}>
            <Plus size={15} /> İlk PDF’ini ekle
          </button>}
        </section>

        <section className="outputs-section">
          <div className="sidebar-heading"><span>Çıktılar</span></div>
          <button className={`output-row ${activeOutput === 'all' ? 'active' : ''}`} onClick={() => setActiveOutput('all')}>
            <Layers3 size={16} /><span>Tüm sayfalar</span><small>{pages.length}</small>
          </button>
          {outputs.map((output, index) => {
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
            <button className={`tool ${annotationOpen ? 'active' : ''}`} title="Metin ekle"
              disabled={selected.length !== 1} onClick={() => setAnnotationOpen((value) => !value)}><Type size={17} /></button>
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
            <button onClick={splitSelected} title="Yeni PDF'e ayır"><Scissors size={16} /></button>
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
            <p>Birleştir, sırala, böl ve üzerine yaz. Dosyaların bilgisayarından hiç ayrılmadan.</p>
          </div>
          <button className={`drop-card ${isDraggingFiles ? 'dragging' : ''}`}
            onClick={() => fileInputRef.current?.click()} onDragLeave={() => setIsDraggingFiles(false)}>
            <span className="drop-visual"><span className="paper paper-back" />
              <span className="paper paper-front"><span>PDF</span></span><span className="upload-badge"><Upload size={20} /></span>
            </span>
            <strong>PDF’lerini buraya bırak</strong><span>veya bilgisayarından seç</span>
            <small>Birden fazla dosya seçebilirsin</small>
          </button>
          <div className="feature-strip">
            <span><GripVertical size={16} /> Sürükle & sırala</span>
            <span><Scissors size={16} /> Dilediğin yerden böl</span>
            <span><Type size={16} /> Metin ekle</span>
          </div>
        </div> : <div className="page-stage">
          <div className="stage-heading"><div><span className="eyebrow">DÜZENLEME ALANI</span>
            <h1>{activeOutput === 'all' ? 'Tüm sayfalar' : outputs.find((item) => item.id === activeOutput)?.name}</h1></div>
            <div className="stage-meta"><span>{visiblePages.length} sayfa</span>{totalAnnotations > 0 && <span>{totalAnnotations} metin</span>}</div>
          </div>
          <div className="page-grid" style={{ '--card-width': `${Math.round(176 * zoom / 100)}px` } as React.CSSProperties}>
            {visiblePages.map((page, visibleIndex) => {
              const isSelected = selected.includes(page.id);
              const source = sources.find((item) => item.id === page.sourceId);
              return <article key={page.id} className={`page-card ${isSelected ? 'selected' : ''}`} draggable
                onDragStart={(event) => { dragIdRef.current = page.id; event.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); handlePageDrop(page.id); }}
                onClick={(event) => selectPage(page.id, event.metaKey || event.ctrlKey || event.shiftKey)}>
                <div className="page-sheet" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
                  <img src={page.thumbnail} alt={`${page.sourceName}, sayfa ${page.originalPageNumber}`}
                    style={{ transform: `rotate(${page.rotation}deg) scale(${page.rotation % 180 === 0 ? 1 : page.height / page.width})` }} />
                  {page.annotations.map((annotation) => <span key={annotation.id}
                    className={`annotation annotation-${annotation.position} annotation-align-${annotation.align}`}
                    style={{ color: annotation.color, fontSize: `${Math.max(7, annotation.size * zoom / 210)}px` }}>{annotation.text}</span>)}
                  <span className="page-index">{visibleIndex + 1}</span>
                  <span className="select-check">{isSelected && <Check size={13} strokeWidth={3} />}</span>
                </div>
                <div className="page-caption"><span className="source-dot" style={{ background: source?.color }} />
                  <span title={page.sourceName}>{page.sourceName.replace(/\.pdf$/i, '')}</span><small>s.{page.originalPageNumber}</small>
                </div>
              </article>;
            })}
            <button className="add-page-card" onClick={() => fileInputRef.current?.click()}><Plus size={22} /><span>PDF ekle</span></button>
          </div>
        </div>}
      </section>

      {!emptyState && <aside className="inspector">
        <div className="inspector-head"><span>Özellikler</span>{selected.length > 0 && <small>{selected.length} seçili</small>}</div>
        {!selected.length ? <div className="inspector-empty"><MousePointer2 size={22} /><strong>Bir sayfa seç</strong>
          <p>Döndürmek, ayırmak veya metin eklemek için bir sayfaya tıkla.</p></div> : <>
          <section className="inspector-section"><label>Çıktı dosyası</label><div className="select-wrap">
            <select value={selectedPage?.outputId ?? ''} onChange={(event) => moveSelectedToOutput(event.target.value)}>
              {selectedPages.some((page) => page.outputId !== selectedPages[0]?.outputId) && <option value="">Birden fazla</option>}
              {outputs.map((output) => <option key={output.id} value={output.id}>{output.name}</option>)}
            </select><ChevronDown size={15} /></div>
            <button className="inspector-button accent" onClick={splitSelected}><Scissors size={16} /> Seçimi yeni PDF’e ayır</button>
          </section>
          <section className="inspector-section"><label>Sayfa işlemleri</label><div className="button-grid">
            <button onClick={() => rotateSelected(-1)}><RotateCcw size={16} /> Sola</button>
            <button onClick={() => rotateSelected(1)}><RotateCw size={16} /> Sağa</button>
          </div><button className="inspector-button danger-text" onClick={deleteSelected}><Trash2 size={16} /> Sayfayı kaldır</button></section>
          {selectedPage && <section className="inspector-section"><div className="label-row"><label>Metinler</label>
            <button onClick={() => setAnnotationOpen(true)}><Plus size={14} /> Ekle</button></div>
            {selectedPage.annotations.length ? <div className="annotation-list">{selectedPage.annotations.map((annotation) => <div key={annotation.id}>
              <span style={{ color: annotation.color }}>Aa</span><p><strong>{annotation.text}</strong><small>{annotation.size} pt · {annotation.position}</small></p>
              <button aria-label="Metni kaldır" onClick={() => removeAnnotation(selectedPage.id, annotation.id)}><X size={14} /></button>
            </div>)}</div> : <button className="add-text-card" onClick={() => setAnnotationOpen(true)}><Type size={18} /><span>Bu sayfaya metin ekle</span></button>}
          </section>}
        </>}
      </aside>}

      {annotationOpen && selectedPage && <div className="popover text-popover" role="dialog" aria-label="Metin ekle">
        <div className="popover-head"><strong>Metin ekle</strong><button onClick={() => setAnnotationOpen(false)}><X size={17} /></button></div>
        <label>Metin</label><textarea value={textDraft} onChange={(event) => setTextDraft(event.target.value)} rows={3} autoFocus />
        <div className="form-row"><div><label>Boyut</label><input type="number" min="8" max="72" value={textSize}
          onChange={(event) => setTextSize(Number(event.target.value))} /></div>
          <div><label>Renk</label><input className="color-input" type="color" value={textColor} onChange={(event) => setTextColor(event.target.value)} /></div>
        </div>
        <label>Konum</label><div className="segmented">{(['top', 'center', 'bottom'] as const).map((position) => <button key={position}
          className={textPosition === position ? 'active' : ''} onClick={() => setTextPosition(position)}>
          {{ top: 'Üst', center: 'Orta', bottom: 'Alt' }[position]}</button>)}</div>
        <label>Hizalama</label><div className="align-buttons">
          <button className={textAlign === 'left' ? 'active' : ''} onClick={() => setTextAlign('left')}><AlignLeft size={16} /></button>
          <button className={textAlign === 'center' ? 'active' : ''} onClick={() => setTextAlign('center')}><AlignCenter size={16} /></button>
          <button className={textAlign === 'right' ? 'active' : ''} onClick={() => setTextAlign('right')}><AlignRight size={16} /></button>
        </div><button className="button button-primary full" onClick={addText}>Sayfaya ekle</button>
      </div>}

      {exportOpen && <div className="modal-backdrop" onMouseDown={() => setExportOpen(false)}><section className="export-modal"
        role="dialog" aria-modal="true" aria-label="PDF'leri dışa aktar" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><span className="modal-icon"><Download size={20} /></span><div><h2>PDF’lerin hazır</h2>
          <p>Her çıktı ayrı bir dosya olarak indirilecek.</p></div></div><button onClick={() => setExportOpen(false)}><X size={19} /></button></div>
        <div className="export-list">{outputs.map((output) => {
          const groupPages = pages.filter((page) => page.outputId === output.id);
          if (!groupPages.length) return null;
          return <div key={output.id}><span className="pdf-badge">PDF</span><div><input aria-label="Dosya adı" value={output.name}
            onChange={(event) => setOutputs((current) => current.map((item) => item.id === output.id ? { ...item, name: event.target.value } : item))} />
            <small>{groupPages.length} sayfa · tahmini {formatBytes(groupPages.length * 118000)}</small></div>
            <button aria-label={`${output.name} indir`} disabled={isExporting} onClick={() => void exportGroup(output)}><Download size={17} /></button></div>;
        })}</div>
        <div className="export-footer"><span><CloudOff size={14} /> Yerel olarak oluşturulur</span>
          <button className="button button-primary" disabled={isExporting} onClick={() => void exportAll()}>
            {isExporting ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
            {isExporting ? 'Hazırlanıyor…' : outputs.filter((o) => pages.some((p) => p.outputId === o.id)).length > 1 ? 'Tümünü indir' : 'PDF’i indir'}
          </button></div>
      </section></div>}

      {isImporting && <div className="processing" role="status"><LoaderCircle className="spin" size={18} />
        <span><strong>PDF hazırlanıyor</strong>{importProgress}</span></div>}
      {isDraggingFiles && !isImporting && <div className="drop-overlay" onDragLeave={() => setIsDraggingFiles(false)}>
        <div><Upload size={28} /><strong>PDF’leri bırak</strong><span>Sayfaları hemen düzenlemeye başlayalım</span></div></div>}
      {toast && <div className={`toast ${toast.tone === 'error' ? 'error' : ''}`} role="status">
        {toast.tone === 'error' ? <X size={15} /> : <Check size={15} />} {toast.message}</div>}
    </main>
  );
}
