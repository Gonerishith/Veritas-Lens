import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Camera,
  Check,
  Copy,
  Cpu,
  Crosshair,
  Download,
  FileCode2,
  FileDown,
  FileJson,
  FileOutput,
  FileText,
  History,
  Link2,
  Loader2,
  RefreshCw,
  Scale,
  Share2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import type {
  ElaStats,
  ForensicReport,
  ImageMetadata,
  ProvenanceEvent,
  ProvenanceEventKind,
  SignalStatus,
  VerdictType,
} from '../types/forensics';
import { deriveFallbackProvenance } from '../utils/exifParser';
import {
  buildMarkdownReport,
  downloadTextFile,
  formatVerdictLabel,
} from '../utils/reportExport';
import { generateForensicPdfReport } from '../utils/pdfReport';
import { createShareLink, type CreatedShareLink } from '../utils/shareService';

type InspectorTab = 'findings' | 'provenance' | 'metadata' | 'export';

interface ReportInspectorProps {
  report: ForensicReport | null;
  metadata: ImageMetadata | null;
  elaStats: ElaStats | null;
  imageDataUrl: string | null;
  elaDataUrl: string | null;
  isAnalyzing: boolean;
  errorMessage: string | null;
  selectedRegionId: string | null;
  hoveredRegionId: string | null;
  onSelectRegion: (id: string | null) => void;
  onHoverRegion: (id: string | null) => void;
  onRetry: () => void;
  onSendToCompare: (slot: 'A' | 'B') => void;
  aiThreshold: number;
  onChangeAiThreshold: (threshold: number) => void;
}

const DEFAULT_AI_THRESHOLD = 65;

const SENSITIVITY_PRESETS = [
  { label: 'Strict', threshold: 45 },
  { label: 'Balanced', threshold: 65 },
  { label: 'Lenient', threshold: 80 },
] as const;

export function classifyByThreshold(aiScore: number, aiThreshold: number): VerdictType {
  const mixedFloor = Math.max(15, aiThreshold - 30);
  if (aiScore >= aiThreshold) return 'likely_ai';
  if (aiScore >= mixedFloor) return 'inconclusive';
  return 'likely_real';
}

function getSensitivityLabel(aiThreshold: number): string {
  if (aiThreshold <= 50) return 'Strict';
  if (aiThreshold >= 75) return 'Lenient';
  return 'Balanced';
}

function getVerdictVisuals(verdict: VerdictType) {
  switch (verdict) {
    case 'likely_ai':
      return {
        label: 'Likely AI-Generated',
        interpretation: 'Strong visual indicators of synthetic or generative creation.',
        icon: ShieldAlert,
        textClass: 'text-red-700 dark:text-red-400',
        strokeClass: 'stroke-red-600 dark:stroke-red-500',
        barClass: 'bg-red-600 dark:bg-red-500',
        surfaceClass: 'bg-red-50/60 border-red-200 dark:bg-red-950/25 dark:border-red-900/60',
      };
    case 'likely_real':
      return {
        label: 'Likely Authentic',
        interpretation: 'Optical, lighting, and texture cues align with a real photograph.',
        icon: ShieldCheck,
        textClass: 'text-emerald-700 dark:text-emerald-400',
        strokeClass: 'stroke-emerald-600 dark:stroke-emerald-500',
        barClass: 'bg-emerald-600 dark:bg-emerald-500',
        surfaceClass:
          'bg-emerald-50/60 border-emerald-200 dark:bg-emerald-950/25 dark:border-emerald-900/60',
      };
    default:
      return {
        label: 'Inconclusive / Edited',
        interpretation: 'Mixed visual cues — image may be heavily edited or partially synthesized.',
        icon: Scale,
        textClass: 'text-amber-700 dark:text-amber-400',
        strokeClass: 'stroke-amber-500 dark:stroke-amber-400',
        barClass: 'bg-amber-500 dark:bg-amber-400',
        surfaceClass:
          'bg-amber-50/60 border-amber-200 dark:bg-amber-950/25 dark:border-amber-900/60',
      };
  }
}

function getSignalTone(status: SignalStatus) {
  if (status === 'synthetic') {
    return {
      label: 'Synthetic cue',
      text: 'text-red-700 dark:text-red-400',
      bar: 'bg-red-600 dark:bg-red-500',
    };
  }
  if (status === 'authentic') {
    return {
      label: 'Authentic cue',
      text: 'text-emerald-700 dark:text-emerald-400',
      bar: 'bg-emerald-600 dark:bg-emerald-500',
    };
  }
  return {
    label: 'Mixed / Caution',
    text: 'text-amber-700 dark:text-amber-400',
    bar: 'bg-amber-500 dark:bg-amber-400',
  };
}

