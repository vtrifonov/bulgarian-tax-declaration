/* cspell:disable */
// cspell:disable-next-line
import * as CFB from 'cfb';

import type {
    Spb8FormData,
    Spb8Security,
} from '../types/index.js';

/**
 * Fill the official BNB SPB-8 template (.xls) with form data.
 *
 * Uses direct BIFF8 binary patching to preserve the template's
 * formatting (green headers, borders, column widths, hidden column A).
 * SheetJS round-trip loses all formatting, so we modify records in-place.
 *
 * Template structure (3 sheets, 0-indexed):
 * - Sheet 0 (SPB8_BPM6): R1C2=report type, R2C2=EGN, R3C2=year
 * - Sheet 1 (INVESTMENTS): data rows start at R3 (row 4 in Excel), cols 1-6
 * - Sheet 2 (SECURITIES): data rows start at R5 (row 6 in Excel), cols 1-3
 */

// BNB expects single-letter codes: P = първоначален, R = коригиращ

// BIFF8 record types
const RT_LABELSST = 0x00fd;
const RT_NUMBER = 0x0203;
const RT_BLANK = 0x0201;
const RT_SST = 0x00fc;
const RT_EXTSST = 0x00ff;
const RT_BOUNDSHEET = 0x0085;
const RT_BOF = 0x0809;
const RT_EOF = 0x000a;

// ── DataView helpers (browser-safe, no Buffer) ──────────────────

function readU16(arr: Uint8Array, off: number): number {
    return arr[off] | (arr[off + 1] << 8);
}

function readU32(arr: Uint8Array, off: number): number {
    return (
        (arr[off]
            | (arr[off + 1] << 8)
            | (arr[off + 2] << 16)
            | (arr[off + 3] << 24))
        >>> 0
    );
}

function writeU16(arr: Uint8Array, off: number, val: number): void {
    arr[off] = val & 0xff;
    arr[off + 1] = (val >> 8) & 0xff;
}

function writeU32(arr: Uint8Array, off: number, val: number): void {
    arr[off] = val & 0xff;
    arr[off + 1] = (val >> 8) & 0xff;
    arr[off + 2] = (val >> 16) & 0xff;
    arr[off + 3] = (val >> 24) & 0xff;
}

function writeF64(arr: Uint8Array, off: number, val: number): void {
    const dv = new DataView(arr.buffer, arr.byteOffset + off, 8);

    dv.setFloat64(0, val, true); // little-endian
}

function concat(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;

    for (const p of parts) {
        out.set(p, pos);
        pos += p.length;
    }

    return out;
}

/** Encode a JS string to UTF-16LE bytes. */
function encodeUtf16le(s: string): Uint8Array {
    const buf = new Uint8Array(s.length * 2);

    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);

        buf[i * 2] = code & 0xff;
        buf[i * 2 + 1] = (code >> 8) & 0xff;
    }

    return buf;
}

/** Decode UTF-16LE bytes to a JS string. */
function decodeUtf16le(arr: Uint8Array, off: number, chars: number): string {
    let s = '';

    for (let i = 0; i < chars; i++) {
        s += String.fromCharCode(arr[off + i * 2] | (arr[off + i * 2 + 1] << 8));
    }

    return s;
}

/** Decode latin1 bytes to a JS string. */
function decodeLatin1(arr: Uint8Array, off: number, chars: number): string {
    let s = '';

    for (let i = 0; i < chars; i++) {
        s += String.fromCharCode(arr[off + i]);
    }

    return s;
}

// ── BIFF8 record builders ───────────────────────────────────────

interface BiffRecord {
    type: number;
    raw: Uint8Array;
}

interface CellPatch {
    sheet: number;
    row: number;
    col: number;
    xf: number;
    sst?: number;
    num?: number;
}

/** Encode a string into BIFF8 SST format (always UTF-16LE). */
function encodeSstString(s: string): Uint8Array {
    const charBytes = encodeUtf16le(s);
    const buf = new Uint8Array(3 + charBytes.length);

    writeU16(buf, 0, s.length);
    buf[2] = 0x01; // UTF-16LE flag
    buf.set(charBytes, 3);

    return buf;
}

