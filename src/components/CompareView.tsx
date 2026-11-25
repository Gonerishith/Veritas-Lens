import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  GripVertical,
  Link2,
  Loader2,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { SAMPLE_IMAGES } from '../data/samples';
import type {
  CompareSlot,
  HistoryRecord,
  SampleImage,
  VerdictType,
} from '../types/forensics';
import { formatVerdictLabel } from '../utils/reportExport';

const COMPARE_SLOT_MIME = 'application/x-veritas-compare-slot';

interface CompareViewProps {
  slotA: CompareSlot;
  slotB: CompareSlot;
  history: HistoryRecord[];
  onLoadFile: (slot: 'A' | 'B', file: File) => void;
  onLoadPairFiles: (fileA: File, fileB: File) => void;
  onLoadUrl: (slot: 'A' | 'B', url: string) => void;
  onLoadSample: (slot: 'A' | 'B', sample: SampleImage) => void;
  onLoadHistory: (slot: 'A' | 'B', record: HistoryRecord) => void;
  onClearSlot: (slot: 'A' | 'B') => void;
  onSwapSlots: () => void;
  onOpenInAnalyzer: (slot: 'A' | 'B') => void;
}

function extractDroppedUrl(dt: DataTransfer): string | null {
  const uriList = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
  const firstLine = uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  if (firstLine && /^https?:\/\//i.test(firstLine)) {
    return firstLine;
  }
  return null;
}

