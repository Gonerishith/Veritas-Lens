# Veritas Lens — AI Image Authenticity & Forensic Analyzer

**Veritas Lens** is a mobile-first web application for evaluating whether an image is AI-generated, edited, or an authentic photograph. It combines server-side multimodal vision forensics with client-side Error Level Analysis (ELA), container EXIF/XMP provenance extraction, pixel-level zoom inspection, batch processing, and exportable forensic reports.

## Key Features

- **Multimodal AI Authenticity Analysis**
  - Percentage-based AI-generated vs. authentic confidence gauge with a 6-channel visual forensic breakdown (lighting, texture, anatomy/geometry, optics, reflections, and compression cues).
  - Interactive bounding-box highlights mapped directly onto the image canvas for flagged artifacts and authentic optical cues.
  - Dynamic **AI Warning Threshold** slider (`30%–90%`, with Strict / Balanced / Lenient presets) that reclassifies verdicts in real time.

- **Client-Side Forensic Inspection Tools**
  - **Error Level Analysis (ELA):** Real-time HTML5 Canvas recompression heatmap with interactive **Split Wipe**, thermal/grayscale palettes, and JPEG quality & gain calibration sliders.
  - **Optical Zoom Loupe:** `2x`, `4x`, and `8x` pixel-level inspection supporting both desktop pointer tracking and mobile touch-drag with upward finger offset.
  - **Embedded Provenance Timeline:** Extracts camera capture records and chronological software edit history from EXIF, XMP (`xmpMM:History`), IPTC (`DigitalSourceType`), C2PA/JUMBF claim generators, and PNG text chunks, visualizing them as a vertical timeline.
  - **Metadata Inspector:** Displays container specs, camera/lens/exposure fields, and flags embedded generative software markers.

- **Flexible Input & Workflow Modes**
  - **Multiple Input Methods:** Drag-and-drop upload, clipboard paste (`Ctrl+V`), direct image URL import, curated benchmark sample gallery, and **Live Camera Capture** (front/rear camera switching, framing grid, multi-shot batch queuing, and native device camera fallback).
  - **Batch Processing Mode:** Upload or capture multiple images at once, track analysis progress, sort/filter scores in a summary table (with mobile touch cards), and export results as CSV or JSON.
  - **Side-by-Side Compare Mode:** Load any two images into Slot A and Slot B to compare authenticity scores, signals, and ELA heatmaps directly.
  - **Private Local History:** Automatically stores past scans locally in browser IndexedDB for quick recall.

- **Reporting & Sharing**
  - **Download Full Report (`.pdf`):** Generates a multi-page A4 forensic PDF in the browser containing the AI verdict, threshold calibration, side-by-side Original & ELA heatmap thumbnails, 6-channel breakdown, flagged regions, and full EXIF metadata.
  - **Share Report URL:** Creates a shareable public URL (with a compact stateless deep-link fallback) so recipients can inspect the full report.
  - **Markdown & JSON Exports:** Copy or download structured forensic dossiers.
  - **Light Studio & Dark Lab Themes:** Full dual-theme support with mobile thumb-zone navigation.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons
- **Backend:** Node.js, Express (`tsx`), `@google/genai` (with optional OpenRouter fallback)
- **Client Forensics & Export:** `exifr` (EXIF/XMP/IPTC parsing), HTML5 Canvas (ELA & optical loupe), `jspdf` (client-side PDF generation), IndexedDB (local scan history)

## Getting Started

### Prerequisites
- Node.js 18+
- A Gemini API key (and optionally an OpenRouter API key for fallback)

### Installation

```bash
git clone <your-repo-url>
cd <your-repo-name>
npm install
