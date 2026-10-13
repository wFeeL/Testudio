export const SHOW_LIMIT = 100000;
const DIR_MARK = '{dir}';

function isSimpleText(data: Buffer): boolean {
  if (data.includes(0x00) || data.includes(0x0d)) {
    return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

export function isEditableText(data: Buffer): boolean {
  return data.length <= SHOW_LIMIT && isSimpleText(data);
}

function hex(byte: number): string {
  return '\\x' + byte.toString(16).toUpperCase().padStart(2, '0');
}

function sequenceLength(lead: number): number {
  if (lead >= 0xc2 && lead <= 0xdf) {
    return 2;
  }
  if (lead >= 0xe0 && lead <= 0xef) {
    return 3;
  }
  if (lead >= 0xf0 && lead <= 0xf4) {
    return 4;
  }
  return 0;
}

function showAscii(byte: number): string {
  if (byte === 0x00) {
    return '\\0';
  }
  if (byte === 0x0d) {
    return '\\r';
  }
  if (byte === 0x09) {
    return '\\t';
  }
  if (byte === 0x5c) {
    return '\\\\';
  }
  if (byte === 0x0a) {
    return '\n';
  }
  if (byte < 0x20 || byte === 0x7f) {
    return hex(byte);
  }
  return String.fromCharCode(byte);
}

function decodeSequence(data: Buffer, index: number, length: number): string | undefined {
  if (length === 0 || index + length > data.length) {
    return undefined;
  }
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    return decoder.decode(data.subarray(index, index + length));
  } catch {
    return undefined;
  }
}

export function showBytes(data: Buffer): string {
  let result = '';
  let index = 0;
  while (index < data.length) {
    const byte = data[index];
    if (byte < 0x80) {
      result += showAscii(byte);
      index += 1;
      continue;
    }
    const length = sequenceLength(byte);
    const symbol = decodeSequence(data, index, length);
    if (symbol !== undefined) {
      result += symbol;
      index += length;
    } else {
      result += hex(byte);
      index += 1;
    }
  }
  return result;
}

export function replaceAllBytes(data: Buffer, from: Buffer, to: Buffer): Buffer {
  if (from.length === 0) {
    return data;
  }
  const parts: Buffer[] = [];
  let start = 0;
  let found = data.indexOf(from, start);
  while (found !== -1) {
    parts.push(data.subarray(start, found));
    parts.push(to);
    start = found + from.length;
    found = data.indexOf(from, start);
  }
  parts.push(data.subarray(start));
  return Buffer.concat(parts);
}

export function substituteDir(data: Buffer, folder: string): Buffer {
  return replaceAllBytes(data, Buffer.from(DIR_MARK), Buffer.from(folder));
}

export function restoreDir(data: Buffer, folder: string): Buffer {
  return replaceAllBytes(data, Buffer.from(folder), Buffer.from(DIR_MARK));
}
