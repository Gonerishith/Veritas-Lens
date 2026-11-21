import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  Grid3x3,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Smartphone,
  SwitchCamera,
  X,
} from 'lucide-react';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaptureAnalyze: (file: File) => void;
  onCaptureAddToBatch: (file: File) => void;
  onOpenBatchTab: () => void;
}

interface CapturedFrame {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

function buildCaptureFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `camera-capture-${stamp}.jpg`;
}

export function CameraCaptureModal({
  isOpen,
  onClose,
  onCaptureAnalyze,
  onCaptureAddToBatch,
  onOpenBatchTab,
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceIndex, setActiveDeviceIndex] = useState<number>(-1);
  const [isStarting, setIsStarting] = useState(false);
  const [streamReady, setStreamReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [flashActive, setFlashActive] = useState(false);
  const [captured, setCaptured] = useState<CapturedFrame | null>(null);
  const [batchQueuedCount, setBatchQueuedCount] = useState(0);
  const [resolutionLabel, setResolutionLabel] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreamReady(false);
  }, []);

  const clearCaptured = useCallback(() => {
    setCaptured((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, []);

  const startCamera = useCallback(
    async (targetFacing: 'environment' | 'user', specificDeviceId?: string) => {
      stopStream();
      setIsStarting(true);
      setCameraError(null);
      setResolutionLabel(null);

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setIsStarting(false);
        setCameraError(
          'Live browser camera streaming is unavailable on this device or context. Use the Device Camera button below to take a photo directly.'
        );
        return;
      }

      const tryConstraints = async (constraints: MediaStreamConstraints) =>
        navigator.mediaDevices.getUserMedia(constraints);

      try {
        let stream: MediaStream;
        try {
          const videoConstraint: MediaTrackConstraints = specificDeviceId
            ? {
                deviceId: { exact: specificDeviceId },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              }
            : {
                facingMode: { ideal: targetFacing },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              };
          stream = await tryConstraints({ video: videoConstraint, audio: false });
        } catch (firstErr) {
          // Retry with relaxed constraints if exact device or ideal resolution is rejected
          if (
            firstErr instanceof DOMException &&
            (firstErr.name === 'NotAllowedError' || firstErr.name === 'SecurityError')
          ) {
            throw firstErr;
          }
          stream = await tryConstraints({ video: true, audio: false });
        }

        streamRef.current = stream;

        const videoEl = videoRef.current;
        if (videoEl) {
          videoEl.srcObject = stream;
          await videoEl.play().catch(() => {});
        }

        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings?.();
        if (settings?.width && settings?.height) {
          setResolutionLabel(`${settings.width} × ${settings.height}`);
        }

        // Enumerate cameras after permission is granted so labels/count are populated
        if (navigator.mediaDevices.enumerateDevices) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices.filter((d) => d.kind === 'videoinput');
            setVideoDevices(cameras);
            if (settings?.deviceId) {
              const foundIdx = cameras.findIndex((c) => c.deviceId === settings.deviceId);
              if (foundIdx >= 0) setActiveDeviceIndex(foundIdx);
            }
          } catch {
            // Non-fatal
          }
        }

        setStreamReady(true);
      } catch (err) {
        if (err instanceof DOMException) {
          if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
            setCameraError(
              'Camera access was blocked or denied. Allow camera permission in your browser settings, or use the Device Camera button below.'
            );
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            setCameraError(
              'No camera was detected on this device. Connect a camera or use the Device Camera button below.'
            );
          } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            setCameraError(
              'The camera is currently in use by another application. Close the other app and tap Retry.'
            );
          } else {
            setCameraError(`Unable to start camera (${err.message || err.name}).`);
          }
        } else {
          setCameraError('Unable to access the camera right now. You can use the Device Camera option below.');
        }
      } finally {
        setIsStarting(false);
      }
    },
    [stopStream]
  );

  // Start / stop stream when modal opens or closes
  useEffect(() => {
    if (!isOpen) {
      stopStream();
      clearCaptured();
      setBatchQueuedCount(0);
      setCameraError(null);
      return;
    }

    void startCamera(facingMode);

    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleCaptureFrame = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !streamReady || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) return;

    const width = videoEl.videoWidth;
    const height = videoEl.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Mirror captured frame when using front-facing selfie camera so it matches preview
    if (facingMode === 'user') {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoEl, 0, 0, width, height);

    setFlashActive(true);
    window.setTimeout(() => setFlashActive(false), 160);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], buildCaptureFilename(), {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
        const previewUrl = URL.createObjectURL(blob);
        setCaptured((prev) => {
          if (prev) URL.revokeObjectURL(prev.previewUrl);
          return { file, previewUrl, width, height };
        });
      },
      'image/jpeg',
      0.94
    );
  }, [facingMode, streamReady]);

  // Keyboard shortcuts: Escape to close, Space to snap while viewfinder active
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === ' ' && !captured && streamReady && !cameraError) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== 'BUTTON' && tag !== 'INPUT') {
          e.preventDefault();
          handleCaptureFrame();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, captured, streamReady, cameraError, handleCaptureFrame]);

  const handleSwitchCamera = () => {
    clearCaptured();
    if (videoDevices.length > 1) {
      const nextIdx = (activeDeviceIndex + 1) % videoDevices.length;
      setActiveDeviceIndex(nextIdx);
      const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
      setFacingMode(nextFacing);
      void startCamera(nextFacing, videoDevices[nextIdx].deviceId);
    } else {
      const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
      setFacingMode(nextFacing);
      void startCamera(nextFacing);
    }
  };

  const handleAnalyzeCaptured = () => {
    if (!captured) return;
    const fileToAnalyze = captured.file;
    stopStream();
    clearCaptured();
    onCaptureAnalyze(fileToAnalyze);
  };

  const handleQueueToBatch = () => {
    if (!captured) return;
    const fileToQueue = captured.file;
    onCaptureAddToBatch(fileToQueue);
    setBatchQueuedCount((c) => c + 1);
    clearCaptured();
  };

  const handleNativeCameraFile = (file: File | undefined) => {
    if (!file) return;
    stopStream();
    clearCaptured();
    onCaptureAnalyze(file);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Camera capture studio"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/75 backdrop-blur-xs sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-[#0F1522]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold text-slate-900 sm:text-base dark:text-slate-100">
              Live Camera Capture
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
              {captured
                ? `Captured frame · ${captured.width} × ${captured.height} px`
                : resolutionLabel
                  ? `${facingMode === 'environment' ? 'Rear' : 'Front'} camera · ${resolutionLabel} px`
                  : 'Capture a real photo to run authenticity, EXIF, and ELA inspection'}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!captured && streamReady ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowGrid((g) => !g)}
                  aria-pressed={showGrid}
                  title="Toggle framing grid"
                  className={`inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border text-xs transition-colors sm:min-h-0 sm:min-w-0 sm:p-2 ${
                    showGrid
                      ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <Grid3x3 className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={handleSwitchCamera}
                  title="Switch camera"
                  aria-label="Switch front or rear camera"
                  className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 sm:min-h-0 sm:min-w-0 sm:p-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <SwitchCamera className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            ) : null}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close camera"
              className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 sm:min-h-0 sm:min-w-0 sm:p-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Hidden Native OS Camera Capture Input (preserves full smartphone EXIF metadata) */}
        <input
          ref={nativeCameraInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            handleNativeCameraFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {/* Viewfinder / Captured Still Preview */}
        <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-slate-950 sm:aspect-[16/10]">
          {/* Always mount video element so videoRef is ready before getUserMedia resolves */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover ${
              facingMode === 'user' ? '-scale-x-100' : ''
            } ${captured || cameraError ? 'hidden' : 'block'}`}
          />

          {/* Captured still image preview */}
          {captured ? (
            <img
              src={captured.previewUrl}
              alt="Captured camera photo preview"
              className="h-full w-full object-contain bg-slate-950"
            />
          ) : null}

          {/* Subtle Rule-of-Thirds Viewfinder Grid */}
          {!captured && streamReady && showGrid && !cameraError ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/20" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/20" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/20" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/20" />
            </div>
          ) : null}

          {/* Brief Shutter Flash */}
          {flashActive ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-white/75" />
          ) : null}

          {/* Loading State */}
          {isStarting && !cameraError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-slate-950/90 px-6 text-center text-slate-200">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" aria-hidden="true" />
              <p className="text-sm font-medium">Requesting camera access…</p>
              <p className="text-xs text-slate-400">
                Approve the browser permission prompt to start the live viewfinder.
              </p>
            </div>
          ) : null}

          {/* Error / Permission Denied Fallback State */}
          {cameraError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-amber-500/40 bg-amber-950/50 text-amber-300">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-3 max-w-md text-sm font-medium text-slate-100">
                Camera preview unavailable
              </p>
              <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-300">
                {cameraError}
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void startCamera(facingMode)}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Retry Camera</span>
                </button>
                <button
                  type="button"
                  onClick={() => nativeCameraInputRef.current?.click()}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 whitespace-nowrap shrink-0"
                >
                  <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Use Device Camera App</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Batch capture status bar when user snaps multiple photos */}
        {batchQueuedCount > 0 ? (
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/80">
            <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span className="font-mono tabular-nums font-medium">{batchQueuedCount}</span>
              <span>
                {batchQueuedCount === 1 ? 'photo added' : 'photos added'} to Batch Queue
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                stopStream();
                clearCaptured();
                onClose();
                onOpenBatchTab();
              }}
              className="font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Open Batch →
            </button>
          </div>
        ) : null}

        {/* Bottom Control Bar */}
        <div
          className="border-t border-slate-200 bg-white px-4 py-3.5 sm:px-5 dark:border-slate-800 dark:bg-[#0F1522]"
          style={{ paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))' }}
        >
          {captured ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={clearCaptured}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 sm:min-h-0 sm:rounded-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>Retake</span>
              </button>

              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                <button
                  type="button"
                  onClick={handleQueueToBatch}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0 sm:min-h-0 sm:rounded-lg sm:text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <Layers className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                  <span>Add to Batch</span>
                </button>

                <button
                  type="button"
                  onClick={handleAnalyzeCaptured}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0 sm:min-h-0 sm:rounded-lg sm:text-sm dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  <Camera className="h-4 w-4" aria-hidden="true" />
                  <span>Analyze Photo</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 sm:min-h-0 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Smartphone className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                <span>Device Camera</span>
              </button>

              {/* Primary Tactile Shutter Button */}
              <button
                type="button"
                disabled={!streamReady || Boolean(cameraError)}
                onClick={handleCaptureFrame}
                aria-label="Capture photo"
                className="group relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-slate-900 bg-white p-1 transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-100 dark:bg-slate-900"
              >
                <span className="flex h-full w-full items-center justify-center rounded-full bg-blue-600 text-white transition-colors group-hover:bg-blue-700 dark:bg-blue-500 dark:group-hover:bg-blue-400">
                  <Camera className="h-5 w-5" aria-hidden="true" />
                </span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[42px] items-center justify-center rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:text-slate-900 whitespace-nowrap shrink-0 sm:min-h-0 dark:text-slate-400 dark:hover:text-slate-100"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
