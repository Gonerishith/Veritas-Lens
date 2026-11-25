import type {
  ConfidenceLevel,
  ElaStats,
  ForensicRegion,
  ForensicReport,
  ForensicSignal,
  ImageMetadata,
  MetadataField,
  ProvenanceEvent,
  ProvenanceEventKind,
  SignalStatus,
  SourceType,
  VerdictType,
} from '../types/forensics';
import { createCompactThumbnail } from './elaEngine';

export interface SharedReportPayload {
  report: ForensicReport;
  aiThreshold: number;
  previewImageDataUrl: string | null;
  sharedAt: string;
}

export interface CreatedShareLink {
  url: string;
  mode: 'public_url' | 'deep_link';
  includesImage: boolean;
  shareId?: string;
}

export interface ResolvedShareResult extends SharedReportPayload {
  mode: 'public_url' | 'deep_link';
}

const SAFE_IMAGE_DATA_URL_REGEX = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const SAFE_SHARE_ID_REGEX = /^[A-Za-z0-9_-]{10,24}$/;

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function clampFloat(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function safeString(val: unknown, maxLen: number, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  return val.trim().slice(0, maxLen) || fallback;
}

function isSafeImageDataUrl(val: unknown): val is string {
  return (
    typeof val === 'string' &&
    val.length > 32 &&
    val.length <= 650_000 &&
    SAFE_IMAGE_DATA_URL_REGEX.test(val)
  );
}

export function sanitizeSharedPayload(raw: unknown): SharedReportPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const rawReport = obj.report;
  if (typeof rawReport !== 'object' || rawReport === null) return null;
  const r = rawReport as Record<string, unknown>;

  const aiProbability = clampInt(r.aiProbability, 0, 100, 50);
  const aiThreshold = clampInt(obj.aiThreshold, 30, 90, 65);

  const verdict: VerdictType =
    r.verdict === 'likely_ai' || r.verdict === 'inconclusive' || r.verdict === 'likely_real'
      ? r.verdict
      : aiProbability >= aiThreshold
        ? 'likely_ai'
        : aiProbability <= Math.max(15, aiThreshold - 30)
          ? 'likely_real'
          : 'inconclusive';

  const confidence: ConfidenceLevel =
    r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low'
      ? r.confidence
      : 'medium';

  const sourceType: SourceType =
    r.sourceType === 'upload' ||
    r.sourceType === 'url' ||
    r.sourceType === 'sample' ||
    r.sourceType === 'paste' ||
    r.sourceType === 'camera'
      ? r.sourceType
      : 'upload';

  const rawSignals = Array.isArray(r.signals) ? r.signals.slice(0, 8) : [];
  const signals: ForensicSignal[] = rawSignals.map((item, idx) => {
    const s = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const score = clampInt(s.score, 0, 100, 50);
    const status: SignalStatus =
      s.status === 'authentic' || s.status === 'caution' || s.status === 'synthetic'
        ? s.status
        : score >= 65
          ? 'synthetic'
          : score <= 35
            ? 'authentic'
            : 'caution';
    return {
      id: safeString(s.id, 40, `signal-${idx + 1}`),
      name: safeString(s.name, 80, `Forensic Signal ${idx + 1}`),
      status,
      score,
      observation: safeString(s.observation, 500, 'No additional details recorded.'),
    };
  });

  const rawRegions = Array.isArray(r.regions) ? r.regions.slice(0, 6) : [];
  const regions: ForensicRegion[] = rawRegions
    .map((item, idx) => {
      const reg = (typeof item === 'object' && item !== null ? item : {}) as Record<
        string,
        unknown
      >;
      const box = Array.isArray(reg.box_2d) ? reg.box_2d.map(Number) : [];
      if (box.length !== 4 || box.some((v) => !Number.isFinite(v))) return null;
      const ymin = clampInt(box[0], 0, 990, 100);
      const xmin = clampInt(box[1], 0, 990, 100);
      const ymax = clampInt(box[2], ymin + 10, 1000, Math.min(1000, ymin + 150));
      const xmax = clampInt(box[3], xmin + 10, 1000, Math.min(1000, xmin + 150));
      const category =
        reg.category === 'artifact' ||
        reg.category === 'authentic_cue' ||
        reg.category === 'anomaly'
          ? reg.category
          : 'anomaly';
      const severity =
        reg.severity === 'high' || reg.severity === 'medium' || reg.severity === 'low'
          ? reg.severity
          : 'medium';
      return {
        id: safeString(reg.id, 40, `region-${idx + 1}`),
        label: safeString(reg.label, 80, `Region ${idx + 1}`),
        category,
        severity,
        explanation: safeString(reg.explanation, 400, 'Localized forensic observation.'),
        box_2d: [ymin, xmin, ymax, xmax] as [number, number, number, number],
      };
    })
    .filter((entry): entry is ForensicRegion => entry !== null);

  const rawMeta = (typeof r.metadata === 'object' && r.metadata !== null ? r.metadata : {}) as Record<
    string,
    unknown
  >;
  const rawFields = Array.isArray(rawMeta.fields) ? rawMeta.fields.slice(0, 30) : [];
  const fields: MetadataField[] = rawFields.map((item) => {
    const f = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const group =
      f.group === 'file' ||
      f.group === 'camera' ||
      f.group === 'software' ||
      f.group === 'ai_markers'
        ? f.group
        : 'file';
    return {
      label: safeString(f.label, 60, 'Field'),
      value: safeString(f.value, 220, '—'),
      group,
      flagged: Boolean(f.flagged),
    };
  });

  const rawProvenance = Array.isArray(rawMeta.provenance)
    ? rawMeta.provenance.slice(0, 20)
    : undefined;
  const provenance: ProvenanceEvent[] | undefined = rawProvenance
    ? rawProvenance.map((item, idx) => {
        const p = (typeof item === 'object' && item !== null ? item : {}) as Record<
          string,
          unknown
        >;
        const kind: ProvenanceEventKind =
          p.kind === 'capture' ||
          p.kind === 'digitized' ||
          p.kind === 'edit' ||
          p.kind === 'software_signature' ||
          p.kind === 'export' ||
          p.kind === 'ai_signature'
            ? p.kind
            : 'software_signature';
        return {
          id: safeString(p.id, 40, `prov-${idx + 1}`),
          kind,
          signature: safeString(p.signature, 120, 'Recorded signature'),
          action: safeString(p.action, 120, 'Metadata entry recorded'),
          timestamp: typeof p.timestamp === 'string' ? safeString(p.timestamp, 48) : undefined,
          sourceTag: safeString(p.sourceTag, 64, 'EXIF / XMP'),
          details: typeof p.details === 'string' ? safeString(p.details, 200) : undefined,
          flagged: Boolean(p.flagged),
        };
      })
    : undefined;

  const metadata: ImageMetadata = {
    fileName: safeString(rawMeta.fileName, 120, 'shared-image.jpg'),
    mimeType: safeString(rawMeta.mimeType, 40, 'image/jpeg'),
    fileSize: clampInt(rawMeta.fileSize, 0, 100_000_000, 0),
    width: clampInt(rawMeta.width, 0, 50_000, 0),
    height: clampInt(rawMeta.height, 0, 50_000, 0),
    aspectRatio: safeString(rawMeta.aspectRatio, 24, '—'),
    hasExif: Boolean(rawMeta.hasExif),
    cameraMake: typeof rawMeta.cameraMake === 'string' ? safeString(rawMeta.cameraMake, 80) : undefined,
    cameraModel: typeof rawMeta.cameraModel === 'string' ? safeString(rawMeta.cameraModel, 80) : undefined,
    lensModel: typeof rawMeta.lensModel === 'string' ? safeString(rawMeta.lensModel, 100) : undefined,
    software: typeof rawMeta.software === 'string' ? safeString(rawMeta.software, 100) : undefined,
    dateTimeOriginal:
      typeof rawMeta.dateTimeOriginal === 'string'
        ? safeString(rawMeta.dateTimeOriginal, 64)
        : undefined,
    exposureSummary:
      typeof rawMeta.exposureSummary === 'string'
        ? safeString(rawMeta.exposureSummary, 100)
        : undefined,
    aiMarkerDetected: Boolean(rawMeta.aiMarkerDetected),
    aiMarkerDetails:
      typeof rawMeta.aiMarkerDetails === 'string'
        ? safeString(rawMeta.aiMarkerDetails, 240)
        : undefined,
    fields,
    provenance,
  };

  let elaStats: ElaStats | null = null;
  if (typeof r.elaStats === 'object' && r.elaStats !== null) {
    const e = r.elaStats as Record<string, unknown>;
    elaStats = {
      quality: clampInt(e.quality, 50, 98, 90),
      scale: clampInt(e.scale, 1, 50, 15),
      meanError: clampFloat(e.meanError, 0, 255, 0),
      maxError: clampFloat(e.maxError, 0, 255, 0),
      highVarianceRatio: clampFloat(e.highVarianceRatio, 0, 100, 0),
      uniformityAssessment: safeString(
        e.uniformityAssessment,
        200,
        'Compression profile recorded.'
      ),
    };
  }

  const createdAt = safeString(r.createdAt, 40, new Date().toISOString());
  const sharedAt = safeString(obj.sharedAt, 40, createdAt);

  const report: ForensicReport = {
    id: safeString(r.id, 64, `shared-${Date.now()}`),
    createdAt,
    sourceType,
    verdict,
    aiProbability,
    confidence,
    headline: safeString(r.headline, 240, 'Shared forensic evaluation'),
    summary: safeString(r.summary, 1000, 'Forensic scan summary included in shared report.'),
    suspectedSource: safeString(r.suspectedSource, 100, 'Undetermined'),
    signals,
    regions,
    metadata,
    elaStats,
  };

  const previewImageDataUrl = isSafeImageDataUrl(obj.previewImageDataUrl)
    ? obj.previewImageDataUrl
    : null;

  return {
    report,
    aiThreshold,
    previewImageDataUrl,
    sharedAt,
  };
}

function encodeBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function getBaseAppUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export function buildStatelessDeepLink(report: ForensicReport, aiThreshold: number): string {
  const compactPayload: SharedReportPayload = {
    report: {
      ...report,
      sourceUrl: undefined,
      metadata: {
        ...report.metadata,
        fields: report.metadata.fields.slice(0, 14),
      },
    },
    aiThreshold,
    previewImageDataUrl: null,
    sharedAt: new Date().toISOString(),
  };
  const encoded = encodeBase64Url(JSON.stringify(compactPayload));
  return `${getBaseAppUrl()}#report=${encoded}`;
}

export async function createShareLink(
  report: ForensicReport,
  aiThreshold: number,
  imageDataUrl: string | null
): Promise<CreatedShareLink> {
  let previewImageDataUrl: string | null = null;

  if (imageDataUrl) {
    try {
      const compact = await createCompactThumbnail(imageDataUrl, 960);
      if (isSafeImageDataUrl(compact)) {
        previewImageDataUrl = compact;
      } else {
        const smaller = await createCompactThumbnail(imageDataUrl, 640);
        if (isSafeImageDataUrl(smaller)) {
          previewImageDataUrl = smaller;
        }
      }
    } catch {
      previewImageDataUrl = null;
    }
  }

  const payload: SharedReportPayload = {
    report: {
      ...report,
      sourceUrl: undefined,
    },
    aiThreshold,
    previewImageDataUrl,
    sharedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch('/api/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      if (typeof data.id === 'string' && SAFE_SHARE_ID_REGEX.test(data.id)) {
        return {
          url: `${getBaseAppUrl()}?share=${encodeURIComponent(data.id)}`,
          mode: 'public_url',
          includesImage: Boolean(previewImageDataUrl),
          shareId: data.id,
        };
      }
    }
  } catch {
    // Fall back to self-contained stateless deep-link below
  }

  return {
    url: buildStatelessDeepLink(report, aiThreshold),
    mode: 'deep_link',
    includesImage: false,
  };
}

