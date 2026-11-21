import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { Eye, EyeOff, MoveHorizontal, Search } from 'lucide-react';
import type {
  CanvasMode,
  ElaPalette,
  ElaStats,
  ForensicRegion,
  LoupeZoom,
} from '../types/forensics';

interface ForensicCanvasProps {
  imageDataUrl: string;
  elaDataUrl: string | null;
  elaStats: ElaStats | null;
  regions: ForensicRegion[];
  selectedRegionId: string | null;
  hoveredRegionId: string | null;
  onSelectRegion: (id: string | null) => void;
  onHoverRegion: (id: string | null) => void;
  elaQuality: number;
  elaScale: number;
  elaPalette: ElaPalette;
  isRecomputingEla: boolean;
  onChangeElaQuality: (val: number) => void;
  onChangeElaScale: (val: number) => void;
  onChangeElaPalette: (val: ElaPalette) => void;
  isAnalyzing: boolean;
}

interface LoupeState {
  visible: boolean;
  isTouch: boolean;
  clientX: number;
  clientY: number;
  relX: number; // 0..1 on image
  relY: number; // 0..1 on image
  pixelX: number;
  pixelY: number;
  hex: string;
  rgb: string;
}

const REGION_STYLES: Record<
  ForensicRegion['category'],
  { border: string; bg: string; labelBg: string }
