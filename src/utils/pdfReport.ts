import { jsPDF } from 'jspdf';
import type { ElaStats, ForensicReport, ImageMetadata, VerdictType } from '../types/forensics';
import { formatBytes } from './exifParser';
import { formatVerdictLabel } from './reportExport';

interface PdfReportInput {
  report: ForensicReport;
  defaultVerdict: VerdictType;
  aiThreshold: number;
  metadata: ImageMetadata | null;
  elaStats: ElaStats | null;
  imageDataUrl: string | null;
  elaDataUrl: string | null;
}

interface NormalizedImage {
  dataUrl: string;
  width: number;
  height: number;
}

const RGB_SLATE_900: [number, number, number] = [15, 23, 42];
const RGB_SLATE_700: [number, number, number] = [51, 65, 85];
const RGB_SLATE_500: [number, number, number] = [100, 116, 139];
const RGB_SLATE_200: [number, number, number] = [226, 232, 240];
const RGB_SLATE_100: [number, number, number] = [241, 245, 249];
const RGB_SLATE_50: [number, number, number] = [248, 250, 252];
const RGB_BLUE_600: [number, number, number] = [37, 99, 235];

function getVerdictRgb(verdict: VerdictType): {
  accent: [number, number, number];
  tint: [number, number, number];
  border: [number, number, number];
} {
  if (verdict === 'likely_ai') {
    return {
      accent: [185, 28, 28],
      tint: [254, 242, 242],
      border: [254, 202, 202],
    };
  }
  if (verdict === 'likely_real') {
    return {
      accent: [4, 120, 87],
      tint: [236, 253, 245],
      border: [167, 243, 208],
    };
  }
  return {
    accent: [180, 83, 9],
    tint: [255, 251, 235],
    border: [253, 230, 138],
  };
}

function getSignalRgb(status: 'authentic' | 'caution' | 'synthetic'): [number, number, number] {
  if (status === 'synthetic') return [220, 38, 38];
  if (status === 'authentic') return [5, 150, 105];
  return [217, 119, 6];
}

function normalizeImageToJpeg(
  src: string,
  maxDim = 960
): Promise<NormalizedImage | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const natW = img.naturalWidth || 1;
        const natH = img.naturalHeight || 1;
        const scale = Math.min(1, maxDim / Math.max(natW, natH));
        const width = Math.max(1, Math.round(natW * scale));
        const height = Math.max(1, Math.round(natH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        resolve({ dataUrl, width, height });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function fitRect(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number
): { w: number; h: number; xOffset: number; yOffset: number } {
  const ratio = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * ratio;
  const h = imgH * ratio;
  return {
    w,
    h,
    xOffset: (boxW - w) / 2,
    yOffset: (boxH - h) / 2,
  };
}

function sanitizePdfText(text: string): string {
  // jsPDF core Helvetica supports WinAnsi; normalize common Unicode punctuation cleanly
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2014/g, ' - ')
    .replace(/\u2013/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00D7/g, 'x')
    .replace(/\u2265/g, '>=')
    .replace(/\u2264/g, '<=')
    .replace(/\u00B7/g, ' | ')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, ' ');
}

