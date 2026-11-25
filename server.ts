import 'dotenv/config';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES * 1.4);
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const SHARES_DIR = path.resolve(os.tmpdir(), 'veritas-lens-shares');
const MAX_SHARED_REPORTS = 200;
const MAX_SHARE_PREVIEW_LEN = 650_000;
const SAFE_SHARE_ID_REGEX = /^[A-Za-z0-9_-]{10,24}$/;
const SAFE_PREVIEW_DATA_URL_REGEX = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const shareMemoryCache = new Map<string, Record<string, unknown>>();
const shareRateMap = new Map<string, { count: number; resetAt: number }>();

function checkShareRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxPerWindow = 30;
  const entry = shareRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    shareRateMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxPerWindow) return false;
  entry.count += 1;
  return true;
}

function clampServerInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampServerFloat(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function safeServerStr(val: unknown, maxLen: number, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  return val.trim().slice(0, maxLen) || fallback;
}

function sanitizeSharedReportBody(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) return null;
  const obj = body as Record<string, unknown>;
  if (typeof obj.report !== 'object' || obj.report === null) return null;
  const rawReport = obj.report as Record<string, unknown>;

  const core = sanitizeAnalysisPayload(rawReport);
  const aiThreshold = clampServerInt(obj.aiThreshold, 30, 90, 65);

  const rawMeta = (
    typeof rawReport.metadata === 'object' && rawReport.metadata !== null ? rawReport.metadata : {}
  ) as Record<string, unknown>;
  const rawFields = Array.isArray(rawMeta.fields) ? rawMeta.fields.slice(0, 30) : [];
  const fields = rawFields.map((item) => {
    const f = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const group =
      f.group === 'file' ||
      f.group === 'camera' ||
      f.group === 'software' ||
      f.group === 'ai_markers'
        ? f.group
        : 'file';
    return {
      label: safeServerStr(f.label, 60, 'Field'),
      value: safeServerStr(f.value, 220, '—'),
      group,
      flagged: Boolean(f.flagged),
    };
  });

  const rawProvenance = Array.isArray(rawMeta.provenance)
    ? rawMeta.provenance.slice(0, 20)
    : undefined;
  const provenance = rawProvenance
    ? rawProvenance.map((item, idx) => {
        const p = (typeof item === 'object' && item !== null ? item : {}) as Record<
          string,
          unknown
        >;
        const kind =
          p.kind === 'capture' ||
          p.kind === 'digitized' ||
          p.kind === 'edit' ||
          p.kind === 'software_signature' ||
          p.kind === 'export' ||
          p.kind === 'ai_signature'
            ? p.kind
            : 'software_signature';
        return {
          id: safeServerStr(p.id, 40, `prov-${idx + 1}`),
          kind,
          signature: safeServerStr(p.signature, 120, 'Recorded signature'),
          action: safeServerStr(p.action, 120, 'Metadata entry recorded'),
          timestamp: typeof p.timestamp === 'string' ? safeServerStr(p.timestamp, 48) : undefined,
          sourceTag: safeServerStr(p.sourceTag, 64, 'EXIF / XMP'),
          details: typeof p.details === 'string' ? safeServerStr(p.details, 200) : undefined,
          flagged: Boolean(p.flagged),
        };
      })
    : undefined;

  const metadata = {
    fileName: safeServerStr(rawMeta.fileName, 120, 'shared-image.jpg'),
    mimeType: safeServerStr(rawMeta.mimeType, 40, 'image/jpeg'),
    fileSize: clampServerInt(rawMeta.fileSize, 0, 100_000_000, 0),
    width: clampServerInt(rawMeta.width, 0, 50_000, 0),
    height: clampServerInt(rawMeta.height, 0, 50_000, 0),
    aspectRatio: safeServerStr(rawMeta.aspectRatio, 24, '—'),
    hasExif: Boolean(rawMeta.hasExif),
    cameraMake: typeof rawMeta.cameraMake === 'string' ? safeServerStr(rawMeta.cameraMake, 80) : undefined,
    cameraModel: typeof rawMeta.cameraModel === 'string' ? safeServerStr(rawMeta.cameraModel, 80) : undefined,
    lensModel: typeof rawMeta.lensModel === 'string' ? safeServerStr(rawMeta.lensModel, 100) : undefined,
    software: typeof rawMeta.software === 'string' ? safeServerStr(rawMeta.software, 100) : undefined,
    dateTimeOriginal:
      typeof rawMeta.dateTimeOriginal === 'string'
        ? safeServerStr(rawMeta.dateTimeOriginal, 64)
        : undefined,
    exposureSummary:
      typeof rawMeta.exposureSummary === 'string'
        ? safeServerStr(rawMeta.exposureSummary, 100)
        : undefined,
    aiMarkerDetected: Boolean(rawMeta.aiMarkerDetected),
    aiMarkerDetails:
      typeof rawMeta.aiMarkerDetails === 'string'
        ? safeServerStr(rawMeta.aiMarkerDetails, 240)
        : undefined,
    fields,
    provenance,
  };

  let elaStats: Record<string, unknown> | null = null;
  if (typeof rawReport.elaStats === 'object' && rawReport.elaStats !== null) {
    const e = rawReport.elaStats as Record<string, unknown>;
    elaStats = {
      quality: clampServerInt(e.quality, 50, 98, 90),
      scale: clampServerInt(e.scale, 1, 50, 15),
      meanError: clampServerFloat(e.meanError, 0, 255, 0),
      maxError: clampServerFloat(e.maxError, 0, 255, 0),
      highVarianceRatio: clampServerFloat(e.highVarianceRatio, 0, 100, 0),
      uniformityAssessment: safeServerStr(e.uniformityAssessment, 200, 'Compression profile recorded.'),
    };
  }

  const sourceType =
    rawReport.sourceType === 'upload' ||
    rawReport.sourceType === 'url' ||
    rawReport.sourceType === 'sample' ||
    rawReport.sourceType === 'paste' ||
    rawReport.sourceType === 'camera'
      ? rawReport.sourceType
      : 'upload';

  let previewImageDataUrl: string | null = null;
  if (
    typeof obj.previewImageDataUrl === 'string' &&
    obj.previewImageDataUrl.length > 32 &&
    obj.previewImageDataUrl.length <= MAX_SHARE_PREVIEW_LEN &&
    SAFE_PREVIEW_DATA_URL_REGEX.test(obj.previewImageDataUrl)
  ) {
    previewImageDataUrl = obj.previewImageDataUrl;
  }

  const createdAt = safeServerStr(rawReport.createdAt, 40, new Date().toISOString());

  return {
    report: {
      ...core,
      id: safeServerStr(rawReport.id, 64, `scan-${Date.now()}`),
      createdAt,
      sourceType,
      metadata,
      elaStats,
    },
    aiThreshold,
    previewImageDataUrl,
    sharedAt: new Date().toISOString(),
  };
}

