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
    authenticEvidence: {
      type: Type.ARRAY,
      description:
        '2 to 4 concrete visual or physical observations supporting that this could be a REAL camera/smartphone photograph (e.g., coherent real-world clutter, legible brand/sign text, natural everyday candid lighting, consistent mechanical/clothing details, real smartphone HDR/bokeh/JPEG compression).',
      items: { type: Type.STRING },
    },
    syntheticEvidence: {
      type: Type.ARRAY,
      description:
        '0 to 4 concrete, specific generative AI artifacts visible in the image (e.g., garbled text/emblems, broken spoke/lug-nut symmetry, impossible jewelry/eyeglass merging, paradoxical razor-sharp edges paired with waxy diffusion skin, nonsensical melted background objects). Leave empty if no genuine AI artifacts exist.',
      items: { type: Type.STRING },
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
    aiProbability: {
      type: Type.INTEGER,
      description:
        'Calibrated integer from 0 (definitely real camera photograph) to 100 (definitely AI-generated / CGI), weighed neutrally after comparing authenticEvidence against syntheticEvidence.',
    },
    verdict: {
      type: Type.STRING,
      description: 'Overall authenticity classification: "likely_ai", "inconclusive", or "likely_real".',
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
      description: 'Brief classification such as "Natural Optical Capture", "Smartphone Computational Photo", "Modern Diffusion Model", "3D / CGI Rendering", "AI-Edited Photograph", or "Undetermined".',
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
  propertyOrdering: [
    'authenticEvidence',
    'syntheticEvidence',
    'signals',
    'aiProbability',
    'verdict',
    'confidence',
    'headline',
    'summary',
    'suspectedSource',
    'regions',
  ],
  required: [
    'authenticEvidence',
    'syntheticEvidence',
    'signals',
    'aiProbability',
    'verdict',
    'confidence',
    'headline',
    'summary',
    'suspectedSource',
    'regions',
  ],
};

const FORENSIC_SYSTEM_INSTRUCTION = `You are a neutral, highly calibrated digital image forensic analyst. Your job is to accurately separate REAL camera/smartphone photographs from AI-generated (diffusion/GAN) images and 3D/CGI renders with BOTH low false positives (never falsely flagging real photos as AI) AND low false negatives (catching modern photorealistic AI images).

STEP 1 — MANDATORY NEUTRAL BASELINE & REAL-WORLD PHOTOGRAPHY AWARENESS:
Most everyday images uploaded by users are REAL smartphone or DSLR photos shared via WhatsApp, Instagram, X, Facebook, or screenshots. Before suspecting AI, remember what is 100% NORMAL in real photographs and MUST NEVER be counted as AI evidence:
- Missing EXIF metadata (social media, messaging apps, web downloads, and screenshots ALWAYS strip EXIF from real photos).
- Smartphone computational photography: iPhone/Pixel/Samsung/Xiaomi Portrait Mode cutout bokeh around hair/shoulders, multi-frame night denoising (smooth skin/walls/sky), HDR tone-mapping, and built-in smartphone beauty/skin-smoothing filters.
- Social-media JPEG recompression: soft micro-detail, low noise residual, slightly mushy distant foliage or small distant text.
- Professional DSLR / editorial photography: clean studio lighting, CPL polarizing filters on glossy cars, Lightroom/Photoshop color grading, shallow f/1.4–f/2.8 lens bokeh.
- Everyday candid realism: slightly awkward or mundane composition, ordinary unglamorous lighting, real-world background clutter, real readable text/logos/brands, authentic clothing wrinkles, natural messy hair, and imperfect human faces/bodies.

STEP 2 — WHAT ACTUALLY SEPARATES TRUE AI GENERATION FROM REAL PHOTOS:
List concrete evidence for BOTH sides (authenticEvidence vs. syntheticEvidence) before scoring. Look closely at Image 1 (full frame) and Image 2 (1:1 micro-detail crop, when provided):

A. Strong Authentic Real-Photo Cues:
- Everyday candid/unposed lighting, natural real-world clutter, messy/unbalanced composition, or genuine camera/lens quirks (motion blur, natural ISO grain, realistic flare).
- Crisp, coherent, real-world readable text, signs, brand logos, manufacturer car emblems, license plates, or product packaging that hold up under close inspection.
- Consistent fine mechanical/clothing structure: matching earrings, continuous jewelry chains, proper buttons/zippers/seams, symmetrical car wheel spokes & lug nuts, coherent brake assemblies, and physically consistent background geometry.
- Natural human authenticity: asymmetrical facial features, authentic uneven skin texture/creases/blemishes/peach fuzz, or normal smartphone JPEG/Portrait-Mode rendering on a genuine real-world scene.
- Verified camera EXIF/provenance tags (strong supporting cue when visual content agrees).

B. Genuine AI-Generation Signatures (distinct from normal phone smoothing or JPEG compression!):
1. Structural, Text & Mechanical Contradictions:
   - In-focus text, signs, logos, car badges, tire sidewall text, or license plates rendered as garbled pseudo-letters/alien symbols (NOT merely out-of-focus or low-res JPEG blur).
   - Physical geometry failures: eyeglasses/jewelry merging into skin, left vs. right earrings having totally different structures, clothing straps/seams/buttons disappearing into nothing, car spokes/lug nuts breaking rotational symmetry, mismatched front/rear wheels, panel gaps fading randomly into paint, background lines shifting angle behind a subject.
   - Impossible reflections or warped anatomy: reflections in mirrors/glasses/car paint depicting an impossible scene, fused teeth, malformed fingers/ears/limbs.
2. Modern Photorealistic Diffusion Signatures (Flux, Midjourney v6+, Imagen, GPT-Image — when NO gross deformity exists):
   - Paradoxical "Hyper-Sharp + Waxy Plasticity": Unlike phone denoising or JPEG blur (which softens the whole photo evenly), AI diffusion portraits often combine razor-sharp hyper-rendered eyelashes/lips/edges with surreal, uniformly glowing airbrushed/waxy skin across face/neck/shoulders, overly luminous jewel-like irises, and ribbon-like glossy hair strands that loop impossibly or dissolve smoothly into background bokeh.
   - Semantic Background Melting: Out-of-focus background objects (buildings, furniture, distant cars, crowds, street signs) morph into nonsensical impossible shapes rather than real optical lens blur.
   - "Prompted Hyper-Perfection" + Localized Micro-Anomalies: Unnaturally idealized symmetrical "AI model" face + hyper-balanced cinematic rim lighting + ultra-glossy uniform aesthetic COMBINED with at least 2 concrete localized micro-anomalies (e.g., mismatched catchlights, fused chain/earring details, impossible hair loops, warped clothing weave, melted background objects, or garbled micro-text).

STEP 3 — CALIBRATED SCORING DISCIPLINE:
Weigh authenticEvidence vs. syntheticEvidence honestly BEFORE setting aiProbability (0..100):
- Score 5..30 ("likely_real"): The scene looks like a genuine camera/smartphone photograph with real-world coherence and ZERO clear generative contradictions — EVEN IF it has no EXIF, smartphone Portrait Mode bokeh, phone beauty smoothing, JPEG compression, or professional studio lighting!
- Score 70..96 ("likely_ai"): Clear structural/text/geometry impossibilities OR explicit AI container markers OR multiple concrete, verifiable diffusion portrait/vehicle signatures (paradoxical hyper-sharp waxy plasticity + localized micro-anomalies in eyes/hair/jewelry/emblems/background) that clearly outweigh authentic cues.
- Score 38..62 ("inconclusive"): Evidence is genuinely split (e.g., heavily FaceTuned/Photoshopped real photo, extreme low-res thumbnail, or ambiguous studio shot with weak/conflicting cues).

Output Rules:
- Fill authenticEvidence and syntheticEvidence objectively first, then the 6 signals, then aiProbability and verdict.
- Provide exactly 6 signals using IDs: "lighting", "anatomy_geometry", "texture", "background", "optics", "noise_compression".
- Ensure aiProbability aligns with the 6 signals and thresholds: >= 65 => "likely_ai", 36..64 => "inconclusive", <= 35 => "likely_real".
- Provide 2 to 5 accurate box_2d [ymin, xmin, ymax, xmax] (0..1000) regions relative to Image 1 pointing to concrete visible evidence.
- Keep prose concise, neutral, and strictly grounded in what is actually visible.`;

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
  let aiProbability = Math.max(0, Math.min(100, Math.round(rawProb)));

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

  const rawAuthentic = Array.isArray(raw.authenticEvidence) ? raw.authenticEvidence.map(String) : [];
  const rawSynthetic = Array.isArray(raw.syntheticEvidence) ? raw.syntheticEvidence.map(String) : [];

  // Reconcile headline probability if it strongly contradicts the 6 channel scores
  if (signals.length >= 4) {
    const avgSignal =
      signals.reduce((acc, s) => acc + s.score, 0) / signals.length;
    const highSyntheticCount = signals.filter((s) => s.score >= 65).length;
    const highAuthenticCount = signals.filter((s) => s.score <= 35).length;

    if (highSyntheticCount >= 3 && aiProbability < avgSignal - 12) {
      aiProbability = Math.round(aiProbability * 0.4 + avgSignal * 0.6);
    } else if (highAuthenticCount >= 4 && aiProbability > avgSignal + 15) {
      aiProbability = Math.round(aiProbability * 0.4 + avgSignal * 0.6);
    } else if (Math.abs(aiProbability - avgSignal) > 22) {
      aiProbability = Math.round(aiProbability * 0.55 + avgSignal * 0.45);
    }
    aiProbability = Math.max(0, Math.min(100, aiProbability));
  }

  let verdict: 'likely_ai' | 'likely_real' | 'possible_manipulation' | 'inconclusive' = 'inconclusive';
  if (
    raw.verdict === 'likely_ai' ||
    raw.verdict === 'likely_real' ||
    raw.verdict === 'possible_manipulation' ||
    raw.verdict === 'inconclusive'
  ) {
    verdict = raw.verdict;
  } else if (aiProbability >= 70) {
    verdict = 'likely_ai';
  } else if (aiProbability <= 30) {
    verdict = 'likely_real';
  } else if (aiProbability >= 40 && aiProbability <= 65 && rawSynthetic.length > 0) {
    verdict = 'possible_manipulation';
  } else if (aiProbability >= 65) {
    verdict = 'likely_ai';
  } else if (aiProbability <= 35) {
    verdict = 'likely_real';
  }

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
    authenticEvidence: rawAuthentic,
    syntheticEvidence: rawSynthetic,
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
      const detailCropBase64 =
        typeof req.body?.detailCropBase64 === 'string' &&
        req.body.detailCropBase64.trim().length > 0 &&
        req.body.detailCropBase64.trim().length <= 1_000_000
          ? req.body.detailCropBase64.trim()
          : '';
      const detailCropRegion =
        Array.isArray(req.body?.detailCropRegion) &&
        req.body.detailCropRegion.length === 4 &&
        req.body.detailCropRegion.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
          ? (req.body.detailCropRegion as [number, number, number, number])
          : null;
      const metadataContext =
        typeof req.body?.metadataContext === 'string'
          ? req.body.metadataContext.slice(0, 3500)
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

      const cropNotice = detailCropBase64
        ? `TWO IMAGES ARE ATTACHED:\n- Image 1: Full-frame composition (compute all box_2d bounding-box coordinates [ymin, xmin, ymax, xmax] in 0..1000 relative to Image 1).\n- Image 2: Unscaled 1:1 native-resolution micro-detail crop from Image 1 region ${detailCropRegion ? `[${detailCropRegion.join(', ')}]` : 'around the primary subject'} for crisp inspection of fine texture, text, edges, and optics.`
        : 'Inspect the full image carefully for both authentic photographic cues and any genuine generative AI artifacts.';

      const promptParts = [
        'Perform an objective, neutrally calibrated digital forensic examination of this image to determine whether it is a real camera/smartphone photograph or an AI-generated/CGI image.',
        cropNotice,
        'Weigh authenticEvidence (real-world coherence, natural everyday lighting/imperfections, readable text/logos, normal smartphone HDR/Portrait-Mode/JPEG artifacts) fairly against syntheticEvidence (concrete generative contradictions, garbled text/emblems, impossible geometry, or paradoxical hyper-sharp + waxy diffusion texture with localized micro-anomalies). Do NOT penalize ordinary real photos for lacking EXIF, having phone smoothing/bokeh, or social-media compression.',
        metadataContext
          ? `Client-side container, EXIF & ELA summary:\n${metadataContext}`
          : 'No camera EXIF metadata was present in the file container (normal for social media downloads and screenshots).',
        'Return the complete structured JSON forensic report with authenticEvidence, syntheticEvidence, all 6 signals, calibrated aiProbability, verdict, and 2-5 localized bounding boxes relative to Image 1.',
      ].join('\n\n');

      const startedAt = Date.now();
      console.log(
        `[api/analyze] start mime=${mimeType} base64Len=${imageBase64.length} detailCrop=${Boolean(detailCropBase64)}`
      );

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

      const geminiParts: Array<
        { inlineData: { mimeType: string; data: string } } | { text: string }
      > = [
        {
          inlineData: {
            mimeType,
            data: imageBase64,
          },
        },
      ];
      if (detailCropBase64) {
        geminiParts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: detailCropBase64,
          },
        });
      }
      geminiParts.push({ text: promptParts });

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
                    parts: geminiParts,
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
        const openRouterContent: Array<
          { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
        > = [
          { type: 'text', text: promptParts },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${imageBase64}` },
          },
        ];
        if (detailCropBase64) {
          openRouterContent.push({
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${detailCropBase64}` },
          });
        }
        const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: AbortSignal.timeout(35000),
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
                content: openRouterContent,
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
