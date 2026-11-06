export function uploadBytes(body, maximum) {
  if (!Buffer.isBuffer(body))
    throw Object.assign(new Error('Expected a binary file upload.'), { status: 400 });
  const bytes = Buffer.from(body);
  if (bytes.byteLength === 0 || bytes.byteLength > maximum)
    throw Object.assign(new Error('The uploaded file is empty or exceeds its size limit.'), {
      status: 400,
    });
  return bytes;
}