function VerdictBadgeText({ verdict, probability }: { verdict: VerdictType; probability: number }) {
  const Icon =
    verdict === 'likely_ai'
      ? ShieldAlert
      : verdict === 'likely_real'
        ? ShieldCheck
        : Scale;
  const color =
    verdict === 'likely_ai'
      ? 'text-red-700 dark:text-red-400'
      : verdict === 'likely_real'
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-amber-700 dark:text-amber-400';

  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${color}`}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{formatVerdictLabel(verdict)}</span>
      </span>
      <span className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
        {probability}%
      </span>
    </div>
  );
}

interface SlotCardProps {
  slotKey: 'A' | 'B';
  slot: CompareSlot;
  layer: 'original' | 'ela';
  history: HistoryRecord[];
  onLoadFile: (file: File) => void;
  onLoadPairFiles: (fileA: File, fileB: File) => void;
  onLoadUrl: (url: string) => void;
  onLoadSample: (sample: SampleImage) => void;
  onLoadHistory: (record: HistoryRecord) => void;
  onSwapSlots: () => void;
  onClear: () => void;
  onOpenInAnalyzer: () => void;
}

function CompareSlotCard({
  slotKey,
  slot,
  layer,
  history,
  onLoadFile,
  onLoadPairFiles,
  onLoadUrl,
  onLoadSample,
  onLoadHistory,
  onSwapSlots,
  onClear,
  onOpenInAnalyzer,
}: SlotCardProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const [urlVal, setUrlVal] = useState('');
  const [dragMode, setDragMode] = useState<'none' | 'file' | 'pair' | 'swap'>('none');

  const otherSlot: 'A' | 'B' = slotKey === 'A' ? 'B' : 'A';

  const handleSubmitUrl = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = urlVal.trim();
    if (!trimmed || slot.isLoading) return;
    onLoadUrl(trimmed);
    setUrlVal('');
  };

  const detectDragMode = (dt: DataTransfer): 'none' | 'file' | 'pair' | 'swap' => {
    const types = Array.from(dt.types || []);
    if (types.includes(COMPARE_SLOT_MIME)) {
      return 'swap';
    }
    if (types.includes('Files')) {
      const fileItems = Array.from(dt.items || []).filter((item) => item.kind === 'file');
      return fileItems.length >= 2 ? 'pair' : 'file';
    }
    if (types.includes('text/uri-list')) {
      return 'file';
    }
    return 'none';
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    const mode = detectDragMode(e.dataTransfer);
    if (mode === 'none') return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragMode(mode);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    const mode = detectDragMode(e.dataTransfer);
    if (mode === 'none') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = mode === 'swap' ? 'move' : 'copy';
    if (dragMode !== mode) {
      setDragMode(mode);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (dragDepthRef.current <= 0) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragMode('none');
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragMode('none');

    if (slot.isLoading) return;

    // 1. Check in-app slot-to-slot swap drag
    const draggedFromSlot = e.dataTransfer.getData(COMPARE_SLOT_MIME);
    if (draggedFromSlot === 'A' || draggedFromSlot === 'B') {
      if (draggedFromSlot !== slotKey) {
        onSwapSlots();
      }
      return;
    }

    // 2. Check dropped files
    const files = Array.from(e.dataTransfer.files || []).filter(
      (f) => !f.type || f.type.startsWith('image/')
    );
    if (files.length >= 2) {
      if (slotKey === 'A') {
        onLoadPairFiles(files[0], files[1]);
      } else {
        onLoadPairFiles(files[1], files[0]);
      }
      return;
    }
    if (files.length === 1) {
      onLoadFile(files[0]);
      return;
    }

    // 3. Check dropped remote image URL
    const droppedUrl = extractDroppedUrl(e.dataTransfer);
    if (droppedUrl) {
      onLoadUrl(droppedUrl);
    }
  };

  const activeImg =
    layer === 'ela' && slot.elaDataUrl ? slot.elaDataUrl : slot.imageDataUrl;

  const isDragActive = dragMode !== 'none';

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col overflow-hidden rounded-xl border bg-white transition-colors dark:bg-[#111827] ${
        isDragActive
          ? 'border-blue-600 ring-2 ring-blue-600/20 dark:border-blue-500 dark:ring-blue-500/25'
          : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      {/* Hidden input always mounted so both empty & occupied slots support quick file replacement */}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length >= 2) {
            if (slotKey === 'A') onLoadPairFiles(files[0], files[1]);
            else onLoadPairFiles(files[1], files[0]);
          } else if (files.length === 1) {
            onLoadFile(files[0]);
          }
          e.target.value = '';
        }}
      />

      {/* Slot Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-1.5">
          {slot.imageDataUrl ? (
            <span
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(COMPARE_SLOT_MIME, slotKey);
                e.dataTransfer.effectAllowed = 'move';
              }}
              title={`Drag onto Image ${otherSlot} to swap`}
              className="inline-flex cursor-grab items-center text-slate-400 hover:text-slate-600 active:cursor-grabbing dark:text-slate-500 dark:hover:text-slate-300"
            >
              <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          ) : null}
          <span className="font-display text-sm font-semibold text-slate-900 whitespace-nowrap dark:text-slate-100">
            Image {slotKey}
          </span>
          {slot.metadata ? (
            <span className="truncate text-xs text-slate-500 dark:text-slate-400">
              · {slot.metadata.fileName}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {slot.imageDataUrl && !slot.isLoading ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 whitespace-nowrap dark:text-slate-400 dark:hover:text-slate-100"
            >
              Replace
            </button>
          ) : null}
          {slot.report ? (
            <button
              type="button"
              onClick={onOpenInAnalyzer}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap dark:text-blue-400"
            >
              Inspect full
            </button>
          ) : null}
          {slot.imageDataUrl ? (
            <button
              type="button"
              onClick={onClear}
              aria-label={`Clear Image ${slotKey}`}
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Image Viewport or Picker */}
      {slot.imageDataUrl ? (
        <div className="flex flex-col">
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(COMPARE_SLOT_MIME, slotKey);
              e.dataTransfer.effectAllowed = 'move';
            }}
            title={`Drag onto Image ${otherSlot} to swap, or drop a new file here to replace`}
            className="relative flex aspect-[4/3] w-full cursor-grab items-center justify-center overflow-hidden bg-slate-100 p-3 active:cursor-grabbing dark:bg-[#0D1320]"
          >
            <img
              src={activeImg || slot.imageDataUrl}
              alt={`Comparison slot ${slotKey}`}
              referrerPolicy="no-referrer"
              draggable={false}
              className="max-h-full max-w-full rounded object-contain select-none"
            />
            {slot.isLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/55 text-white backdrop-blur-[1px]">
                <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
                <span className="text-xs font-medium">Analyzing Image {slotKey}…</span>
              </div>
            ) : null}
          </div>

          {/* Slot Verdict Footer */}
          <div className="border-t border-slate-100 p-4 dark:border-slate-800">
            {slot.error ? (
              <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{slot.error}</span>
              </div>
            ) : slot.report ? (
              <div>
                <VerdictBadgeText
                  verdict={slot.report.verdict}
                  probability={slot.report.aiProbability}
                />
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                  {slot.report.headline}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                  <span>
                    {slot.metadata?.width}×{slot.metadata?.height}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{slot.metadata?.hasExif ? 'EXIF Present' : 'No EXIF'}</span>
                  {slot.elaStats ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>ELA Mean {slot.elaStats.meanError}</span>
                    </>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="h-4 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-3 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-between p-5">
          <div
            role="button"
            tabIndex={0}
            onClick={() => !slot.isLoading && fileRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !slot.isLoading) {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
            className={`flex aspect-[16/10] flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center transition-colors cursor-pointer ${
              isDragActive
                ? 'border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/30'
                : 'border-slate-300 bg-slate-50/70 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-slate-600'
            }`}
          >
            {slot.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
            ) : (
              <Upload className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            )}
            <p className="mt-2.5 text-sm font-medium text-slate-800 dark:text-slate-200">
              {slot.isLoading ? 'Loading image…' : `Drop or upload Image ${slotKey}`}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Drop 1 image here, or 2 images to fill both A & B
            </p>
          </div>

          {/* URL + Sample + History Pickers */}
          <div className="mt-4 space-y-3">
            <form onSubmit={handleSubmitUrl} className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="url"
                  value={urlVal}
                  onChange={(e) => setUrlVal(e.target.value)}
                  placeholder="Paste image URL…"
                  disabled={slot.isLoading}
                  className="min-h-[42px] w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none sm:min-h-0 sm:text-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                disabled={slot.isLoading || !urlVal.trim()}
                className="min-h-[42px] rounded-lg border border-slate-200 bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap sm:min-h-0 sm:px-3 dark:border-slate-700 dark:bg-slate-100 dark:text-slate-950"
              >
                Load
              </button>
            </form>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                aria-label={`Select benchmark sample for Image ${slotKey}`}
                defaultValue=""
                disabled={slot.isLoading}
                onChange={(e) => {
                  const found = SAMPLE_IMAGES.find((s) => s.id === e.target.value);
                  if (found) onLoadSample(found);
                  e.target.value = '';
                }}
                className="min-h-[42px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-base text-slate-700 focus:border-blue-600 focus:outline-none sm:min-h-0 sm:text-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="" disabled>
                  Pick a benchmark sample…
                </option>
                {SAMPLE_IMAGES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>

              <select
                aria-label={`Select saved history scan for Image ${slotKey}`}
                defaultValue=""
                disabled={slot.isLoading || history.length === 0}
                onChange={(e) => {
                  const found = history.find((h) => h.id === e.target.value);
                  if (found) onLoadHistory(found);
                  e.target.value = '';
                }}
                className="min-h-[42px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-base text-slate-700 focus:border-blue-600 focus:outline-none disabled:opacity-50 sm:min-h-0 sm:text-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="" disabled>
                  {history.length > 0 ? 'Load from local history…' : 'No saved scans yet'}
                </option>
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.report.metadata.fileName} ({h.report.aiProbability}% AI)
                  </option>
                ))}
              </select>
            </div>

            {slot.error ? (
              <p className="text-xs text-red-600 dark:text-red-400">{slot.error}</p>
            ) : null}
          </div>
        </div>
      )}

      {/* Active Drag-Over Overlay (non-interactive so drop lands cleanly on card) */}
      {isDragActive ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-blue-600/12 p-6 text-center backdrop-blur-[2px] dark:bg-blue-500/18"
        >
          <div className="flex flex-col items-center rounded-xl border border-blue-500/70 bg-white/95 px-5 py-4 shadow-sm dark:border-blue-400/70 dark:bg-[#0F1522]/95">
            {dragMode === 'swap' ? (
              <ArrowLeftRight className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            ) : (
              <Upload className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            )}
            <p className="mt-2 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {dragMode === 'swap'
                ? `Drop to swap Image A ↔ B`
                : dragMode === 'pair'
                  ? 'Drop 2 images to compare A & B'
                  : slot.imageDataUrl
                    ? `Drop to replace Image ${slotKey}`
                    : `Drop to load Image ${slotKey}`}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {dragMode === 'swap'
                ? 'Instantly exchanges both comparison slots'
                : 'Runs live vision, EXIF, and ELA comparison'}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CompareView({
  slotA,
  slotB,
  history,
  onLoadFile,
  onLoadPairFiles,
  onLoadUrl,
  onLoadSample,
  onLoadHistory,
  onClearSlot,
  onSwapSlots,
  onOpenInAnalyzer,
}: CompareViewProps) {
  const [layer, setLayer] = useState<'original' | 'ela'>('original');
  const bothReady = Boolean(slotA.report && slotB.report);

  const deltaProb =
    slotA.report && slotB.report
      ? slotB.report.aiProbability - slotA.report.aiProbability
      : 0;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      {/* Header & Controls */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-50">
            Side-by-Side Comparison
          </h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm dark:text-slate-400">
            Drag and drop images onto either slot (or drop 2 at once) to compare authenticity scores, EXIF provenance, and ELA residuals.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <div
            role="group"
            aria-label="Synchronized comparison layer"
            className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-900"
          >
            {(['original', 'ela'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setLayer(mode)}
                className={`min-h-[38px] rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:min-h-0 ${
                  layer === mode
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-50'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {mode === 'original' ? 'Original' : 'ELA Map'}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!slotA.imageDataUrl && !slotB.imageDataUrl}
            onClick={onSwapSlots}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0 sm:min-h-0 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Swap A / B</span>
          </button>
        </div>
      </div>

      {/* Dual Slot Grid */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 items-stretch">
        <CompareSlotCard
          slotKey="A"
          slot={slotA}
          layer={layer}
          history={history}
          onLoadFile={(f) => onLoadFile('A', f)}
          onLoadPairFiles={onLoadPairFiles}
          onLoadUrl={(u) => onLoadUrl('A', u)}
          onLoadSample={(s) => onLoadSample('A', s)}
          onLoadHistory={(h) => onLoadHistory('A', h)}
          onSwapSlots={onSwapSlots}
          onClear={() => onClearSlot('A')}
          onOpenInAnalyzer={() => onOpenInAnalyzer('A')}
        />
        <CompareSlotCard
          slotKey="B"
          slot={slotB}
          layer={layer}
          history={history}
          onLoadFile={(f) => onLoadFile('B', f)}
          onLoadPairFiles={onLoadPairFiles}
          onLoadUrl={(u) => onLoadUrl('B', u)}
          onLoadSample={(s) => onLoadSample('B', s)}
          onLoadHistory={(h) => onLoadHistory('B', h)}
          onSwapSlots={onSwapSlots}
          onClear={() => onClearSlot('B')}
          onOpenInAnalyzer={() => onOpenInAnalyzer('B')}
        />
      </div>

      {/* Comparative Signal Matrix */}
      {bothReady && slotA.report && slotB.report ? (
        <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
          <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Comparative Forensic Matrix
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Direct channel-by-channel comparison between Image A and Image B.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                  <th className="px-5 py-3">Forensic Dimension</th>
                  <th className="px-5 py-3 text-right">Image A</th>
                  <th className="px-5 py-3 text-right">Image B</th>
                  <th className="px-5 py-3 text-right">Delta (B − A)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                <tr className="font-medium">
                  <td className="px-5 py-3 text-slate-900 dark:text-slate-100">
                    Overall AI Likelihood
                  </td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {slotA.report.aiProbability}%
                  </td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {slotB.report.aiProbability}%
                  </td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {deltaProb > 0 ? `+${deltaProb}%` : `${deltaProb}%`}
                  </td>
                </tr>

                <tr>
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                    Suspected Source
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-slate-700 dark:text-slate-300">
                    {slotA.report.suspectedSource}
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-slate-700 dark:text-slate-300">
                    {slotB.report.suspectedSource}
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-slate-400">—</td>
                </tr>

                <tr>
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                    EXIF Camera Provenance
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-slate-700 dark:text-slate-300">
                    {slotA.metadata?.hasExif ? 'Present' : 'Not present'}
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-slate-700 dark:text-slate-300">
                    {slotB.metadata?.hasExif ? 'Present' : 'Not present'}
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-slate-400">—</td>
                </tr>

                {slotA.elaStats && slotB.elaStats ? (
                  <tr>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                      ELA Mean Residual Error
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300">
                      {slotA.elaStats.meanError}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300">
                      {slotB.elaStats.meanError}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {slotB.elaStats.meanError - slotA.elaStats.meanError >= 0 ? '+' : ''}
                      {(slotB.elaStats.meanError - slotA.elaStats.meanError).toFixed(2)}
                    </td>
                  </tr>
                ) : null}

                {slotA.report.signals.map((sigA, idx) => {
                  const sigB = slotB.report?.signals[idx];
                  if (!sigB) return null;
                  const diff = sigB.score - sigA.score;
                  return (
                    <tr key={sigA.id}>
                      <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                        {sigA.name}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-slate-800 dark:text-slate-200">
                        {sigA.score}%
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-slate-800 dark:text-slate-200">
                        {sigB.score}%
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {diff > 0 ? `+${diff}%` : `${diff}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
