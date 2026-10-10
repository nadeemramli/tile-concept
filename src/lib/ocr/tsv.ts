/**
 * Tesseract TSV output → words and lines with pixel boxes and confidence.
 *
 * Pure and dependency-free (relative imports only) so the background worker,
 * which runs outside Next.js, can share it with the tests.
 */

export interface OcrBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrWord extends OcrBox {
  text: string;
  /** 0-100 as Tesseract reports it. */
  conf: number;
}

export interface OcrLine extends OcrBox {
  /** 0-based reading-order index on the page. */
  index: number;
  block: number;
  par: number;
  text: string;
  words: OcrWord[];
  /** Mean word confidence, 0-100. */
  conf: number;
  /** Weakest word, 0-100: one misread digit is what makes a price wrong. */
  minConf: number;
}

export interface OcrPage {
  width: number;
  height: number;
  lines: OcrLine[];
  wordCount: number;
  /** Mean over every recognised word, 0-100; 0 when nothing was read. */
  meanConf: number;
}

const COLUMNS = ["level", "page_num", "block_num", "par_num", "line_num", "word_num", "left", "top", "width", "height", "conf", "text"] as const;

function union(boxes: OcrBox[]): OcrBox {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: bottom - y };
}

export function unionBox(boxes: OcrBox[]): OcrBox {
  return union(boxes);
}

export function parseTesseractTsv(tsv: string): OcrPage {
  const rows = tsv.split(/\r?\n/).filter((l) => l.length > 0);
  const header = rows.shift()?.split("\t") ?? [];
  if (COLUMNS.some((c, i) => header[i] !== c)) {
    throw new Error("Unexpected Tesseract TSV header — the engine output format changed");
  }

  let width = 0;
  let height = 0;
  const byLine = new Map<string, { block: number; par: number; words: OcrWord[] }>();
  const order: string[] = [];

  for (const row of rows) {
    const cells = row.split("\t");
    const level = Number(cells[0]);
    const left = Number(cells[6]);
    const top = Number(cells[7]);
    const w = Number(cells[8]);
    const h = Number(cells[9]);
    if (level === 1) {
      width = w;
      height = h;
      continue;
    }
    if (level !== 5) continue;
    const text = (cells[11] ?? "").trim();
    const conf = Number(cells[10]);
    // Tesseract emits -1 for structural rows and empty words; neither is evidence.
    if (!text || !Number.isFinite(conf) || conf < 0) continue;
    const key = `${cells[2]}:${cells[3]}:${cells[4]}`;
    let line = byLine.get(key);
    if (!line) {
      line = { block: Number(cells[2]), par: Number(cells[3]), words: [] };
      byLine.set(key, line);
      order.push(key);
    }
    line.words.push({ text, conf, x: left, y: top, w, h });
  }

  const lines: OcrLine[] = order.map((key, index) => {
    const { block, par, words } = byLine.get(key)!;
    // Scanner specks read as "|" or ":" carry no value; they should not drag
    // down the confidence of the words that do.
    const meaningful = words.filter((wd) => /[a-z0-9]/i.test(wd.text));
    const confs = (meaningful.length ? meaningful : words).map((wd) => wd.conf);
    return {
      index,
      block,
      par,
      text: words.map((wd) => wd.text).join(" "),
      words,
      conf: Math.round((confs.reduce((s, c) => s + c, 0) / confs.length) * 10) / 10,
      minConf: Math.min(...confs),
      ...union(words),
    };
  });

  const all = lines.flatMap((l) => l.words).filter((wd) => /[a-z0-9]/i.test(wd.text));
  const meanConf = all.length ? Math.round((all.reduce((s, wd) => s + wd.conf, 0) / all.length) * 10) / 10 : 0;
  return { width, height, lines, wordCount: all.length, meanConf };
}
