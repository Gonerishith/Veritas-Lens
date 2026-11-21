import { ArrowLeftRight, Clock, Images, Layers, ScanSearch } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ActiveTab } from '../types/forensics';

interface MobileBottomNavProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  historyCount: number;
  batchCount: number;
}

const MOBILE_NAV_ITEMS: {
  id: ActiveTab;
  label: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}[] = [
  { id: 'analyze', label: 'Analyze', icon: ScanSearch },
  { id: 'batch', label: 'Batch', icon: Layers },
  { id: 'compare', label: 'Compare', icon: ArrowLeftRight },
  { id: 'samples', label: 'Samples', icon: Images },
  { id: 'history', label: 'History', icon: Clock },
];

export function MobileBottomNav({
  activeTab,
  onSelectTab,
  historyCount,
  batchCount,
}: MobileBottomNavProps) {
  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe md:hidden dark:border-slate-800 dark:bg-[#0B0F17]/95"
    >
      <div className="mx-auto grid h-14 max-w-lg grid-cols-5 items-stretch">
        {MOBILE_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
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
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 active:scale-[0.97] ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-blue-600 dark:bg-blue-400"
                />
              ) : null}
              <span className="relative inline-flex items-center justify-center">
                <Icon className="h-[20px] w-[20px]" aria-hidden={true} />
                {count > 0 ? (
                  <span className="absolute -right-3 -top-1 font-mono text-[10px] font-semibold leading-none tabular-nums text-slate-600 dark:text-slate-300">
                    {count > 99 ? '99' : count}
                  </span>
                ) : null}
              </span>
              <span className="text-[10px] font-medium leading-tight tracking-tight whitespace-nowrap">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
