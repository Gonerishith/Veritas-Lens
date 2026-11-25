export type VerdictType = 'likely_ai' | 'likely_real' | 'possible_manipulation' | 'inconclusive';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type SignalStatus = 'authentic' | 'caution' | 'synthetic';
export type SourceType = 'upload' | 'url' | 'sample' | 'paste' | 'camera';
export type ActiveTab = 'analyze' | 'batch' | 'compare' | 'samples' | 'history';
export type CanvasMode = 'original' | 'ela' | 'split';
export type LoupeZoom = 0 | 2 | 4 | 8;
export type ElaPalette = 'thermal' | 'grayscale';

export interface ForensicSignal {
  id: string;
  name: string;
  status: SignalStatus;
  score: number; // 0-100 synthetic likelihood indicator
  observation: string;
}

export interface ForensicRegion {
  id: string;
  label: string;
  category: 'artifact' | 'authentic_cue' | 'anomaly';
  severity: 'high' | 'medium' | 'low';
  explanation: string;
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
}

export interface MetadataField {
  label: string;
  value: string;
  group: 'file' | 'camera' | 'software' | 'ai_markers';
  flagged?: boolean;
}

export type ProvenanceEventKind =
  | 'capture'
  | 'digitized'
  | 'edit'
  | 'software_signature'
  | 'export'
  | 'ai_signature';

export interface ProvenanceEvent {
  id: string;
  kind: ProvenanceEventKind;
  signature: string;
  action: string;
  timestamp?: string;
  sourceTag: string;
  details?: string;
  flagged?: boolean;
}

export interface ImageMetadata {
  fileName: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  aspectRatio: string;
  hasExif: boolean;
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  software?: string;
  dateTimeOriginal?: string;
  exposureSummary?: string;
  aiMarkerDetected: boolean;
  aiMarkerDetails?: string;
  fields: MetadataField[];
  provenance?: ProvenanceEvent[];
}

export interface ElaStats {
  quality: number;
  scale: number;
  meanError: number;
  maxError: number;
  highVarianceRatio: number;
  uniformityAssessment: string;
}

export interface AiAnalysisResponse {
  authenticEvidence?: string[];
  syntheticEvidence?: string[];
  verdict: VerdictType;
  aiProbability: number;
  confidence: ConfidenceLevel;
  headline: string;
  summary: string;
  suspectedSource: string;
  signals: ForensicSignal[];
  regions: ForensicRegion[];
}

export interface ForensicReport extends AiAnalysisResponse {
  id: string;
  createdAt: string;
  sourceType: SourceType;
  sourceUrl?: string;
  metadata: ImageMetadata;
  elaStats: ElaStats | null;
}

export interface HistoryRecord {
  id: string;
  createdAt: string;
  thumbnailDataUrl: string;
  imageDataUrl: string;
  report: ForensicReport;
}

export interface SampleImage {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  url: string;
  fileName: string;
  forensicNote: string;
}

export interface CompareSlot {
  imageDataUrl: string | null;
  elaDataUrl: string | null;
  report: ForensicReport | null;
  metadata: ImageMetadata | null;
  elaStats: ElaStats | null;
  isLoading: boolean;
  error: string | null;
}

export type BatchItemStatus = 'queued' | 'analyzing' | 'complete' | 'error';

export interface BatchItem {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sourceType: SourceType;
  imageDataUrl: string;
  thumbnailDataUrl: string;
  elaDataUrl: string | null;
  metadata: ImageMetadata | null;
  elaStats: ElaStats | null;
  report: ForensicReport | null;
  status: BatchItemStatus;
  error: string | null;
}