export async function generateForensicPdfReport({
  report,
  defaultVerdict,
  aiThreshold,
  metadata,
  elaStats,
  imageDataUrl,
  elaDataUrl,
}: PdfReportInput): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297mm
  const margin = 15;
  const contentWidth = pageWidth - margin * 2; // 180mm
  const footerReserve = 16;

  let y = margin;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageHeight - footerReserve) {
      doc.addPage();
      y = margin + 4;
    }
  };

  const drawSectionHeading = (title: string, subtitle?: string) => {
    ensureSpace(16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...RGB_SLATE_900);
    doc.text(sanitizePdfText(title), margin, y);
    y += 1.5;
    doc.setDrawColor(...RGB_SLATE_200);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4.5;
    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...RGB_SLATE_500);
      const subLines = doc.splitTextToSize(sanitizePdfText(subtitle), contentWidth);
      doc.text(subLines, margin, y);
      y += subLines.length * 3.8 + 2.5;
    }
  };

  // Normalize thumbnails in parallel before laying out pages
  const [normOriginal, normEla] = await Promise.all([
    imageDataUrl ? normalizeImageToJpeg(imageDataUrl, 960) : Promise.resolve(null),
    elaDataUrl ? normalizeImageToJpeg(elaDataUrl, 960) : Promise.resolve(null),
  ]);

  const effectiveMeta = metadata ?? report.metadata;
  const effectiveEla = elaStats ?? report.elaStats;
  const aiScore = Math.max(0, Math.min(100, Math.round(report.aiProbability)));
  const authenticScore = 100 - aiScore;
  const mixedFloor = Math.max(15, aiThreshold - 30);
  const verdictColors = getVerdictRgb(report.verdict);

  // --- 1. TOP HEADER BAND ---
  doc.setFillColor(...RGB_SLATE_900);
  doc.rect(0, 0, pageWidth, 28, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text('Veritas Lens', margin, 11.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text('Digital Image Authenticity & Forensic Dossier', margin, 17.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  const dateLabel = sanitizePdfText(`Generated: ${new Date(report.createdAt).toLocaleString()}`);
  doc.text(dateLabel, pageWidth - margin, 11.5, { align: 'right' });
  const fileLabel = sanitizePdfText(`Subject: ${effectiveMeta.fileName}`);
  doc.text(
    fileLabel.length > 52 ? `${fileLabel.slice(0, 49)}...` : fileLabel,
    pageWidth - margin,
    17.5,
    { align: 'right' }
  );
  doc.text(sanitizePdfText(`Report ID: ${report.id}`), pageWidth - margin, 23, {
    align: 'right',
  });

  y = 35;

  // --- 2. EXECUTIVE VERDICT & AI CONFIDENCE CARD ---
  const headlineLines = doc.splitTextToSize(sanitizePdfText(report.headline), contentWidth - 10);
  const summaryLines = doc.splitTextToSize(sanitizePdfText(report.summary), contentWidth - 10);
  const overridden = report.verdict !== defaultVerdict;
  const cardHeight =
    37 + headlineLines.length * 4.5 + summaryLines.length * 4 + (overridden ? 5 : 0);

  doc.setFillColor(...verdictColors.tint);
  doc.setDrawColor(...verdictColors.border);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, contentWidth, cardHeight, 3, 3, 'FD');

  const cardInnerX = margin + 5;
  let cy = y + 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...RGB_SLATE_500);
  doc.text('AI-GENERATED CONFIDENCE VERDICT', cardInnerX, cy);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...verdictColors.accent);
  doc.text(sanitizePdfText(formatVerdictLabel(report.verdict)), cardInnerX, cy + 6.5);

  // Right-aligned big score readout
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...verdictColors.accent);
  doc.text(`${aiScore}%`, pageWidth - margin - 5, cy + 5.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...RGB_SLATE_500);
  doc.text(
    `AI-Generated (${authenticScore}% Authentic)`,
    pageWidth - margin - 5,
    cy + 10.5,
    { align: 'right' }
  );

  // Dual percentage bar + threshold marker
  cy += 13;
  const barX = cardInnerX;
  const barW = contentWidth - 10;
  const barH = 3.2;

  doc.setFillColor(...RGB_SLATE_200);
  doc.roundedRect(barX, cy, barW, barH, 1.5, 1.5, 'F');

  if (aiScore > 0) {
    doc.setFillColor(...verdictColors.accent);
    doc.roundedRect(barX, cy, Math.max(2, (barW * aiScore) / 100), barH, 1.5, 1.5, 'F');
  }

  // Threshold vertical tick marker
  const threshX = barX + (barW * aiThreshold) / 100;
  doc.setDrawColor(...RGB_SLATE_900);
  doc.setLineWidth(0.7);
  doc.line(threshX, cy - 1.2, threshX, cy + barH + 1.2);

  cy += 6.8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...RGB_SLATE_500);
  doc.text(
    sanitizePdfText(
      `Warning Threshold: >= ${aiThreshold}% AI | Mixed Band: ${mixedFloor}-${aiThreshold}% | Analyst Certainty: ${report.confidence.toUpperCase()} | Source: ${report.suspectedSource}`
    ),
    cardInnerX,
    cy
  );

  if (overridden) {
    cy += 4.5;
    doc.setTextColor(...RGB_SLATE_700);
    doc.text(
      sanitizePdfText(
        `Note: Reclassified by custom >=${aiThreshold}% warning threshold (Model default verdict: ${formatVerdictLabel(defaultVerdict)}).`
      ),
      cardInnerX,
      cy
    );
  }

  cy += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...RGB_SLATE_900);
  doc.text(headlineLines, cardInnerX, cy);
  cy += headlineLines.length * 4.5 + 1;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...RGB_SLATE_700);
  doc.text(summaryLines, cardInnerX, cy);

  y += cardHeight + 8;

  // --- 3. VISUAL EVIDENCE: ORIGINAL + ELA HEATMAP THUMBNAILS ---
  if (normOriginal || normEla) {
    drawSectionHeading(
      'Visual Evidence & Error Level Analysis (ELA)',
      'Side-by-side subject frame and client-side JPEG recompression residual heatmap.'
    );

    const imgBoxHeight = 56;
    const gap = 6;
    const colW = (contentWidth - gap) / 2;

    ensureSpace(imgBoxHeight + (effectiveEla ? 26 : 12));

    const drawThumbBox = (
      xPos: number,
      label: string,
      normImg: NormalizedImage | null,
      fallbackMsg: string
    ) => {
      doc.setFillColor(...RGB_SLATE_50);
      doc.setDrawColor(...RGB_SLATE_200);
      doc.setLineWidth(0.3);
      doc.roundedRect(xPos, y, colW, imgBoxHeight + 8, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...RGB_SLATE_700);
      doc.text(sanitizePdfText(label), xPos + 3, y + 5.2);

      const frameX = xPos + 2.5;
      const frameY = y + 7.5;
      const frameW = colW - 5;
      const frameH = imgBoxHeight - 2;

      doc.setFillColor(15, 23, 42);
      doc.rect(frameX, frameY, frameW, frameH, 'F');

      if (normImg) {
        const fitted = fitRect(normImg.width, normImg.height, frameW, frameH);
        doc.addImage(
          normImg.dataUrl,
          'JPEG',
          frameX + fitted.xOffset,
          frameY + fitted.yOffset,
          fitted.w,
          fitted.h
        );
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(sanitizePdfText(fallbackMsg), frameX + frameW / 2, frameY + frameH / 2, {
          align: 'center',
        });
      }
    };

    drawThumbBox(
      margin,
      `Original Image (${effectiveMeta.width}x${effectiveMeta.height})`,
      normOriginal,
      'Original image preview unavailable'
    );
    drawThumbBox(
      margin + colW + gap,
      effectiveEla
        ? `ELA Heatmap (Q${effectiveEla.quality}% | ${effectiveEla.scale}x Gain)`
        : 'Error Level Analysis Heatmap',
      normEla,
      'ELA map not available for this scan'
    );

    y += imgBoxHeight + 12;

    // ELA Quantitative Strip
    if (effectiveEla) {
      ensureSpace(18);
      doc.setFillColor(...RGB_SLATE_50);
      doc.setDrawColor(...RGB_SLATE_200);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y, contentWidth, 14.5, 2, 2, 'FD');

      const metrics = [
        { k: 'Mean Residual Error', v: `${effectiveEla.meanError}` },
        { k: 'Peak Residual Error', v: `${effectiveEla.maxError}` },
        { k: 'High-Variance Pixels', v: `${effectiveEla.highVarianceRatio}%` },
        { k: 'Recompression Setup', v: `Q${effectiveEla.quality}% / ${effectiveEla.scale}x` },
      ];
      const cellW = contentWidth / metrics.length;
      metrics.forEach((m, idx) => {
        const mx = margin + idx * cellW + 3.5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...RGB_SLATE_500);
        doc.text(m.k, mx, y + 4.8);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(...RGB_SLATE_900);
        doc.text(sanitizePdfText(m.v), mx, y + 9.8);
      });

      y += 17;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...RGB_SLATE_700);
      const assessLines = doc.splitTextToSize(
        sanitizePdfText(`ELA Assessment: ${effectiveEla.uniformityAssessment}`),
        contentWidth
      );
      doc.text(assessLines, margin, y);
      y += assessLines.length * 3.8 + 5;
    }
  }

  // --- 4. 6-CHANNEL VISUAL FORENSIC BREAKDOWN ---
  if (report.signals.length > 0) {
    drawSectionHeading(
      'Visual Forensic Signal Breakdown',
      'Independent evaluation across lighting, geometry, micro-texture, spatial coherence, optics, and compression noise.'
    );

    for (const signal of report.signals) {
      const obsLines = doc.splitTextToSize(sanitizePdfText(signal.observation), contentWidth - 4);
      const blockH = 10 + obsLines.length * 3.8 + 3;
      ensureSpace(blockH);

      const toneRgb = getSignalRgb(signal.status);
      const statusText =
        signal.status === 'synthetic'
          ? 'Synthetic cue'
          : signal.status === 'authentic'
            ? 'Authentic cue'
            : 'Mixed / Caution';

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...RGB_SLATE_900);
      doc.text(sanitizePdfText(signal.name), margin, y);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...toneRgb);
      doc.text(
        sanitizePdfText(`${statusText}  (${signal.score}%)`),
        pageWidth - margin,
        y,
        { align: 'right' }
      );

      // Signal bar
      y += 2;
      doc.setFillColor(...RGB_SLATE_100);
      doc.roundedRect(margin, y, contentWidth, 2, 1, 1, 'F');
      if (signal.score > 0) {
        doc.setFillColor(...toneRgb);
        doc.roundedRect(margin, y, Math.max(1.5, (contentWidth * signal.score) / 100), 2, 1, 1, 'F');
      }

      y += 5.5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.3);
      doc.setTextColor(...RGB_SLATE_700);
      doc.text(obsLines, margin, y);
      y += obsLines.length * 3.8 + 4;
    }
  }

  // --- 5. FLAGGED CANVAS REGIONS ---
  if (report.regions.length > 0) {
    drawSectionHeading(
      'Localized Canvas Observations',
      'Specific image coordinates flagged for synthetic artifacts, anomalies, or authentic optical cues.'
    );

    report.regions.forEach((region, idx) => {
      const expLines = doc.splitTextToSize(sanitizePdfText(region.explanation), contentWidth - 10);
      const needed = 8 + expLines.length * 3.8 + 3;
      ensureSpace(needed);

      doc.setFillColor(...RGB_SLATE_100);
      doc.roundedRect(margin, y - 3.3, 5.5, 5, 1, 1, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...RGB_SLATE_900);
      doc.text(`${idx + 1}`, margin + 2.75, y + 0.2, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...RGB_SLATE_900);
      doc.text(sanitizePdfText(region.label), margin + 8, y);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...RGB_SLATE_500);
      const coords = `[${region.box_2d.join(', ')}]`;
      doc.text(
        sanitizePdfText(`${region.category.replace('_', ' ')} | ${region.severity} priority | ${coords}`),
        pageWidth - margin,
        y,
        { align: 'right' }
      );

      y += 4.5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      doc.setTextColor(...RGB_SLATE_700);
      doc.text(expLines, margin + 8, y);
      y += expLines.length * 3.8 + 3.5;
    });
  }

  // --- 6. DETAILED FILE & EXIF METADATA TABLE ---
  drawSectionHeading(
    'File Container & EXIF Metadata',
    'Client-side header extraction from file binary, EXIF tags, and embedded software / generator markers.'
  );

  if (effectiveMeta.aiMarkerDetected && effectiveMeta.aiMarkerDetails) {
    const markerLines = doc.splitTextToSize(
      sanitizePdfText(`Generative Metadata Marker Detected: ${effectiveMeta.aiMarkerDetails}`),
      contentWidth - 8
    );
    const boxH = markerLines.length * 4 + 6;
    ensureSpace(boxH + 4);
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(254, 202, 202);
    doc.roundedRect(margin, y, contentWidth, boxH, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(185, 28, 28);
    doc.text(markerLines, margin + 4, y + 5);
    y += boxH + 4;
  }

  const metadataRows =
    effectiveMeta.fields.length > 0
      ? effectiveMeta.fields
      : [
          { label: 'File Name', value: effectiveMeta.fileName, group: 'file' as const },
          {
            label: 'Dimensions',
            value: `${effectiveMeta.width} x ${effectiveMeta.height} px (${effectiveMeta.aspectRatio})`,
            group: 'file' as const,
          },
          { label: 'File Size', value: formatBytes(effectiveMeta.fileSize), group: 'file' as const },
          { label: 'MIME Type', value: effectiveMeta.mimeType, group: 'file' as const },
          {
            label: 'Camera EXIF',
            value: effectiveMeta.hasExif ? 'Present' : 'Not present / stripped',
            group: 'camera' as const,
          },
        ];

  const keyColW = 54;
  const valColW = contentWidth - keyColW - 6;

  // Table header
  ensureSpace(9);
  doc.setFillColor(...RGB_SLATE_100);
  doc.rect(margin, y, contentWidth, 6.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.setTextColor(...RGB_SLATE_700);
  doc.text('Metadata Field', margin + 3, y + 4.4);
  doc.text('Extracted Value', margin + keyColW + 3, y + 4.4);
  y += 6.5;

  metadataRows.forEach((field, rowIdx) => {
    const valLines = doc.splitTextToSize(sanitizePdfText(field.value), valColW);
    const rowH = Math.max(6.5, valLines.length * 3.8 + 2.8);
    ensureSpace(rowH + 1);

    if (rowIdx % 2 === 1) {
      doc.setFillColor(...RGB_SLATE_50);
      doc.rect(margin, y, contentWidth, rowH, 'F');
    }

    doc.setDrawColor(...RGB_SLATE_200);
    doc.setLineWidth(0.18);
    doc.line(margin, y + rowH, pageWidth - margin, y + rowH);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...RGB_SLATE_500);
    doc.text(sanitizePdfText(field.label), margin + 3, y + 4.3);

    doc.setFont('helvetica', field.flagged ? 'bold' : 'normal');
    doc.setFontSize(8);
    if (field.flagged) {
      doc.setTextColor(185, 28, 28);
    } else {
      doc.setTextColor(...RGB_SLATE_900);
    }
    doc.text(valLines, margin + keyColW + 3, y + 4.3);

    y += rowH;
  });

  // --- 7. PAGE FOOTERS ACROSS ALL PAGES ---
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...RGB_SLATE_200);
    doc.setLineWidth(0.25);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...RGB_SLATE_500);
    doc.text('Veritas Lens | AI Image Authenticity Analyzer', margin, pageHeight - 7.5);

    doc.setTextColor(...RGB_BLUE_600);
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 7.5, {
      align: 'right',
    });
  }

  const baseName = effectiveMeta.fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'scan';
  doc.save(`${baseName}-full-forensic-report.pdf`);
}
