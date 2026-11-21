import { useCallback, useEffect, useRef, useState } from 'react';
import { BatchView } from './components/BatchView';
import { CameraCaptureModal } from './components/CameraCaptureModal';
import { CompareView } from './components/CompareView';
import { ForensicCanvas } from './components/ForensicCanvas';
import { HistoryView } from './components/HistoryView';
import { MobileBottomNav } from './components/MobileBottomNav';
import { classifyByThreshold, ReportInspector } from './components/ReportInspector';
import { SamplesView } from './components/SamplesView';
import { SubToolbar } from './components/SubToolbar';
import { TopNav } from './components/TopNav';
import { UploadStage } from './components/UploadStage';
import { SAMPLE_IMAGES } from './data/samples';
import type {
  ActiveTab,
  BatchItem,
  CompareSlot,
  ElaPalette,
  ElaStats,
  ForensicReport,
  HistoryRecord,
  ImageMetadata,
  SampleImage,
} from './types/forensics';
import {
  assembleForensicReport,
  loadFromFile,
  loadFromRemoteUrl,
  loadFromSampleAsset,
  runClientForensics,
  runServerAiAnalysis,
  type LoadedImageAsset,
} from './utils/analysisService';
import { computeErrorLevelAnalysis, createCompactThumbnail } from './utils/elaEngine';
import {
  clearHistoryRecords,
  deleteHistoryRecord,
  listHistoryRecords,
  saveHistoryRecord,
} from './utils/historyDb';
import { Link2, Loader2 } from 'lucide-react';
import { buildMarkdownReport, downloadTextFile } from './utils/reportExport';
import {
  clearShareUrlFromAddressBar,
  resolveSharedReportFromUrl,
} from './utils/shareService';

