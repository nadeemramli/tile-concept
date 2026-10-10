/**
 * The OCR engine: locally installed Tesseract, driven as a subprocess.
 *
 * Runs in the background worker (scripts/ocr/worker.mts), never in a page
 * request (PRD §12.5). There is no hosted OCR provider, no key and no cost:
 * if the `tesseract` binary is missing the job fails as `engine_unavailable`
 * and every page becomes a manual-entry item.
 *
 * Relative imports only, so the worker can load it under tsx.
 */
import { spawn } from "node:child_process";
import sharp, { type Sharp } from "sharp";
import { extractImages, extractText, getDocumentProxy } from "unpdf";
import type { ParsedRecord } from "../parsers/types";
import { buildOcrRecords, manualRecord } from "./entries";
import { parseTesseractTsv } from "./tsv";

export const OCR_PARSER_VERSION = "ocr-tesseract@1";
/** Same threshold as the text-layer parser: below it a page is a scan. */
const TEXT_LAYER_MIN_CHARS = 40;
/** Tesseract reads best near 300 dpi; a scan narrower than this is upscaled. */
const MIN_OCR_WIDTH = 1600;
const MAX_INPUT_PIXELS = 60_000_000;
export const PAGE_TIMEOUT_MS = 90_000;
/** Page segmentation: a single uniform block reads catalogue cards in order. */
const PSM = "6";

export type OcrFailureKind = "transient" | "encrypted" | "unsupported" | "oversize" | "too_many_pages" | "engine_unavailable" | "source_missing";

export class OcrFailure extends Error {
  constructor(
    readonly kind: OcrFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "OcrFailure";
  }
}

export interface EngineInfo {
  engine: "tesseract";
  version: string;
  languages: string[];
}