export async function resolveSharedReportFromUrl(): Promise<{
  result: ResolvedShareResult | null;
  error: string | null;
}> {
  if (typeof window === 'undefined') {
    return { result: null, error: null };
  }

  const params = new URLSearchParams(window.location.search);
  const shareId = params.get('share')?.trim();

  if (shareId) {
    if (!SAFE_SHARE_ID_REGEX.test(shareId)) {
      return { result: null, error: 'This shared report link is invalid or malformed.' };
    }
    try {
      const res = await fetch(`/api/shares/${encodeURIComponent(shareId)}`);
      if (!res.ok) {
        return {
          result: null,
          error:
            res.status === 404
              ? 'This shared report link has expired or could not be found.'
              : 'Could not load the shared forensic report.',
        };
      }
      const raw = (await res.json()) as unknown;
      const sanitized = sanitizeSharedPayload(raw);
      if (!sanitized) {
        return { result: null, error: 'Shared report data could not be validated.' };
      }
      return {
        result: { ...sanitized, mode: 'public_url' },
        error: null,
      };
    } catch {
      return { result: null, error: 'Network error while retrieving the shared forensic report.' };
    }
  }

  const hash = window.location.hash;
  if (hash.startsWith('#report=')) {
    const encoded = hash.slice('#report='.length).trim();
    if (!encoded || encoded.length > 24_000) {
      return { result: null, error: 'This shared deep-link is invalid or exceeds size limits.' };
    }
    try {
      const decoded = decodeBase64Url(encoded);
      const parsed = JSON.parse(decoded) as unknown;
      const sanitized = sanitizeSharedPayload(parsed);
      if (!sanitized) {
        return { result: null, error: 'Shared deep-link data could not be validated.' };
      }
      return {
        result: { ...sanitized, mode: 'deep_link' },
        error: null,
      };
    } catch {
      return { result: null, error: 'Could not decode this shared report deep-link.' };
    }
  }

  return { result: null, error: null };
}

export function clearShareUrlFromAddressBar(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let changed = false;
  if (url.searchParams.has('share')) {
    url.searchParams.delete('share');
    changed = true;
  }
  if (url.hash.startsWith('#report=')) {
    url.hash = '';
    changed = true;
  }
  if (changed) {
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }
}
