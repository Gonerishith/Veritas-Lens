import exifr from 'exifr';
import type {
  ImageMetadata,
  MetadataField,
  ProvenanceEvent,
  ProvenanceEventKind,
} from '../types/forensics';

const AI_SIGNATURE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /midjourney/i, label: 'Midjourney metadata signature' },
  { pattern: /dall-?e|openai/i, label: 'OpenAI / DALL-E metadata signature' },
  {
    pattern: /stable\s*diffusion|automatic1111|comfyui|invokeai/i,
    label: 'Stable Diffusion / ComfyUI workflow chunk',
  },
  { pattern: /firefly|adobe\s+generative/i, label: 'Adobe Firefly generative tag' },
  {
    pattern: /trainedalgorithmicmedia|compositewithtrainedalgorithmicmedia/i,
    label: 'IPTC/C2PA AI-generated digital source type',
  },
  { pattern: /c2pa|jumbf|contentcredentials/i, label: 'Content Credentials / C2PA provenance block' },
  { pattern: /imagen|synthid|google\s+ai/i, label: 'Google Generative AI metadata marker' },
  {
    pattern: /flux\.?1|black\s*forest\s*labs|leonardo\.ai|ideogram/i,
    label: 'Generative model software tag',
  },
];

const KIND_ORDER: Record<ProvenanceEventKind, number> = {
  capture: 0,
  digitized: 1,
  edit: 2,
  software_signature: 3,
  export: 4,
  ai_signature: 5,
};

function matchesAiSignature(text: string): string | undefined {
  for (const item of AI_SIGNATURE_PATTERNS) {
    if (item.pattern.test(text)) {
      return item.label;
    }
  }
  return undefined;
}

