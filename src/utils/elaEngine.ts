import type { ElaPalette, ElaStats } from '../types/forensics';

export interface ElaResult {
  elaDataUrl: string;
  stats: ElaStats;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image for Error Level Analysis.'));
    img.src = src;
  });
}

function thermalColor(v: number): [number, number, number] {
  // Smooth forensic thermal ramp: deep navy -> cobalt -> cyan -> amber -> crimson/white
  const t = Math.max(0, Math.min(255, v)) / 255;
  if (t < 0.25) {
    const k = t / 0.25;
    return [Math.round(8 + k * 14), Math.round(14 + k * 44), Math.round(32 + k * 110)];
  }
  if (t < 0.5) {
    const k = (t - 0.25) / 0.25;
    return [Math.round(22 + k * 10), Math.round(58 + k * 130), Math.round(142 + k * 78)];
  }
  if (t < 0.75) {
    const k = (t - 0.5) / 0.25;
    return [Math.round(32 + k * 213), Math.round(188 - k * 30), Math.round(220 - k * 190)];
  }
  const k = (t - 0.75) / 0.25;
  return [Math.round(245 + k * 10), Math.round(158 - k * 90 + k * 80), Math.round(30 + k * 190)];
}

export async function computeErrorLevelAnalysis(
  imageDataUrl: string,
  quality = 90,
  scale = 15,
  palette: ElaPalette = 'thermal'
): Promise<ElaResult> {
  const originalImg = await loadImageElement(imageDataUrl);

  // Cap canvas dimensions for crisp, instant real-time ELA computation
  const maxDim = 1400;
  const ratio = Math.min(1, maxDim / Math.max(originalImg.naturalWidth, originalImg.naturalHeight));
  const width = Math.max(1, Math.round(originalImg.naturalWidth * ratio));
  const height = Math.max(1, Math.round(originalImg.naturalHeight * ratio));

  const origCanvas = document.createElement('canvas');
  origCanvas.width = width;
  origCanvas.height = height;
  const origCtx = origCanvas.getContext('2d', { willReadFrequently: true });
  if (!origCtx) {
    throw new Error('2D canvas context unavailable for ELA.');
  }
  origCtx.drawImage(originalImg, 0, 0, width, height);
  const origPixels = origCtx.getImageData(0, 0, width, height).data;

  // Re-compress to JPEG at specified quality level
  const clampedQuality = Math.max(0.5, Math.min(0.98, quality / 100));
  const recompressedDataUrl = origCanvas.toDataURL('image/jpeg', clampedQuality);
  const recompressedImg = await loadImageElement(recompressedDataUrl);

  const compCanvas = document.createElement('canvas');
  compCanvas.width = width;
  compCanvas.height = height;
  const compCtx = compCanvas.getContext('2d', { willReadFrequently: true });
  if (!compCtx) {
    throw new Error('2D canvas context unavailable for ELA recompression.');
  }
  compCtx.drawImage(recompressedImg, 0, 0, width, height);
  const compPixels = compCtx.getImageData(0, 0, width, height).data;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) {
    throw new Error('2D canvas context unavailable for ELA output.');
  }
  const outImageData = outCtx.createImageData(width, height);
  const outData = outImageData.data;

  const pixelCount = width * height;
  let sumError = 0;
  let maxError = 0;
  let highVarianceCount = 0;

  for (let i = 0; i < origPixels.length; i += 4) {
    const dr = Math.abs(origPixels[i] - compPixels[i]);
    const dg = Math.abs(origPixels[i + 1] - compPixels[i + 1]);
    const db = Math.abs(origPixels[i + 2] - compPixels[i + 2]);

    const avgDiff = (dr + dg + db) / 3;
    sumError += avgDiff;
    if (avgDiff > maxError) maxError = avgDiff;
    if (avgDiff > 12) highVarianceCount++;

    if (palette === 'thermal') {
      const amp = Math.min(255, avgDiff * scale);
      const [r, g, b] = thermalColor(amp);
      outData[i] = r;
      outData[i + 1] = g;
      outData[i + 2] = b;
      outData[i + 3] = 255;
    } else {
      outData[i] = Math.min(255, Math.round(dr * scale));
      outData[i + 1] = Math.min(255, Math.round(dg * scale));
      outData[i + 2] = Math.min(255, Math.round(db * scale));
      outData[i + 3] = 255;
    }
  }

  outCtx.putImageData(outImageData, 0, 0);

  const meanError = Number((sumError / pixelCount).toFixed(2));
  const highVarianceRatio = Number(((highVarianceCount / pixelCount) * 100).toFixed(2));

  let uniformityAssessment = 'Uniform compression profile across frame';
  if (highVarianceRatio > 8) {
    uniformityAssessment = 'Elevated high-frequency edge variance detected';
  } else if (highVarianceRatio > 2.5) {
    uniformityAssessment = 'Localized regions show distinct recompression delta';
  } else if (meanError < 1.8) {
    uniformityAssessment = 'Very smooth, low-residual recompression profile';
  }

  return {
    elaDataUrl: outCanvas.toDataURL('image/png'),
    stats: {
      quality,
      scale,
      meanError,
      maxError: Number(maxError.toFixed(1)),
      highVarianceRatio,
      uniformityAssessment,
    },
  };
}

export async function createCompactThumbnail(imageDataUrl: string, maxDim = 360): Promise<string> {
  const img = await loadImageElement(imageDataUrl);
  const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * ratio));
  const height = Math.max(1, Math.round(img.naturalHeight * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return imageDataUrl;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

export async function prepareAnalysisPayload(
  imageDataUrl: string,
  mimeType: string
): Promise<{ base64: string; mimeType: string; width: number; height: number }> {
  const img = await loadImageElement(imageDataUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  // Preserve fine forensic details (emblems, lug nuts, license plates, micro-grain) up to 2048px
  // while keeping the JSON body safely under Vercel's 4.5 MB serverless payload limit.
  const maxDim = 2048;
  const maxSafeBase64Chars = 3_300_000;
  const commaIdx = imageDataUrl.indexOf(',');
  const rawBase64 = commaIdx >= 0 ? imageDataUrl.slice(commaIdx + 1) : imageDataUrl;

  const needsResize = Math.max(width, height) > maxDim || rawBase64.length > maxSafeBase64Chars;
  if (!needsResize) {
    const normalizedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)
      ? mimeType
      : 'image/jpeg';
    return { base64: rawBase64, mimeType: normalizedMime, width, height };
  }

  const ratio = Math.min(1, maxDim / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * ratio));
  const targetH = Math.max(1, Math.round(height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      base64: rawBase64,
      mimeType: 'image/jpeg',
      width,
      height,
    };
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);

  let base64 = '';
  for (const quality of [0.92, 0.86, 0.8]) {
    const compressed = canvas.toDataURL('image/jpeg', quality);
    base64 = compressed.slice(compressed.indexOf(',') + 1);
    if (base64.length <= maxSafeBase64Chars) {
      break;
    }
  }
  return { base64, mimeType: 'image/jpeg', width, height };
}
