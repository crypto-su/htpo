/** Small byte helpers shared by the PDF writer and TrueType subsetter. */
export const ascii = (value: string): Uint8Array => new TextEncoder().encode(value);
export const hex16 = (value: number): string => value.toString(16).padStart(4, '0');
export function unicodeHex(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i++) result += hex16(value.charCodeAt(i));
  return result;
}
export function pdfString(value: string): string {
  if (/[^\x20-\x7e]/.test(value)) return `<feff${unicodeHex(value)}>`;
  return `(${value.replace(/[\\()]/g, '\\$&')})`;
}
export function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
export function concat(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}
export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
}
export function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('PDF coordinates must be finite.');
  return String(Math.round(value * 100000) / 100000);
}