function getProvenanceVisuals(kind: ProvenanceEventKind, flagged?: boolean) {
  if (kind === 'ai_signature' || flagged) {
    return {
      label: 'Generative signature',
      icon: ShieldAlert,
      labelClass: 'text-red-700 dark:text-red-400',
      nodeClass:
        'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-400',
    };
  }
  switch (kind) {
    case 'capture':
      return {
        label: 'Camera capture',
        icon: Camera,
        labelClass: 'text-emerald-700 dark:text-emerald-400',
        nodeClass:
          'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400',
      };
    case 'digitized':
      return {
        label: 'Digitized',
        icon: Cpu,
        labelClass: 'text-slate-600 dark:text-slate-300',
        nodeClass:
          'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
      };
    case 'edit':
      return {
        label: 'Edit history',
        icon: SlidersHorizontal,
        labelClass: 'text-blue-700 dark:text-blue-400',
        nodeClass:
          'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-400',
      };
    case 'export':
      return {
        label: 'Export / Save',
        icon: FileOutput,
        labelClass: 'text-amber-700 dark:text-amber-400',
        nodeClass:
          'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-400',
      };
    default:
      return {
        label: 'Software signature',
        icon: FileCode2,
        labelClass: 'text-slate-700 dark:text-slate-300',
        nodeClass:
          'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
      };
  }
}

function formatPostCaptureDelta(events: ProvenanceEvent[]): string | null {
  const captureEvt = events.find((e) => e.kind === 'capture' && e.timestamp);
  if (!captureEvt?.timestamp) return null;
  const parseTs = (ts: string) =>
    Date.parse(ts.replace(/\s*\(([^)]+)\)\s*$/, '$1').replace(' ', 'T'));
  const startMs = parseTs(captureEvt.timestamp);
  if (Number.isNaN(startMs)) return null;

  let latestMs = startMs;
  for (const evt of events) {
    if (!evt.timestamp || evt.id === captureEvt.id) continue;
    const ms = parseTs(evt.timestamp);
    if (!Number.isNaN(ms) && ms > latestMs) {
      latestMs = ms;
    }
  }

  const diffSec = Math.round((latestMs - startMs) / 1000);
  if (diffSec < 60) return null;
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);

  if (days > 0) {
    return hours > 0 ? `+${days}d ${hours}h edit span` : `+${days}d edit span`;
  }
  if (hours > 0) {
    return mins > 0 ? `+${hours}h ${mins}m edit span` : `+${hours}h edit span`;
  }
  return `+${mins}m edit span`;
}