function computeAspectRatio(width: number, height: number): string {
  if (!width || !height) return '—';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  const w = Math.round(width / divisor);
  const h = Math.round(height / divisor);
  if (w > 32 || h > 32) {
    return `${(width / height).toFixed(2)}:1`;
  }
  return `${w}:${h}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function normalizeTimestamp(raw: unknown): string | undefined {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().replace('T', ' ').slice(0, 19);
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // Convert EXIF "YYYY:MM:DD HH:MM:SS" into "YYYY-MM-DD HH:MM:SS"
  const exifDateMatch = trimmed.match(/^(\d{4}):(\d{2}):(\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/);
  if (exifDateMatch) {
    const [, y, m, d, time] = exifDateMatch;
    if (y === '0000') return undefined;
    return time ? `${y}-${m}-${d} ${time}` : `${y}-${m}-${d}`;
  }
  // Clean ISO-8601 strings into readable UTC/offset format
  const isoMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/
  );
  if (isoMatch) {
    const [, datePart, timePart, tz] = isoMatch;
    return tz && tz !== 'Z' ? `${datePart} ${timePart} (${tz})` : `${datePart} ${timePart}`;
  }
  return trimmed.slice(0, 48);
}

function parseComparableEpoch(timestamp?: string): number | null {
  if (!timestamp) return null;
  const cleaned = timestamp.replace(/\s*\(([^)]+)\)\s*$/, '$1').replace(' ', 'T');
  const parsed = Date.parse(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

interface PngTextChunk {
  keyword: string;
  value: string;
  raw: string;
}

function scanPngTextChunks(buffer: ArrayBuffer): PngTextChunk[] {
  const bytes = new Uint8Array(buffer);
  // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length < 16 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return [];
  }

  const findings: PngTextChunk[] = [];
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    if (type === 'tEXt' || type === 'iTXt') {
      const slice = bytes.slice(dataStart, Math.min(dataEnd, dataStart + 32768));
      const nullIdx = slice.indexOf(0);
      const keyword =
        nullIdx > 0 ? decoder.decode(slice.slice(0, nullIdx)).trim() : type;
      const bodySlice = nullIdx >= 0 ? slice.slice(nullIdx + 1) : slice;
      const value = decoder
        .decode(bodySlice)
        .replace(/^\0+/, '')
        .replace(/\0+/g, ' ')
        .trim();
      if (value) {
        const raw = `${keyword}: ${value}`.slice(0, 260);
        findings.push({ keyword, value, raw });
      }
    }

    offset = dataEnd + 4; // skip CRC
    if (type === 'IEND') break;
  }

  return findings;
}

function extractRawXmpPacket(buffer: ArrayBuffer, pngChunks: PngTextChunk[]): string | null {
  // 1. Check PNG iTXt XMP chunk first
  for (const chunk of pngChunks) {
    if (
      /xmp/i.test(chunk.keyword) ||
      chunk.value.includes('<x:xmpmeta') ||
      chunk.value.includes('<rdf:RDF')
    ) {
      const start = chunk.value.indexOf('<x:xmpmeta');
      const altStart = start >= 0 ? start : chunk.value.indexOf('<rdf:RDF');
      if (altStart >= 0) {
        return chunk.value.slice(altStart, altStart + 160_000);
      }
    }
  }

  // 2. Scan head 384 KB and tail 64 KB for embedded XMP packet (JPEG APP1, WebP XMP, TIFF)
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const headText = decoder.decode(bytes.slice(0, Math.min(bytes.length, 393216)));
  const tailText =
    bytes.length > 393216
      ? decoder.decode(bytes.slice(Math.max(393216, bytes.length - 65536)))
      : '';

  for (const text of [headText, tailText]) {
    const startIdx = text.indexOf('<x:xmpmeta');
    if (startIdx >= 0) {
      const endIdx = text.indexOf('</x:xmpmeta>', startIdx);
      if (endIdx > startIdx) {
        return text.slice(startIdx, endIdx + '</x:xmpmeta>'.length);
      }
    }
    const rdfStart = text.indexOf('<rdf:RDF');
    if (rdfStart >= 0) {
      const rdfEnd = text.indexOf('</rdf:RDF>', rdfStart);
      if (rdfEnd > rdfStart) {
        return text.slice(rdfStart, rdfEnd + '</rdf:RDF>'.length);
      }
    }
  }

  return null;
}

function mapStEvtAction(rawAction?: string): { label: string; kind: ProvenanceEventKind } {
  const act = (rawAction || '').trim().toLowerCase();
  switch (act) {
    case 'created':
      return { label: 'File created', kind: 'capture' };
    case 'converted':
      return { label: 'Format converted', kind: 'export' };
    case 'saved':
      return { label: 'Saved edit', kind: 'edit' };
    case 'derived':
      return { label: 'Derived from parent asset', kind: 'edit' };
    case 'published':
      return { label: 'Published / exported', kind: 'export' };
    case 'edited':
      return { label: 'Edited image', kind: 'edit' };
    case 'resized':
      return { label: 'Resized image', kind: 'edit' };
    case 'cropped':
      return { label: 'Cropped image', kind: 'edit' };
    case 'formatted':
      return { label: 'Formatted / color managed', kind: 'edit' };
    default:
      return {
        label: act ? `Edit action: ${act}` : 'Software edit recorded',
        kind: 'edit',
      };
  }
}

function getElementAttrOrChild(el: Element, localName: string): string | undefined {
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    const cleanName = attr.localName || attr.name.split(':').pop() || '';
    if (cleanName.toLowerCase() === localName.toLowerCase() && attr.value.trim()) {
      return attr.value.trim();
    }
  }
  const children = el.getElementsByTagName('*');
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const cleanName = child.localName || child.tagName.split(':').pop() || '';
    if (cleanName.toLowerCase() === localName.toLowerCase()) {
      const text = child.textContent?.trim();
      if (text) return text;
    }
  }
  return undefined;
}

interface ExtractedXmpData {
  historyEvents: ProvenanceEvent[];
  creatorTool?: string;
  createDate?: string;
  modifyDate?: string;
  metadataDate?: string;
  digitalSourceType?: string;
  photoshopHistory?: string;
}

function parseXmpProvenance(xmpPacket: string): ExtractedXmpData {
  const result: ExtractedXmpData = { historyEvents: [] };

  try {
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(xmpPacket, 'application/xml');
      const hasParseError = doc.getElementsByTagName('parsererror').length > 0;
      if (!hasParseError) {
        const allElements = doc.getElementsByTagName('*');
        for (let i = 0; i < allElements.length; i++) {
          const el = allElements[i];
          const local = (el.localName || el.tagName.split(':').pop() || '').toLowerCase();

          if (local === 'description') {
            result.creatorTool = result.creatorTool || getElementAttrOrChild(el, 'CreatorTool');
            result.createDate = result.createDate || getElementAttrOrChild(el, 'CreateDate');
            result.modifyDate = result.modifyDate || getElementAttrOrChild(el, 'ModifyDate');
            result.metadataDate = result.metadataDate || getElementAttrOrChild(el, 'MetadataDate');
            result.digitalSourceType =
              result.digitalSourceType || getElementAttrOrChild(el, 'DigitalSourceType');
          }

          if (local === 'history' && (el.prefix === 'xmpMM' || el.tagName.includes('xmpMM'))) {
            const items = el.getElementsByTagName('*');
            for (let j = 0; j < items.length; j++) {
              const li = items[j];
              const liLocal = (li.localName || li.tagName.split(':').pop() || '').toLowerCase();
              if (liLocal !== 'li') continue;

              const actionRaw = getElementAttrOrChild(li, 'action');
              const softwareAgent = getElementAttrOrChild(li, 'softwareAgent');
              const when = normalizeTimestamp(getElementAttrOrChild(li, 'when'));
              const changed = getElementAttrOrChild(li, 'changed');
              const parameters = getElementAttrOrChild(li, 'parameters');

              if (!actionRaw && !softwareAgent && !when && !parameters) continue;

              const mapped = mapStEvtAction(actionRaw);
              const combined = `${softwareAgent || ''} ${parameters || ''} ${changed || ''}`;
              const aiHit = matchesAiSignature(combined);
              const detailParts: string[] = [];
              if (parameters) detailParts.push(parameters.slice(0, 140));
              if (changed && changed !== '/') detailParts.push(`Changed: ${changed.slice(0, 80)}`);

              result.historyEvents.push({
                id: `xmp-hist-${result.historyEvents.length + 1}`,
                kind: aiHit ? 'ai_signature' : mapped.kind,
                signature: softwareAgent || 'Unspecified XMP Agent',
                action: aiHit ? `${mapped.label} (${aiHit})` : mapped.label,
                timestamp: when,
                sourceTag: 'XMP xmpMM:History',
                details: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
                flagged: Boolean(aiHit),
              });
            }
          }

          if (local === 'history' && (el.prefix === 'photoshop' || el.tagName.includes('photoshop'))) {
            const text = el.textContent?.trim();
            if (text) result.photoshopHistory = text.slice(0, 320);
          }
        }
      }
    }
  } catch {
    // Fall through to resilient regex fallback below
  }

  // Fallback regex extraction for xmpMM:History when XML namespaces are partial or non-strict
  if (result.historyEvents.length === 0 && /stEvt:/i.test(xmpPacket)) {
    const liMatches = xmpPacket.match(/<rdf:li\b[^>]*>[\s\S]*?<\/rdf:li>|<rdf:li\b[^>]*\/>/gi) || [];
    liMatches.forEach((snippet, idx) => {
      if (!/stEvt:/i.test(snippet)) return;
      const grab = (name: string): string | undefined => {
        const attrMatch = snippet.match(new RegExp(`stEvt:${name}\\s*=\\s*"([^"]+)"`, 'i'));
        if (attrMatch?.[1]) return attrMatch[1].trim();
        const tagMatch = snippet.match(
          new RegExp(`<stEvt:${name}[^>]*>([^<]+)</stEvt:${name}>`, 'i')
        );
        return tagMatch?.[1]?.trim();
      };
      const actionRaw = grab('action');
      const softwareAgent = grab('softwareAgent');
      const when = normalizeTimestamp(grab('when'));
      const changed = grab('changed');
      const parameters = grab('parameters');
      if (!actionRaw && !softwareAgent && !when) return;

      const mapped = mapStEvtAction(actionRaw);
      const combined = `${softwareAgent || ''} ${parameters || ''}`;
      const aiHit = matchesAiSignature(combined);
      const detailParts: string[] = [];
      if (parameters) detailParts.push(parameters.slice(0, 140));
      if (changed && changed !== '/') detailParts.push(`Changed: ${changed.slice(0, 80)}`);

      result.historyEvents.push({
        id: `xmp-re-${idx + 1}`,
        kind: aiHit ? 'ai_signature' : mapped.kind,
        signature: softwareAgent || 'Unspecified XMP Agent',
        action: aiHit ? `${mapped.label} (${aiHit})` : mapped.label,
        timestamp: when,
        sourceTag: 'XMP xmpMM:History',
        details: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
        flagged: Boolean(aiHit),
      });
    });
  }

  if (!result.creatorTool) {
    const m =
      xmpPacket.match(/xmp:CreatorTool\s*=\s*"([^"]+)"/i) ||
      xmpPacket.match(/<xmp:CreatorTool[^>]*>([^<]+)<\/xmp:CreatorTool>/i);
    if (m?.[1]) result.creatorTool = m[1].trim();
  }

  if (!result.digitalSourceType) {
    const m =
      xmpPacket.match(/DigitalSourceType\s*=\s*"([^"]+)"/i) ||
      xmpPacket.match(/<[^>]*DigitalSourceType[^>]*>([^<]+)<\//i);
    if (m?.[1]) result.digitalSourceType = m[1].trim();
  }

  return result;
}