function resolveConfinedSharePath(id: string): string | null {
  if (!SAFE_SHARE_ID_REGEX.test(id)) return null;
  const resolved = path.resolve(SHARES_DIR, `${id}.json`);
  if (!resolved.startsWith(SHARES_DIR + path.sep)) return null;
  return resolved;
}

async function persistSharedReport(id: string, record: Record<string, unknown>): Promise<void> {
  shareMemoryCache.set(id, record);
  while (shareMemoryCache.size > MAX_SHARED_REPORTS) {
    const oldestKey = shareMemoryCache.keys().next().value;
    if (!oldestKey) break;
    shareMemoryCache.delete(oldestKey);
    const oldPath = resolveConfinedSharePath(oldestKey);
    if (oldPath) {
      await fs.unlink(oldPath).catch(() => undefined);
    }
  }

  const targetPath = resolveConfinedSharePath(id);
  if (!targetPath) return;
  await fs.mkdir(SHARES_DIR, { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(record), 'utf8');
}

async function loadSharedReport(id: string): Promise<Record<string, unknown> | null> {
  const cached = shareMemoryCache.get(id);
  if (cached) return cached;

  const targetPath = resolveConfinedSharePath(id);
  if (!targetPath) return null;
  try {
    const raw = await fs.readFile(targetPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    shareMemoryCache.set(id, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(
      new Error('Server API key is not configured. Please check Settings > Secrets.'),
      { statusCode: 500 }
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();
  if (net.isIPv4(normalized)) {
    return isPrivateIpv4(normalized);
  }
  if (net.isIPv6(normalized)) {
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA fc00::/7
    if (
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    ) {
      return true; // link-local fe80::/10
    }
    if (normalized.startsWith('ff')) return true; // multicast
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice(7);
      if (net.isIPv4(mapped)) {
        return isPrivateIpv4(mapped);
      }
      return true;
    }
    return false;
  }
  return true;
}

async function assertSafeRemoteUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('Please provide a valid http or https image URL.'), {
      statusCode: 400,
    });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Only http:// and https:// image URLs are supported.'), {
      statusCode: 400,
    });
  }

  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('Image URLs with embedded credentials are not allowed.'), {
      statusCode: 400,
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw Object.assign(new Error('This host is not permitted for remote image import.'), {
      statusCode: 400,
    });
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw Object.assign(new Error('Private or reserved IP addresses are not permitted.'), {
        statusCode: 400,
      });
    }
    return parsed;
  }

  let resolved: { address: string }[];
  try {
    resolved = await dns.lookup(host, { all: true });
  } catch {
    throw Object.assign(new Error('Could not resolve the image URL hostname.'), {
      statusCode: 400,
    });
  }

  if (!resolved.length || resolved.some((entry) => isPrivateOrReservedIp(entry.address))) {
    throw Object.assign(new Error('The target URL resolves to a restricted network address.'), {
      statusCode: 400,
    });
  }

  return parsed;
}

