import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createWorker, OEM, type Worker } from "tesseract.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, loadImage } from "@napi-rs/canvas";

// Downloaded once on first use and reused for every OCR call (this is what
// tesseract.js recommends — spinning up a worker per page/document is slow).
// Kept as a module-level singleton so it survives across server function calls
// within the same server process.
let workerPromise: Promise<Worker> | null = null;
// Separate worker dedicated to orientation detection: `detect()` needs the
// Legacy engine (not the fast LSTM-only model the main worker uses), and
// `osd.traineddata` is its own small trained set, not part of fra/eng.
let osdWorkerPromise: Promise<Worker> | null = null;

const CACHE_PATH = path.join(process.cwd(), ".cache", "tesseract");
// French invoices occasionally mix in English/brand terms — loading both
// trained sets costs a bit of extra download/init time but avoids missing them.
const LANGS = "fra+eng";

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    // tesseract.js writes downloaded *.traineddata to this folder with plain
    // fs.writeFile (no auto-mkdir) — without this it fails silently and
    // re-downloads from the jsdelivr CDN on every cold start.
    fs.mkdirSync(CACHE_PATH, { recursive: true });
    workerPromise = createWorker(LANGS, undefined, { cachePath: CACHE_PATH });
  }
  return workerPromise;
}

function getOsdWorker(): Promise<Worker> {
  if (!osdWorkerPromise) {
    fs.mkdirSync(CACHE_PATH, { recursive: true });
    osdWorkerPromise = createWorker("osd", OEM.TESSERACT_ONLY, { cachePath: CACHE_PATH });
  }
  return osdWorkerPromise;
}

async function rotateImageBuffer(buffer: Buffer, degrees: 90 | 180 | 270): Promise<Buffer> {
  const image = await loadImage(buffer);
  const { width, height } = image;
  const swapDimensions = degrees === 90 || degrees === 270;
  const canvas = createCanvas(swapDimensions ? height : width, swapDimensions ? width : height);
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(image, -width / 2, -height / 2);
  return canvas.encode("png");
}

// Tesseract's legacy OSD is unreliable on sparse/table-heavy layouts (lots of
// borders, little continuous prose) — it confidently misfires on those even
// when the page is already upright. Measured against two real invoices: a
// genuinely-rotated photo scored ~7.3 confidence; an already-upright scanned
// delivery note (dense pipe-table layout) got a false-positive 180° flip at
// only ~2.7-3.6. This threshold sits between the two — below it we leave the
// image alone rather than risk flipping an already-correct page into garbage.
const ORIENTATION_CONFIDENCE_THRESHOLD = 5;

/**
 * Real invoice photos are routinely shot sideways (phone held landscape).
 * Tesseract's LSTM recognizer assumes upright text and produces garbage on a
 * rotated page rather than failing loudly — confirmed against a real supplier
 * photo that came back as unreadable noise until this was added. Detects the
 * skew with Tesseract's Legacy-engine OSD (orientation & script detection) and
 * rotates the image back to upright before the real recognition pass runs.
 */
async function correctOrientation(buffer: Buffer): Promise<Buffer> {
  const osdWorker = await getOsdWorker();
  const { data } = await osdWorker.detect(buffer);
  const degrees = data.orientation_degrees;
  const confidence = data.orientation_confidence ?? 0;
  if (!degrees || degrees === 0 || confidence < ORIENTATION_CONFIDENCE_THRESHOLD) return buffer;
  // Tesseract reports how far the text is rotated clockwise from upright;
  // rotating by the same amount again brings it back to upright.
  return rotateImageBuffer(buffer, degrees as 90 | 180 | 270);
}

async function ocrImageBuffer(worker: Worker, buffer: Buffer): Promise<string> {
  const upright = await correctOrientation(buffer);
  const { data } = await worker.recognize(upright);
  return data.text.trim();
}

const require = createRequire(import.meta.url);
const PDFJS_DIST_DIR = path.dirname(require.resolve("pdfjs-dist/package.json"));

function pdfjsAssetPath(sub: string): string {
  const absolute = path.join(PDFJS_DIST_DIR, sub).split(path.sep).join("/");
  return absolute.endsWith("/") ? absolute : `${absolute}/`;
}

/**
 * Rasterizes every page of a PDF to a PNG buffer, using pdfjs-dist directly
 * (not the `pdf-to-png-converter` wrapper — see below).
 *
 * pdf-to-png-converter never sets pdfjs-dist's `wasmUrl` option, which its
 * bundled WASM codecs (used for e.g. CCITT Group 4 fax-encoded scans — the
 * standard output of most scanner/MFP hardware) require to load. Without it,
 * pdfjs-dist fails to decode the page image and *silently* renders a blank
 * white page instead of throwing — confirmed against a real scanned invoice
 * (Lexmark MFP output) that came back as 4 blank pages until this was fixed.
 */
// pdfjs-dist types `PDFDocumentProxy#canvasFactory` as a bare `Object` (it's
// deliberately untyped upstream — see pdf-to-png-converter's own runtime
// isCanvasFactory() check for the same reason). Node's factory is backed by
// @napi-rs/canvas under the hood (pdf.mjs requires it directly).
interface NodeCanvasFactory {
  create(width: number, height: number): { canvas: CanvasLike; context: unknown };
  destroy(entry: { canvas: CanvasLike; context: unknown }): void;
}
interface CanvasLike {
  encode(format: "png"): Promise<Buffer>;
}

async function rasterizePdfToPng(buffer: Buffer, scale: number): Promise<Buffer[]> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: pdfjsAssetPath("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: pdfjsAssetPath("standard_fonts"),
    wasmUrl: pdfjsAssetPath("wasm"),
    disableFontFace: true,
    useSystemFonts: false,
  });

  try {
    const doc = await loadingTask.promise;
    const canvasFactory = doc.canvasFactory as unknown as NodeCanvasFactory;
    const pngs: Buffer[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale });
        const width = Math.floor(viewport.width);
        const height = Math.floor(viewport.height);
        const { canvas, context } = canvasFactory.create(width, height);
        // @ts-expect-error — pdfjs-dist expects a DOM CanvasRenderingContext2D;
        // @napi-rs/canvas's SKRSContext2D implements the same surface at runtime.
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        pngs.push(await canvas.encode("png"));
        canvasFactory.destroy({ canvas, context });
      } finally {
        page.cleanup();
      }
    }
    return pngs;
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Raw-text OCR extraction for an invoice file, using Tesseract instead of the
 * multimodal AI gateway. Images are recognized directly; PDFs are rasterized
 * page-by-page (Tesseract only understands bitmaps) before OCR runs on each
 * page. This is intentionally text-only for now — turning the output into
 * structured header/line-item data (what `extractInvoice` in ai.server.ts
 * does today) is a separate follow-up.
 */
export async function extractTextFromFile(
  base64: string,
  mime: string,
): Promise<{ text: string; pageCount: number }> {
  const buffer = Buffer.from(base64, "base64");
  const worker = await getWorker();

  if (mime === "application/pdf") {
    const pages = await rasterizePdfToPng(buffer, 2);
    const texts: string[] = [];
    for (const page of pages) {
      texts.push(await ocrImageBuffer(worker, page));
    }
    return {
      text: texts.join("\n\n----- page suivante -----\n\n").trim(),
      pageCount: pages.length,
    };
  }

  if (mime.startsWith("image/")) {
    return { text: await ocrImageBuffer(worker, buffer), pageCount: 1 };
  }

  throw new Error(`Type de fichier non pris en charge par l'OCR : ${mime}`);
}