const EMPTY_COMPARE_SLOT: CompareSlot = {
  imageDataUrl: null,
  elaDataUrl: null,
  report: null,
  metadata: null,
  elaStats: null,
  isLoading: false,
  error: null,
};

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('veritas-lens-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

function getInitialAiThreshold(): number {
  if (typeof window === 'undefined') return 65;
  const stored = Number(window.localStorage.getItem('veritas-lens-ai-threshold'));
  if (!Number.isNaN(stored) && stored >= 30 && stored <= 90) {
    return Math.round(stored);
  }
  return 65;
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [aiThreshold, setAiThreshold] = useState<number>(getInitialAiThreshold);
  const [activeTab, setActiveTab] = useState<ActiveTab>('analyze');

  // Primary Analyze Workspace State
  const [activeAsset, setActiveAsset] = useState<LoadedImageAsset | null>(null);
  const [activeImageUrl, setActiveImageUrl] = useState<string | null>(null);
  const [activeMetadata, setActiveMetadata] = useState<ImageMetadata | null>(null);
  const [activeElaUrl, setActiveElaUrl] = useState<string | null>(null);
  const [activeElaStats, setActiveElaStats] = useState<ElaStats | null>(null);
  const [activeReport, setActiveReport] = useState<ForensicReport | null>(null);

  const [isLoadingAsset, setIsLoadingAsset] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Interactive Canvas State
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [elaQuality, setElaQuality] = useState(90);
  const [elaScale, setElaScale] = useState(15);
  const [elaPalette, setElaPalette] = useState<ElaPalette>('thermal');
  const [isRecomputingEla, setIsRecomputingEla] = useState(false);

  // Compare, Batch & History State
  const [slotA, setSlotA] = useState<CompareSlot>(EMPTY_COMPARE_SLOT);
  const [slotB, setSlotB] = useState<CompareSlot>(EMPTY_COMPARE_SLOT);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [sharedBanner, setSharedBanner] = useState<{
    sharedAt: string;
    mode: 'public_url' | 'deep_link';
    includesImage: boolean;
  } | null>(null);
  const [isLoadingShared, setIsLoadingShared] = useState(false);
  const [shareLoadError, setShareLoadError] = useState<string | null>(null);

  const scanSequenceRef = useRef(0);
  const batchAssetsRef = useRef<Map<string, LoadedImageAsset>>(new Map());
  const batchRunIdRef = useRef(0);
  const batchItemsRef = useRef<BatchItem[]>([]);
  batchItemsRef.current = batchItems;

  // Sync Tailwind v4 .dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      window.localStorage.setItem('veritas-lens-theme', theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem('veritas-lens-ai-threshold', String(aiThreshold));
    } catch {
      // Ignore storage errors
    }
  }, [aiThreshold]);

  // Hydrate IndexedDB local history on startup
  useEffect(() => {
    listHistoryRecords().then((records) => setHistory(records));
  }, []);

  // Hydrate shared forensic report if opened via ?share=<id> or #report=<encoded>
  useEffect(() => {
    const hasShareParam =
      typeof window !== 'undefined' &&
      (new URLSearchParams(window.location.search).has('share') ||
        window.location.hash.startsWith('#report='));
    if (!hasShareParam) return;

    let cancelled = false;
    setIsLoadingShared(true);
    setShareLoadError(null);

    resolveSharedReportFromUrl().then(({ result, error }) => {
      if (cancelled) return;
      setIsLoadingShared(false);
      if (error || !result) {
        setShareLoadError(error || 'Unable to load shared forensic report.');
        return;
      }
      setActiveTab('analyze');
      setActiveAsset(null);
      setActiveReport(result.report);
      setActiveMetadata(result.report.metadata);
      setActiveElaStats(result.report.elaStats);
      setActiveImageUrl(result.previewImageDataUrl);
      setActiveElaUrl(null);
      setAiThreshold(result.aiThreshold);
      setAnalyzeError(null);
      setUploadError(null);
      setIsAnalyzing(false);
      setSelectedRegionId(null);
      setHoveredRegionId(null);
      setSharedBanner({
        sharedAt: result.sharedAt,
        mode: result.mode,
        includesImage: Boolean(result.previewImageDataUrl),
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Recompute ELA heatmap smoothly when user adjusts calibration sliders
  useEffect(() => {
    if (!activeImageUrl) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsRecomputingEla(true);
      try {
        const res = await computeErrorLevelAnalysis(
          activeImageUrl,
          elaQuality,
          elaScale,
          elaPalette
        );
        if (!cancelled) {
          setActiveElaUrl(res.elaDataUrl);
          setActiveElaStats(res.stats);
        }
      } catch {
        // Retain prior ELA canvas on transient error
      } finally {
        if (!cancelled) setIsRecomputingEla(false);
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeImageUrl, elaQuality, elaScale, elaPalette]);

  const executePrimaryAnalysis = useCallback(async (asset: LoadedImageAsset) => {
    const seq = ++scanSequenceRef.current;
    clearShareUrlFromAddressBar();
    setSharedBanner(null);
    setShareLoadError(null);
    setActiveTab('analyze');
    setUploadError(null);
    setAnalyzeError(null);
    setSelectedRegionId(null);
    setHoveredRegionId(null);
    setActiveAsset(asset);
    setActiveImageUrl(asset.dataUrl);
    setActiveReport(null);
    setActiveMetadata(null);
    setActiveElaUrl(null);
    setActiveElaStats(null);
    setIsAnalyzing(true);

    try {
      const clientRes = await runClientForensics(asset, 90, 15, 'thermal');
      if (seq !== scanSequenceRef.current) return;

      setElaQuality(90);
      setElaScale(15);
      setElaPalette('thermal');
      setActiveMetadata(clientRes.metadata);
      setActiveElaUrl(clientRes.elaDataUrl);
      setActiveElaStats(clientRes.elaStats);

      const aiRes = await runServerAiAnalysis(
        clientRes.preparedBase64,
        clientRes.preparedMimeType,
        clientRes.metadata
      );
      if (seq !== scanSequenceRef.current) return;

      const fullReport = assembleForensicReport(asset, clientRes, aiRes);
      setActiveReport(fullReport);
      setIsAnalyzing(false);

      // Save to local IndexedDB history
      const thumb = await createCompactThumbnail(asset.dataUrl, 360);
      const record: HistoryRecord = {
        id: fullReport.id,
        createdAt: fullReport.createdAt,
        thumbnailDataUrl: thumb,
        imageDataUrl: asset.dataUrl,
        report: fullReport,
      };
      await saveHistoryRecord(record);
      setHistory((prev) => [record, ...prev.filter((r) => r.id !== record.id)].slice(0, 40));
    } catch (err) {
      if (seq !== scanSequenceRef.current) return;
      setIsAnalyzing(false);
      setAnalyzeError(
        err instanceof Error ? err.message : 'Unable to complete forensic analysis.'
      );
    }
  }, []);

  const handleSelectFile = useCallback(
    async (file: File, sourceType: 'upload' | 'paste' | 'camera' = 'upload') => {
      setUploadError(null);
      setIsLoadingAsset(true);
      try {
        const asset = await loadFromFile(file, sourceType);
        setIsLoadingAsset(false);
        await executePrimaryAnalysis(asset);
      } catch (err) {
        setIsLoadingAsset(false);
        setUploadError(err instanceof Error ? err.message : 'Could not load image file.');
      }
    },
    [executePrimaryAnalysis]
  );

  const handleImportUrl = useCallback(
    async (url: string) => {
      setUploadError(null);
      setIsLoadingAsset(true);
      try {
        const asset = await loadFromRemoteUrl(url);
        setIsLoadingAsset(false);
        await executePrimaryAnalysis(asset);
      } catch (err) {
        setIsLoadingAsset(false);
        setUploadError(err instanceof Error ? err.message : 'Could not import image URL.');
      }
    },
    [executePrimaryAnalysis]
  );

  const handleSelectSample = useCallback(
    async (sample: SampleImage) => {
      setUploadError(null);
      setIsLoadingAsset(true);
      try {
        const asset = await loadFromSampleAsset(sample.url, sample.fileName);
        setIsLoadingAsset(false);
        await executePrimaryAnalysis(asset);
      } catch (err) {
        setIsLoadingAsset(false);
        setUploadError(err instanceof Error ? err.message : 'Could not load sample image.');
      }
    },
    [executePrimaryAnalysis]
  );

  // Global Ctrl+V / Cmd+V clipboard paste support on Analyze view
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (activeTab !== 'analyze') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            handleSelectFile(file, 'paste');
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [activeTab, handleSelectFile]);

  const handleNewScan = () => {
    scanSequenceRef.current++;
    clearShareUrlFromAddressBar();
    setSharedBanner(null);
    setShareLoadError(null);
    setActiveTab('analyze');
    setActiveAsset(null);
    setActiveImageUrl(null);
    setActiveMetadata(null);
    setActiveElaUrl(null);
    setActiveElaStats(null);
    setActiveReport(null);
    setAnalyzeError(null);
    setUploadError(null);
    setIsAnalyzing(false);
    setSelectedRegionId(null);
    setHoveredRegionId(null);
  };

  const handleRetryAnalysis = () => {
    if (activeAsset) {
      executePrimaryAnalysis(activeAsset);
    }
  };

  const handleQuickExport = () => {
    if (!activeReport) return;
    const baseName = activeReport.metadata.fileName.replace(/\.[^.]+$/, '');
    const effectiveReport: ForensicReport = {
      ...activeReport,
      verdict: classifyByThreshold(Math.round(activeReport.aiProbability), aiThreshold),
    };
    downloadTextFile(
      buildMarkdownReport(effectiveReport),
      `${baseName}-forensic-report.md`,
      'text/markdown;charset=utf-8'
    );
  };

  // Compare Slot Pipeline
  const setSlot = (slotKey: 'A' | 'B', updater: (prev: CompareSlot) => CompareSlot) => {
    if (slotKey === 'A') setSlotA(updater);
    else setSlotB(updater);
  };

  const runCompareSlotAnalysis = async (slotKey: 'A' | 'B', asset: LoadedImageAsset) => {
    setSlot(slotKey, () => ({
      imageDataUrl: asset.dataUrl,
      elaDataUrl: null,
      report: null,
      metadata: null,
      elaStats: null,
      isLoading: true,
      error: null,
    }));

    try {
      const clientRes = await runClientForensics(asset, 90, 15, 'thermal');
      setSlot(slotKey, (prev) => ({
        ...prev,
        elaDataUrl: clientRes.elaDataUrl,
        metadata: clientRes.metadata,
        elaStats: clientRes.elaStats,
      }));

      const aiRes = await runServerAiAnalysis(
        clientRes.preparedBase64,
        clientRes.preparedMimeType,
        clientRes.metadata
      );
      const report = assembleForensicReport(asset, clientRes, aiRes);

      setSlot(slotKey, (prev) => ({
        ...prev,
        report,
        isLoading: false,
      }));

      const thumb = await createCompactThumbnail(asset.dataUrl, 360);
      const record: HistoryRecord = {
        id: report.id,
        createdAt: report.createdAt,
        thumbnailDataUrl: thumb,
        imageDataUrl: asset.dataUrl,
        report,
      };
      await saveHistoryRecord(record);
      setHistory((prev) => [record, ...prev.filter((r) => r.id !== record.id)].slice(0, 40));
    } catch (err) {
      setSlot(slotKey, (prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Comparison scan failed.',
      }));
    }
  };

  const handleCompareFile = async (slotKey: 'A' | 'B', file: File) => {
    try {
      const asset = await loadFromFile(file, 'upload');
      await runCompareSlotAnalysis(slotKey, asset);
    } catch (err) {
      setSlot(slotKey, () => ({
        ...EMPTY_COMPARE_SLOT,
        error: err instanceof Error ? err.message : 'Unable to load file.',
      }));
    }
  };

  const handleCompareUrl = async (slotKey: 'A' | 'B', url: string) => {
    setSlot(slotKey, () => ({ ...EMPTY_COMPARE_SLOT, isLoading: true }));
    try {
      const asset = await loadFromRemoteUrl(url);
      await runCompareSlotAnalysis(slotKey, asset);
    } catch (err) {
      setSlot(slotKey, () => ({
        ...EMPTY_COMPARE_SLOT,
        error: err instanceof Error ? err.message : 'Unable to fetch remote image.',
      }));
    }
  };

  const handleCompareSample = async (slotKey: 'A' | 'B', sample: SampleImage) => {
    setActiveTab('compare');
    setSlot(slotKey, () => ({ ...EMPTY_COMPARE_SLOT, isLoading: true }));
    try {
      const asset = await loadFromSampleAsset(sample.url, sample.fileName);
      await runCompareSlotAnalysis(slotKey, asset);
    } catch (err) {
      setSlot(slotKey, () => ({
        ...EMPTY_COMPARE_SLOT,
        error: err instanceof Error ? err.message : 'Unable to load sample.',
      }));
    }
  };

  const handleLoadHistoryIntoCompare = async (slotKey: 'A' | 'B', record: HistoryRecord) => {
    setActiveTab('compare');
    setSlot(slotKey, () => ({
      imageDataUrl: record.imageDataUrl,
      elaDataUrl: null,
      report: record.report,
      metadata: record.report.metadata,
      elaStats: record.report.elaStats,
      isLoading: false,
      error: null,
    }));
    try {
      const ela = await computeErrorLevelAnalysis(record.imageDataUrl, 90, 15, 'thermal');
      setSlot(slotKey, (prev) => ({
        ...prev,
        elaDataUrl: ela.elaDataUrl,
        elaStats: ela.stats,
      }));
    } catch {
      // ELA optional
    }
  };

  const handleSendActiveToCompare = (slotKey: 'A' | 'B') => {
    if (!activeImageUrl || !activeReport) return;
    setSlot(slotKey, () => ({
      imageDataUrl: activeImageUrl,
      elaDataUrl: activeElaUrl,
      report: activeReport,
      metadata: activeMetadata,
      elaStats: activeElaStats,
      isLoading: false,
      error: null,
    }));
    setActiveTab('compare');
  };

  const handleOpenHistoryRecord = async (record: HistoryRecord) => {
    scanSequenceRef.current++;
    setActiveTab('analyze');
    setActiveAsset(null);
    setActiveImageUrl(record.imageDataUrl);
    setActiveMetadata(record.report.metadata);
    setActiveReport(record.report);
    setActiveElaStats(record.report.elaStats);
    setAnalyzeError(null);
    setUploadError(null);
    setIsAnalyzing(false);
    setSelectedRegionId(null);
    setHoveredRegionId(null);
  };

  const handleOpenCompareInAnalyzer = (slotKey: 'A' | 'B') => {
    const slot = slotKey === 'A' ? slotA : slotB;
    if (!slot.imageDataUrl || !slot.report) return;
    scanSequenceRef.current++;
    setActiveTab('analyze');
    setActiveAsset(null);
    setActiveImageUrl(slot.imageDataUrl);
    setActiveMetadata(slot.metadata);
    setActiveReport(slot.report);
    setActiveElaUrl(slot.elaDataUrl);
    setActiveElaStats(slot.elaStats);
    setAnalyzeError(null);
    setIsAnalyzing(false);
    setSelectedRegionId(null);
  };

  const handleDeleteHistory = async (id: string) => {
    await deleteHistoryRecord(id);
    setHistory((prev) => prev.filter((r) => r.id !== id));
  };

  const handleClearHistory = async () => {
    await clearHistoryRecords();
    setHistory([]);
  };

  // Batch Processing Queue Pipeline (non-interrupting worker pool, concurrency = 2)
  const pendingBatchIdsRef = useRef<string[]>([]);
  const batchRunningRef = useRef(false);

  const drainBatchQueue = useCallback(async () => {
    if (batchRunningRef.current) return;
    if (pendingBatchIdsRef.current.length === 0) return;

    const runId = ++batchRunIdRef.current;
    batchRunningRef.current = true;
    setIsBatchRunning(true);

    const worker = async () => {
      while (pendingBatchIdsRef.current.length > 0) {
        if (batchRunIdRef.current !== runId) return;
        const id = pendingBatchIdsRef.current.shift();
        if (!id) break;
        const asset = batchAssetsRef.current.get(id);
        if (!asset) continue;

        setBatchItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, status: 'analyzing', error: null } : item
          )
        );

        try {
          const clientRes = await runClientForensics(asset, 90, 15, 'thermal');
          if (batchRunIdRef.current !== runId) return;

          setBatchItems((prev) =>
            prev.map((item) =>
              item.id === id
                ? {
                    ...item,
                    metadata: clientRes.metadata,
                    elaDataUrl: clientRes.elaDataUrl,
                    elaStats: clientRes.elaStats,
                  }
                : item
            )
          );

          const aiRes = await runServerAiAnalysis(
            clientRes.preparedBase64,
            clientRes.preparedMimeType,
            clientRes.metadata
          );
          if (batchRunIdRef.current !== runId) return;

          const report = assembleForensicReport(asset, clientRes, aiRes);
          setBatchItems((prev) =>
            prev.map((item) =>
              item.id === id
                ? { ...item, report, status: 'complete', error: null }
                : item
            )
          );

          const thumb = await createCompactThumbnail(asset.dataUrl, 360);
          const record: HistoryRecord = {
            id: report.id,
            createdAt: report.createdAt,
            thumbnailDataUrl: thumb,
            imageDataUrl: asset.dataUrl,
            report,
          };
          await saveHistoryRecord(record);
          setHistory((prev) => [record, ...prev.filter((r) => r.id !== record.id)].slice(0, 40));
        } catch (err) {
          if (batchRunIdRef.current !== runId) return;
          const message =
            err instanceof Error ? err.message : 'Unable to analyze this image.';
          setBatchItems((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, status: 'error', error: message } : item
            )
          );
        }

        if (pendingBatchIdsRef.current.length > 0 && batchRunIdRef.current === runId) {
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      }
    };

    await worker();

    if (batchRunIdRef.current === runId) {
      batchRunningRef.current = false;
      setIsBatchRunning(false);
    }
  }, []);

  const runBatchQueue = useCallback(
    async (targetIds?: string[]) => {
      const idsToEnqueue = targetIds
        ? targetIds
        : batchItemsRef.current
            .filter((item) => item.status === 'queued')
            .map((item) => item.id);

      for (const id of idsToEnqueue) {
        if (!pendingBatchIdsRef.current.includes(id)) {
          pendingBatchIdsRef.current.push(id);
        }
      }
      await drainBatchQueue();
    },
    [drainBatchQueue]
  );

  const enqueueBatchAssets = useCallback(
    async (assets: LoadedImageAsset[]) => {
      const preparedItems: BatchItem[] = [];
      for (const asset of assets) {
        const id = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const thumb = await createCompactThumbnail(asset.dataUrl, 240);
        batchAssetsRef.current.set(id, asset);
        preparedItems.push({
          id,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          fileSize: asset.blob.size,
          sourceType: asset.sourceType,
          imageDataUrl: asset.dataUrl,
          thumbnailDataUrl: thumb,
          elaDataUrl: null,
          metadata: null,
          elaStats: null,
          report: null,
          status: 'queued',
          error: null,
        });
      }

      if (preparedItems.length === 0) return;

      setBatchItems((prev) => [...prev, ...preparedItems]);
      void runBatchQueue(preparedItems.map((item) => item.id));
    },
    [runBatchQueue]
  );

  const handleAddBatchFiles = useCallback(
    async (files: File[]) => {
      setBatchNotice(null);
      setActiveTab('batch');
      const maxBatchAddition = 20;
      const sliced = files.slice(0, maxBatchAddition);
      const loaded: LoadedImageAsset[] = [];
      let skippedCount = Math.max(0, files.length - maxBatchAddition);

      for (const file of sliced) {
        try {
          const asset = await loadFromFile(file, 'upload');
          loaded.push(asset);
        } catch {
          skippedCount++;
        }
      }

      if (skippedCount > 0) {
        setBatchNotice(
          `Skipped ${skippedCount} file${skippedCount > 1 ? 's' : ''} (unsupported format, over 10 MB, or above the 20-image batch limit).`
        );
      }

      if (loaded.length > 0) {
        await enqueueBatchAssets(loaded);
      }
    },
    [enqueueBatchAssets]
  );

  const handleCameraQueueToBatch = useCallback(
    async (file: File) => {
      try {
        const asset = await loadFromFile(file, 'camera');
        await enqueueBatchAssets([asset]);
      } catch {
        // Ignore invalid camera capture
      }
    },
    [enqueueBatchAssets]
  );

  const handleLoadAllSamplesIntoBatch = useCallback(async () => {
    setBatchNotice(null);
    setActiveTab('batch');
    const loaded: LoadedImageAsset[] = [];
    for (const sample of SAMPLE_IMAGES) {
      try {
        const asset = await loadFromSampleAsset(sample.url, sample.fileName);
        loaded.push(asset);
      } catch {
        // Ignore unavailable sample
      }
    }
    if (loaded.length > 0) {
      await enqueueBatchAssets(loaded);
    }
  }, [enqueueBatchAssets]);

  const handleStopBatchQueue = () => {
    batchRunIdRef.current++;
    pendingBatchIdsRef.current = [];
    batchRunningRef.current = false;
    setIsBatchRunning(false);
    setBatchItems((prev) =>
      prev.map((item) =>
        item.status === 'analyzing' ? { ...item, status: 'queued' } : item
      )
    );
  };

  const handleRetryBatchItem = (id: string) => {
    setBatchItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: 'queued', error: null } : item
      )
    );
    void runBatchQueue([id]);
  };

  const handleRetryAllFailedBatch = () => {
    const failedIds = batchItemsRef.current
      .filter((i) => i.status === 'error')
      .map((i) => i.id);
    if (failedIds.length === 0) return;
    setBatchItems((prev) =>
      prev.map((item) =>
        item.status === 'error' ? { ...item, status: 'queued', error: null } : item
      )
    );
    void runBatchQueue(failedIds);
  };

  const handleRemoveBatchItem = (id: string) => {
    pendingBatchIdsRef.current = pendingBatchIdsRef.current.filter((itemId) => itemId !== id);
    batchAssetsRef.current.delete(id);
    setBatchItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearBatch = () => {
    batchRunIdRef.current++;
    pendingBatchIdsRef.current = [];
    batchRunningRef.current = false;
    batchAssetsRef.current.clear();
    setIsBatchRunning(false);
    setBatchNotice(null);
    setBatchItems([]);
  };

  const handleInspectBatchItem = (item: BatchItem) => {
    if (!item.report) return;
    scanSequenceRef.current++;
    setActiveTab('analyze');
    setActiveAsset(batchAssetsRef.current.get(item.id) ?? null);
    setActiveImageUrl(item.imageDataUrl);
    setActiveMetadata(item.metadata);
    setActiveReport(item.report);
    setActiveElaUrl(item.elaDataUrl);
    setActiveElaStats(item.elaStats);
    setAnalyzeError(null);
    setUploadError(null);
    setIsAnalyzing(false);
    setSelectedRegionId(null);
    setHoveredRegionId(null);
  };

  const handleSendBatchItemToCompare = (slotKey: 'A' | 'B', item: BatchItem) => {
    if (!item.report) return;
    setSlot(slotKey, () => ({
      imageDataUrl: item.imageDataUrl,
      elaDataUrl: item.elaDataUrl,
      report: item.report,
      metadata: item.metadata,
      elaStats: item.elaStats,
      isLoading: false,
      error: null,
    }));
    setActiveTab('compare');
  };

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900 transition-colors dark:bg-[#0B0F17] dark:text-slate-100">
      <TopNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onNewScan={handleNewScan}
        historyCount={history.length}
        batchCount={batchItems.length}
      />

      <SubToolbar
        activeTab={activeTab}
        metadata={activeMetadata}
        report={activeReport}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onQuickExport={handleQuickExport}
        onOpenCamera={() => setIsCameraOpen(true)}
      />

      <main className="flex-1">
        {activeTab === 'analyze' ? (
          isLoadingShared ? (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center px-4 py-20 text-center">
              <Loader2 className="h-7 w-7 animate-spin text-blue-600 dark:text-blue-400" />
              <h1 className="mt-4 font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                Loading shared forensic report…
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Validating verdict, signal scores, metadata, and inspection layers.
              </p>
            </div>
          ) : activeImageUrl || activeReport ? (
            <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
              {sharedBanner ? (
                <div className="mb-4 flex flex-col justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs text-blue-900 sm:flex-row sm:items-center dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link2 className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                    <span className="truncate">
                      Viewing shared forensic report · Shared{' '}
                      {new Date(sharedBanner.sharedAt).toLocaleString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleNewScan}
                    className="self-start font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap sm:self-auto dark:text-blue-300 dark:hover:text-blue-200"
                  >
                    Scan your own image →
                  </button>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-12 lg:items-start">
                <div className="lg:col-span-7 xl:col-span-8">
                  {activeImageUrl ? (
                    <ForensicCanvas
                      imageDataUrl={activeImageUrl}
                      elaDataUrl={activeElaUrl}
                      elaStats={activeElaStats}
                      regions={activeReport?.regions ?? []}
                      selectedRegionId={selectedRegionId}
                      hoveredRegionId={hoveredRegionId}
                      onSelectRegion={setSelectedRegionId}
                      onHoverRegion={setHoveredRegionId}
                      elaQuality={elaQuality}
                      elaScale={elaScale}
                      elaPalette={elaPalette}
                      isRecomputingEla={isRecomputingEla}
                      onChangeElaQuality={setElaQuality}
                      onChangeElaScale={setElaScale}
                      onChangeElaPalette={setElaPalette}
                      isAnalyzing={isAnalyzing}
                    />
                  ) : (
                    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center dark:border-slate-700 dark:bg-[#111827]/70">
                      <Link2 className="h-7 w-7 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                      <h2 className="mt-3 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                        Compact Shared Report Snapshot
                      </h2>
                      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        This compact deep-link embeds the complete authenticity verdict, 6-channel forensic scores, EXIF summary, and ELA metrics without original image bytes.
                      </p>
                      <button
                        type="button"
                        onClick={handleNewScan}
                        className="mt-5 inline-flex min-h-[40px] items-center rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                      >
                        Analyze a New Image
                      </button>
                    </div>
                  )}
                </div>

                <div className="lg:col-span-5 xl:col-span-4">
                  <ReportInspector
                    report={activeReport}
                    metadata={activeMetadata}
                    elaStats={activeElaStats}
                    imageDataUrl={activeImageUrl}
                    elaDataUrl={activeElaUrl}
                    isAnalyzing={isAnalyzing}
                    errorMessage={analyzeError}
                    selectedRegionId={selectedRegionId}
                    hoveredRegionId={hoveredRegionId}
                    onSelectRegion={setSelectedRegionId}
                    onHoverRegion={setHoveredRegionId}
                    onRetry={handleRetryAnalysis}
                    onSendToCompare={handleSendActiveToCompare}
                    aiThreshold={aiThreshold}
                    onChangeAiThreshold={setAiThreshold}
                  />
                </div>
              </div>
            </div>
          ) : (
            <UploadStage
              onSelectFile={(file) => handleSelectFile(file, 'upload')}
              onSelectMultipleFiles={handleAddBatchFiles}
              onImportUrl={handleImportUrl}
              onSelectSample={handleSelectSample}
              onOpenCamera={() => setIsCameraOpen(true)}
              isBusy={isLoadingAsset}
              errorMessage={shareLoadError || uploadError}
            />
          )
        ) : null}

        {activeTab === 'batch' ? (
          <BatchView
            items={batchItems}
            isRunning={isBatchRunning}
            uploadNotice={batchNotice}
            onAddFiles={handleAddBatchFiles}
            onLoadAllSamples={handleLoadAllSamplesIntoBatch}
            onStartQueue={() => void runBatchQueue()}
            onStopQueue={handleStopBatchQueue}
            onRetryItem={handleRetryBatchItem}
            onRetryAllFailed={handleRetryAllFailedBatch}
            onRemoveItem={handleRemoveBatchItem}
            onClearBatch={handleClearBatch}
            onInspectItem={handleInspectBatchItem}
            onSendToCompare={handleSendBatchItemToCompare}
          />
        ) : null}

        {activeTab === 'compare' ? (
          <CompareView
            slotA={slotA}
            slotB={slotB}
            history={history}
            onLoadFile={handleCompareFile}
            onLoadUrl={handleCompareUrl}
            onLoadSample={handleCompareSample}
            onLoadHistory={handleLoadHistoryIntoCompare}
            onClearSlot={(k) => setSlot(k, () => EMPTY_COMPARE_SLOT)}
            onSwapSlots={() => {
              const prevA = slotA;
              setSlotA(slotB);
              setSlotB(prevA);
            }}
            onOpenInAnalyzer={handleOpenCompareInAnalyzer}
          />
        ) : null}

        {activeTab === 'samples' ? (
          <SamplesView
            onAnalyzeSample={handleSelectSample}
            onCompareSample={handleCompareSample}
          />
        ) : null}

        {activeTab === 'history' ? (
          <HistoryView
            records={history}
            onOpenRecord={handleOpenHistoryRecord}
            onSendToCompare={handleLoadHistoryIntoCompare}
            onDeleteRecord={handleDeleteHistory}
            onClearAll={handleClearHistory}
            onStartNewScan={handleNewScan}
          />
        ) : null}
      </main>

      <footer className="border-t border-slate-200 bg-white py-5 pb-20 md:pb-5 dark:border-slate-800 dark:bg-[#0B0F17]">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-2 px-4 text-center text-xs text-slate-500 sm:flex-row sm:px-6 sm:text-left lg:px-8 dark:text-slate-400">
          <span>Veritas Lens · AI Image Authenticity Analyzer</span>
          <span>EXIF & ELA run locally in your browser · History stays on your device</span>
        </div>
      </footer>

      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        historyCount={history.length}
        batchCount={batchItems.length}
      />

      <CameraCaptureModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCaptureAnalyze={(file) => {
          setIsCameraOpen(false);
          void handleSelectFile(file, 'camera');
        }}
        onCaptureAddToBatch={(file) => {
          void handleCameraQueueToBatch(file);
        }}
        onOpenBatchTab={() => setActiveTab('batch')}
      />
    </div>
  );
}