async function fetchImageSafely(rawUrl: string): Promise<{
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}> {
  let currentUrl = await assertSafeRemoteUrl(rawUrl);

  for (let redirects = 0; redirects <= 2; redirects++) {
    const response = await fetch(currentUrl.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: 'image/jpeg,image/png,image/webp,image/gif,*/*;q=0.5',
        'User-Agent': 'VeritasLensImageFetcher/1.0',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects === 2) {
        throw Object.assign(new Error('Too many redirects while fetching the remote image.'), {
          statusCode: 400,
        });
      }
      const nextRaw = new URL(location, currentUrl).toString();
      currentUrl = await assertSafeRemoteUrl(nextRaw);
      continue;
    }

    if (!response.ok) {
      throw Object.assign(
        new Error(`Remote server returned HTTP ${response.status} while fetching the image.`),
        { statusCode: 400 }
      );
    }

    const contentTypeHeader = response.headers.get('content-type') || '';
    const mimeType = contentTypeHeader.split(';')[0].trim().toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw Object.assign(
        new Error(
          `URL did not return a supported image format (received "${mimeType || 'unknown'}"). Use JPEG, PNG, WebP, or GIF.`
        ),
        { statusCode: 400 }
      );
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) {
      throw Object.assign(new Error('Remote image exceeds the 10 MB size limit.'), {
        statusCode: 413,
      });
    }

    if (!response.body) {
      throw Object.assign(new Error('Remote image response was empty.'), { statusCode: 400 });
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw Object.assign(new Error('Remote image exceeds the 10 MB size limit.'), {
            statusCode: 413,
          });
        }
        chunks.push(value);
      }
    }

    const buffer = Buffer.concat(chunks);
    const pathname = currentUrl.pathname.split('/').filter(Boolean).pop() || 'remote-image';
    const safeName = pathname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'remote-image';
    const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1];
    const fileName = safeName.includes('.') ? safeName : `${safeName}.${ext}`;

    return { buffer, mimeType, fileName };
  }

  throw Object.assign(new Error('Unable to fetch remote image.'), { statusCode: 400 });
}