/** Build a LABELSST record. */
function makeLabelSst(
    row: number,
    col: number,
    xf: number,
    sstIndex: number,
): Uint8Array {
    const buf = new Uint8Array(14);

    writeU16(buf, 0, RT_LABELSST);
    writeU16(buf, 2, 10); // data length
    writeU16(buf, 4, row);
    writeU16(buf, 6, col);
    writeU16(buf, 8, xf);
    writeU32(buf, 10, sstIndex);

    return buf;
}

/** Build a NUMBER record. */
function makeNumber(
    row: number,
    col: number,
    xf: number,
    value: number,
): Uint8Array {
    const buf = new Uint8Array(18);

    writeU16(buf, 0, RT_NUMBER);
    writeU16(buf, 2, 14);
    writeU16(buf, 4, row);
    writeU16(buf, 6, col);
    writeU16(buf, 8, xf);
    writeF64(buf, 10, value);

    return buf;
}

/** Parse existing SST strings from BIFF8 data. */
function parseSst(data: Uint8Array): { strings: string[]; totalRefs: number } {
    const totalRefs = readU32(data, 0);
    const uniqueCount = readU32(data, 4);
    let pos = 8;
    const strings: string[] = [];

    for (let i = 0; i < uniqueCount; i++) {
        const charCount = readU16(data, pos);
        const flags = data[pos + 2];
        const isUnicode = flags & 1;

        pos += 3;

        let rtRuns = 0;
        let extSize = 0;

        if (flags & 0x08) {
            rtRuns = readU16(data, pos);
            pos += 2;
        }

        if (flags & 0x04) {
            extSize = readU32(data, pos);
            pos += 4;
        }

        if (isUnicode) {
            strings.push(decodeUtf16le(data, pos, charCount));
            pos += charCount * 2;
        } else {
            strings.push(decodeLatin1(data, pos, charCount));
            pos += charCount;
        }

        if (rtRuns > 0) {
            pos += rtRuns * 4;
        }

        if (extSize > 0) {
            pos += extSize;
        }
    }

    return { strings, totalRefs };
}

/** Rebuild the SST record from the string list. */
function buildSstRecord(strings: string[], totalRefs: number): Uint8Array {
    const parts: Uint8Array[] = [];

    for (const s of strings) {
        parts.push(encodeSstString(s));
    }

    const dataLen = 8 + parts.reduce((sum, p) => sum + p.length, 0);
    const header = new Uint8Array(12);

    writeU16(header, 0, RT_SST);
    writeU16(header, 2, dataLen);
    writeU32(header, 4, totalRefs);
    writeU32(header, 8, strings.length);

    return concat([header, ...parts]);
}

// ── Main function ───────────────────────────────────────────────

