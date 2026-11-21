import type { ActiveTab } from '../types/forensics';

interface TopNavProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onNewScan: () => void;
  historyCount: number;
  batchCount: number;
}

const NAV_ITEMS: { id: ActiveTab; label: string }[] = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'batch', label: 'Batch' },
  { id: 'compare', label: 'Compare' },
  { id: 'samples', label: 'Samples' },
  { id: 'history', label: 'History' },
];

export function TopNav({
  activeTab,
  onSelectTab,
  onNewScan,
  historyCount,
  batchCount,
}: TopNavProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-[#0B0F17]/95">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 md:h-16 md:gap-8 lg:px-8">
        {/* Zone 1: Single-element Brand wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab('analyze')}
          className="inline-flex min-h-[44px] items-center font-display text-base font-bold tracking-tight text-slate-900 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 md:text-lg dark:text-slate-50 dark:focus-visible:ring-offset-[#0B0F17]"
        >
          Veritas Lens
        </button>

        {/* Zone 2: Clean single-line text navigation links (desktop md+; mobile uses thumb-zone bottom bar) */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-6 lg:gap-7"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            const count =
              item.id === 'history'
                ? historyCount
                : item.id === 'batch'
                  ? batchCount
                  : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  isActive
                    ? 'text-slate-900 dark:text-slate-50'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                <span>
                  {item.label}
                  {count > 0 ? (
                    <span className="ml-1.5 font-mono text-xs tabular-nums text-slate-400 dark:text-slate-500">
                      {count}
                    </span>
                  ) : null}
                </span>
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 dark:bg-blue-500"
                  />
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={onNewScan}
            className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 sm:px-4 sm:text-sm dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus-visible:ring-offset-[#0B0F17]"
          >
            New Scan
          </button>
        </div>
      </div>
    </header>
  );
}