const FORENSIC_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verdict: {
      type: Type.STRING,
      description: 'Overall authenticity classification: "likely_ai", "inconclusive", or "likely_real".',
    },
    aiProbability: {
      type: Type.INTEGER,
      description: 'Calibrated integer from 0 (definitely real photograph) to 100 (definitely AI-generated / synthetic).',
    },
    confidence: {
      type: Type.STRING,
      description: 'Analyst confidence level: "high", "medium", or "low".',
    },
    headline: {
      type: Type.STRING,
      description: 'Concise 1-sentence forensic conclusion in plain, objective English.',
    },
    summary: {
      type: Type.STRING,
      description: '2-3 sentence technical synthesis weighing both visual cues and metadata context.',
    },
    suspectedSource: {
      type: Type.STRING,
      description: 'Brief classification such as "Natural Optical Capture", "Modern Diffusion Model", "3D / CGI Rendering", "AI-Edited Photograph", or "Undetermined".',
    },
    signals: {
      type: Type.ARRAY,
      description: 'Exactly 6 forensic inspection dimensions.',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          name: { type: Type.STRING },
          status: {
            type: Type.STRING,
            description: '"authentic", "caution", or "synthetic"',
          },
          score: {
            type: Type.INTEGER,
            description: '0-100 synthetic likelihood score for this specific dimension.',
          },
          observation: {
            type: Type.STRING,
            description: 'Specific 1-2 sentence visual observation grounded strictly in what is visible in the image.',
          },
        },
        required: ['id', 'name', 'status', 'score', 'observation'],
      },
    },
    regions: {
      type: Type.ARRAY,
      description: '2 to 5 localized bounding-box regions illustrating the strongest synthetic artifacts or authentic photographic evidence.',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING },
          category: {
            type: Type.STRING,
            description: '"artifact", "authentic_cue", or "anomaly"',
          },
          severity: {
            type: Type.STRING,
            description: '"high", "medium", or "low"',
          },
          explanation: { type: Type.STRING },
          box_2d: {
            type: Type.ARRAY,
            description: '[ymin, xmin, ymax, xmax] normalized integer coordinates in range 0..1000.',
            items: { type: Type.INTEGER },
          },
        },
        required: ['id', 'label', 'category', 'severity', 'explanation', 'box_2d'],
      },
    },
  },
  required: [
    'verdict',
    'aiProbability',
    'confidence',
    'headline',
    'summary',
    'suspectedSource',
    'signals',
    'regions',
  ],
};

