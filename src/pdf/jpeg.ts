import { concat } from './binary';

export function jpegInfo(bytes: Uint8Array): { components: number; width: number; height: number } {
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Invalid JPEG image.');
  let p = 2;
  while (p + 4 < bytes.length) {
    if (bytes[p++] !== 255) throw new Error('Invalid JPEG marker.');
    while (bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = (bytes[p] << 8) | bytes[p + 1];
    if (length < 2 || p + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (bytes[p + 2] !== 8 || ![1, 3, 4].includes(bytes[p + 7])) throw new Error('Unsupported JPEG color depth.');
      return { components: bytes[p + 7], width: (bytes[p + 5] << 8) | bytes[p + 6], height: (bytes[p + 3] << 8) | bytes[p + 4] };
    }
    p += length;
  }
  throw new Error('Unsupported or truncated JPEG image.');
}

/** Our DeviceRGB/DeviceGray DCT images use stored pixels without EXIF orientation
 * or ICC color conversion. Remove those hints from the temporary resize input
 * so canvas decoding keeps the same orientation and colors as the original PDF.
 * Adobe (APP14), other APP2 payloads and compressed scan bytes remain untouched.
 */
export function jpegWithoutRenderingMetadata(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = []; let p = 2, start = 0;
  while (p + 4 < bytes.length) {
    const markerStart = p;
    if (bytes[p++] !== 255) break;
    while (bytes[p] === 255) p++;
    const marker = bytes[p++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = (bytes[p] << 8) | bytes[p + 1];
    if (length < 2 || p + length > bytes.length) break;
    const isIcc = marker === 0xe2 && length >= 14 &&
      [73, 67, 67, 95, 80, 82, 79, 70, 73, 76, 69, 0].every((value, i) => bytes[p + 2 + i] === value); // ICC_PROFILE\0
    if (marker === 0xe1 || isIcc) { parts.push(bytes.subarray(start, markerStart)); start = p + length; }
    p += length;
  }
  return parts.length ? concat([...parts, bytes.subarray(start)]) : bytes;
}