function scanC2paClaimGenerators(buffer: ArrayBuffer): string[] {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('latin1');
  const headText = decoder.decode(bytes.slice(0, Math.min(bytes.length, 262144)));
  const tailText =
    bytes.length > 262144
      ? decoder.decode(bytes.slice(Math.max(262144, bytes.length - 65536)))
      : '';
  const combined = `${headText}\n${tailText}`;

  const generators = new Set<string>();
  // Match CBOR/JSON-embedded C2PA claim_generator strings
  const regex = /claim_generator[^A-Za-z0-9/._-]{1,8}([A-Za-z][A-Za-z0-9 ._/+()-]{2,72})/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(combined)) !== null) {
    const candidate = match[1].replace(/\s+/g, ' ').trim();
    if (candidate.length >= 3 && !/^c2pa\.actions$/i.test(candidate)) {
      generators.add(candidate);
    }
    if (generators.size >= 4) break;
  }
  return Array.from(generators);
}

function scanRawBinaryForMarkers(buffer: ArrayBuffer): string | undefined {
  // Scan first 128 KB and last 32 KB for XMP / C2PA / AI prompt strings
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('latin1');
  const headText = decoder.decode(bytes.slice(0, Math.min(bytes.length, 131072)));
  const tailText =
    bytes.length > 131072
      ? decoder.decode(bytes.slice(Math.max(131072, bytes.length - 32768)))
      : '';
  const combined = `${headText}\n${tailText}`;
  return matchesAiSignature(combined);
}

