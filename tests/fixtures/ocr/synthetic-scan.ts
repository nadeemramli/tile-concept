/**
 * Synthetic scanned-catalogue fixtures for the OCR tests.
 *
 * Every product, code and price here is invented ("SYN-…", brand "Synthetic
 * Tile Co"). Pages are rendered from SVG, then degraded like a scan — slight
 * tilt, blur and grain — and wrapped as JPEG images in a PDF with no text
 * layer, which is exactly what a scanned catalogue looks like to the parser.
 */
import sharp from "sharp";

export interface ScanOptions {
  lines: string[];
  /** Degrees of tilt, as from a crooked scanner feed. */
  tilt?: number;
  /** Gaussian blur sigma; above ~3 the page is unreadable on purpose. */
  blur?: number;
  /** 0-1 strength of grain. */
  grain?: number;
  width?: number;
  height?: number;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function renderScan(opts: ScanOptions): Promise<Buffer> {
  const width = opts.width ?? 1240;
  const height = opts.height ?? 1754;
  const body = opts.lines
    .map((line, i) => (line ? `<text x="90" y="${150 + i * 54}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${i === 0 ? 34 : 28}" fill="#111">${escapeXml(line)}</text>` : ""))
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fbfaf6"/>${body}</svg>`;

  let img = sharp(Buffer.from(svg)).flatten({ background: "#fbfaf6" });
  if (opts.tilt) img = sharp(await img.png().toBuffer()).rotate(opts.tilt, { background: "#fbfaf6" });
  let buf = await img.greyscale().png().toBuffer();
  if (opts.grain) {
    const meta = await sharp(buf).metadata();
    const w = meta.width!;
    const h = meta.height!;
    // Deterministic grain (seeded LCG), so the fixture is identical every run.
    let seed = 22;
    const noise = Buffer.alloc(w * h);
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = 128 + Math.round(((seed / 0x7fffffff) - 0.5) * 255 * opts.grain);
    }
    buf = await sharp(buf)
      .composite([{ input: noise, raw: { width: w, height: h, channels: 1 }, blend: "overlay" }])
      .png()
      .toBuffer();
  }
  if (opts.blur) buf = await sharp(buf).blur(opts.blur).png().toBuffer();
  return sharp(buf).jpeg({ quality: 82 }).toBuffer();
}

/** Wrap JPEG pages into a minimal PDF with no text layer (each page = one scan). */
export async function jpegsToPdf(jpegs: Buffer[]): Promise<Buffer> {
  const objects: Buffer[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages; then per page: page, contents, image.
  let next = 3;
  const add = (id: number, body: Buffer) => {
    objects[id] = Buffer.concat([Buffer.from(`${id} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
  };
  for (const jpg of jpegs) {
    const meta = await sharp(jpg).metadata();
    const w = meta.width!;
    const h = meta.height!;
    const pageId = next++;
    const contentId = next++;
    const imageId = next++;
    pageIds.push(pageId);
    // 72 dpi points from a ~150 dpi scan: A4-ish page.
    const pw = Math.round((w * 72) / 150);
    const ph = Math.round((h * 72) / 150);
    add(pageId, Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    const content = Buffer.from(`q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`);
    add(contentId, Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream")]));
    const channels = meta.channels === 1 ? "/DeviceGray" : "/DeviceRGB";
    add(imageId, Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace ${channels} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`), jpg, Buffer.from("\nendstream")]));
  }
  add(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
  add(2, Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(" ")}] /Count ${pageIds.length} >>`));

  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary");
  const parts: Buffer[] = [header];
  const offsets: number[] = [];
  let pos = header.length;
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = pos;
    parts.push(objects[id]);
    pos += objects[id].length;
  }
  const xref = [`xref\n0 ${objects.length}\n`, "0000000000 65535 f \n", ...offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** A per-run tag keeps codes unique so parallel or repeated runs never collide. */
export function catalogueLines(tag: string): { page1: string[]; codes: { code: string; price: string; size: string; finish: string; colour: string }[] } {
  const codes = [
    { code: `SYN-${tag}-6060G`, price: "45.90", size: "600 x 600 mm", finish: "Matt", colour: "Grey" },
    { code: `SYN-${tag}-3060W`, price: "32.50", size: "300 x 600 mm", finish: "Gloss", colour: "White" },
  ];
  const page1 = [
    "SYNTHETIC TILE CO - TEST CATALOGUE 2026",
    "Porcelain floor and wall collection",
    "",
    `Code: ${codes[0].code}   Size: ${codes[0].size}`,
    `Finish: ${codes[0].finish}   Colour: ${codes[0].colour}`,
    `Price: RM ${codes[0].price} per m2`,
    "",
    "",
    `Code: ${codes[1].code}   Size: ${codes[1].size}`,
    `Finish: ${codes[1].finish}   Colour: ${codes[1].colour}`,
    `Price: RM ${codes[1].price} per m2`,
  ];
  return { page1, codes };
}

/** Scanned two-page catalogue: page 1 readable, page 2 deliberately too poor to read. */
export async function syntheticCatalogue(tag: string): Promise<{ pdf: Buffer; codes: ReturnType<typeof catalogueLines>["codes"] }> {
  const { page1, codes } = catalogueLines(tag);
  const good = await renderScan({ lines: page1, tilt: 0.6, grain: 0.25 });
  const poor = await renderScan({ lines: [`Code: SYN-${tag}-BLUR1  Price: RM 99.00`, "Finish: Matt Colour: Beige"], blur: 9, grain: 0.5 });
  return { pdf: await jpegsToPdf([good, poor]), codes };
}
