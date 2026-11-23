/**
 * Safe, zero-dependency, bounded text extraction for common rich document
 * formats: DOCX, XLSX, PPTX (Office Open XML) and basic text-stream PDF.
 *
 * Security invariants:
 * - Never executes embedded macros, scripts, or external entity lookups (no XXE).
 * - Enforces strict compressed & decompressed byte limits (ZIP-bomb protection).
 * - Detects encrypted PDFs and malformed archives cleanly without crashing.
 * - Callers MUST frame returned text as untrusted data.
 */

import { inflateRawSync, inflateSync } from 'node:zlib';

export const RICH_DOCUMENT_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.pdf']);
const MAX_DECOMPRESSED_BYTES = 4 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 120_000;

export interface RichDocumentResult {
  ok: boolean;
  format: 'docx' | 'xlsx' | 'pptx' | 'pdf';
  text: string;
  error?: string;
}

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Parse ZIP Central Directory safely without external packages. */
function parseZipEntries(buf: Buffer): ZipEntry[] {
  // Locate End of Central Directory (EOCD) signature 0x06054b50 from the end
  let eocdOffset = -1;
  const minOffset = Math.max(0, buf.length - 65_557);
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Invalid or truncated Office archive (missing ZIP EOCD).');

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (totalEntries > 2_000) throw new Error('Archive has too many entries to inspect safely.');

  const entries: ZipEntry[] = [];
  let cursor = cdOffset;
  for (let i = 0; i < totalEntries && cursor + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) break;
    const compressionMethod = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localHeaderOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntryUtf8(buf: Buffer, entry: ZipEntry, budget: { remaining: number }): string {
  if (entry.uncompressedSize > budget.remaining) {
    throw new Error('Archive entry exceeds safe decompression limit.');
  }
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buf.length || buf.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`Malformed ZIP local header for ${entry.name}.`);
  }
  const nameLen = buf.readUInt16LE(offset + 26);
  const extraLen = buf.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLen + extraLen;
  const slice = buf.subarray(dataStart, dataStart + entry.compressedSize);

  let raw: Buffer;
  if (entry.compressionMethod === 0) {
    raw = slice;
  } else if (entry.compressionMethod === 8) {
    raw = inflateRawSync(slice, { maxOutputLength: budget.remaining });
  } else {
    throw new Error(`Unsupported ZIP compression method (${entry.compressionMethod}) in ${entry.name}.`);
  }
  budget.remaining -= raw.length;
  return raw.toString('utf8');
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

function extractDocx(buf: Buffer): RichDocumentResult {
  const entries = parseZipEntries(buf);
  const docEntry = entries.find((e) => e.name === 'word/document.xml');
  if (!docEntry) {
    return { ok: false, format: 'docx', text: '', error: 'DOCX archive does not contain word/document.xml.' };
  }
  const xml = readZipEntryUtf8(buf, docEntry, { remaining: MAX_DECOMPRESSED_BYTES });
  const paragraphs: string[] = [];
  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(xml)) !== null) {
    const tParts: string[] = [];
    const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(match[1])) !== null) {
      tParts.push(decodeXmlEntities(tMatch[1]));
    }
    const line = tParts.join('').trim();
    if (line) paragraphs.push(line);
  }
  return { ok: true, format: 'docx', text: paragraphs.join('\n').slice(0, MAX_EXTRACTED_CHARS) };
}

function extractPptx(buf: Buffer): RichDocumentResult {
  const entries = parseZipEntries(buf);
  const slides = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.name))
    .sort((a, b) => {
      const na = Number(a.name.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      const nb = Number(b.name.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      return na - nb;
    });
  if (slides.length === 0) {
    return { ok: false, format: 'pptx', text: '', error: 'PPTX archive does not contain any slides.' };
  }
  const budget = { remaining: MAX_DECOMPRESSED_BYTES };
  const sections: string[] = [];
  for (let i = 0; i < slides.length; i += 1) {
    const xml = readZipEntryUtf8(buf, slides[i], budget);
    const parts: string[] = [];
    const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRegex.exec(xml)) !== null) {
      const val = decodeXmlEntities(tMatch[1]).trim();
      if (val) parts.push(val);
    }
    if (parts.length > 0) sections.push(`--- Slide ${i + 1} ---\n${parts.join('\n')}`);
  }
  return { ok: true, format: 'pptx', text: sections.join('\n\n').slice(0, MAX_EXTRACTED_CHARS) };
}