function run(cmd: string, args: string[], input?: Buffer, timeoutMs = PAGE_TIMEOUT_MS): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new OcrFailure("transient", `Tesseract did not finish within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new OcrFailure("engine_unavailable", "Tesseract is not installed on the OCR worker") : e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), code });
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function detectEngine(): Promise<EngineInfo> {
  const v = await run("tesseract", ["--version"], undefined, 15_000);
  const version = /tesseract\s+v?([\d.]+[\w.-]*)/i.exec(v.stdout + v.stderr)?.[1];
  if (!version) throw new OcrFailure("engine_unavailable", "Tesseract did not report a version");
  const l = await run("tesseract", ["--list-langs"], undefined, 15_000);
  const languages = (l.stdout + l.stderr).split(/\r?\n/).slice(1).map((s) => s.trim()).filter((s) => /^[a-z_]+$/i.test(s));
  if (!languages.includes("eng")) throw new OcrFailure("engine_unavailable", "Tesseract has no English language data installed");
  return { engine: "tesseract", version, languages };
}

export interface PreparedPage {
  page: number;
  /** Greyscale PNG actually given to Tesseract; also the reviewer's page image. */
  png: Buffer;
  width: number;
  height: number;
  preprocessing: Record<string, unknown>;
}

/** Deterministic clean-up: greyscale, stretch contrast, upscale small scans. */
async function preprocess(input: Sharp, page: number): Promise<PreparedPage> {
  const meta = await input.metadata();
  const srcWidth = meta.width ?? 0;
  const scale = srcWidth > 0 && srcWidth < MIN_OCR_WIDTH ? MIN_OCR_WIDTH / srcWidth : 1;
  let img = input.rotate().greyscale().normalise();
  if (scale > 1) img = img.resize({ width: Math.round(srcWidth * scale), kernel: "lanczos3" });
  const { data, info } = await img.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
  return {
    page,
    png: data,
    width: info.width,
    height: info.height,
    preprocessing: { steps: ["auto-orient", "greyscale", "normalise", ...(scale > 1 ? [`upscale x${scale.toFixed(2)}`] : [])], source_width: srcWidth, source_height: meta.height ?? 0 },
  };
}

export interface PageSource {
  page: number;
  /** Set when the page has a text layer and needs no OCR. */
  textLayer?: string;
  prepared?: PreparedPage;
  /** Why no image could be prepared. */
  problem?: string;
}

function isPasswordError(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? "";
  const msg = e instanceof Error ? e.message : String(e);
  return name === "PasswordException" || /password/i.test(msg) || /encrypt/i.test(msg);
}

/**
 * The pages to read from a PDF. Text-layer pages are reported (and skipped);
 * scanned pages yield their embedded page image.
 */
export async function preparePdf(data: Uint8Array, pages: number[] | null, maxPages: number): Promise<{ pageCount: number; sources: PageSource[] }> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data));
  } catch (e) {
    if (isPasswordError(e)) throw new OcrFailure("encrypted", "The PDF is password-protected or encrypted");
    throw new OcrFailure("unsupported", `The PDF could not be opened (${e instanceof Error ? e.message : "unknown error"})`);
  }
  const pageCount = pdf.numPages;
  const wanted = (pages && pages.length ? pages : Array.from({ length: pageCount }, (_, i) => i + 1)).filter((p) => p >= 1 && p <= pageCount);
  if (wanted.length > maxPages) throw new OcrFailure("too_many_pages", `This job covers ${wanted.length} pages; OCR reads at most ${maxPages} per job`);

  const { text } = await extractText(pdf, { mergePages: false });
  const texts = Array.isArray(text) ? text : [text];
  const sources: PageSource[] = [];
  for (const page of wanted) {
    const layer = (texts[page - 1] ?? "").trim();
    if (layer.replace(/\s+/g, "").length >= TEXT_LAYER_MIN_CHARS) {
      sources.push({ page, textLayer: layer });
      continue;
    }
    const images = await extractImages(pdf, page);
    if (!images.length) {
      sources.push({ page, problem: "the page has neither a text layer nor an embedded scan image" });
      continue;
    }
    // A scanned page is one large image; logos and swatches are smaller.
    const img = images.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    if (img.width * img.height > MAX_INPUT_PIXELS) {
      sources.push({ page, problem: `the page image is ${img.width}×${img.height} px, larger than OCR accepts` });
      continue;
    }
    const raw = sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: img.channels }, limitInputPixels: MAX_INPUT_PIXELS });
    sources.push({ page, prepared: await preprocess(raw, page) });
  }
  return { pageCount, sources };
}

export async function prepareImage(data: Uint8Array): Promise<PageSource> {
  try {
    const input = sharp(Buffer.from(data), { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    await input.metadata();
    return { page: 1, prepared: await preprocess(input, 1) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/pixel limit/i.test(msg)) throw new OcrFailure("oversize", "The image is larger than OCR accepts");
    throw new OcrFailure("unsupported", `The image could not be decoded (${msg})`);
  }
}

export async function recognise(png: Buffer): Promise<{ tsv: string }> {
  const r = await run("tesseract", ["stdin", "stdout", "-l", "eng", "--psm", PSM, "tsv"], png);
  if (r.code !== 0) throw new OcrFailure("transient", `Tesseract exited with ${r.code}: ${r.stderr.trim().slice(0, 200)}`);
  return { tsv: r.stdout };
}

export interface PageOutcome {
  page_no: number;
  outcome: "read" | "unreadable" | "no_text" | "no_image" | "failed";
  word_count: number;
  mean_confidence: number | null;
  width_px: number | null;
  height_px: number | null;
  text: string | null;
  preprocessing: Record<string, unknown>;
  detail: string | null;
  /** Bytes for the worker to store as evidence; not sent to the database. */
  png?: Buffer;
  tsv?: string;
}

export interface OcrRun {
  records: ParsedRecord[];
  pages: PageOutcome[];
  stats: Record<string, unknown>;
}

/**
 * Read every requested page. Proposals for readable pages, a manual-entry
 * record (with the reason) for every page that is not.
 */
export async function runOcr(input: { data: Uint8Array; kind: string; mimeType: string | null; pages: number[] | null; maxPages: number; maxBytes: number; engineLabel: string }): Promise<OcrRun> {
  if (input.data.byteLength > input.maxBytes) throw new OcrFailure("oversize", `The file is ${(input.data.byteLength / 1048576).toFixed(1)} MB; OCR accepts at most ${Math.round(input.maxBytes / 1048576)} MB`);
  const started = Date.now();

  let sources: PageSource[];
  if (input.kind === "pdf" || input.mimeType === "application/pdf") {
    sources = (await preparePdf(input.data, input.pages, input.maxPages)).sources;
  } else if (input.kind === "image") {
    sources = [await prepareImage(input.data)];
  } else {
    throw new OcrFailure("unsupported", `OCR does not read ${input.kind} sources`);
  }

  const records: ParsedRecord[] = [];
  const pages: PageOutcome[] = [];
  let rowNo = 1;
  for (const src of sources) {
    if (src.textLayer !== undefined) {
      // Native text wins (PRD §7.8); the text-layer parser already staged it.
      pages.push({ page_no: src.page, outcome: "no_text", word_count: 0, mean_confidence: null, width_px: null, height_px: null, text: null, preprocessing: {}, detail: "Page has a text layer; read by the text parser, not OCR" });
      continue;
    }
    if (!src.prepared) {
      records.push(manualRecord(src.page, rowNo++, src.problem ?? "no image was found", { engine: input.engineLabel }));
      pages.push({ page_no: src.page, outcome: "no_image", word_count: 0, mean_confidence: null, width_px: null, height_px: null, text: null, preprocessing: {}, detail: src.problem ?? null });
      continue;
    }
    const { tsv } = await recognise(src.prepared.png);
    const page = parseTesseractTsv(tsv);
    const pageRecords = buildOcrRecords(page, src.page, rowNo, input.engineLabel);
    rowNo += pageRecords.length;
    records.push(...pageRecords);
    const unreadable = pageRecords.length === 1 && pageRecords[0].issues.some((i) => i.code === "needs_manual");
    pages.push({
      page_no: src.page,
      outcome: unreadable ? "unreadable" : "read",
      word_count: page.wordCount,
      mean_confidence: page.meanConf,
      width_px: src.prepared.width,
      height_px: src.prepared.height,
      text: page.lines.map((l) => l.text).join("\n"),
      preprocessing: src.prepared.preprocessing,
      detail: unreadable ? (pageRecords[0].issues[0]?.detail ?? null) : null,
      png: src.prepared.png,
      tsv,
    });
  }

  const read = pages.filter((p) => p.outcome === "read");
  return {
    records,
    pages,
    stats: {
      pages: pages.length,
      pages_read: read.length,
      pages_text_layer: pages.filter((p) => p.outcome === "no_text").length,
      words: read.reduce((s, p) => s + p.word_count, 0),
      mean_confidence: read.length ? Math.round((read.reduce((s, p) => s + (p.mean_confidence ?? 0), 0) / read.length) * 10) / 10 : null,
      proposals: records.filter((r) => r.issues.every((i) => i.code !== "needs_manual")).length,
      duration_ms: Date.now() - started,
      parser_version: OCR_PARSER_VERSION,
      psm: PSM,
    },
  };
}
