import type {
  AiAnalysisResponse,
  ElaPalette,
  ElaStats,
  ForensicReport,
  ImageMetadata,
  SourceType,
} from '../types/forensics';
import { computeErrorLevelAnalysis, prepareAnalysisPayload } from './elaEngine';
import { buildMetadataContextForAi, parseImageMetadata } from './exifParser';

export interface LoadedImageAsset {
  blob: Blob;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  sourceType: SourceType;
  sourceUrl?: string;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the selected image file.'));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/data:([^;]+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function loadFromFile(file: File, sourceType: SourceType = 'upload'): Promise<LoadedImageAsset> {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) {
    throw new Error('Unsupported format. Please upload a JPEG, PNG, WebP, or GIF image.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Image exceeds the 10 MB file size limit.');
  }
  const dataUrl = await blobToDataUrl(file);
  return {
    blob: file,
    dataUrl,
    fileName: file.name || 'pasted-image.png',
    mimeType: file.type,
    sourceType,
  };
}

async function safeReadJson<T>(response: Response): Promise<{ data: T | null; rawText: string }> {
  const rawText = await response.text();
  if (!rawText) return { data: null, rawText: '' };
  try {
    return { data: JSON.parse(rawText) as T, rawText };
  } catch {
    return { data: null, rawText };
  }
}

export async function loadFromRemoteUrl(url: string): Promise<LoadedImageAsset> {
  const response = await fetch('/api/fetch-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const { data: payload } = await safeReadJson<{
    dataUrl?: string;
    mimeType?: string;
    fileName?: string;
    error?: string;
  }>(response);

  if (!response.ok || !payload?.dataUrl) {
    if (response.status === 404) {
      throw new Error(
        'Backend API route (/api/fetch-image) was not found. Make sure api/index.ts and vercel.json are deployed.'
      );
    }
    throw new Error(payload?.error || `Could not import image from URL (HTTP ${response.status}).`);
  }

  const blob = dataUrlToBlob(payload.dataUrl);
  return {
    blob,
    dataUrl: payload.dataUrl,
    fileName: payload.fileName || 'remote-image.jpg',
    mimeType: payload.mimeType || 'image/jpeg',
    sourceType: 'url',
    sourceUrl: url,
  };
}

export async function loadFromSampleAsset(
  url: string,
  fileName: string
): Promise<LoadedImageAsset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Unable to load the selected sample image.');
  }
  const blob = await response.blob();
  const dataUrl = await blobToDataUrl(blob);
  return {
    blob,
    dataUrl,
    fileName,
    mimeType: blob.type || 'image/jpeg',
    sourceType: 'sample',
  };
}

export interface ClientForensicsResult {
  metadata: ImageMetadata;
  elaDataUrl: string;
  elaStats: ElaStats;
  preparedBase64: string;
  preparedMimeType: string;
}

export async function runClientForensics(
  asset: LoadedImageAsset,
  elaQuality = 90,
  elaScale = 15,
  elaPalette: ElaPalette = 'thermal'
): Promise<ClientForensicsResult> {
  const prepared = await prepareAnalysisPayload(asset.dataUrl, asset.mimeType);
  const [metadata, ela] = await Promise.all([
    parseImageMetadata(asset.blob, asset.fileName, prepared.width, prepared.height),
    computeErrorLevelAnalysis(asset.dataUrl, elaQuality, elaScale, elaPalette),
  ]);

  return {
    metadata,
    elaDataUrl: ela.elaDataUrl,
    elaStats: ela.stats,
    preparedBase64: prepared.base64,
    preparedMimeType: prepared.mimeType,
  };
}

export async function runServerAiAnalysis(
  preparedBase64: string,
  preparedMimeType: string,
  metadata: ImageMetadata,
  elaStats?: ElaStats | null
): Promise<AiAnalysisResponse> {
  const baseContext = buildMetadataContextForAi(metadata);
  const elaSummary = elaStats
    ? `\nError Level Analysis (ELA @ Q${elaStats.quality}, ${elaStats.scale}x): Mean Residual=${elaStats.meanError}, Max Delta=${elaStats.maxError}, High-Variance Pixels=${elaStats.highVarianceRatio}%, Profile="${elaStats.uniformityAssessment}"`
    : '';

  const payload = JSON.stringify({
    imageBase64: preparedBase64,
    mimeType: preparedMimeType,
    metadataContext: `${baseContext}${elaSummary}`,
  });

  let lastMessage = 'Forensic vision analysis failed. Please try again.';

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    const { data, rawText } = await safeReadJson<AiAnalysisResponse & { error?: string }>(response);
    if (response.ok && data) {
      return data;
    }

    if (response.status === 404) {
      throw new Error(
        'Backend API endpoint (/api/analyze) returned 404. Ensure api/index.ts and vercel.json are pushed and deployed.'
      );
    }
    if (response.status === 413) {
      throw new Error('Image payload exceeded the server request limit. Try a smaller image.');
    }

    lastMessage =
      data?.error ||
      (rawText.trim()
        ? `Server returned HTTP ${response.status}: ${rawText.trim().slice(0, 140)}`
        : `Forensic vision analysis failed (HTTP ${response.status}).`);

    const isTransient = response.status === 502 || response.status === 503 || response.status === 504;
    if (isTransient && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    throw new Error(lastMessage);
  }

  throw new Error(lastMessage);
}

export function assembleForensicReport(
  asset: LoadedImageAsset,
  client: ClientForensicsResult,
  ai: AiAnalysisResponse
): ForensicReport {
  return {
    ...ai,
    id: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    sourceType: asset.sourceType,
    sourceUrl: asset.sourceUrl,
    metadata: client.metadata,
    elaStats: client.elaStats,
  };
}