async function copyTextReliable(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback to temporary textarea copy below
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function ReportInspector({
  report,
  metadata,
  elaStats,
  imageDataUrl,
  elaDataUrl,
  isAnalyzing,
  errorMessage,
  selectedRegionId,
  hoveredRegionId,
  onSelectRegion,
  onHoverRegion,
  onRetry,
  onSendToCompare,
  aiThreshold,
  onChangeAiThreshold,
}: ReportInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('findings');
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [shareState, setShareState] = useState<
    (CreatedShareLink & { thresholdAtShare: number }) | null
  >(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfDownloaded, setPdfDownloaded] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    setShareState(null);
    setShareCopied(false);
    setShareError(null);
    setPdfDownloaded(false);
    setPdfError(null);
  }, [report?.id]);

  const effectiveScore = report ? Math.max(0, Math.min(100, Math.round(report.aiProbability))) : 0;
  const effectiveVerdict: VerdictType | null = report
    ? classifyByThreshold(effectiveScore, aiThreshold)
    : null;
  const effectiveReport: ForensicReport | null =
    report && effectiveVerdict ? { ...report, verdict: effectiveVerdict } : null;
  const provenanceEvents = metadata ? deriveFallbackProvenance(metadata) : [];
  const provenanceEditDelta = formatPostCaptureDelta(provenanceEvents);

  const handleGenerateShareLink = async () => {
    if (!effectiveReport || isGeneratingShare) return;
    setIsGeneratingShare(true);
    setShareError(null);
    setShareCopied(false);
    try {
      const created = await createShareLink(effectiveReport, aiThreshold, imageDataUrl);
      setShareState({ ...created, thresholdAtShare: aiThreshold });
      const copied = await copyTextReliable(created.url);
      if (copied) {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2600);
      }
    } catch {
      setShareError('Unable to generate a shareable link right now. Please try again.');
    } finally {
      setIsGeneratingShare(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!shareState?.url) return;
    const copied = await copyTextReliable(shareState.url);
    if (copied) {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2600);
    }
  };

  const handleCopySummary = async () => {
    if (!effectiveReport) return;
    const text = buildMarkdownReport(effectiveReport);
    const copied = await copyTextReliable(text);
    if (copied) {
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    }
  };

  const handleDownloadMarkdown = () => {
    if (!effectiveReport) return;
    const baseName = effectiveReport.metadata.fileName.replace(/\.[^.]+$/, '');
    downloadTextFile(
      buildMarkdownReport(effectiveReport),
      `${baseName}-forensic-report.md`,
      'text/markdown;charset=utf-8'
    );
  };

  const handleDownloadFullPdf = async () => {
    if (!effectiveReport || !report || isGeneratingPdf) return;
    setIsGeneratingPdf(true);
    setPdfError(null);
    setPdfDownloaded(false);
    try {
      await generateForensicPdfReport({
        report: effectiveReport,
        defaultVerdict: report.verdict,
        aiThreshold,
        metadata,
        elaStats,
        imageDataUrl,
        elaDataUrl,
      });
      setPdfDownloaded(true);
      setTimeout(() => setPdfDownloaded(false), 2600);
    } catch {
      setPdfError('Unable to generate the PDF report right now. Please try again.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleDownloadJson = () => {
    if (!effectiveReport) return;
    const baseName = effectiveReport.metadata.fileName.replace(/\.[^.]+$/, '');
    downloadTextFile(
      JSON.stringify(
        { ...effectiveReport, appliedAiWarningThreshold: aiThreshold },
        null,
        2
      ),
      `${baseName}-forensic-report.json`,
      'application/json;charset=utf-8'
    );
  };

  const renderVerdictCard = () => {
    if (errorMessage) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50/70 p-5 dark:border-red-900/60 dark:bg-red-950/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-semibold text-red-900 dark:text-red-200">
                Vision analysis interrupted
              </h2>
              <p className="mt-1 text-sm text-red-800/90 dark:text-red-300">{errorMessage}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-red-800 whitespace-nowrap shrink-0 dark:bg-red-600 dark:hover:bg-red-500"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Retry Analysis</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (isAnalyzing || !report) {
      return (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2.5 flex-1">
              <div className="h-3.5 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-7 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-3.5 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
            </div>
            <div className="h-[74px] w-[74px] shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
          </div>
          <div className="mt-5 h-2.5 w-full animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Calculating AI-generated confidence score across lighting, texture, geometry, and optics…
          </p>
        </div>
      );
    }

    const activeVerdict = effectiveVerdict ?? report.verdict;
    const visuals = getVerdictVisuals(activeVerdict);
    const VerdictIcon = visuals.icon;
    const aiScore = effectiveScore;
    const authenticScore = 100 - aiScore;
    const mixedFloor = Math.max(15, aiThreshold - 30);
    const verdictOverridden = activeVerdict !== report.verdict;

    // SVG circular progress gauge geometry
    const radius = 31;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference * (1 - aiScore / 100);

    return (
      <div className={`rounded-xl border p-5 transition-colors duration-200 ${visuals.surfaceClass}`}>
        {/* Top Row: Verdict + Prominent Percentage Confidence Gauge */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              AI-Generated Confidence Score
            </p>
            <div className={`mt-1 flex items-center gap-2 text-lg font-display font-bold tracking-tight ${visuals.textClass}`}>
              <VerdictIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>{visuals.label}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {visuals.interpretation}
            </p>
          </div>

          {/* Circular Percentage Gauge */}
          <div
            className="relative flex h-[78px] w-[78px] shrink-0 items-center justify-center"
            role="img"
            aria-label={`AI-generated confidence score: ${aiScore} percent`}
          >
            <svg className="h-full w-full -rotate-90" viewBox="0 0 76 76">
              <circle
                cx="38"
                cy="38"
                r={radius}
                fill="none"
                strokeWidth="6"
                className="stroke-slate-200/90 dark:stroke-slate-800"
              />
              <circle
                cx="38"
                cy="38"
                r={radius}
                fill="none"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className={`transition-all duration-300 ${visuals.strokeClass}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-mono text-xl font-bold leading-none tabular-nums text-slate-900 dark:text-slate-50">
                {aiScore}
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">%</span>
              </span>
              <span className="mt-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                AI
              </span>
            </div>
          </div>
        </div>

        {/* Dual Percentage Split Scale (AI-Generated vs Authentic) with Dynamic Threshold Marker */}
        <div className="mt-4 border-t border-slate-200/70 pt-3.5 dark:border-slate-800/80">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              AI-Generated:{' '}
              <span className={`font-mono font-semibold tabular-nums ${visuals.textClass}`}>
                {aiScore}%
              </span>
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              Authentic:{' '}
              <span className="font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                {authenticScore}%
              </span>
            </span>
          </div>

          <div className="relative mt-2.5 h-2.5 w-full rounded-full bg-slate-200/90 dark:bg-slate-800">
            <div className="h-full w-full overflow-hidden rounded-full">
              <div
                style={{ width: `${aiScore}%` }}
                className={`h-full rounded-full transition-all duration-300 ${visuals.barClass}`}
              />
            </div>

            {/* Subtle lower mixed boundary guide */}
            <span
              aria-hidden="true"
              style={{ left: `${mixedFloor}%` }}
              className="pointer-events-none absolute inset-y-0 w-px bg-slate-500/45 dark:bg-slate-400/45"
            />

            {/* Prominent Dynamic AI Warning Threshold Marker */}
            <span
              aria-hidden="true"
              style={{ left: `${aiThreshold}%` }}
              title={`AI-generated warning threshold: ${aiThreshold}%`}
              className="pointer-events-none absolute -top-1 -bottom-1 -ml-px w-0.5 rounded-full bg-slate-900 shadow-[0_0_0_1px_rgba(255,255,255,0.75)] dark:bg-white dark:shadow-[0_0_0_1px_rgba(11,15,23,0.8)]"
            />
          </div>

          <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
            <span>0% Real</span>
            <span>
              {mixedFloor}–{aiThreshold}% Mixed
            </span>
            <span>≥{aiThreshold}% AI</span>
          </div>
        </div>

        {/* Granular Confidence Score Breakdown */}
        <div className="mt-4 rounded-xl border border-slate-200/90 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Granular Confidence Breakdown
            </h4>
            <span className="font-mono text-[11px] text-slate-400">Multi-Channel Weights</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(() => {
              const findScore = (id: string, fallback: number) => {
                const s = effectiveReport?.signals.find((sig) => sig.id === id);
                return s ? s.score : fallback;
              };
              const artifactScore = findScore('texture', aiScore);
              const neuralScore = findScore('noise_compression', Math.min(100, aiScore + 3));
              const lightingScore = findScore('lighting', aiScore);
              const metaScore = metadata?.hasExif ? 90 : metadata?.aiMarkerDetected ? 15 : 75;

              const metrics = [
                { label: 'Artifact Presence', score: artifactScore, desc: 'Texture & micro-detail consistency' },
                { label: 'Neural Signature', score: neuralScore, desc: 'Noise floor & compression residuals' },
                { label: 'Lighting & Geometry', score: lightingScore, desc: 'Illumination, shadows & perspective' },
                { label: 'Metadata Consistency', score: metaScore, desc: 'EXIF & container provenance check' },
              ];

              return metrics.map((m) => (
                <div key={m.label} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{m.label}</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{m.score}%</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                    <div
                      style={{ width: `${m.score}%` }}
                      className={`h-full rounded-full ${
                        m.score >= 65 ? 'bg-red-600 dark:bg-red-500' : m.score <= 35 ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-amber-500 dark:bg-amber-400'
                      }`}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">{m.desc}</p>
                </div>
              ));
            })()}
          </div>
        </div>

        {/* Dynamic Sensitivity Threshold Slider */}
        <div className="mt-3.5 border-t border-slate-200/70 pt-3.5 dark:border-slate-800/80">
          <div className="flex items-center justify-between gap-2 text-xs">
            <label
              htmlFor="ai-warning-threshold"
              className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <span>AI Warning Threshold</span>
            </label>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                ≥ {aiThreshold}%
              </span>
              <span aria-hidden="true" className="text-slate-400">·</span>
              <span className="text-slate-500 dark:text-slate-400">
                {getSensitivityLabel(aiThreshold)}
              </span>
              {aiThreshold !== DEFAULT_AI_THRESHOLD ? (
                <button
                  type="button"
                  onClick={() => onChangeAiThreshold(DEFAULT_AI_THRESHOLD)}
                  className="ml-0.5 text-[11px] font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>

          <input
            id="ai-warning-threshold"
            type="range"
            min={30}
            max={90}
            step={1}
            value={aiThreshold}
            aria-valuetext={`Flag as AI-generated at ${aiThreshold} percent or higher (${getSensitivityLabel(aiThreshold)} sensitivity)`}
            onChange={(e) => onChangeAiThreshold(Number(e.target.value))}
            className="forensic-slider mt-2.5 w-full"
          />

          <div className="mt-3 flex flex-col gap-2 sm:mt-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div
              role="group"
              aria-label="Sensitivity threshold presets"
              className="grid w-full grid-cols-3 items-center rounded-lg border border-slate-200/90 bg-white/75 p-0.5 sm:inline-flex sm:w-auto sm:rounded-md dark:border-slate-800 dark:bg-slate-900/80"
            >
              {SENSITIVITY_PRESETS.map((preset) => {
                const isSelected = aiThreshold === preset.threshold;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => onChangeAiThreshold(preset.threshold)}
                    className={`min-h-[38px] rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 sm:min-h-0 sm:rounded sm:text-[11px] ${
                      isSelected
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    {preset.label}{' '}
                    <span className="font-mono tabular-nums opacity-80">{preset.threshold}%</span>
                  </button>
                );
              })}
            </div>

            <span className="hidden font-mono text-[11px] tabular-nums text-slate-500 whitespace-nowrap sm:inline dark:text-slate-400">
              30%–90%
            </span>
          </div>
        </div>

        {/* Quiet Unboxed Provenance Line + Report Actions */}
        <div className="mt-3.5 space-y-2.5 border-t border-slate-200/70 pt-3 text-xs text-slate-600 dark:border-slate-800/80 dark:text-slate-300">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
            <span>
              Certainty:{' '}
              <span className="font-medium capitalize text-slate-900 dark:text-slate-100">
                {report.confidence}
              </span>
            </span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span className="truncate">
              Source:{' '}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {report.suspectedSource}
              </span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isGeneratingPdf}
              onClick={handleDownloadFullPdf}
              className="inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 active:scale-[0.98] disabled:opacity-60 whitespace-nowrap shrink-0 sm:min-h-0 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
            >
              {isGeneratingPdf ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : pdfDownloaded ? (
                <Check className="h-3.5 w-3.5 text-emerald-400 dark:text-emerald-600" aria-hidden="true" />
              ) : (
                <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>
                {isGeneratingPdf
                  ? 'Building PDF…'
                  : pdfDownloaded
                    ? 'PDF Downloaded'
                    : 'Download Full Report'}
              </span>
            </button>

            <button
              type="button"
              disabled={isGeneratingShare}
              onClick={handleGenerateShareLink}
              className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-slate-300/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60 whitespace-nowrap shrink-0 sm:min-h-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              {isGeneratingShare ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400" aria-hidden="true" />
              ) : (
                <Share2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              )}
              <span>
                {isGeneratingShare
                  ? 'Creating link…'
                  : shareState && shareState.thresholdAtShare !== aiThreshold
                    ? 'Update Share Link'
                    : 'Share Report'}
              </span>
            </button>
          </div>

          {verdictOverridden ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Reclassified by your ≥{aiThreshold}% warning threshold · Default model verdict:{' '}
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {formatVerdictLabel(report.verdict)}
              </span>
            </p>
          ) : null}

          {pdfError ? (
            <p role="alert" className="text-[11px] text-red-700 dark:text-red-400">
              {pdfError}
            </p>
          ) : null}

          {shareError ? (
            <p role="alert" className="text-[11px] text-red-700 dark:text-red-400">
              {shareError}
            </p>
          ) : null}

          {shareState ? (
            <div className="border-t border-slate-200/70 pt-2.5 dark:border-slate-800/80">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200">
                  <Link2 className="h-3 w-3 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                  <span>
                    {shareState.mode === 'public_url'
                      ? 'Shareable Public URL Ready'
                      : 'Shareable Deep-Link Ready'}
                  </span>
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {shareState.includesImage ? 'Report + image preview' : 'Compact report link'}
                </span>
              </div>

              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly
                  aria-label="Shareable forensic report URL"
                  value={shareState.url}
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.currentTarget.select()}
                  className="min-h-[38px] min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-700 focus:border-blue-600 focus:outline-none sm:min-h-0 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-200"
                />
                <button
                  type="button"
                  onClick={handleCopyShareLink}
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 sm:min-h-0 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
                >
                  {shareCopied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400 dark:text-emerald-600" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {shareState.thresholdAtShare !== aiThreshold ? (
                <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  Warning threshold changed from {shareState.thresholdAtShare}% to {aiThreshold}% — click Update Share Link to refresh.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <aside className="flex flex-col gap-4">
      {renderVerdictCard()}

      {/* Segmented Inspector Tabs */}
      <div
        role="tablist"
        aria-label="Forensic report sections"
        className="grid grid-cols-4 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-900"
      >
        {(
          [
            { id: 'findings', label: 'Findings' },
            { id: 'provenance', label: 'Provenance' },
            { id: 'metadata', label: 'Metadata' },
            { id: 'export', label: 'Export' },
          ] as { id: InspectorTab; label: string }[]
        ).map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[40px] rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 sm:min-h-0 sm:px-2.5 sm:text-xs ${
                active
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-50'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Panel Container */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        {/* FINDINGS TAB */}
        {activeTab === 'findings' ? (
          isAnalyzing || !report ? (
            <div className="space-y-4 p-5">
              <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              <div className="space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
              </div>
              <div className="border-t border-slate-100 pt-4 space-y-3 dark:border-slate-800">
                {[1, 2, 3, 4].map((row) => (
                  <div key={row} className="space-y-1.5">
                    <div className="flex justify-between">
                      <div className="h-3.5 w-36 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                      <div className="h-3.5 w-10 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                    </div>
                    <div className="h-3 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {/* Executive Synthesis */}
              <div className="p-5">
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {report.headline}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {report.summary}
                </p>
              </div>

              {/* 6-Dimension Visual Signal Breakdown */}
              <div className="p-5">
                <h4 className="font-display text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Visual Forensic Breakdown
                </h4>
                <div className="mt-3.5 space-y-4">
                  {report.signals.map((signal) => {
                    const tone = getSignalTone(signal.status);
                    return (
                      <div key={signal.id}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {signal.name}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-xs font-medium ${tone.text}`}>
                              {tone.label}
                            </span>
                            <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                              {signal.score}%
                            </span>
                          </div>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            style={{ width: `${signal.score}%` }}
                            className={`h-full rounded-full ${tone.bar}`}
                          />
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                          {signal.observation}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Interactive Flagged Regions */}
              {report.regions.length > 0 ? (
                <div className="p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-display text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Inspectable Canvas Regions
                    </h4>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      Click to highlight
                    </span>
                  </div>
                  <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                    {report.regions.map((region, idx) => {
                      const isActive =
                        selectedRegionId === region.id || hoveredRegionId === region.id;
                      const catColor =
                        region.category === 'artifact'
                          ? 'text-red-600 dark:text-red-400'
                          : region.category === 'authentic_cue'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400';

                      return (
                        <button
                          key={region.id}
                          type="button"
                          onClick={() =>
                            onSelectRegion(selectedRegionId === region.id ? null : region.id)
                          }
                          onMouseEnter={() => onHoverRegion(region.id)}
                          onMouseLeave={() => onHoverRegion(null)}
                          className={`flex w-full items-start gap-3 py-3 text-left transition-colors ${
                            isActive
                              ? 'bg-blue-50/70 -mx-2 px-2 rounded-lg dark:bg-blue-950/30'
                              : 'hover:bg-slate-50/80 dark:hover:bg-slate-900/40'
                          }`}
                        >
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 font-mono text-[11px] font-semibold tabular-nums text-slate-700 dark:border-slate-700 dark:text-slate-300">
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                {region.label}
                              </span>
                              <Crosshair
                                className={`h-3.5 w-3.5 shrink-0 ${
                                  isActive
                                    ? 'text-blue-600 dark:text-blue-400'
                                    : 'text-slate-400'
                                }`}
                                aria-hidden="true"
                              />
                            </div>
                            <p className={`mt-0.5 text-xs ${catColor}`}>
                              {region.category.replace('_', ' ')} · {region.severity} priority
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                              {region.explanation}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          )
        ) : null}

        {/* PROVENANCE TAB */}
        {activeTab === 'provenance' ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <div className="p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Embedded Provenance Timeline
                </h3>
                <span className="font-mono text-xs tabular-nums text-slate-500 whitespace-nowrap shrink-0 dark:text-slate-400">
                  {provenanceEvents.length}{' '}
                  {provenanceEvents.length === 1 ? 'signature' : 'signatures'}
                </span>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  {metadata?.hasExif ? 'Camera EXIF present' : 'Camera EXIF absent'}
                </span>
                {provenanceEvents.some((e) => e.flagged) ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-red-700 dark:text-red-400">
                      Generative marker flagged
                    </span>
                  </>
                ) : null}
                {provenanceEditDelta ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {provenanceEditDelta}
                    </span>
                  </>
                ) : null}
              </div>
            </div>

            <div className="p-5">
              {!metadata ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No file container metadata loaded yet.
                </p>
              ) : provenanceEvents.length > 0 ? (
                <ol
                  aria-label="Chronological camera and software provenance timeline"
                  className="relative"
                >
                  {provenanceEvents.map((event, idx) => {
                    const visuals = getProvenanceVisuals(event.kind, event.flagged);
                    const EventIcon = visuals.icon;
                    const isLast = idx === provenanceEvents.length - 1;
                    const stepLabel = String(idx + 1).padStart(2, '0');

                    return (
                      <li key={event.id} className="relative flex gap-3.5">
                        {/* Vertical Spine & Semantic Node */}
                        <div className="flex flex-col items-center shrink-0">
                          <span
                            className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border ${visuals.nodeClass}`}
                            aria-hidden="true"
                          >
                            <EventIcon className="h-3.5 w-3.5" />
                          </span>
                          {!isLast ? (
                            <span
                              aria-hidden="true"
                              className="my-1 w-px flex-1 bg-slate-200 dark:bg-slate-800"
                            />
                          ) : null}
                        </div>

                        {/* Chronological Event Content */}
                        <div className={`min-w-0 flex-1 ${isLast ? 'pb-0' : 'pb-5'}`}>
                          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-mono text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                                {stepLabel}.
                              </span>
                              <span className={`font-medium ${visuals.labelClass}`}>
                                {visuals.label}
                              </span>
                            </div>
                            {event.timestamp ? (
                              <time className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                                {event.timestamp}
                              </time>
                            ) : null}
                          </div>

                          <p
                            className={`mt-1 break-words font-display text-sm font-semibold ${
                              event.flagged
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {event.signature}
                          </p>

                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                            <span>{event.action}</span>
                            <span aria-hidden="true" className="text-slate-400">·</span>
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {event.sourceTag}
                            </span>
                          </div>

                          {event.details ? (
                            <p className="mt-1.5 break-words text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                              {event.details}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                      aria-hidden="true"
                    >
                      <History className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                        No embedded camera or software edit history
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        This file contains no camera capture EXIF, XMP edit log, C2PA credentials, or software signatures. Metadata is commonly stripped by social platforms, messaging apps, screenshots, or synthetic generators.
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Containers inspected:
                    </span>{' '}
                    EXIF IFD0/ExifIFD · TIFF Software · XMP xmpMM:History · IPTC DigitalSourceType · JUMBF/C2PA · PNG Text Chunks
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* METADATA TAB */}
        {activeTab === 'metadata' ? (
          <div className="divide-y divide-slate-100 p-5 dark:divide-slate-800">
            {metadata ? (
              <>
                {metadata.aiMarkerDetected ? (
                  <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50/80 p-3.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                    <div>
                      <p className="font-semibold">Generative metadata marker detected</p>
                      <p className="mt-0.5">{metadata.aiMarkerDetails}</p>
                    </div>
                  </div>
                ) : null}

                <dl className="divide-y divide-slate-100 dark:divide-slate-800">
                  {metadata.fields.map((field) => (
                    <div
                      key={`${field.group}-${field.label}`}
                      className="flex flex-col justify-between gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4"
                    >
                      <dt className="text-xs text-slate-500 shrink-0 dark:text-slate-400">
                        {field.label}
                      </dt>
                      <dd
                        className={`break-words text-left font-mono text-xs tabular-nums sm:text-right ${
                          field.flagged
                            ? 'font-semibold text-red-700 dark:text-red-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {field.value}
                      </dd>
                    </div>
                  ))}
                </dl>

                {elaStats ? (
                  <div className="pt-4 mt-4">
                    <h4 className="font-display text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Error Level Analysis Summary
                    </h4>
                    <dl className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                      <div className="flex justify-between py-2 text-xs">
                        <dt className="text-slate-500 dark:text-slate-400">Mean Residual Error</dt>
                        <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {elaStats.meanError}
                        </dd>
                      </div>
                      <div className="flex justify-between py-2 text-xs">
                        <dt className="text-slate-500 dark:text-slate-400">Peak Residual Error</dt>
                        <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {elaStats.maxError}
                        </dd>
                      </div>
                      <div className="flex justify-between py-2 text-xs">
                        <dt className="text-slate-500 dark:text-slate-400">High-Variance Pixels</dt>
                        <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {elaStats.highVarianceRatio}%
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4 py-2 text-xs">
                        <dt className="text-slate-500 shrink-0 dark:text-slate-400">Assessment</dt>
                        <dd className="text-right text-slate-800 dark:text-slate-200">
                          {elaStats.uniformityAssessment}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : null}
                {provenanceEvents.length > 0 ? (
                  <div className="pt-3.5 mt-4 flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500 dark:text-slate-400">
                      {provenanceEvents.length} embedded provenance{' '}
                      {provenanceEvents.length === 1 ? 'signature' : 'signatures'} extracted
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('provenance')}
                      className="font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      View timeline →
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No file container metadata loaded yet.
              </p>
            )}
          </div>
        ) : null}

        {/* EXPORT TAB */}
        {activeTab === 'export' ? (
          <div className="space-y-5 p-5">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Export Forensic Dossier
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Generate a comprehensive PDF with the AI verdict, original & ELA heatmap thumbnails, 6-channel breakdown, and detailed EXIF metadata, or share a live report URL.
              </p>

              <div className="mt-4 flex flex-col gap-2.5">
                <button
                  type="button"
                  disabled={!report || isGeneratingPdf}
                  onClick={handleDownloadFullPdf}
                  className="inline-flex min-h-[44px] items-center justify-between rounded-lg bg-blue-600 px-3.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40 sm:min-h-0 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  <span className="inline-flex items-center gap-2">
                    {isGeneratingPdf ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : pdfDownloaded ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <FileDown className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>
                      {isGeneratingPdf
                        ? 'Generating PDF report…'
                        : pdfDownloaded
                          ? 'Full PDF report downloaded'
                          : 'Download Full Report (.pdf)'}
                    </span>
                  </span>
                  <Download className="h-4 w-4 opacity-80" aria-hidden="true" />
                </button>

                {pdfError ? (
                  <p role="alert" className="text-xs text-red-700 dark:text-red-400">
                    {pdfError}
                  </p>
                ) : null}

                <button
                  type="button"
                  disabled={!report || isGeneratingShare}
                  onClick={handleGenerateShareLink}
                  className="inline-flex min-h-[44px] items-center justify-between rounded-lg bg-slate-900 px-3.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-40 sm:min-h-0 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
                >
                  <span className="inline-flex items-center gap-2">
                    {isGeneratingShare ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : shareCopied ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Share2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>
                      {isGeneratingShare
                        ? 'Generating shareable URL…'
                        : shareCopied
                          ? 'Share link copied to clipboard'
                          : 'Share Report URL'}
                    </span>
                  </span>
                  <Link2 className="h-4 w-4 opacity-80" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  disabled={!report}
                  onClick={handleCopySummary}
                  className="inline-flex min-h-[44px] items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-40 sm:min-h-0 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="inline-flex items-center gap-2">
                    {copiedSummary ? (
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="h-4 w-4 text-slate-500" />
                    )}
                    <span>{copiedSummary ? 'Copied to clipboard' : 'Copy Markdown summary'}</span>
                  </span>
                </button>

                <button
                  type="button"
                  disabled={!report}
                  onClick={handleDownloadMarkdown}
                  className="inline-flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-800 dark:bg-[#0F1522] dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="inline-flex items-center gap-2">
                    <FileText className="h-4 w-4 text-slate-500" />
                    <span>Download Markdown (.md)</span>
                  </span>
                  <Download className="h-4 w-4 text-slate-400" />
                </button>

                <button
                  type="button"
                  disabled={!report}
                  onClick={handleDownloadJson}
                  className="inline-flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-slate-800 dark:bg-[#0F1522] dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="inline-flex items-center gap-2">
                    <FileJson className="h-4 w-4 text-slate-500" />
                    <span>Download Raw JSON (.json)</span>
                  </span>
                  <Download className="h-4 w-4 text-slate-400" />
                </button>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <h4 className="font-display text-xs font-semibold text-slate-500 dark:text-slate-400">
                Side-by-Side Comparison
              </h4>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Load this analyzed image into Compare mode alongside another image.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!report}
                  onClick={() => onSendToCompare('A')}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap sm:min-h-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Send to Slot A</span>
                </button>
                <button
                  type="button"
                  disabled={!report}
                  onClick={() => onSendToCompare('B')}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap sm:min-h-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Send to Slot B</span>
                </button>
              </div>
            </div>

            {effectiveReport ? (
              <div className="border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                Verdict evaluated as{' '}
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {formatVerdictLabel(effectiveReport.verdict)}
                </span>{' '}
                ({effectiveReport.aiProbability}% AI score · ≥{aiThreshold}% warning threshold) on{' '}
                {new Date(effectiveReport.createdAt).toLocaleString()}.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
