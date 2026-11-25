import type { ForensicReport, VerdictType } from '../types/forensics';
import { deriveFallbackProvenance, formatBytes } from './exifParser';

export function formatVerdictLabel(verdict: VerdictType): string {
  switch (verdict) {
    case 'likely_ai':
      return 'Likely AI-Generated';
    case 'likely_real':
      return 'Likely Authentic';
    default:
      return 'Inconclusive / Edited';
  }
}

export function buildMarkdownReport(report: ForensicReport): string {
  const provenance = deriveFallbackProvenance(report.metadata);
  const lines: string[] = [
    `# Veritas Lens — Forensic Authenticity Report`,
    '',
    `- **File:** ${report.metadata.fileName}`,
    `- **Analyzed:** ${new Date(report.createdAt).toLocaleString()}`,
    `- **Verdict:** ${formatVerdictLabel(report.verdict)}`,
    `- **Synthetic Likelihood:** ${report.aiProbability}% (Confidence: ${report.confidence})`,
    `- **Suspected Source:** ${report.suspectedSource}`,
    `- **Dimensions:** ${report.metadata.width} × ${report.metadata.height} px (${formatBytes(report.metadata.fileSize)})`,
    '',
    `## Executive Summary`,
    report.headline,
    '',
    report.summary,
    '',
    `## Forensic Signal Breakdown`,
    ...report.signals.map(
      (s) => `- **${s.name}** (${s.score}% synthetic · ${s.status}): ${s.observation}`
    ),
    '',
    `## Highlighted Regions`,
    ...(report.regions.length > 0
      ? report.regions.map(
          (r) => `- **${r.label}** (${r.category}, ${r.severity} severity): ${r.explanation}`
        )
      : ['- No isolated visual anomalies flagged.']),
    '',
    `## Embedded Provenance Timeline`,
    ...(provenance.length > 0
      ? provenance.map(
          (evt, idx) =>
            `${idx + 1}. **${evt.signature}** — ${evt.action} (${evt.sourceTag}${evt.timestamp ? ` · ${evt.timestamp}` : ''})${evt.details ? ` — ${evt.details}` : ''}`
        )
      : ['- No embedded camera or software edit history detected in file container.']),
    '',
    `## Container & EXIF Metadata`,
    ...report.metadata.fields.map((f) => `- **${f.label}:** ${f.value}`),
  ];

  if (report.elaStats) {
    lines.push(
      '',
      `## Error Level Analysis (ELA)`,
      `- **JPEG Quality:** ${report.elaStats.quality}% · **Gain:** ${report.elaStats.scale}x`,
      `- **Mean Residual Error:** ${report.elaStats.meanError}`,
      `- **Peak Error:** ${report.elaStats.maxError}`,
      `- **High-Variance Pixel Share:** ${report.elaStats.highVarianceRatio}%`,
      `- **Assessment:** ${report.elaStats.uniformityAssessment}`
    );
  }

  return lines.join('\n');
}

export function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const str = value == null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildBatchCsv(reports: ForensicReport[]): string {
  const headers = [
    'File Name',
    'Verdict',
    'AI Likelihood (%)',
    'Confidence',
    'Suspected Source',
    'Dimensions',
    'File Size (bytes)',
    'Camera EXIF Present',
    'AI Container Marker',
    'ELA Mean Error',
    'ELA High-Variance (%)',
    'Headline',
    'Analyzed At',
  ];

  const rows = reports.map((r) =>
    [
      r.metadata.fileName,
      formatVerdictLabel(r.verdict),
      r.aiProbability,
      r.confidence,
      r.suspectedSource,
      `${r.metadata.width}x${r.metadata.height}`,
      r.metadata.fileSize,
      r.metadata.hasExif ? 'Yes' : 'No',
      r.metadata.aiMarkerDetected ? r.metadata.aiMarkerDetails || 'Yes' : 'No',
      r.elaStats ? r.elaStats.meanError : '',
      r.elaStats ? r.elaStats.highVarianceRatio : '',
      r.headline,
      r.createdAt,
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return [headers.map(escapeCsvCell).join(','), ...rows].join('\n');
}
