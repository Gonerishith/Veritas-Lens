import { useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpDown,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Images,
  Loader2,
  Play,
  RefreshCw,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import type { BatchItem, VerdictType } from '../types/forensics';
import { formatBytes } from '../utils/exifParser';
import {
  buildBatchCsv,
  downloadTextFile,
  formatVerdictLabel,
} from '../utils/reportExport';

type BatchFilter = 'all' | VerdictType | 'pending' | 'error';
type SortField = 'fileName' | 'aiProbability' | 'verdict' | 'elaMean' | 'fileSize';
type SortDir = 'asc' | 'desc';

interface BatchViewProps {
  items: BatchItem[];
  isRunning: boolean;
  uploadNotice: string | null;
  onAddFiles: (files: File[]) => void;
  onLoadAllSamples: () => void;
  onStartQueue: () => void;
  onStopQueue: () => void;
  onRetryItem: (id: string) => void;
  onRetryAllFailed: () => void;
  onRemoveItem: (id: string) => void;
  onClearBatch: () => void;
  onInspectItem: (item: BatchItem) => void;
  onSendToCompare: (slot: 'A' | 'B', item: BatchItem) => void;
}

const VERDICT_RANK: Record<VerdictType, number> = {
  likely_ai: 4,
  possible_manipulation: 3,
  inconclusive: 2,
  likely_real: 1,
};

export function BatchView({
  items,
  isRunning,
  uploadNotice,
  onAddFiles,
  onLoadAllSamples,
  onStartQueue,
  onStopQueue,
  onRetryItem,
  onRetryAllFailed,
  onRemoveItem,
  onClearBatch,
  onInspectItem,
  onSendToCompare,
}: BatchViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [filter, setFilter] = useState<BatchFilter>('all');
  const [query, setQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('aiProbability');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [confirmClear, setConfirmClear] = useState(false);

  const summary = useMemo(() => {
    const completed = items.filter((i) => i.status === 'complete' && i.report);
    const queued = items.filter((i) => i.status === 'queued').length;
    const analyzing = items.filter((i) => i.status === 'analyzing').length;
    const failed = items.filter((i) => i.status === 'error').length;

    const likelyAi = completed.filter((i) => i.report?.verdict === 'likely_ai').length;
    const possibleManipulation = completed.filter((i) => i.report?.verdict === 'possible_manipulation').length;
    const inconclusive = completed.filter((i) => i.report?.verdict === 'inconclusive').length;
    const likelyReal = completed.filter((i) => i.report?.verdict === 'likely_real').length;
    const withExif = completed.filter((i) => i.metadata?.hasExif).length;

    const avgAiScore =
      completed.length > 0
        ? completed.reduce((acc, i) => acc + (i.report?.aiProbability ?? 0), 0) / completed.length
        : null;

    return {
      total: items.length,
      completedCount: completed.length,
      completedReports: completed.map((i) => i.report!),
      queued,
      analyzing,
      failed,
      likelyAi,
      possibleManipulation,
      inconclusive,
      likelyReal,
      withExif,
      avgAiScore,
    };
  }, [items]);

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (filter === 'pending' && item.status !== 'queued' && item.status !== 'analyzing') {
        return false;
      }
      if (filter === 'error' && item.status !== 'error') {
        return false;
      }
      if (
        (filter === 'likely_ai' || filter === 'inconclusive' || filter === 'likely_real') &&
        item.report?.verdict !== filter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        item.fileName.toLowerCase().includes(q) ||
        (item.report?.suspectedSource.toLowerCase().includes(q) ?? false) ||
        (item.report?.headline.toLowerCase().includes(q) ?? false)
      );
    });

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'fileName') {
        cmp = a.fileName.localeCompare(b.fileName);
      } else if (sortField === 'fileSize') {
        cmp = a.fileSize - b.fileSize;
      } else if (sortField === 'aiProbability') {
        const av = a.report ? a.report.aiProbability : -1;
        const bv = b.report ? b.report.aiProbability : -1;
        cmp = av - bv;
      } else if (sortField === 'verdict') {
        const av = a.report ? VERDICT_RANK[a.report.verdict] : 0;
        const bv = b.report ? VERDICT_RANK[b.report.verdict] : 0;
        cmp = av - bv;
      } else if (sortField === 'elaMean') {
        const av = a.elaStats ? a.elaStats.meanError : -1;
        const bv = b.elaStats ? b.elaStats.meanError : -1;
        cmp = av - bv;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [items, filter, query, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'fileName' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
    );
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (dragDepthRef.current <= 0) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      onAddFiles(files);
    }
  };

  const handleExportCsv = () => {
    if (summary.completedReports.length === 0) return;
    const csv = buildBatchCsv(summary.completedReports);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(csv, `veritas-lens-batch-${stamp}.csv`, 'text/csv;charset=utf-8');
  };

  const handleExportJson = () => {
    if (summary.completedReports.length === 0) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      JSON.stringify(summary.completedReports, null, 2),
      `veritas-lens-batch-${stamp}.json`,
      'application/json;charset=utf-8'
    );
  };

  const progressPct =
    summary.total > 0
      ? Math.round(((summary.completedCount + summary.failed) / summary.total) * 100)
      : 0;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-8 lg:px-8"
    >
      {/* Header & Top Actions */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-50">
            Batch Authenticity Analyzer
          </h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm dark:text-slate-400">
            Upload multiple images at once to score, rank, and compare their AI-generation likelihood.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {items.length > 0 ? (
            <>
              {isRunning ? (
                <button
                  type="button"
                  onClick={onStopQueue}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  <span>Stop Queue</span>
                </button>
              ) : summary.queued > 0 ? (
                <button
                  type="button"
                  onClick={onStartQueue}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Analyze Queued ({summary.queued})</span>
                </button>
              ) : null}

              {summary.failed > 0 && !isRunning ? (
                <button
                  type="button"
                  onClick={onRetryAllFailed}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Retry Failed ({summary.failed})</span>
                </button>
              ) : null}

              <button
                type="button"
                disabled={summary.completedCount === 0}
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Export CSV</span>
              </button>

              <button
                type="button"
                disabled={summary.completedCount === 0}
                onClick={handleExportJson}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Export JSON</span>
              </button>

              {confirmClear ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onClearBatch();
                      setConfirmClear(false);
                    }}
                    className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700 whitespace-nowrap"
                  >
                    Confirm Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 whitespace-nowrap shrink-0 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-red-900/60 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Multi-Image Dropzone */}
      <div
        className={`mt-6 flex flex-col items-center justify-between gap-4 rounded-xl border border-dashed px-6 transition-colors sm:flex-row ${
          items.length === 0 ? 'py-12' : 'py-5'
        } ${
          isDragging
            ? 'border-blue-600 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-950/30'
            : 'border-slate-300 bg-slate-50/70 dark:border-slate-700 dark:bg-[#111827]/70'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) onAddFiles(files);
            e.target.value = '';
          }}
        />

        <div className="flex items-center gap-4 text-left">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <Upload className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {items.length === 0
                ? 'Drop multiple images here to start a batch scan'
                : 'Add more images to this batch queue'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Select up to 20 JPEG, PNG, WebP, or GIF images (10 MB max each) · Runs vision, EXIF, and ELA automatically
            </p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 active:scale-[0.98] whitespace-nowrap shrink-0 sm:min-h-0 sm:w-auto dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Select Images</span>
          </button>

          <button
            type="button"
            onClick={onLoadAllSamples}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.98] whitespace-nowrap shrink-0 sm:min-h-0 sm:w-auto dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Images className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Load 4 Benchmark Samples</span>
          </button>
        </div>
      </div>

      {uploadNotice ? (
        <div
          role="status"
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
        >
          {uploadNotice}
        </div>
      ) : null}

      {/* Batch KPI Summary Strip + Live Progress */}
      {items.length > 0 ? (
        <section className="mt-5 sm:mt-6">
          <div className="grid grid-cols-2 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white [&>*:nth-child(odd)]:border-r [&>*:nth-child(odd)]:border-slate-200 sm:grid-cols-4 sm:divide-x sm:divide-y-0 sm:[&>*:nth-child(odd)]:border-r-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-[#111827] dark:[&>*:nth-child(odd)]:border-slate-800">
            <div className="p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Batch Progress</p>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  {summary.completedCount}/{summary.total}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">complete</span>
              </div>
              <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                {isRunning
                  ? `${summary.analyzing} analyzing · ${summary.queued} queued`
                  : summary.failed > 0
                    ? `${summary.failed} failed`
                    : 'Queue idle'}
              </p>
            </div>

            <div className="p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Mean AI Likelihood</p>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  {summary.avgAiScore !== null ? `${summary.avgAiScore.toFixed(1)}` : '—'}
                </span>
                {summary.avgAiScore !== null ? (
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">%</span>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Across scored images
              </p>
            </div>

            <div className="p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Verdict Split</p>
              <div className="mt-1.5 flex items-baseline gap-2 font-mono text-lg font-bold tabular-nums">
                <span className="text-red-700 dark:text-red-400">{summary.likelyAi} AI</span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="text-amber-700 dark:text-amber-400">{summary.inconclusive} Mix</span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="text-emerald-700 dark:text-emerald-400">{summary.likelyReal} Real</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Classified by likelihood band
              </p>
            </div>

            <div className="p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">EXIF Provenance</p>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  {summary.withExif}
                </span>
                <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  of {summary.completedCount || summary.total} files
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Contain camera EXIF headers
              </p>
            </div>
          </div>

          {/* Active Processing Progress Bar */}
          {isRunning || (summary.queued > 0 && summary.completedCount > 0) ? (
            <div className="mt-3 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  style={{ width: `${Math.max(4, progressPct)}%` }}
                  className="h-full rounded-full bg-blue-600 transition-all duration-300 dark:bg-blue-500"
                />
              </div>
              <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {progressPct}%
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Filter & Search Bar + Summary Table */}
      {items.length > 0 ? (
        <section className="mt-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="max-w-full overflow-x-auto no-scrollbar">
              <div
                role="group"
                aria-label="Filter batch summary table"
                className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-900"
              >
                {(
                  [
                    { id: 'all', label: `All (${summary.total})` },
                    { id: 'likely_ai', label: `Likely AI (${summary.likelyAi})` },
                    { id: 'inconclusive', label: `Inconclusive (${summary.inconclusive})` },
                    { id: 'likely_real', label: `Likely Real (${summary.likelyReal})` },
                    ...(summary.failed > 0
                      ? [{ id: 'error' as BatchFilter, label: `Failed (${summary.failed})` }]
                      : []),
                  ] as { id: BatchFilter; label: string }[]
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:min-h-0 ${
                      filter === tab.id
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-50'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-64">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search filenames or source…"
                  className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none sm:min-h-0 sm:text-sm dark:border-slate-800 dark:bg-[#111827] dark:text-slate-100"
                />
              </div>

              {/* Mobile Sort Selector (replaces column header clicks on < md) */}
              <div className="flex items-center gap-2 md:hidden">
                <label htmlFor="mobile-batch-sort" className="sr-only">
                  Sort batch results
                </label>
                <select
                  id="mobile-batch-sort"
                  value={`${sortField}:${sortDir}`}
                  onChange={(e) => {
                    const [field, dir] = e.target.value.split(':') as [SortField, SortDir];
                    setSortField(field);
                    setSortDir(dir);
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-[#111827] dark:text-slate-200"
                >
                  <option value="aiProbability:desc">Sort: Highest AI Score</option>
                  <option value="aiProbability:asc">Sort: Lowest AI Score</option>
                  <option value="verdict:desc">Sort: Verdict (AI first)</option>
                  <option value="elaMean:desc">Sort: Highest ELA Mean</option>
                  <option value="fileName:asc">Sort: Filename (A–Z)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Mobile-First Touch Card List (< md) */}
          <div className="mt-4 space-y-3 md:hidden">
            {visibleItems.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400">
                No batch items match this filter.
              </div>
            ) : (
              visibleItems.map((item) => {
                const report = item.report;
                const VerdictIcon =
                  report?.verdict === 'likely_ai'
                    ? ShieldAlert
                    : report?.verdict === 'likely_real'
                      ? ShieldCheck
                      : Scale;
                const verdictColor =
                  report?.verdict === 'likely_ai'
                    ? 'text-red-700 dark:text-red-400'
                    : report?.verdict === 'likely_real'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400';
                const barColor =
                  report?.verdict === 'likely_ai'
                    ? 'bg-red-600 dark:bg-red-500'
                    : report?.verdict === 'likely_real'
                      ? 'bg-emerald-600 dark:bg-emerald-500'
                      : 'bg-amber-500 dark:bg-amber-400';

                return (
                  <article
                    key={item.id}
                    className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-[#111827]"
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        disabled={!report}
                        onClick={() => report && onInspectItem(item)}
                        className="h-14 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 disabled:cursor-default dark:border-slate-800 dark:bg-slate-900"
                      >
                        <img
                          src={item.thumbnailDataUrl}
                          alt={item.fileName}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {item.fileName}
                          </p>
                          {report ? (
                            <span className="font-mono text-base font-bold tabular-nums text-slate-900 shrink-0 dark:text-slate-50">
                              {report.aiProbability}%
                            </span>
                          ) : null}
                        </div>

                        {item.status === 'complete' && report ? (
                          <div className="mt-1">
                            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${verdictColor}`}>
                              <VerdictIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span>{formatVerdictLabel(report.verdict)}</span>
                            </span>
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                              <div
                                style={{ width: `${report.aiProbability}%` }}
                                className={`h-full rounded-full ${barColor}`}
                              />
                            </div>
                          </div>
                        ) : item.status === 'analyzing' ? (
                          <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            <span>Analyzing…</span>
                          </span>
                        ) : item.status === 'queued' ? (
                          <span className="mt-1 inline-block text-xs text-slate-500 dark:text-slate-400">
                            Queued for scan
                          </span>
                        ) : (
                          <div className="mt-1">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-400">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span>Scan failed</span>
                            </span>
                            {item.error ? (
                              <p className="mt-0.5 line-clamp-2 text-[11px] text-red-600/80 dark:text-red-400/80">
                                {item.error}
                              </p>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Metadata line */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      <span>{formatBytes(item.fileSize)}</span>
                      {item.metadata ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            {item.metadata.width}×{item.metadata.height}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {item.metadata.aiMarkerDetected
                              ? 'AI tag found'
                              : item.metadata.hasExif
                                ? 'Camera EXIF'
                                : 'No EXIF'}
                          </span>
                        </>
                      ) : null}
                      {item.elaStats ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>ELA {item.elaStats.meanError.toFixed(2)}</span>
                        </>
                      ) : null}
                    </div>

                    {/* Touch Action Bar */}
                    <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                      {item.status === 'complete' && report ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onInspectItem(item)}
                            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          >
                            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Inspect</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onSendToCompare('A', item)}
                            className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
                            <span>A</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onSendToCompare('B', item)}
                            className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
                            <span>B</span>
                          </button>
                        </>
                      ) : item.status === 'error' ? (
                        <button
                          type="button"
                          disabled={isRunning}
                          onClick={() => onRetryItem(item.id)}
                          className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Retry Scan</span>
                        </button>
                      ) : (
                        <span className="flex-1 text-xs text-slate-400">Waiting in queue…</span>
                      )}

                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.id)}
                        aria-label={`Remove ${item.fileName} from batch`}
                        className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-slate-800 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* Desktop Sortable Summary Table (md+) */}
          <div className="mt-4 hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block dark:border-slate-800 dark:bg-[#111827]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleSort('fileName')}
                        className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
                      >
                        <span>Image</span>
                        {renderSortIcon('fileName')}
                      </button>
                    </th>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleSort('verdict')}
                        className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
                      >
                        <span>Verdict</span>
                        {renderSortIcon('verdict')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('aiProbability')}
                        className="inline-flex items-center justify-end gap-1.5 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
                      >
                        <span>AI Score</span>
                        {renderSortIcon('aiProbability')}
                      </button>
                    </th>
                    <th className="px-4 py-3">Suspected Source</th>
                    <th className="px-4 py-3">EXIF</th>
                    <th className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('elaMean')}
                        className="inline-flex items-center justify-end gap-1.5 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
                      >
                        <span>ELA Mean</span>
                        {renderSortIcon('elaMean')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                      >
                        No batch items match this filter.
                      </td>
                    </tr>
                  ) : (
                    visibleItems.map((item) => {
                      const report = item.report;
                      const VerdictIcon =
                        report?.verdict === 'likely_ai'
                          ? ShieldAlert
                          : report?.verdict === 'likely_real'
                            ? ShieldCheck
                            : Scale;
                      const verdictColor =
                        report?.verdict === 'likely_ai'
                          ? 'text-red-700 dark:text-red-400'
                          : report?.verdict === 'likely_real'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400';
                      const barColor =
                        report?.verdict === 'likely_ai'
                          ? 'bg-red-600 dark:bg-red-500'
                          : report?.verdict === 'likely_real'
                            ? 'bg-emerald-600 dark:bg-emerald-500'
                            : 'bg-amber-500 dark:bg-amber-400';

                      return (
                        <tr
                          key={item.id}
                          className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-900/40"
                        >
                          {/* Image + Metadata */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                disabled={!report}
                                onClick={() => report && onInspectItem(item)}
                                className="h-11 w-14 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100 disabled:cursor-default dark:border-slate-800 dark:bg-slate-900"
                              >
                                <img
                                  src={item.thumbnailDataUrl}
                                  alt={item.fileName}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-cover"
                                />
                              </button>
                              <div className="min-w-0 max-w-[220px]">
                                <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                                  {item.fileName}
                                </p>
                                <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                                  {item.metadata
                                    ? `${item.metadata.width}×${item.metadata.height} · `
                                    : ''}
                                  {formatBytes(item.fileSize)}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Status / Verdict */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {item.status === 'complete' && report ? (
                              <div>
                                <span
                                  className={`inline-flex items-center gap-1.5 text-xs font-semibold ${verdictColor}`}
                                >
                                  <VerdictIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>{formatVerdictLabel(report.verdict)}</span>
                                </span>
                                <p className="mt-0.5 text-[11px] capitalize text-slate-500 dark:text-slate-400">
                                  {report.confidence} confidence
                                </p>
                              </div>
                            ) : item.status === 'analyzing' ? (
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                <span>Analyzing…</span>
                              </span>
                            ) : item.status === 'queued' ? (
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                Queued
                              </span>
                            ) : (
                              <div className="max-w-[200px]">
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>Scan failed</span>
                                </span>
                                {item.error ? (
                                  <p className="mt-0.5 truncate text-[11px] text-red-600/80 dark:text-red-400/80">
                                    {item.error}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>

                          {/* AI Score */}
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {report ? (
                              <div className="inline-flex flex-col items-end">
                                <span className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                                  {report.aiProbability}%
                                </span>
                                <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                  <div
                                    style={{ width: `${report.aiProbability}%` }}
                                    className={`h-full rounded-full ${barColor}`}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="font-mono text-xs text-slate-400">—</span>
                            )}
                          </td>

                          {/* Suspected Source */}
                          <td className="px-4 py-3">
                            {report ? (
                              <div className="max-w-[210px]">
                                <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                                  {report.suspectedSource}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                                  {report.headline}
                                </p>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>

                          {/* EXIF */}
                          <td className="px-4 py-3 whitespace-nowrap text-xs">
                            {item.metadata ? (
                              <div>
                                <span
                                  className={
                                    item.metadata.aiMarkerDetected
                                      ? 'font-medium text-red-700 dark:text-red-400'
                                      : item.metadata.hasExif
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-slate-500 dark:text-slate-400'
                                  }
                                >
                                  {item.metadata.aiMarkerDetected
                                    ? 'AI tag found'
                                    : item.metadata.hasExif
                                      ? 'Camera EXIF'
                                      : 'Stripped / None'}
                                </span>
                                {item.metadata.cameraModel ? (
                                  <p className="mt-0.5 max-w-[130px] truncate text-[11px] text-slate-400">
                                    {item.metadata.cameraModel}
                                  </p>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>

                          {/* ELA Mean */}
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap dark:text-slate-300">
                            {item.elaStats ? item.elaStats.meanError.toFixed(2) : '—'}
                          </td>

                          {/* Row Actions */}
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {item.status === 'complete' && report ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onInspectItem(item)}
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                  >
                                    <FolderOpen className="h-3 w-3" aria-hidden="true" />
                                    <span>Inspect</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onSendToCompare('A', item)}
                                    title="Send to Compare Slot A"
                                    className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                                  >
                                    <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
                                    <span>A</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onSendToCompare('B', item)}
                                    title="Send to Compare Slot B"
                                    className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                                  >
                                    <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
                                    <span>B</span>
                                  </button>
                                </>
                              ) : item.status === 'error' ? (
                                <button
                                  type="button"
                                  disabled={isRunning}
                                  onClick={() => onRetryItem(item.id)}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                >
                                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                                  <span>Retry</span>
                                </button>
                              ) : null}

                              <button
                                type="button"
                                onClick={() => onRemoveItem(item.id)}
                                aria-label={`Remove ${item.fileName} from batch`}
                                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
