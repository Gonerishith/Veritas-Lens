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

export interface PreparedAnalysisPayload {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  detailCropBase64?: string;
  detailCropRegion?: [number, number, number, number];
}

function findSalientDetailCropRect(
  img: HTMLImageElement,
  width: number,
  height: number,
  cropSize: number
): { sx: number; sy: number; sw: number; sh: number; region: [number, number, number, number] } {
  const sw = Math.min(cropSize, width);
  const sh = Math.min(cropSize, height);

  // Fast 128px edge-energy map biased toward upper-center / subject region (faces, eyes, grilles, badges)
  const probeScale = Math.min(1, 128 / Math.max(width, height));
  const pw = Math.max(16, Math.round(width * probeScale));
  const ph = Math.max(16, Math.round(height * probeScale));
  const probeCanvas = document.createElement('canvas');
  probeCanvas.width = pw;
  probeCanvas.height = ph;
  const pCtx = probeCanvas.getContext('2d', { willReadFrequently: true });

  let bestCenterX = width * 0.5;
  let bestCenterY = height * 0.42;

  if (pCtx) {
    pCtx.drawImage(img, 0, 0, pw, ph);
    const pData = pCtx.getImageData(0, 0, pw, ph).data;
    const grid = 8;
    const cellW = pw / grid;
    const cellH = ph / grid;
    let bestScore = -1;

    for (let gy = 1; gy < grid - 1; gy++) {
      for (let gx = 1; gx < grid - 1; gx++) {
        let energy = 0;
        const xStart = Math.floor(gx * cellW);
        const yStart = Math.floor(gy * cellH);
        const xEnd = Math.min(pw - 2, Math.floor((gx + 1) * cellW));
        const yEnd = Math.min(ph - 2, Math.floor((gy + 1) * cellH));
        let cnt = 0;

        for (let y = yStart; y < yEnd; y++) {
          for (let x = xStart; x < xEnd; x++) {
            const idx = (y * pw + x) * 4;
            const rIdx = idx + 4;
            const dIdx = idx + pw * 4;
            const l0 = pData[idx] + pData[idx + 1] + pData[idx + 2];
            const lr = pData[rIdx] + pData[rIdx + 1] + pData[rIdx + 2];
            const ld = pData[dIdx] + pData[dIdx + 1] + pData[dIdx + 2];
            energy += Math.abs(l0 - lr) + Math.abs(l0 - ld);
            cnt++;
          }
        }
        const avgEnergy = cnt > 0 ? energy / cnt : 0;
        // Favor upper-center / center focal zones (where portraits & car fronts sit)
        const nx = (gx + 0.5) / grid;
        const ny = (gy + 0.5) / grid;
        const distFromFocus = Math.hypot((nx - 0.5) * 1.15, (ny - 0.4) * 1.1);
        const spatialWeight = Math.max(0.45, 1.25 - distFromFocus);
        const score = avgEnergy * spatialWeight;
        if (score > bestScore) {
          bestScore = score;
          bestCenterX = nx * width;
          bestCenterY = ny * height;
        }
      }
    }
  }

  const sx = Math.max(0, Math.min(width - sw, Math.round(bestCenterX - sw / 2)));
  const sy = Math.max(0, Math.min(height - sh, Math.round(bestCenterY - sh / 2)));
  const region: [number, number, number, number] = [
    Math.round((sy / height) * 1000),
    Math.round((sx / width) * 1000),
    Math.round(((sy + sh) / height) * 1000),
    Math.round(((sx + sw) / width) * 1000),
  ];

  return { sx, sy, sw, sh, region };
}

export async function prepareAnalysisPayload(
  imageDataUrl: string,
  mimeType: string
): Promise<PreparedAnalysisPayload> {
  const img = await loadImageElement(imageDataUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  // Extract a 1:1 native-resolution micro-detail crop (up to 768x768) for pixel-level visual inspection
  let detailCropBase64: string | undefined;
  let detailCropRegion: [number, number, number, number] | undefined;

  try {
    if (Math.max(width, height) > 880) {
      const cropDim = Math.min(768, width, height);
      const crop = findSalientDetailCropRect(img, width, height, cropDim);
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = crop.sw;
      cropCanvas.height = crop.sh;
      const cropCtx = cropCanvas.getContext('2d');
      if (cropCtx) {
        cropCtx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
        const cropDataUrl = cropCanvas.toDataURL('image/jpeg', 0.94);
        const cropB64 = cropDataUrl.slice(cropDataUrl.indexOf(',') + 1);
        if (cropB64.length <= 420_000) {
          detailCropBase64 = cropB64;
          detailCropRegion = crop.region;
        }
      }
    }
  } catch {
    // Non-fatal: proceed with full-frame analysis
  }

  // Preserve fine forensic details up to 2048px while staying safely under Vercel's 4.5 MB payload limit
  const maxDim = 2048;
  const maxSafeBase64Chars = detailCropBase64 ? 2_800_000 : 3_300_000;
  const commaIdx = imageDataUrl.indexOf(',');
  const rawBase64 = commaIdx >= 0 ? imageDataUrl.slice(commaIdx + 1) : imageDataUrl;

  const needsResize = Math.max(width, height) > maxDim || rawBase64.length > maxSafeBase64Chars;
  if (!needsResize) {
    const normalizedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)
      ? mimeType
      : 'image/jpeg';
    return {
      base64: rawBase64,
      mimeType: normalizedMime,
      width,
      height,
      detailCropBase64,
      detailCropRegion,
    };
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
      detailCropBase64,
      detailCropRegion,
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
  return {
    base64,
    mimeType: 'image/jpeg',
    width,
    height,
    detailCropBase64,
    detailCropRegion,
  };
}