function formatExposure(parsed: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (typeof parsed.FocalLength === 'number') {
    parts.push(`${Math.round(parsed.FocalLength)}mm`);
  }
  if (typeof parsed.FNumber === 'number') {
    parts.push(`f/${parsed.FNumber.toFixed(1).replace(/\.0$/, '')}`);
  }
  if (typeof parsed.ExposureTime === 'number' && parsed.ExposureTime > 0) {
    if (parsed.ExposureTime < 1) {
      parts.push(`1/${Math.round(1 / parsed.ExposureTime)}s`);
    } else {
      parts.push(`${parsed.ExposureTime}s`);
    }
  }
  if (typeof parsed.ISO === 'number') {
    parts.push(`ISO ${parsed.ISO}`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function formatDigitalSourceLabel(rawValue: string): {
  label: string;
  flagged: boolean;
} {
  const token = rawValue.split('/').pop()?.trim() || rawValue.trim();
  const lower = token.toLowerCase();
  if (lower.includes('compositewithtrainedalgorithmicmedia')) {
    return {
      label: 'Composite with trained algorithmic (AI) media',
      flagged: true,
    };
  }
  if (lower.includes('trainedalgorithmicmedia')) {
    return {
      label: 'Trained algorithmic (AI-generated) media',
      flagged: true,
    };
  }
  if (lower.includes('algorithmicmedia')) {
    return {
      label: 'Algorithmically generated media',
      flagged: true,
    };
  }
  if (lower.includes('digitalcapture')) {
    return {
      label: 'Original digital camera capture',
      flagged: false,
    };
  }
  if (lower.includes('compositecapture')) {
    return {
      label: 'Multi-frame composite capture',
      flagged: false,
    };
  }
  return {
    label: token,
    flagged: Boolean(matchesAiSignature(rawValue)),
  };
}

function sortAndDeduplicateProvenance(events: ProvenanceEvent[]): ProvenanceEvent[] {
  const seen = new Set<string>();
  const unique: ProvenanceEvent[] = [];

  for (const evt of events) {
    const sigKey = evt.signature.trim().toLowerCase();
    const actKey = evt.action.trim().toLowerCase();
    const tsKey = (evt.timestamp || '').slice(0, 19);
    const dedupeKey = `${evt.kind}|${sigKey}|${tsKey}|${actKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    unique.push(evt);
  }

  return unique
    .map((evt, originalIdx) => ({
      evt,
      originalIdx,
      epoch: parseComparableEpoch(evt.timestamp),
    }))
    .sort((a, b) => {
      // Capture always anchors the start of the timeline if both lack comparable earlier timestamps
      if (a.evt.kind === 'capture' && b.evt.kind !== 'capture') {
        if (a.epoch === null || b.epoch === null || a.epoch <= b.epoch) return -1;
      }
      if (b.evt.kind === 'capture' && a.evt.kind !== 'capture') {
        if (a.epoch === null || b.epoch === null || b.epoch <= a.epoch) return 1;
      }
      if (a.epoch !== null && b.epoch !== null && a.epoch !== b.epoch) {
        return a.epoch - b.epoch;
      }
      if (a.epoch !== null && b.epoch === null) return -1;
      if (a.epoch === null && b.epoch !== null) return 1;
      const kindDiff = KIND_ORDER[a.evt.kind] - KIND_ORDER[b.evt.kind];
      if (kindDiff !== 0) return kindDiff;
      return a.originalIdx - b.originalIdx;
    })
    .map((item, idx) => ({
      ...item.evt,
      id: `prov-${idx + 1}`,
    }));
}

export function deriveFallbackProvenance(meta: ImageMetadata): ProvenanceEvent[] {
  if (Array.isArray(meta.provenance)) {
    return meta.provenance;
  }

  const events: ProvenanceEvent[] = [];

  if (meta.cameraMake || meta.cameraModel || meta.lensModel || meta.dateTimeOriginal) {
    const cameraName = [meta.cameraMake, meta.cameraModel].filter(Boolean).join(' ');
    const detailParts = [meta.lensModel, meta.exposureSummary].filter(Boolean);
    events.push({
      id: 'fb-capture',
      kind: 'capture',
      signature: cameraName || 'Digital Camera EXIF',
      action: 'Original camera capture',
      timestamp: meta.dateTimeOriginal,
      sourceTag: 'EXIF IFD0 / ExifIFD',
      details: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
      flagged: false,
    });
  }

  if (meta.software) {
    const aiHit = matchesAiSignature(meta.software);
    events.push({
      id: 'fb-software',
      kind: aiHit ? 'ai_signature' : 'software_signature',
      signature: meta.software,
      action: aiHit ? `Generative software tag (${aiHit})` : 'Software signature recorded',
      sourceTag: 'EXIF / TIFF Software',
      flagged: Boolean(aiHit),
    });
  }

  if (meta.aiMarkerDetected && meta.aiMarkerDetails) {
    const alreadyCovered = events.some(
      (e) =>
        e.flagged &&
        (e.signature.toLowerCase().includes(meta.aiMarkerDetails!.toLowerCase()) ||
          e.action.toLowerCase().includes(meta.aiMarkerDetails!.toLowerCase()))
    );
    if (!alreadyCovered) {
      events.push({
        id: 'fb-ai-marker',
        kind: 'ai_signature',
        signature: meta.aiMarkerDetails,
        action: 'Generative provenance marker detected',
        sourceTag: 'Container Headers',
        flagged: true,
      });
    }
  }

  return sortAndDeduplicateProvenance(events);
}

export async function parseImageMetadata(
  blob: Blob,
  fileName: string,
  width: number,
  height: number
): Promise<ImageMetadata> {
  const buffer = await blob.arrayBuffer();
  const fields: MetadataField[] = [
    { label: 'File Name', value: fileName, group: 'file' },
    { label: 'Format', value: blob.type || 'image/unknown', group: 'file' },
    { label: 'Dimensions', value: `${width} × ${height} px`, group: 'file' },
    { label: 'Aspect Ratio', value: computeAspectRatio(width, height), group: 'file' },
    { label: 'File Size', value: formatBytes(blob.size), group: 'file' },
  ];

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (await exifr.parse(buffer, {
      tiff: true,
      exif: true,
      xmp: true,
      iptc: true,
      icc: false,
      jfif: false,
      multiSegment: true,
      translateValues: true,
    })) as Record<string, unknown> | null;
  } catch {
    parsed = null;
  }

  const pngChunks = scanPngTextChunks(buffer);
  const rawMarker = scanRawBinaryForMarkers(buffer);
  const rawXmpPacket = extractRawXmpPacket(buffer, pngChunks);
  const xmpData = rawXmpPacket ? parseXmpProvenance(rawXmpPacket) : { historyEvents: [] };
  const c2paGenerators = scanC2paClaimGenerators(buffer);

  const cameraMake = typeof parsed?.Make === 'string' ? parsed.Make.trim() : undefined;
  const cameraModel = typeof parsed?.Model === 'string' ? parsed.Model.trim() : undefined;
  const lensModel =
    typeof parsed?.LensModel === 'string'
      ? parsed.LensModel.trim()
      : typeof parsed?.Lens === 'string'
        ? parsed.Lens.trim()
        : undefined;
  const exifSoftware = typeof parsed?.Software === 'string' ? parsed.Software.trim() : undefined;
  const processingSoftware =
    typeof parsed?.ProcessingSoftware === 'string'
      ? parsed.ProcessingSoftware.trim()
      : undefined;
  const hostComputer =
    typeof parsed?.HostComputer === 'string' ? parsed.HostComputer.trim() : undefined;
  const creatorTool =
    typeof parsed?.CreatorTool === 'string'
      ? parsed.CreatorTool.trim()
      : xmpData.creatorTool;

  const software = exifSoftware || creatorTool || processingSoftware;

  const dateTimeOriginal = normalizeTimestamp(parsed?.DateTimeOriginal);
  const dateTimeDigitized = normalizeTimestamp(
    parsed?.CreateDate ?? parsed?.DateTimeDigitized ?? xmpData.createDate
  );
  const modifyDate = normalizeTimestamp(
    parsed?.ModifyDate ?? parsed?.DateTime ?? xmpData.modifyDate
  );
  const metadataDate = normalizeTimestamp(parsed?.MetadataDate ?? xmpData.metadataDate);

  const exposureSummary = parsed ? formatExposure(parsed) : undefined;
  const hasExif = Boolean(cameraMake || cameraModel || lensModel || exposureSummary || dateTimeOriginal);

  if (cameraMake || cameraModel) {
    fields.push({
      label: 'Camera Body',
      value: [cameraMake, cameraModel].filter(Boolean).join(' '),
      group: 'camera',
    });
  }
  if (lensModel) {
    fields.push({ label: 'Lens', value: lensModel, group: 'camera' });
  }
  if (exposureSummary) {
    fields.push({ label: 'Exposure', value: exposureSummary, group: 'camera' });
  }
  if (dateTimeOriginal) {
    fields.push({ label: 'Capture Date', value: dateTimeOriginal, group: 'camera' });
  }
  if (modifyDate && modifyDate !== dateTimeOriginal) {
    fields.push({ label: 'Last Modified', value: modifyDate, group: 'software' });
  }
  if (typeof parsed?.ColorSpace === 'string' || typeof parsed?.ColorSpace === 'number') {
    fields.push({ label: 'Color Space', value: String(parsed.ColorSpace), group: 'camera' });
  }

  if (software) {
    fields.push({ label: 'Software / Editor', value: software, group: 'software' });
  }
  if (processingSoftware && processingSoftware !== software) {
    fields.push({ label: 'Processing Software', value: processingSoftware, group: 'software' });
  }
  if (hostComputer && hostComputer !== software) {
    fields.push({ label: 'Host System', value: hostComputer, group: 'software' });
  }

  const digitalSourceTypeRaw =
    typeof parsed?.DigitalSourceType === 'string'
      ? parsed.DigitalSourceType.trim()
      : xmpData.digitalSourceType;

  let aiMarkerDetected = Boolean(rawMarker);
  let aiMarkerDetails = rawMarker;

  const combinedTextToCheck = [
    exifSoftware || '',
    creatorTool || '',
    processingSoftware || '',
    typeof parsed?.Description === 'string' ? parsed.Description : '',
    typeof parsed?.ImageDescription === 'string' ? parsed.ImageDescription : '',
    digitalSourceTypeRaw || '',
    ...c2paGenerators,
    ...pngChunks.map((c) => c.raw),
  ].join(' ');

  const detectedFromText = matchesAiSignature(combinedTextToCheck);
  if (detectedFromText) {
    aiMarkerDetected = true;
    aiMarkerDetails = detectedFromText;
  }

  if (pngChunks.length > 0) {
    pngChunks.slice(0, 3).forEach((chunk, idx) => {
      const looksLikePrompt = /parameters|prompt|steps:|sampler:|cfg scale|seed:/i.test(chunk.raw);
      if (looksLikePrompt) {
        aiMarkerDetected = true;
        aiMarkerDetails =
          aiMarkerDetails || 'Embedded generative prompt parameters in PNG text chunk';
      }
      fields.push({
        label: `PNG Chunk #${idx + 1}`,
        value: chunk.raw,
        group: looksLikePrompt ? 'ai_markers' : 'software',
        flagged: looksLikePrompt,
      });
    });
  }

  // Build chronological embedded provenance timeline from EXIF / XMP / C2PA / PNG signatures
  const rawProvenance: ProvenanceEvent[] = [];

  // 1. Hardware camera capture node
  if (cameraMake || cameraModel || lensModel || exposureSummary || dateTimeOriginal) {
    const cameraLabel = [cameraMake, cameraModel].filter(Boolean).join(' ');
    const details = [lensModel, exposureSummary].filter(Boolean).join(' · ');
    rawProvenance.push({
      id: 'exif-capture',
      kind: 'capture',
      signature: cameraLabel || 'Digital Camera Sensor',
      action: 'Original camera capture',
      timestamp: dateTimeOriginal,
      sourceTag: 'EXIF IFD0 / ExifIFD',
      details: details || undefined,
      flagged: false,
    });
  }

  // 2. Digitized timestamp if distinct from original capture
  if (dateTimeDigitized && dateTimeDigitized !== dateTimeOriginal) {
    rawProvenance.push({
      id: 'exif-digitized',
      kind: 'digitized',
      signature: hostComputer || [cameraMake, cameraModel].filter(Boolean).join(' ') || 'Image Digitizer',
      action: 'Image digitized',
      timestamp: dateTimeDigitized,
      sourceTag: 'EXIF DateTimeDigitized',
      flagged: false,
    });
  }

  // 3. XMP xmpMM:History chronological edit events
  rawProvenance.push(...xmpData.historyEvents);

  // 4. XMP CreatorTool (if not already represented identically in xmpMM:History)
  if (creatorTool) {
    const alreadyInHistory = xmpData.historyEvents.some(
      (evt) => evt.signature.toLowerCase() === creatorTool.toLowerCase()
    );
    if (!alreadyInHistory) {
      const aiHit = matchesAiSignature(creatorTool);
      rawProvenance.push({
        id: 'xmp-creator-tool',
        kind: aiHit ? 'ai_signature' : 'software_signature',
        signature: creatorTool,
        action: aiHit ? `Generative tool signature (${aiHit})` : 'Authoring tool recorded',
        timestamp: !dateTimeOriginal ? dateTimeDigitized : undefined,
        sourceTag: 'XMP xmp:CreatorTool',
        flagged: Boolean(aiHit),
      });
    }
  }

  // 5. EXIF / TIFF Software tag
  if (exifSoftware) {
    const alreadyInHistory = xmpData.historyEvents.some(
      (evt) =>
        evt.signature.toLowerCase() === exifSoftware.toLowerCase() &&
        (!modifyDate || evt.timestamp?.startsWith(modifyDate.slice(0, 16)))
    );
    const sameAsCreatorWithoutModDate =
      creatorTool &&
      creatorTool.toLowerCase() === exifSoftware.toLowerCase() &&
      (!modifyDate || modifyDate === dateTimeOriginal);

    if (!alreadyInHistory && !sameAsCreatorWithoutModDate) {
      const aiHit = matchesAiSignature(exifSoftware);
      const isFirmware =
        Boolean(cameraMake || cameraModel) &&
        (!modifyDate || modifyDate === dateTimeOriginal) &&
        /ver\.?\s*\d|firmware|ios|android|pixel|one ui/i.test(exifSoftware);
      rawProvenance.push({
        id: 'tiff-software',
        kind: aiHit ? 'ai_signature' : isFirmware ? 'software_signature' : 'edit',
        signature: exifSoftware,
        action: aiHit
          ? `Generative software signature (${aiHit})`
          : isFirmware
            ? 'In-camera firmware / OS processing'
            : 'Processed / saved with software',
        timestamp: modifyDate && modifyDate !== dateTimeOriginal ? modifyDate : undefined,
        sourceTag: 'TIFF Software',
        flagged: Boolean(aiHit),
      });
    }
  }

  // 6. EXIF ProcessingSoftware / HostComputer
  if (processingSoftware && processingSoftware.toLowerCase() !== (exifSoftware || '').toLowerCase()) {
    const aiHit = matchesAiSignature(processingSoftware);
    rawProvenance.push({
      id: 'exif-proc-sw',
      kind: aiHit ? 'ai_signature' : 'edit',
      signature: processingSoftware,
      action: aiHit ? `Generative processing software (${aiHit})` : 'Post-processing pipeline tag',
      sourceTag: 'EXIF ProcessingSoftware',
      flagged: Boolean(aiHit),
    });
  }

  if (
    hostComputer &&
    hostComputer.toLowerCase() !== (exifSoftware || '').toLowerCase() &&
    hostComputer.toLowerCase() !== [cameraMake, cameraModel].filter(Boolean).join(' ').toLowerCase()
  ) {
    rawProvenance.push({
      id: 'exif-host',
      kind: 'software_signature',
      signature: hostComputer,
      action: 'Host OS / encoding environment',
      sourceTag: 'TIFF HostComputer',
      flagged: false,
    });
  }

  // 7. Photoshop text history log if embedded
  if (xmpData.photoshopHistory) {
    const lines = xmpData.photoshopHistory
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 4);
    if (lines.length > 0) {
      rawProvenance.push({
        id: 'ps-history',
        kind: 'edit',
        signature: 'Adobe Photoshop Edit Log',
        action: `${lines.length} recorded edit ${lines.length === 1 ? 'entry' : 'entries'}`,
        sourceTag: 'XMP photoshop:History',
        details: lines.join(' · ').slice(0, 180),
        flagged: Boolean(matchesAiSignature(xmpData.photoshopHistory)),
      });
    }
  }

  // 8. Standalone ModifyDate / MetadataDate when modified after capture with no software agent named
  if (
    modifyDate &&
    modifyDate !== dateTimeOriginal &&
    !rawProvenance.some((e) => e.timestamp === modifyDate)
  ) {
    rawProvenance.push({
      id: 'exif-modify-date',
      kind: 'export',
      signature: exifSoftware || creatorTool || 'Unattributed File Rewrite',
      action: 'File modified / re-saved after capture',
      timestamp: modifyDate,
      sourceTag: 'EXIF ModifyDate',
      flagged: false,
    });
  }

  if (
    metadataDate &&
    metadataDate !== dateTimeOriginal &&
    metadataDate !== modifyDate &&
    !rawProvenance.some((e) => e.timestamp === metadataDate)
  ) {
    rawProvenance.push({
      id: 'xmp-meta-date',
      kind: 'edit',
      signature: creatorTool || exifSoftware || 'Metadata Editor',
      action: 'XMP metadata block updated',
      timestamp: metadataDate,
      sourceTag: 'XMP MetadataDate',
      flagged: false,
    });
  }

  // 9. IPTC DigitalSourceType declaration
  if (digitalSourceTypeRaw) {
    const formatted = formatDigitalSourceLabel(digitalSourceTypeRaw);
    rawProvenance.push({
      id: 'iptc-dst',
      kind: formatted.flagged ? 'ai_signature' : 'software_signature',
      signature: formatted.label,
      action: 'IPTC Digital Source Type declaration',
      sourceTag: 'IPTC DigitalSourceType',
      details: digitalSourceTypeRaw.slice(0, 120),
      flagged: formatted.flagged,
    });
  }

  // 10. C2PA / Content Credentials claim generators
  c2paGenerators.forEach((generator, idx) => {
    const aiHit = matchesAiSignature(generator);
    rawProvenance.push({
      id: `c2pa-gen-${idx + 1}`,
      kind: aiHit ? 'ai_signature' : 'software_signature',
      signature: generator,
      action: aiHit ? 'C2PA Content Credentials (AI claim)' : 'C2PA Content Credentials signature',
      sourceTag: 'JUMBF / C2PA Claim',
      flagged: Boolean(aiHit),
    });
  });

  // 11. PNG text chunk software or generative prompt parameters
  pngChunks.forEach((chunk, idx) => {
    const keyLower = chunk.keyword.toLowerCase();
    const isSoftwareChunk = keyLower === 'software' || keyLower === 'source' || keyLower === 'creator';
    const isPromptChunk = /parameters|prompt|workflow/i.test(keyLower) || /steps:|sampler:|cfg scale|seed:/i.test(chunk.value);
    const aiHit = matchesAiSignature(chunk.raw);

    if (isSoftwareChunk || isPromptChunk || aiHit) {
      rawProvenance.push({
        id: `png-chunk-${idx + 1}`,
        kind: isPromptChunk || aiHit ? 'ai_signature' : 'software_signature',
        signature: isSoftwareChunk
          ? chunk.value.slice(0, 80)
          : aiHit || `PNG ${chunk.keyword} chunk`,
        action: isPromptChunk
          ? 'Embedded generative inference parameters'
          : aiHit
            ? 'Generative marker in PNG chunk'
            : 'PNG encoder / software signature',
        sourceTag: `PNG ${chunk.keyword}`,
        details: isSoftwareChunk ? undefined : chunk.value.slice(0, 140),
        flagged: Boolean(isPromptChunk || aiHit),
      });
    }
  });

  // 12. Catch-all binary AI marker if detected but not yet represented as a flagged provenance event
  if (aiMarkerDetected && aiMarkerDetails && !rawProvenance.some((e) => e.flagged)) {
    rawProvenance.push({
      id: 'binary-ai-marker',
      kind: 'ai_signature',
      signature: aiMarkerDetails,
      action: 'Generative signature detected in binary headers',
      sourceTag: 'Container Binary Scan',
      flagged: true,
    });
  }

  const provenance = sortAndDeduplicateProvenance(rawProvenance);

  fields.push({
    label: 'EXIF Camera Provenance',
    value: hasExif ? 'Present' : 'Not present (stripped or synthetic)',
    group: 'ai_markers',
  });

  fields.push({
    label: 'AI Generator Markers',
    value: aiMarkerDetected
      ? aiMarkerDetails || 'Detected in container headers'
      : 'None found in file headers',
    group: 'ai_markers',
    flagged: aiMarkerDetected,
  });

  return {
    fileName,
    mimeType: blob.type || 'image/jpeg',
    fileSize: blob.size,
    width,
    height,
    aspectRatio: computeAspectRatio(width, height),
    hasExif,
    cameraMake,
    cameraModel,
    lensModel,
    software,
    dateTimeOriginal,
    exposureSummary,
    aiMarkerDetected,
    aiMarkerDetails,
    fields,
    provenance,
  };
}

