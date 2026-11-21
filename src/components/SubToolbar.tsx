import { Camera, Download, Moon, Sun } from 'lucide-react';
import type { ActiveTab, ForensicReport, ImageMetadata } from '../types/forensics';
import { formatBytes } from '../utils/exifParser';

interface SubToolbarProps {
  activeTab: ActiveTab;
  metadata: ImageMetadata | null;
  report: ForensicReport | null;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onQuickExport: () => void;
  onOpenCamera: () => void;
}

export function SubToolbar({
  activeTab,
  metadata,
  report,
  theme,
  onToggleTheme,
  onQuickExport,
  onOpenCamera,
}: SubToolbarProps) {
  const renderContextLine = () => {
    if (activeTab === 'analyze' && metadata) {
      return (
        <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="truncate max-w-[220px] sm:max-w-[320px] font-medium text-slate-700 dark:text-slate-200">
            {metadata.fileName}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
            {metadata.width} × {metadata.height} px
          </span>
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          <span className="hidden sm:inline font-mono tabular-nums whitespace-nowrap shrink-0">
            {formatBytes(metadata.fileSize)}
          </span>
          <span aria-hidden="true" className="hidden md:inline">·</span>
          <span className="hidden md:inline whitespace-nowrap shrink-0">
            {metadata.hasExif ? 'EXIF Present' : 'No Camera EXIF'}
          </span>
        </div>
      );
    }

    const descriptions: Record<ActiveTab, string> = {
      analyze: 'Multimodal vision inspection · EXIF container parser · Canvas Error Level Analysis',
      batch: 'Multi-image authenticity queue · Sortable summary table · CSV & JSON export',
      compare: 'Side-by-side authenticity verification · Signal & compression delta matrix',
      samples: 'Curated benchmark images · One-click live forensic evaluation',
      history: 'Local browser archive · Stored privately on this device',
    };

    return (
      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
        {descriptions[activeTab]}
      </p>
    );
  };

  return (
    <div className="border-b border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-[#0F1522]">
      <div className="mx-auto flex min-h-12 max-w-[1440px] items-center justify-between gap-3 px-4 py-1.5 sm:min-h-11 sm:gap-4 sm:px-6 lg:px-8">
        <div className="min-w-0 flex-1">{renderContextLine()}</div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenCamera}
            aria-label="Open live camera capture"
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap shrink-0 sm:min-h-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Camera className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            <span>Camera</span>
          </button>

          {activeTab === 'analyze' && report ? (
            <button
              type="button"
              onClick={onQuickExport}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap shrink-0 sm:min-h-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Export Report</span>
              <span className="sm:hidden">Export</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light studio mode' : 'Switch to dark lab mode'}
            className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap shrink-0 sm:min-h-0 sm:min-w-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Light Studio</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Dark Lab</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