export function fillBnbTemplate(
    templateBuffer: ArrayBuffer,
    formData: Spb8FormData,
): Uint8Array {
    const cfb = CFB.read(new Uint8Array(templateBuffer), { type: 'array' });
    const wbEntry = CFB.find(cfb, '/Workbook') ?? CFB.find(cfb, '/Book');

    if (!wbEntry?.content) {
        throw new Error('Workbook stream not found in template');
    }

    const buf = new Uint8Array(wbEntry.content);

    // Step 1: Parse all BIFF8 records
    let offset = 0;
    const records: BiffRecord[] = [];

    while (offset < buf.length - 3) {
        const type = readU16(buf, offset);
        const len = readU16(buf, offset + 2);

        records.push({ type, raw: buf.slice(offset, offset + 4 + len) });
        offset += 4 + len;
    }

    // Step 2: Parse SST and prepare new strings
    const sstRecIdx = records.findIndex((r) => r.type === RT_SST);
    const { strings, totalRefs } = parseSst(
        records[sstRecIdx].raw.slice(4),
    );

    const addString = (s: string): number => {
        const idx = strings.indexOf(s);

        if (idx >= 0) {
            return idx;
        }
        strings.push(s);

        return strings.length - 1;
    };

    // Step 3: Collect cell patches
    const patches: CellPatch[] = [];
    let newRefs = 0;

    // BOF[0] = global workbook, BOF[1] = SPB8_BPM6, BOF[2] = INVESTMENTS, BOF[3] = SECURITIES
    // Sheet indices are 1-based (sheetNum increments on each BOF starting from -1)

    // Sheet 1 (SPB8_BPM6): C2=report type (P/R), C3=EGN, C4=year
    patches.push({
        sheet: 1,
        row: 1,
        col: 2,
        xf: 23,
        sst: addString(formData.reportType),
    });
    newRefs++;

    patches.push({
        sheet: 1,
        row: 2,
        col: 2,
        xf: 23,
        sst: addString(formData.personalData?.egn ?? ''),
    });
    newRefs++;

    patches.push({
        sheet: 1,
        row: 3,
        col: 2,
        xf: 23,
        num: formData.year,
    });

    // Sheet 2 (INVESTMENTS): rows 4+ (0-indexed R3+), cols B-G
    const maxInvRows = 47;

    for (
        let i = 0;
        i < Math.min(formData.accounts.length, maxInvRows);
        i++
    ) {
        const acc = formData.accounts[i];
        const row = 3 + i;

        patches.push({
            sheet: 2,
            row,
            col: 1,
            xf: 0,
            sst: addString(acc.type),
        });
        newRefs++;
        patches.push({
            sheet: 2,
            row,
            col: 2,
            xf: 0,
            sst: addString(acc.maturity),
        });
        newRefs++;
        patches.push({
            sheet: 2,
            row,
            col: 3,
            xf: 0,
            sst: addString(acc.country),
        });
        newRefs++;
        patches.push({
            sheet: 2,
            row,
            col: 4,
            xf: 0,
            sst: addString(acc.currency),
        });
        newRefs++;
        patches.push({
            sheet: 2,
            row,
            col: 5,
            xf: 0,
            num: Math.round(acc.amountStartOfYear / 10) / 100,
        });
        patches.push({
            sheet: 2,
            row,
            col: 6,
            xf: 0,
            num: Math.round(acc.amountEndOfYear / 10) / 100,
        });
    }

    // Sheet 3 (SECURITIES): rows 4+ (0-indexed R3+), cols B-D
    const maxSecRows = 47;
    const exportable = formData.securities.filter((s: Spb8Security) => {
        const startQty = Math.round(s.quantityStartOfYear * 100) / 100;
        const endQty = Math.round(s.quantityEndOfYear * 100) / 100;

        return startQty !== 0 || endQty !== 0;
    });

    for (let i = 0; i < Math.min(exportable.length, maxSecRows); i++) {
        const s = exportable[i];
        const row = 3 + i;

        patches.push({
            sheet: 3,
            row,
            col: 1,
            xf: 0,
            sst: addString(s.isin),
        });
        newRefs++;
        patches.push({
            sheet: 3,
            row,
            col: 2,
            xf: 0,
            num: Math.round(s.quantityStartOfYear * 100) / 100,
        });
        patches.push({
            sheet: 3,
            row,
            col: 3,
            xf: 0,
            num: Math.round(s.quantityEndOfYear * 100) / 100,
        });
    }

    // Step 4: Apply patches to records
    let sheetNum = -1;
    const newRecords: BiffRecord[] = [];
    const patchesBySheet = new Map<number, CellPatch[]>();

    for (const p of patches) {
        if (!patchesBySheet.has(p.sheet)) {
            patchesBySheet.set(p.sheet, []);
        }
        patchesBySheet.get(p.sheet)!.push(p);
    }

    for (const rec of records) {
        if (rec.type === RT_BOF) {
            sheetNum++;
        }

        // Replace BLANK records that match a patch
        if (rec.type === RT_BLANK && patchesBySheet.has(sheetNum)) {
            const row = readU16(rec.raw, 4);
            const col = readU16(rec.raw, 6);
            const sheetPatches = patchesBySheet.get(sheetNum)!;
            const pi = sheetPatches.findIndex(
                (p) => p.row === row && p.col === col,
            );

            if (pi >= 0) {
                const patch = sheetPatches[pi];

                sheetPatches.splice(pi, 1);

                if (patch.sst !== undefined) {
                    newRecords.push({
                        type: RT_LABELSST,
                        raw: makeLabelSst(row, col, patch.xf, patch.sst),
                    });
                } else if (patch.num !== undefined) {
                    newRecords.push({
                        type: RT_NUMBER,
                        raw: makeNumber(row, col, patch.xf, patch.num),
                    });
                }
                continue;
            }
        }

        // Before EOF, insert remaining patches for this sheet
        if (rec.type === RT_EOF && patchesBySheet.has(sheetNum)) {
            const remaining = patchesBySheet.get(sheetNum)!;

            remaining.sort((a, b) => a.row - b.row || a.col - b.col);

            for (const patch of remaining) {
                if (patch.sst !== undefined) {
                    newRecords.push({
                        type: RT_LABELSST,
                        raw: makeLabelSst(
                            patch.row,
                            patch.col,
                            patch.xf,
                            patch.sst,
                        ),
                    });
                } else if (patch.num !== undefined) {
                    newRecords.push({
                        type: RT_NUMBER,
                        raw: makeNumber(
                            patch.row,
                            patch.col,
                            patch.xf,
                            patch.num,
                        ),
                    });
                }
            }
            remaining.length = 0;
        }

        // Replace SST with updated version
        if (rec.type === RT_SST) {
            newRecords.push({
                type: RT_SST,
                raw: buildSstRecord(strings, totalRefs + newRefs),
            });
            continue;
        }

        // Drop EXTSST — it's optional and becomes stale after SST changes
        if (rec.type === RT_EXTSST) {
            continue;
        }

        newRecords.push(rec);
    }

    // Step 5: Fix BOUNDSHEET offsets
    // BOUNDSHEET records contain absolute byte offsets to each sheet's BOF.
    // Collect BOUNDSHEET indices and BOF indices, then recalculate.
    const boundsheetIndices: number[] = [];
    const bofIndices: number[] = [];

    for (let i = 0; i < newRecords.length; i++) {
        if (newRecords[i].type === RT_BOUNDSHEET) {
            boundsheetIndices.push(i);
        }

        if (newRecords[i].type === RT_BOF) {
            bofIndices.push(i);
        }
    }

    // BOF[0] is the global workbook BOF; BOF[1+] are sheet BOFs
    // BOUNDSHEET[i] should point to BOF[i+1]
    if (boundsheetIndices.length + 1 === bofIndices.length) {
        // Calculate cumulative byte offsets
        const offsets: number[] = [];
        let pos = 0;

        for (let i = 0; i < newRecords.length; i++) {
            offsets.push(pos);
            pos += newRecords[i].raw.length;
        }

        for (let i = 0; i < boundsheetIndices.length; i++) {
            const bsIdx = boundsheetIndices[i];
            const bofIdx = bofIndices[i + 1];
            const bofOffset = offsets[bofIdx];
            // BOUNDSHEET data: bytes 4-7 = BOF offset (U32LE)
            const rec = newRecords[bsIdx].raw;
            // Make a mutable copy if needed
            const copy = new Uint8Array(rec);

            writeU32(copy, 4, bofOffset);
            newRecords[bsIdx] = { type: RT_BOUNDSHEET, raw: copy };
        }
    }

    // Step 6: Rebuild workbook stream
    const newBuf = concat(newRecords.map((r) => r.raw));

    // Step 7: Update CFB and write
    wbEntry.content = newBuf;
    const output = CFB.write(cfb, { type: 'array' });

    return new Uint8Array(output);
}
/* cspell:enable */