const FORENSIC_SYSTEM_INSTRUCTION = `You are a principal digital image forensic analyst specializing in distinguishing authentic camera photographs from modern AI-generated images (Flux, Midjourney, Imagen, DALL-E, Stable Diffusion) and 3D/CGI renders.

Evaluate the image objectively with strict scientific discipline. Do NOT default to calling polished photos AI, and do NOT assume a photorealistic image is real without verifying fine physical and geometric details.

Perform a systematic multi-domain inspection across these 6 forensic channels:
1. Lighting & Shadow Physics ("lighting") — Light source directionality, tire/object ambient-occlusion contact shadows on ground surfaces, specular reflections, caustics, and multi-source shadow coherence.
2. Anatomy, Text & Geometry ("anatomy_geometry") — Human hands/fingers/eyes/teeth/ears, architectural straight lines, readable signage/typography, and mechanical/vehicular structural logic (see Vehicle Protocol below).
3. Surface Texture & Micro-Detail ("texture") — Authentic optical sensor/film micro-grain, subtle paint orange-peel/imperfections, fabric weave, skin pores, and foliage randomness vs. hyper-smooth liquid-plastic diffusion surfaces, painterly smears, or repeating synthetic micro-patterns.
4. Background & Spatial Coherence ("background") — Continuity of horizons/fences/curbs behind foreground objects, reflections in glass/paint/mirrors matching actual surroundings, perspective vanishing points, and coherence of distant vehicles, pedestrians, and street signs.
5. Optical & Lens Characteristics ("optics") — Physically progressive depth-of-field gradient, realistic lens flare/chromatic aberration, natural specular bokeh shapes, and genuine motion blur vs. uniform synthetic blur or inconsistent focal planes.
6. Noise, Grain & Compression ("noise_compression") — Luminance/chroma sensor noise continuity across shadows and highlights, absence of synthetic edge halos, quantitative ELA compression cues, and EXIF/XMP/C2PA provenance evidence when provided.

CRITICAL VEHICLE & AUTOMOTIVE FORENSIC PROTOCOL (apply rigorously whenever cars, motorcycles, trucks, or machinery appear):
- Emblems, Badges & Typography: Inspect hood, grille, fender, trunk, and wheel center-cap logos, brake caliper branding, tire sidewall molded lettering/numbers, and license plate fonts/kerning/stamps. Authentic camera captures preserve real manufacturer emblems and consistent lettering (or exhibit natural optical defocus/motion blur); AI generators frequently distort logos into uncanny pseudo-emblems, melt license plate characters into pseudo-glyphs, or smear molded tire text unevenly.
- Wheels, Spokes, Lug Nuts & Brakes: Count wheel spokes for exact rotational symmetry; verify lug-nut count and concentric spacing (typically 5 evenly spaced); verify brake rotors and calipers sit physically behind spokes; verify front and rear wheel rims match in design. AI car renders often show irregular spoke spacing, mismatched lug-nut counts, warped brake calipers, or subtly different front vs. rear wheel designs.
- Body Panel Gaps, Trim & Headlight Internals: Trace hood, fender, door, and bumper shutlines for crisp, engineered seams (AI often blurs, fades, or randomly terminates panel seams). Inspect headlight internal projectors/DRL emitters, grille mesh cell uniformity, windshield wipers, cowl vents, door handles, and side-mirror mounts for true mechanical symmetry vs. melted greebles.
- Paint Clearcoat Reflections & Cabin Glass: Verify curved clearcoat reflections accurately mirror actual sky, trees, buildings, poles, road lines, or studio softboxes without surreal liquid warping. Inspect visible cabin interiors through glass (steering wheel, seats, headrests, pillars, mirrors) for physically coherent placement.
- Tire-to-Ground Contact: Verify realistic dark contact shadows where rubber meets pavement, natural tire sidewall compression, and physically believable wheel-well suspension geometry.

ANTI-FALSE-POSITIVE CALIBRATION (Real Commercial, Editorial & Edited Photography):
- Real automotive and commercial photography (shot on DSLR/mirrorless cameras with circular polarizing CPL filters, rolling-shot camera rigs, studio strobes, or Lightroom/Photoshop grading) routinely has spotless paint, dramatic sunset/studio lighting, deep reflections, shallow bokeh, and NO EXIF metadata (social media platforms, messaging apps, and websites strip EXIF automatically).
- NEVER classify an image as "likely_ai" (aiProbability >= 65) solely because it looks glossy, cinematic, dramatically lit, color-graded, or lacks EXIF metadata.
- To score aiProbability >= 65 ("likely_ai"), cite concrete, observable visual impossibilities or synthetic artifacts (such as warped emblems/badges, garbled text/license plates, asymmetric spokes/lug nuts, melted grille/headlight internals, broken panel seams, contradictory reflections, anatomical errors, or explicit AI generator container markers).
- Conversely, NEVER score an image "likely_real" (aiProbability <= 35) on overall vibe alone — actively verify fine micro-details (badges, wheels, lettering, reflections, seams, background text/objects) first.
- If an image is heavily compressed, low-resolution, or heavily post-processed with mixed cues and no decisive physical impossibility, calibrate honestly into the "inconclusive" band (36..64) with "low" or "medium" confidence.

Output Rules:
- Return strictly valid JSON conforming to the provided schema.
- Provide exactly 6 signals using IDs: "lighting", "anatomy_geometry", "texture", "background", "optics", "noise_compression".
- Calibrate aiProbability (0..100) consistently with your signal scores and evidence: >= 65 => "likely_ai", 36..64 => "inconclusive", <= 35 => "likely_real".
- Provide 2 to 5 precise bounding boxes in box_2d [ymin, xmin, ymax, xmax] (0..1000) highlighting concrete visible evidence (e.g., wheel lug nuts/spokes, front grille emblem, license plate typography, clearcoat reflection seam, headlight optics, hand grip, or natural sensor grain).
- Keep prose concise, neutral, technical, and strictly grounded in details visible in the image.`;

function extractErrorStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null) {
    if ('status' in err && Number((err as { status?: unknown }).status) > 0) {
      return Number((err as { status?: unknown }).status);
    }
    if ('statusCode' in err && Number((err as { statusCode?: unknown }).statusCode) > 0) {
      return Number((err as { statusCode?: unknown }).statusCode);
    }
  }
  if (err instanceof Error) {
    const match = err.message.match(/"code"\s*:\s*(\d{3})|\b(429|500|502|503|504)\b/);
    if (match) {
      return Number(match[1] || match[2]);
    }
  }
  return 0;
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const status = extractErrorStatus(err);
      const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!retryable || attempt === maxRetries) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 350);
      const delayMs = 900 * Math.pow(2, attempt) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function sanitizeAnalysisPayload(raw: Record<string, unknown>) {
  const rawProb = typeof raw.aiProbability === 'number' ? raw.aiProbability : 50;
  const aiProbability = Math.max(0, Math.min(100, Math.round(rawProb)));

  const verdict: 'likely_ai' | 'inconclusive' | 'likely_real' =
    aiProbability >= 65 ? 'likely_ai' : aiProbability <= 35 ? 'likely_real' : 'inconclusive';

  const confidence: 'high' | 'medium' | 'low' =
    raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
      ? raw.confidence
      : 'medium';

  const rawSignals = Array.isArray(raw.signals) ? raw.signals : [];
  const signals = rawSignals.slice(0, 6).map((item, idx) => {
    const s = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const score = Math.max(0, Math.min(100, Math.round(Number(s.score) || 50)));
    const status: 'authentic' | 'caution' | 'synthetic' =
      score >= 65 ? 'synthetic' : score <= 35 ? 'authentic' : 'caution';
    return {
      id: typeof s.id === 'string' && s.id ? s.id : `signal-${idx + 1}`,
      name: typeof s.name === 'string' && s.name ? s.name : `Forensic Signal ${idx + 1}`,
      status,
      score,
      observation:
        typeof s.observation === 'string' && s.observation
          ? s.observation
          : 'No anomaly details recorded for this channel.',
    };
  });

  const rawRegions = Array.isArray(raw.regions) ? raw.regions : [];
  const regions = rawRegions
    .slice(0, 6)
    .map((item, idx) => {
      const r = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      const box = Array.isArray(r.box_2d) ? r.box_2d.map((v) => Number(v)) : [];
      if (box.length !== 4 || box.some((v) => Number.isNaN(v))) {
        return null;
      }
      const ymin = Math.max(0, Math.min(990, Math.round(box[0])));
      const xmin = Math.max(0, Math.min(990, Math.round(box[1])));
      const ymax = Math.max(ymin + 10, Math.min(1000, Math.round(box[2])));
      const xmax = Math.max(xmin + 10, Math.min(1000, Math.round(box[3])));
      const category =
        r.category === 'artifact' || r.category === 'authentic_cue' || r.category === 'anomaly'
          ? r.category
          : 'anomaly';
      const severity =
        r.severity === 'high' || r.severity === 'medium' || r.severity === 'low'
          ? r.severity
          : 'medium';

      return {
        id: typeof r.id === 'string' && r.id ? r.id : `region-${idx + 1}`,
        label: typeof r.label === 'string' && r.label ? r.label : `Region ${idx + 1}`,
        category,
        severity,
        explanation:
          typeof r.explanation === 'string' && r.explanation
            ? r.explanation
            : 'Localized visual feature flagged during forensic scan.',
        box_2d: [ymin, xmin, ymax, xmax] as [number, number, number, number],
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    verdict,
    aiProbability,
    confidence,
    headline:
      typeof raw.headline === 'string' && raw.headline
        ? raw.headline
        : 'Forensic image evaluation complete.',
    summary:
      typeof raw.summary === 'string' && raw.summary
        ? raw.summary
        : 'Combined visual inspection and container metadata analysis completed.',
    suspectedSource:
      typeof raw.suspectedSource === 'string' && raw.suspectedSource
        ? raw.suspectedSource
        : 'Undetermined',
    signals,
    regions,
  };
}

function buildApiApp() {
  const expressApp = express();
  expressApp.use(express.json({ limit: '16mb' }));

  const apiRouter = express.Router();

  apiRouter.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    });
  });

  apiRouter.post('/shares', async (req: Request, res: Response) => {
    try {
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      if (!checkShareRateLimit(clientIp)) {
        res.status(429).json({
          error: 'Too many share links created recently. Please wait a few minutes and try again.',
        });
        return;
      }

      const sanitized = sanitizeSharedReportBody(req.body);
      if (!sanitized) {
        res.status(400).json({ error: 'Invalid forensic report payload.' });
        return;
      }

      const id = crypto.randomBytes(12).toString('base64url');
      await persistSharedReport(id, sanitized);
      res.status(201).json({ id, sharedAt: sanitized.sharedAt });
    } catch {
      res.status(500).json({ error: 'Unable to create shareable report link.' });
    }
  });

  apiRouter.get('/shares/:id', async (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    if (!SAFE_SHARE_ID_REGEX.test(id)) {
      res.status(400).json({ error: 'Invalid share report identifier.' });
      return;
    }

    const record = await loadSharedReport(id);
    if (!record) {
      res.status(404).json({ error: 'Shared report not found or has expired.' });
      return;
    }

    res.json(record);
  });

  apiRouter.post('/fetch-image', async (req: Request, res: Response) => {
    try {
      const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      if (!rawUrl || rawUrl.length > 2048) {
        res.status(400).json({ error: 'Please enter a valid image URL.' });
        return;
      }

      const { buffer, mimeType, fileName } = await fetchImageSafely(rawUrl);
      const base64 = buffer.toString('base64');
      res.json({
        dataUrl: `data:${mimeType};base64,${base64}`,
        mimeType,
        byteSize: buffer.byteLength,
        fileName,
      });
    } catch (err: unknown) {
      const statusCode =
        typeof err === 'object' && err !== null && 'statusCode' in err
          ? Number((err as { statusCode?: number }).statusCode) || 400
          : 500;
      const message =
        err instanceof Error ? err.message : 'Unable to fetch the remote image URL.';
      res.status(statusCode).json({ error: message });
    }
  });

  apiRouter.post('/analyze', async (req: Request, res: Response) => {
    try {
      const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64.trim() : '';
      const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType.trim().toLowerCase() : '';
      const metadataContext =
        typeof req.body?.metadataContext === 'string'
          ? req.body.metadataContext.slice(0, 3000)
          : '';

      if (!imageBase64 || imageBase64.length > MAX_BASE64_LENGTH) {
        res.status(400).json({
          error: 'Image data is missing or exceeds the 10 MB analysis limit.',
        });
        return;
      }

      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        res.status(400).json({
          error: 'Unsupported image format. Please use JPEG, PNG, WebP, or GIF.',
        });
        return;
      }

      const promptParts = [
        'Perform a deep digital forensic authenticity examination of this image to determine whether it is AI-generated/CGI or an authentic camera photograph.',
        'Inspect micro-level physical evidence carefully: if a vehicle/car is present, explicitly examine manufacturer emblems/badges, license plate typography, wheel spoke symmetry and lug-nut counts, brake rotors/calipers, tire sidewall lettering, body panel shutlines, headlight internals, paint clearcoat reflections, and cabin interior through glass. Distinguish genuine commercial/CPL-filtered/edited photography from diffusion synthesis by requiring concrete physical, typographic, or geometric impossibilities before flagging Likely AI.',
        metadataContext
          ? `Client-side container, EXIF & ELA inspection summary:\n${metadataContext}`
          : 'No camera EXIF metadata was present in the file container (remember: social platforms and websites routinely strip EXIF from real photos).',
        'Return the complete structured JSON forensic report with all 6 signals and 2-5 localized bounding boxes grounded in concrete visible features.',
      ].join('\n\n');

      const startedAt = Date.now();
      console.log(`[api/analyze] start mime=${mimeType} base64Len=${imageBase64.length}`);

      let rawText = '';
      let lastModelErr: unknown = null;
      let usedModel = '';

      const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
      const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());

      if (!hasGeminiKey && !hasOpenRouterKey) {
        res.status(503).json({
          error:
            'No vision API key is configured on the server. Add GEMINI_API_KEY (or OPENROUTER_API_KEY) to your server environment variables and redeploy.',
        });
        return;
      }

      if (hasGeminiKey) {
        const ai = getGeminiClient();
        const candidateModels: {
          name: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite' | 'gemini-2.5-flash';
          thinkingLevel?: ThinkingLevel;
          retries: number;
        }[] = [
          { name: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.HIGH, retries: 2 },
          { name: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MEDIUM, retries: 1 },
          { name: 'gemini-2.5-flash', retries: 2 },
        ];

        for (let idx = 0; idx < candidateModels.length; idx++) {
          const candidate = candidateModels[idx];
          const hasNextCandidate = idx < candidateModels.length - 1 || hasOpenRouterKey;
          try {
            usedModel = candidate.name;
            const response = await callWithRetry(
              () =>
                ai.models.generateContent({
                  model: candidate.name,
                  contents: {
                    parts: [
                      {
                        inlineData: {
                          mimeType,
                          data: imageBase64,
                        },
                      },
                      {
                        text: promptParts,
                      },
                    ],
                  },
                  config: {
                    systemInstruction: FORENSIC_SYSTEM_INSTRUCTION,
                    responseMimeType: 'application/json',
                    responseSchema: FORENSIC_RESPONSE_SCHEMA,
                    ...(candidate.thinkingLevel
                      ? { thinkingConfig: { thinkingLevel: candidate.thinkingLevel } }
                      : {}),
                  },
                }),
              candidate.retries
            );
            rawText = (response.text ?? '').trim();
            if (rawText) break;
          } catch (modelErr: unknown) {
            lastModelErr = modelErr;
            const errStatus = extractErrorStatus(modelErr);
            console.info(
              `[api/analyze] fallback from ${candidate.name} after status=${errStatus || 'unknown'}`
            );
            if (
              hasNextCandidate &&
              (errStatus === 400 ||
                errStatus === 404 ||
                errStatus === 429 ||
                errStatus === 500 ||
                errStatus === 502 ||
                errStatus === 503 ||
                errStatus === 504)
            ) {
              continue;
            }
            throw modelErr;
          }
        }
      }

      // Optional server-side OpenRouter fallback if configured in Settings > Secrets
      if (!rawText && process.env.OPENROUTER_API_KEY?.trim()) {
        usedModel = 'openrouter:google/gemini-2.5-flash';
        const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY.trim()}`,
            'Content-Type': 'application/json',
            'X-Title': 'Veritas Lens',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: FORENSIC_SYSTEM_INSTRUCTION },
              {
                role: 'user',
                content: [
                  { type: 'text', text: promptParts },
                  {
                    type: 'image_url',
                    image_url: { url: `data:${mimeType};base64,${imageBase64}` },
                  },
                ],
              },
            ],
          }),
        });
        if (!orRes.ok) {
          throw Object.assign(
            new Error(`Fallback vision provider returned HTTP ${orRes.status}.`),
            { statusCode: orRes.status }
          );
        }
        const orJson = (await orRes.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        rawText = (orJson.choices?.[0]?.message?.content ?? '').trim();
      }

      if (!rawText) {
        if (lastModelErr) throw lastModelErr;
        res.status(502).json({
          error: 'The vision analyzer returned an empty response. Please try again.',
        });
        return;
      }

      console.log(`[api/analyze] model=${usedModel} finished in ${Date.now() - startedAt}ms`);

      let parsed: Record<string, unknown>;
      try {
        const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        parsed = JSON.parse(cleaned) as Record<string, unknown>;
      } catch {
        res.status(502).json({
          error: 'The forensic report could not be parsed cleanly. Please retry the scan.',
        });
        return;
      }

      res.json(sanitizeAnalysisPayload(parsed));
    } catch (err: unknown) {
      const status = extractErrorStatus(err) || 500;
      console.error(`[api/analyze] failed status=${status}`);

      if (status === 403 || status === 400) {
        res.status(status).json({
          error:
            err instanceof Error
              ? err.message
              : 'Request rejected by the vision API. Check Settings > Secrets if the API key needs verification.',
        });
        return;
      }

      if (status === 429) {
        res.status(429).json({
          error:
            'Analysis rate limit reached. Please wait a moment and try again, or check your quota in Settings > Secrets.',
        });
        return;
      }

      if (status === 503 || status === 502 || status === 504) {
        res.status(503).json({
          error:
            'The vision analysis service is temporarily busy. Please wait a few seconds and click Retry.',
        });
        return;
      }

      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred during forensic analysis.',
      });
    }
  });

  expressApp.use('/api', apiRouter);
  if (process.env.VERCEL) {
    expressApp.use('/', apiRouter);
  }

  return expressApp;
}

export const app = buildApiApp();

async function startStandaloneServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Veritas Lens server listening on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startStandaloneServer().catch((err) => {
    console.error('Failed to start Veritas Lens server:', err);
    process.exit(1);
  });
}

export default app;