export function buildMetadataContextForAi(meta: ImageMetadata): string {
  const lines = [
    `File: ${meta.fileName} (${meta.mimeType}, ${meta.width}x${meta.height}, ${formatBytes(meta.fileSize)})`,
    `Camera EXIF present: ${meta.hasExif ? 'Yes' : 'No'}`,
  ];
  if (meta.cameraMake || meta.cameraModel) {
    lines.push(`Camera: ${[meta.cameraMake, meta.cameraModel].filter(Boolean).join(' ')}`);
  }
  if (meta.lensModel) lines.push(`Lens: ${meta.lensModel}`);
  if (meta.exposureSummary) lines.push(`Exposure: ${meta.exposureSummary}`);
  if (meta.software) lines.push(`Software tag: ${meta.software}`);
  if (meta.provenance && meta.provenance.length > 0) {
    const chain = meta.provenance
      .slice(0, 8)
      .map((evt) => `${evt.signature} [${evt.action}${evt.timestamp ? ` @ ${evt.timestamp}` : ''}]`)
      .join(' -> ');
    lines.push(`Embedded Provenance Chain (${meta.provenance.length} events): ${chain}`);
  }
  if (meta.aiMarkerDetected) {
    lines.push(`Container AI Marker Flagged: ${meta.aiMarkerDetails}`);
  } else {
    lines.push('Container AI Marker Flagged: None');
  }
  return lines.join('\n');
}
