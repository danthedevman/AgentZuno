import { Binary } from 'mongodb';

export function storedBinaryBytes(value) {
  if (value instanceof Binary) return Buffer.from(value.value());
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  // Older JSONB pictures were saved as numbered byte properties instead of BSON Binary.
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (
      keys.length &&
      keys.length <= 5 * 1024 * 1024 &&
      keys.every(
        (key, index) =>
          key === String(index) &&
          Number.isInteger(value[key]) &&
          value[key] >= 0 &&
          value[key] <= 255,
      )
    )
      return Buffer.from(keys.map((key) => value[key]));
  }
  throw Object.assign(new Error('Stored image could not be read.'), { status: 422 });
}
