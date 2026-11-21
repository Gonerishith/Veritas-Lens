import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { ArrowRight, Camera, ImagePlus, Link2, Loader2, Upload } from 'lucide-react';
import { SAMPLE_IMAGES } from '../data/samples';
import type { SampleImage } from '../types/forensics';

interface UploadStageProps {
  onSelectFile: (file: File) => void;
  onSelectMultipleFiles: (files: File[]) => void;
  onImportUrl: (url: string) => void;
  onSelectSample: (sample: SampleImage) => void;
  onOpenCamera: () => void;
  isBusy: boolean;
  errorMessage: string | null;
}

export function UploadStage({
  onSelectFile,
  onSelectMultipleFiles,
  onImportUrl,
  onSelectSample,
  onOpenCamera,
  isBusy,
  errorMessage,
}: UploadStageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [failedSamples, setFailedSamples] = useState<Record<string, boolean>>({});

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (isBusy) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 1) {
      onSelectMultipleFiles(files);
    } else if (files.length === 1) {
      onSelectFile(files[0]);
    }
  };

  const handleUrlSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed || isBusy) return;
    onImportUrl(trimmed);
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-10 lg:px-8 lg:py-14">
      {/* Hero heading & dropzone */}
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-[2.65rem] lg:leading-[1.15] dark:text-slate-50">
          Verify whether an image is AI-generated or authentic
        </h1>
        <p className="mx-auto mt-2.5 max-w-2xl text-sm leading-relaxed text-slate-600 sm:mt-4 sm:text-base dark:text-slate-400">
          Inspect visual artifacts, camera EXIF provenance, and Error Level Analysis compression maps in a single forensic workspace.
        </p>
      </div>

      {/* Primary Upload + URL Console */}
      <div className="mx-auto mt-6 max-w-3xl sm:mt-9">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onClick={() => !isBusy && fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !isBusy) {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={`group relative flex flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-8 text-center transition-colors cursor-pointer active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:rounded-xl sm:px-6 sm:py-12 ${
            isDragging
              ? 'border-blue-600 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-950/30'
              : 'border-slate-300 bg-slate-50/70 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#111827]/70 dark:hover:border-slate-600 dark:hover:bg-[#111827]'
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
              if (files.length > 1) {
                onSelectMultipleFiles(files);
              } else if (files.length === 1) {
                onSelectFile(files[0]);
              }
              e.target.value = '';
            }}
          />

          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-transform duration-150 group-hover:scale-[1.03] sm:rounded-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {isBusy ? (
              <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
            ) : (
              <Upload className="h-5 w-5" />
            )}
          </div>

          <p className="mt-3.5 font-display text-base font-semibold text-slate-900 sm:mt-4 dark:text-slate-100">
            {isBusy ? (
              'Preparing forensic image workspace…'
            ) : (
              <>
                <span className="sm:hidden">Tap to select one or more images</span>
                <span className="hidden sm:inline">
                  Drop one or multiple images here, or click to browse
                </span>
              </>
            )}
          </p>

          <p className="mt-1.5 text-xs text-slate-500 sm:text-sm dark:text-slate-400">
            <span>JPEG, PNG, WebP, or GIF up to 10 MB</span>
            <span className="hidden sm:inline">
              {' '}· Press{' '}
              <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Ctrl+V
              </kbd>{' '}
              anywhere to paste
            </span>
          </p>
        </div>

        {/* Camera Capture + Remote URL Actions */}
        <div className="mt-3.5 flex flex-col gap-2.5 sm:mt-4 sm:flex-row sm:items-center sm:gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onOpenCamera}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100/80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0 sm:min-h-0 sm:w-auto sm:rounded-lg dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
          >
            <Camera className="h-4 w-4" aria-hidden="true" />
            <span>Take Photo</span>
          </button>

          <form onSubmit={handleUrlSubmit} className="flex flex-1 flex-col gap-2.5 sm:flex-row sm:gap-2">
            <label htmlFor="remote-image-url" className="sr-only">
              Paste an image URL
            </label>
            <div className="relative flex-1">
              <Link2
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                aria-hidden="true"
              />
              <input
                id="remote-image-url"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste a direct image URL (https://…)"
                disabled={isBusy}
                className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:opacity-60 sm:min-h-0 sm:rounded-lg sm:text-sm dark:border-slate-800 dark:bg-[#111827] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={isBusy || !urlInput.trim()}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0 sm:min-h-0 sm:w-auto sm:rounded-lg dark:border-slate-700 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
            >
              <span>Analyze URL</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </div>

        {errorMessage ? (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
          >
            {errorMessage}
          </div>
        ) : null}
      </div>

      {/* Curated Sample Gallery Strip */}
      <section className="mt-10 border-t border-slate-200 pt-8 sm:mt-14 sm:pt-10 dark:border-slate-800">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 sm:text-lg dark:text-slate-100">
              Try a benchmark sample
            </h2>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm dark:text-slate-400">
              Tap any test image to run the live vision, EXIF, and Error Level Analysis pipeline.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-5 lg:grid-cols-4">
          {SAMPLE_IMAGES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              disabled={isBusy}
              onClick={() => onSelectSample(sample)}
              className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition-colors hover:border-slate-300 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-60 dark:border-slate-800 dark:bg-[#111827] dark:hover:border-slate-700"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100 dark:bg-slate-900">
                {failedSamples[sample.id] ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-100 to-slate-200 text-slate-500 dark:from-slate-800 dark:to-slate-900 dark:text-slate-400">
                    <ImagePlus className="h-6 w-6" />
                    <span className="text-xs font-medium">{sample.title}</span>
                  </div>
                ) : (
                  <img
                    src={sample.url}
                    alt={sample.title}
                    referrerPolicy="no-referrer"
                    onError={() =>
                      setFailedSamples((prev) => ({ ...prev, [sample.id]: true }))
                    }
                    className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.03]"
                  />
                )}
              </div>

              <div className="flex flex-1 flex-col p-3 sm:p-4">
                <p className="truncate text-[11px] text-slate-500 sm:text-xs dark:text-slate-400">
                  {sample.category}
                </p>
                <h3 className="mt-0.5 font-display text-xs font-semibold text-slate-900 group-hover:text-blue-600 sm:mt-1 sm:text-sm dark:text-slate-100 dark:group-hover:text-blue-400">
                  {sample.title}
                </h3>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500 sm:mt-1.5 sm:line-clamp-none sm:text-xs dark:text-slate-400">
                  {sample.forensicNote}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
