function decodeBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return buf;
}

export const decodeFloat32 = (b64: string) => new Float32Array(decodeBytes(b64));
export const decodeUint16 = (b64: string) => new Uint16Array(decodeBytes(b64));
export const decodeUint32 = (b64: string) => new Uint32Array(decodeBytes(b64));
