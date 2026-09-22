// The measurement cache is synchronous in browsers. This uses the same SHA-256
// compression as the host's resolved-layout-sha, without a private-host dependency.
// Encoding UTF-16LE preserves every existing key code unit, including lone surrogates.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

export class Utf16Sha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private readonly view = new DataView(this.block.buffer);
  private blockLength = 0;
  private totalBytes = 0;
  private finalized = false;

  write(value: string): void {
    if (this.finalized) throw new Error('sha256 digest already finalized');
    this.totalBytes += value.length * 2;
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      this.block[this.blockLength++] = codeUnit & 0xff;
      this.block[this.blockLength++] = codeUnit >>> 8;
      if (this.blockLength === 64) {
        compressSha256(this.state, this.words, this.view);
        this.blockLength = 0;
      }
    }
  }

  digestHex(): string {
    if (this.finalized) throw new Error('sha256 digest already finalized');
    this.finalized = true;
    const bitLenHi = Math.floor(this.totalBytes / 0x20000000);
    const bitLenLo = (this.totalBytes << 3) >>> 0;
    this.block[this.blockLength++] = 0x80;
    if (this.blockLength > 56) {
      this.block.fill(0, this.blockLength);
      compressSha256(this.state, this.words, this.view);
      this.blockLength = 0;
    }
    this.block.fill(0, this.blockLength, 56);
    this.view.setUint32(56, bitLenHi, false);
    this.view.setUint32(60, bitLenLo, false);
    compressSha256(this.state, this.words, this.view);
    let hex = '';
    for (const word of this.state) hex += word.toString(16).padStart(8, '0');
    return hex;
  }
}

function compressSha256(state: Uint32Array, w: Uint32Array, view: DataView): void {
  for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(i * 4, false);
  for (let i = 16; i < 64; i += 1) {
    const w15 = w[i - 15]!;
    const w2 = w[i - 2]!;
    const s0 = (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) >>> 0;
    const s1 = (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)) >>> 0;
    w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
  }
  let a = state[0]!;
  let b = state[1]!;
  let c = state[2]!;
  let d = state[3]!;
  let e = state[4]!;
  let f = state[5]!;
  let g = state[6]!;
  let h = state[7]!;
  for (let i = 0; i < 64; i += 1) {
    const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
    const ch = ((e & f) ^ (~e & g)) >>> 0;
    const temp1 = (h + s1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
    const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
    const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
    const temp2 = (s0 + maj) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }
  state[0] = (state[0]! + a) >>> 0;
  state[1] = (state[1]! + b) >>> 0;
  state[2] = (state[2]! + c) >>> 0;
  state[3] = (state[3]! + d) >>> 0;
  state[4] = (state[4]! + e) >>> 0;
  state[5] = (state[5]! + f) >>> 0;
  state[6] = (state[6]! + g) >>> 0;
  state[7] = (state[7]! + h) >>> 0;
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}