function extractXlsx(buf: Buffer): RichDocumentResult {
  const entries = parseZipEntries(buf);
  const budget = { remaining: MAX_DECOMPRESSED_BYTES };
  const sharedStrings: string[] = [];
  const ssEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  if (ssEntry) {
    const ssXml = readZipEntryUtf8(buf, ssEntry, budget);
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch: RegExpExecArray | null;
    while ((siMatch = siRegex.exec(ssXml)) !== null) {
      const tParts: string[] = [];
      const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRegex.exec(siMatch[1])) !== null) {
        tParts.push(decodeXmlEntities(tMatch[1]));
      }
      sharedStrings.push(tParts.join(''));
    }
  }

  const sheets = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (sheets.length === 0) {
    return { ok: false, format: 'xlsx', text: '', error: 'XLSX archive does not contain any worksheets.' };
  }

  const sections: string[] = [];
  for (let i = 0; i < sheets.length; i += 1) {
    const xml = readZipEntryUtf8(buf, sheets[i], budget);
    const rows: string[] = [];
    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(xml)) !== null && rows.length < 300) {
      const cells: string[] = [];
      const cRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cMatch: RegExpExecArray | null;
      while ((cMatch = cRegex.exec(rowMatch[1])) !== null) {
        const attrs = cMatch[1];
        const inner = cMatch[2];
        const isShared = /\bt="s"/.test(attrs);
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const inlineMatch = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        if (inlineMatch) {
          cells.push(decodeXmlEntities(inlineMatch[1]));
        } else if (vMatch) {
          const rawVal = vMatch[1].trim();
          if (isShared) {
            const idx = Number(rawVal);
            cells.push(sharedStrings[idx] ?? '');
          } else {
            cells.push(rawVal);
          }
        }
      }
      if (cells.some((c) => c.trim().length > 0)) rows.push(cells.join('\t'));
    }
    if (rows.length > 0) sections.push(`--- Sheet ${i + 1} ---\n${rows.join('\n')}`);
  }
  return { ok: true, format: 'xlsx', text: sections.join('\n\n').slice(0, MAX_EXTRACTED_CHARS) };
}

function unescapePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function extractTextFromPdfStream(streamText: string): string[] {
  const out: string[] = [];
  const tjRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tjRegex.exec(streamText)) !== null) {
    const txt = unescapePdfString(m[1]).trim();
    if (txt) out.push(txt);
  }
  const tjArrRegex = /\[([\s\S]*?)\]\s*TJ/g;
  while ((m = tjArrRegex.exec(streamText)) !== null) {
    const parts: string[] = [];
    const inner = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let im: RegExpExecArray | null;
    while ((im = inner.exec(m[1])) !== null) {
      parts.push(unescapePdfString(im[1]));
    }
    const joined = parts.join('').trim();
    if (joined) out.push(joined);
  }
  return out;
}

function extractPdf(buf: Buffer): RichDocumentResult {
  const header = buf.subarray(0, 16).toString('latin1');
  if (!header.startsWith('%PDF-')) {
    return { ok: false, format: 'pdf', text: '', error: 'File does not have a valid %PDF- header.' };
  }
  const latin1 = buf.toString('latin1');
  if (/\/Encrypt\b/.test(latin1)) {
    return { ok: false, format: 'pdf', text: '', error: 'PDF is encrypted/password-protected and cannot be extracted.' };
  }

  const fragments: string[] = [];
  // Scan stream ... endstream blocks
  let cursor = 0;
  let decompressedTotal = 0;
  while (cursor < buf.length && fragments.length < 4_000) {
    const streamIdx = latin1.indexOf('stream', cursor);
    if (streamIdx < 0) break;
    let dataStart = streamIdx + 6;
    if (latin1[dataStart] === '\r' && latin1[dataStart + 1] === '\n') dataStart += 2;
    else if (latin1[dataStart] === '\n') dataStart += 1;
    const endIdx = latin1.indexOf('endstream', dataStart);
    if (endIdx < 0) break;

    const dictSlice = latin1.slice(Math.max(0, streamIdx - 240), streamIdx);
    const rawSlice = buf.subarray(dataStart, endIdx);
    let decoded = '';
    if (/\/FlateDecode\b/.test(dictSlice)) {
      const remaining = MAX_DECOMPRESSED_BYTES - decompressedTotal;
      if (remaining > 0) {
        try {
          const inflated = inflateSync(rawSlice, { maxOutputLength: remaining });
          decompressedTotal += inflated.length;
          decoded = inflated.toString('latin1');
        } catch { /* skip non-text/malformed compressed stream */ }
      }
    } else {
      decoded = rawSlice.toString('latin1');
    }

    if (decoded.includes('BT') || decoded.includes('Tj') || decoded.includes('TJ')) {
      fragments.push(...extractTextFromPdfStream(decoded));
    }
    cursor = endIdx + 9;
  }

  const text = fragments.join('\n').trim().slice(0, MAX_EXTRACTED_CHARS);
  if (!text) {
    return {
      ok: false,
      format: 'pdf',
      text: '',
      error: 'No extractable text streams found in PDF (it may be scanned/image-only or use custom font encoding).',
    };
  }
  return { ok: true, format: 'pdf', text };
}

export function extractRichDocument(ext: string, buffer: Buffer): RichDocumentResult {
  const lower = ext.toLowerCase();
  try {
    switch (lower) {
      case '.docx': return extractDocx(buffer);
      case '.pptx': return extractPptx(buffer);
      case '.xlsx': return extractXlsx(buffer);
      case '.pdf': return extractPdf(buffer);
      default:
        return { ok: false, format: 'pdf', text: '', error: `Unsupported rich document format: ${lower}` };
    }
  } catch (err) {
    const fmt = (lower.slice(1) as 'docx' | 'xlsx' | 'pptx' | 'pdf') || 'pdf';
    return {
      ok: false,
      format: fmt,
      text: '',
      error: `Document extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