> = {
  artifact: {
    border: 'border-red-500',
    bg: 'bg-red-500/12',
    labelBg: 'bg-red-600 text-white',
  },
  anomaly: {
    border: 'border-amber-500',
    bg: 'bg-amber-500/12',
    labelBg: 'bg-amber-600 text-white',
  },
  authentic_cue: {
    border: 'border-emerald-500',
    bg: 'bg-emerald-500/12',
    labelBg: 'bg-emerald-600 text-white',
  },
};

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export function ForensicCanvas({
  imageDataUrl,
  elaDataUrl,
  elaStats,
  regions,
  selectedRegionId,
  hoveredRegionId,
  onSelectRegion,
  onHoverRegion,
  elaQuality,
  elaScale,
  elaPalette,
  isRecomputingEla,
  onChangeElaQuality,
  onChangeElaScale,
  onChangeElaPalette,
  isAnalyzing,
}: ForensicCanvasProps) {
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('original');
  const [showRegions, setShowRegions] = useState(true);
  const [loupeZoom, setLoupeZoom] = useState<LoupeZoom>(0);
  const [splitPercent, setSplitPercent] = useState(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgBoxRef = useRef<HTMLDivElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleImgDimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  const [loupe, setLoupe] = useState<LoupeState>({
    visible: false,
    isTouch: false,
    clientX: 0,
    clientY: 0,
    relX: 0.5,
    relY: 0.5,
    pixelX: 0,
    pixelY: 0,
    hex: '#000000',
    rgb: '0, 0, 0',
  });

  const activeLayerUrl = useMemo(() => {
    if (canvasMode === 'ela' && elaDataUrl) return elaDataUrl;
    return imageDataUrl;
  }, [canvasMode, elaDataUrl, imageDataUrl]);

  // Cache offscreen pixel sampler for live RGB / Hex telemetry in Zoom Loupe
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        sampleCanvasRef.current = canvas;
        sampleImgDimsRef.current = { w: img.naturalWidth, h: img.naturalHeight };
      }
    };
    img.src = activeLayerUrl;
    return () => {
      cancelled = true;
    };
  }, [activeLayerUrl]);

  useEffect(() => {
    if (!isDraggingSplit) return;
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if ('touches' in e) {
        e.preventDefault();
      }
      const box = imgBoxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const pct = ((clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.max(4, Math.min(96, pct)));
    };
    const handleUp = () => setIsDraggingSplit(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchend', handleUp);
    };
  }, [isDraggingSplit]);

  const updateLoupeAtPoint = (clientX: number, clientY: number, isTouch: boolean) => {
    if (loupeZoom === 0 || isDraggingSplit) return;
    const box = imgBoxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const relY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

    const { w, h } = sampleImgDimsRef.current;
    const pixelX = w > 0 ? Math.min(w - 1, Math.floor(relX * w)) : 0;
    const pixelY = h > 0 ? Math.min(h - 1, Math.floor(relY * h)) : 0;

    let hex = '#000000';
    let rgb = '0, 0, 0';
    const sampler = sampleCanvasRef.current;
    if (sampler && w > 0 && h > 0) {
      const ctx = sampler.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        const px = ctx.getImageData(pixelX, pixelY, 1, 1).data;
        hex = rgbToHex(px[0], px[1], px[2]);
        rgb = `${px[0]}, ${px[1]}, ${px[2]}`;
      }
    }

    setLoupe({
      visible: true,
      isTouch,
      clientX: Math.max(0, Math.min(rect.width, clientX - rect.left)),
      clientY: Math.max(0, Math.min(rect.height, clientY - rect.top)),
      relX,
      relY,
      pixelX,
      pixelY,
      hex,
      rgb,
    });
  };

  const handleImageMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    updateLoupeAtPoint(e.clientX, e.clientY, false);
  };

  const handleImageTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (loupeZoom === 0 || isDraggingSplit || e.touches.length !== 1) return;
    const touch = e.touches[0];
    updateLoupeAtPoint(touch.clientX, touch.clientY, true);
  };

  const handleImageTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (loupeZoom === 0 || isDraggingSplit || e.touches.length !== 1) return;
    const touch = e.touches[0];
    updateLoupeAtPoint(touch.clientX, touch.clientY, true);
  };

  const activeRegion = regions.find(
    (r) => r.id === (hoveredRegionId ?? selectedRegionId)
  );

  const loupeSize = 152;

  return (
    <div className="flex flex-col gap-3">
      {/* Canvas Control Bar (Mobile-first stacked rows -> single row on sm+) */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
        {/* View Mode Segmented Control */}
        <div
          role="group"
          aria-label="Canvas inspection layer"
          className="grid w-full grid-cols-3 items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 sm:inline-flex sm:w-auto dark:border-slate-800 dark:bg-slate-900"
        >
          {(
            [
              { id: 'original', label: 'Original' },
              { id: 'ela', label: 'ELA Map' },
              { id: 'split', label: 'Split Wipe' },
            ] as { id: CanvasMode; label: string }[]
          ).map((mode) => {
            const disabled = mode.id !== 'original' && !elaDataUrl;
            const active = canvasMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                disabled={disabled}
                onClick={() => setCanvasMode(mode.id)}
                className={`min-h-[38px] rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 sm:min-h-0 sm:px-3 ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-50'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>

        {/* Right Controls: Region Toggle + Optical Zoom Loupe */}
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <button
            type="button"
            disabled={regions.length === 0}
            onClick={() => setShowRegions((v) => !v)}
            className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 sm:min-h-0 ${
              showRegions && regions.length > 0
                ? 'border-blue-600/30 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/40 dark:text-blue-300'
                : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            {showRegions ? (
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>Regions</span>
            {regions.length > 0 ? (
              <span className="font-mono tabular-nums opacity-75">{regions.length}</span>
            ) : null}
          </button>

          <div
            role="group"
            aria-label="Zoom loupe magnification"
            className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-900"
          >
            <span className="inline-flex items-center gap-1 px-1.5 text-xs text-slate-500 sm:px-2 dark:text-slate-400">
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Loupe</span>
            </span>
            {([0, 2, 4, 8] as LoupeZoom[]).map((z) => {
              const active = loupeZoom === z;
              return (
                <button
                  key={z}
                  type="button"
                  onClick={() => {
                    setLoupeZoom(z);
                    if (z === 0) setLoupe((l) => ({ ...l, visible: false }));
                  }}
                  className={`min-h-[34px] rounded-md px-2 py-1 font-mono text-xs tabular-nums transition-colors whitespace-nowrap shrink-0 sm:min-h-0 ${
                    active
                      ? 'bg-white font-semibold text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-50'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {z === 0 ? 'Off' : `${z}x`}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Image Viewport */}
      <div
        ref={stageRef}
        className="relative flex min-h-[260px] items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100/90 p-2.5 sm:min-h-[380px] sm:p-5 lg:min-h-[540px] dark:border-slate-800 dark:bg-[#0D1320]"
      >
        <div
          ref={imgBoxRef}
          onMouseMove={handleImageMouseMove}
          onMouseLeave={() => setLoupe((prev) => ({ ...prev, visible: false }))}
          onTouchStart={handleImageTouchStart}
          onTouchMove={handleImageTouchMove}
          onTouchEnd={() => setLoupe((prev) => ({ ...prev, visible: false }))}
          onTouchCancel={() => setLoupe((prev) => ({ ...prev, visible: false }))}
          onClick={() => {
            if (selectedRegionId) onSelectRegion(null);
          }}
          className={`relative inline-block max-h-[52vh] max-w-full select-none overflow-hidden rounded-lg bg-slate-950/5 sm:max-h-[640px] dark:bg-black/40 ${
            loupeZoom > 0 ? 'cursor-crosshair touch-none' : 'cursor-default'
          }`}
        >
          {/* Base Image Layer */}
          <img
            src={canvasMode === 'ela' && elaDataUrl ? elaDataUrl : imageDataUrl}
            alt="Analyzed image subject"
            referrerPolicy="no-referrer"
            draggable={false}
            className="block max-h-[52vh] max-w-full w-auto h-auto object-contain sm:max-h-[640px]"
          />

          {/* Split Wipe ELA Overlay */}
          {canvasMode === 'split' && elaDataUrl ? (
            <>
              <img
                src={elaDataUrl}
                alt="Error Level Analysis heatmap layer"
                referrerPolicy="no-referrer"
                draggable={false}
                style={{ clipPath: `inset(0 0 0 ${splitPercent}%)` }}
                className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              />
              <div
                style={{ left: `${splitPercent}%` }}
                className="absolute inset-y-0 z-20 -ml-px w-0.5 touch-none bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.4)]"
              >
                <button
                  type="button"
                  aria-label="Drag to compare original and ELA heatmap"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setIsDraggingSplit(true);
                  }}
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    setIsDraggingSplit(true);
                  }}
                  className="absolute top-1/2 left-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full border border-slate-300 bg-white text-slate-900 shadow-md transition-transform hover:scale-105 cursor-ew-resize dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  <MoveHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="pointer-events-none absolute left-2.5 top-2.5 rounded bg-slate-950/75 px-2 py-0.5 font-mono text-[11px] text-white backdrop-blur-xs sm:left-3 sm:top-3">
                Original
              </div>
              <div className="pointer-events-none absolute right-2.5 top-2.5 rounded bg-slate-950/75 px-2 py-0.5 font-mono text-[11px] text-white backdrop-blur-xs sm:right-3 sm:top-3">
                ELA Map
              </div>
            </>
          ) : null}

          {/* Interactive Region Highlights */}
          {showRegions && regions.length > 0 && canvasMode !== 'split'
            ? regions.map((region, idx) => {
                const [ymin, xmin, ymax, xmax] = region.box_2d;
                const top = `${ymin / 10}%`;
                const left = `${xmin / 10}%`;
                const height = `${(ymax - ymin) / 10}%`;
                const width = `${(xmax - xmin) / 10}%`;
                const style = REGION_STYLES[region.category] ?? REGION_STYLES.anomaly;
                const isFocused =
                  selectedRegionId === region.id || hoveredRegionId === region.id;
                const dimOthers =
                  Boolean(selectedRegionId || hoveredRegionId) && !isFocused;

                return (
                  <button
                    key={region.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectRegion(selectedRegionId === region.id ? null : region.id);
                    }}
                    onMouseEnter={() => onHoverRegion(region.id)}
                    onMouseLeave={() => onHoverRegion(null)}
                    style={{ top, left, width, height }}
                    aria-label={`Inspect region ${idx + 1}: ${region.label}`}
                    className={`absolute z-10 border-2 transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                      style.border
                    } ${isFocused ? `${style.bg} opacity-100` : 'bg-transparent'} ${
                      dimOthers ? 'opacity-30' : 'opacity-90 hover:opacity-100'
                    }`}
                  >
                    <span
                      className={`absolute -top-6 left-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap shadow-xs ${
                        style.labelBg
                      } ${isFocused ? 'opacity-100' : 'opacity-90'}`}
                    >
                      <span className="font-mono tabular-nums">{idx + 1}</span>
                      <span>{region.label}</span>
                    </span>
                  </button>
                );
              })
            : null}

          {/* Optical Zoom Loupe (mouse + finger-offset touch) */}
          {loupeZoom > 0 && loupe.visible && imgBoxRef.current ? (
            <div
              aria-hidden="true"
              style={{
                width: loupeSize,
                height: loupeSize,
                left: Math.max(
                  8,
                  Math.min(
                    imgBoxRef.current.clientWidth - loupeSize - 8,
                    loupe.clientX - loupeSize / 2
                  )
                ),
                top: Math.max(
                  8,
                  Math.min(
                    imgBoxRef.current.clientHeight - loupeSize - 8,
                    loupe.clientY - loupeSize / 2 - (loupe.isTouch ? 68 : 0)
                  )
                ),
                backgroundImage: `url("${
                  canvasMode === 'split' && elaDataUrl && loupe.relX * 100 > splitPercent
                    ? elaDataUrl
                    : activeLayerUrl
                }")`,
                backgroundRepeat: 'no-repeat',
                backgroundSize: `${imgBoxRef.current.clientWidth * loupeZoom}px ${
                  imgBoxRef.current.clientHeight * loupeZoom
                }px`,
                backgroundPosition: `${-(loupe.clientX * loupeZoom - loupeSize / 2)}px ${-(
                  loupe.clientY * loupeZoom -
                  loupeSize / 2
                )}px`,
                imageRendering: loupeZoom >= 4 ? 'pixelated' : 'auto',
              }}
              className="pointer-events-none absolute z-30 rounded-full border-2 border-white shadow-[0_10px_28px_rgba(15,23,42,0.45)] ring-1 ring-slate-900/40"
            >
              {/* Center crosshair reticle */}
              <span className="absolute left-1/2 top-1/2 h-3.5 w-px -translate-x-1/2 -translate-y-1/2 bg-white/90 mix-blend-difference" />
              <span className="absolute left-1/2 top-1/2 h-px w-3.5 -translate-x-1/2 -translate-y-1/2 bg-white/90 mix-blend-difference" />
              <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-slate-950/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white">
                {loupeZoom}x
              </span>
            </div>
          ) : null}

          {/* Subtle scanning progress bar overlay when server analysis is running */}
          {isAnalyzing ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/75 via-slate-950/35 to-transparent px-4 py-3 text-white">
              <div className="flex items-center justify-between gap-2 text-xs font-medium">
                <span className="truncate">Running visual forensic pass…</span>
                <span className="font-mono text-[11px] opacity-80 whitespace-nowrap">ELA & EXIF ready</span>
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/20">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-blue-400" />
              </div>
            </div>
          ) : null}
        </div>

        {/* Corner Coordinate & Pixel Telemetry HUD when Loupe Active */}
        {loupeZoom > 0 ? (
          <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-20 flex items-center gap-2.5 rounded-md border border-slate-200/80 bg-white/95 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-slate-700 shadow-xs backdrop-blur-xs sm:bottom-3 sm:left-3 sm:gap-3 dark:border-slate-700 dark:bg-slate-950/90 dark:text-slate-200">
            {loupe.visible ? (
              <>
                <span>
                  X:{loupe.pixelX} Y:{loupe.pixelY}
                </span>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">|</span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-xs border border-slate-300 dark:border-slate-600"
                    style={{ backgroundColor: loupe.hex }}
                  />
                  <span>{loupe.hex}</span>
                </span>
                <span aria-hidden="true" className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
                <span className="hidden sm:inline text-slate-500 dark:text-slate-400">
                  RGB({loupe.rgb})
                </span>
              </>
            ) : (
              <span className="font-sans text-slate-600 dark:text-slate-300">
                Touch & drag or hover image to magnify ({loupeZoom}x)
              </span>
            )}
          </div>
        ) : null}
      </div>

      {/* Focused Region Callout Bar */}
      {activeRegion && showRegions && canvasMode !== 'split' ? (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs dark:border-slate-800 dark:bg-[#111827]">
          <div className="min-w-0">
            <p className="font-medium text-slate-900 dark:text-slate-100">
              {activeRegion.label}
              <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                · {activeRegion.category.replace('_', ' ')} · {activeRegion.severity} priority
              </span>
            </p>
            <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-400">
              {activeRegion.explanation}
            </p>
          </div>
          {selectedRegionId ? (
            <button
              type="button"
              onClick={() => onSelectRegion(null)}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0 dark:text-blue-400"
            >
              Clear focus
            </button>
          ) : null}
        </div>
      ) : null}

      {/* ELA Calibration Controls (visible in ELA or Split mode) */}
      {canvasMode !== 'original' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Error Level Analysis Calibration
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Bright clusters indicate regions with higher JPEG recompression residuals relative to surrounding pixels.
              </p>
            </div>
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-900">
              {(['thermal', 'grayscale'] as ElaPalette[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onChangeElaPalette(p)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                    elaPalette === p
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3.5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="ela-quality" className="font-medium text-slate-700 dark:text-slate-300">
                  JPEG Recompression Quality
                </label>
                <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  {elaQuality}%
                </span>
              </div>
              <input
                id="ela-quality"
                type="range"
                min={70}
                max={95}
                step={1}
                value={elaQuality}
                onChange={(e) => onChangeElaQuality(Number(e.target.value))}
                className="forensic-slider mt-2 w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="ela-scale" className="font-medium text-slate-700 dark:text-slate-300">
                  Error Amplification Gain
                </label>
                <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                  {elaScale}x
                </span>
              </div>
              <input
                id="ela-scale"
                type="range"
                min={5}
                max={30}
                step={1}
                value={elaScale}
                onChange={(e) => onChangeElaScale(Number(e.target.value))}
                className="forensic-slider mt-2 w-full"
              />
            </div>
          </div>

          {elaStats ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
                <span>Mean: {elaStats.meanError}</span>
                <span aria-hidden="true">·</span>
                <span>Peak: {elaStats.maxError}</span>
                <span aria-hidden="true">·</span>
                <span>High-Variance: {elaStats.highVarianceRatio}%</span>
              </div>
              <span className="text-slate-600 dark:text-slate-300">
                {isRecomputingEla ? 'Recalculating heatmap…' : elaStats.uniformityAssessment}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
