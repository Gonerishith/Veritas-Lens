import { useState } from 'react';
import { ArrowLeftRight, ImagePlus, ScanSearch } from 'lucide-react';
import { SAMPLE_IMAGES } from '../data/samples';
import type { SampleImage } from '../types/forensics';

interface SamplesViewProps {
  onAnalyzeSample: (sample: SampleImage) => void;
  onCompareSample: (slot: 'A' | 'B', sample: SampleImage) => void;
}

export function SamplesView({ onAnalyzeSample, onCompareSample }: SamplesViewProps) {
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <div className="max-w-2xl">
        <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-50">
          Benchmark Sample Gallery
        </h1>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-600 sm:text-sm dark:text-slate-400">
          Inspect curated reference images across portrait, architecture, macro, and urban night domains. Every sample runs through the live multimodal analyzer, EXIF inspector, and ELA engine.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:mt-8 sm:gap-6 md:grid-cols-2">
        {SAMPLE_IMAGES.map((sample) => (
          <article
            key={sample.id}
            className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]"
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100 dark:bg-slate-900">
              {failed[sample.id] ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-500">
                  <ImagePlus className="h-6 w-6" />
                  <span className="text-xs">{sample.title}</span>
                </div>
              ) : (
                <img
                  src={sample.url}
                  alt={sample.title}
                  referrerPolicy="no-referrer"
                  onError={() => setFailed((p) => ({ ...p, [sample.id]: true }))}
                  className="h-full w-full object-cover"
                />
              )}
            </div>

            <div className="flex flex-1 flex-col justify-between p-4 sm:p-5">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {sample.category} · {sample.subtitle}
                </p>
                <h2 className="mt-1.5 font-display text-base font-semibold text-slate-900 sm:text-lg dark:text-slate-100">
                  {sample.title}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 sm:mt-2 sm:text-sm dark:text-slate-400">
                  {sample.forensicNote}
                </p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 sm:mt-5 sm:flex sm:flex-wrap sm:items-center dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => onAnalyzeSample(sample)}
                  className="col-span-2 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 active:scale-[0.98] whitespace-nowrap shrink-0 sm:min-h-0 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Analyze Image</span>
                </button>
                <button
                  type="button"
                  onClick={() => onCompareSample('A', sample)}
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 sm:min-h-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Compare A</span>
                </button>
                <button
                  type="button"
                  onClick={() => onCompareSample('B', sample)}
                  className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 sm:min-h-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Compare B</span>
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
