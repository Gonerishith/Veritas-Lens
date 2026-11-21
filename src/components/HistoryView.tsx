import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Clock,
  FolderOpen,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { HistoryRecord, VerdictType } from '../types/forensics';
import { formatBytes } from '../utils/exifParser';
import { formatVerdictLabel } from '../utils/reportExport';

type FilterVerdict = 'all' | VerdictType;

interface HistoryViewProps {
  records: HistoryRecord[];
  onOpenRecord: (record: HistoryRecord) => void;
  onSendToCompare: (slot: 'A' | 'B', record: HistoryRecord) => void;
  onDeleteRecord: (id: string) => void;
  onClearAll: () => void;
  onStartNewScan: () => void;
}

export function HistoryView({
  records,
  onOpenRecord,
  onSendToCompare,
  onDeleteRecord,
  onClearAll,
  onStartNewScan,
}: HistoryViewProps) {
  const [filter, setFilter] = useState<FilterVerdict>('all');
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((rec) => {
      if (filter !== 'all' && rec.report.verdict !== filter) return false;
      if (!q) return true;
      return (
        rec.report.metadata.fileName.toLowerCase().includes(q) ||
        rec.report.headline.toLowerCase().includes(q) ||
        rec.report.suspectedSource.toLowerCase().includes(q)
      );
    });
  }, [records, filter, query]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-50">
            Local Scan History
          </h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm dark:text-slate-400">
            Past forensic reports saved privately in this browser. Reopen any scan or send two records to Compare mode.
          </p>
        </div>

        {records.length > 0 ? (
          confirmClear ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 dark:text-slate-300">
                Clear all {records.length} scans?
              </span>
              <button
                type="button"
                onClick={() => {
                  onClearAll();
                  setConfirmClear(false);
                }}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 whitespace-nowrap"
              >
                Confirm Clear
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 whitespace-nowrap dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-red-900/60 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear History</span>
            </button>
          )
        ) : null}
      </div>

      {/* Filter & Search Bar */}
      {records.length > 0 ? (
        <div className="mt-5 flex flex-col justify-between gap-3 sm:mt-6 sm:flex-row sm:items-center">
          <div className="max-w-full overflow-x-auto no-scrollbar">
            <div
              role="group"
              aria-label="Filter scan history by verdict"
              className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-900"
            >
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'likely_ai', label: 'Likely AI' },
                  { id: 'inconclusive', label: 'Inconclusive' },
                  { id: 'likely_real', label: 'Likely Real' },
                ] as { id: FilterVerdict; label: string }[]
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

          <div className="relative w-full sm:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by filename or source…"
              className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none sm:min-h-0 sm:text-sm dark:border-slate-800 dark:bg-[#111827] dark:text-slate-100"
            />
          </div>
        </div>
      ) : null}

      {/* Empty State */}
      {records.length === 0 ? (
        <div className="mt-10 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 py-16 text-center dark:border-slate-800 dark:bg-[#111827]/50">
          <Clock className="h-8 w-8 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          <h2 className="mt-4 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            No saved scans yet
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-slate-500 dark:text-slate-400">
            Completed analyses are archived automatically on this device so you can revisit findings or run side-by-side comparisons later.
          </p>
          <button
            type="button"
            onClick={onStartNewScan}
            className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            Analyze Your First Image
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-[#111827]">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No scans match your current filter criteria.
          </p>
          <button
            type="button"
            onClick={() => {
              setFilter('all');
              setQuery('');
            }}
            className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 dark:border-slate-800 dark:bg-[#111827] dark:divide-slate-800">
          {filtered.map((rec) => {
            const { report } = rec;
            const Icon =
              report.verdict === 'likely_ai'
                ? ShieldAlert
                : report.verdict === 'likely_real'
                  ? ShieldCheck
                  : Scale;
            const verdictColor =
              report.verdict === 'likely_ai'
                ? 'text-red-700 dark:text-red-400'
                : report.verdict === 'likely_real'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400';

            return (
              <div
                key={rec.id}
                className="flex flex-col gap-4 p-4 transition-colors hover:bg-slate-50/70 sm:flex-row sm:items-center sm:justify-between dark:hover:bg-slate-900/40"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <button
                    type="button"
                    onClick={() => onOpenRecord(rec)}
                    className="h-16 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <img
                      src={rec.thumbnailDataUrl}
                      alt={report.metadata.fileName}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  </button>

                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenRecord(rec)}
                      className="block truncate font-display text-sm font-semibold text-slate-900 hover:text-blue-600 text-left dark:text-slate-100 dark:hover:text-blue-400"
                    >
                      {report.metadata.fileName}
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className={`inline-flex items-center gap-1 font-medium ${verdictColor}`}>
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>{formatVerdictLabel(report.verdict)}</span>
                      </span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                        {report.aiProbability}% AI
                      </span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {report.suspectedSource}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                      {report.metadata.width}×{report.metadata.height} ·{' '}
                      {formatBytes(report.metadata.fileSize)} ·{' '}
                      {new Date(rec.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenRecord(rec)}
                    className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap sm:min-h-0 sm:flex-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Open</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSendToCompare('A', rec)}
                    className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 whitespace-nowrap sm:min-h-0 sm:px-2.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
                    <span>A</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSendToCompare('B', rec)}
                    className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 whitespace-nowrap sm:min-h-0 sm:px-2.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
                    <span>B</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteRecord(rec.id)}
                    aria-label={`Delete ${report.metadata.fileName} from history`}
                    className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 sm:min-h-0 sm:min-w-0 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
