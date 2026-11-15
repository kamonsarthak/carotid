import { Transform } from 'node:stream';

const SLICE_MS = 50;

/**
 * Trickles data through at a fixed rate. Chunks are cut into slices worth ~50 ms each
 * and released against a running clock, so timer inaccuracy does not accumulate.
 */
export class Throttle extends Transform {
  /** @param {number} kbPerSecond */
  constructor(kbPerSecond) {
    super();
    this.bytesPerMs = (kbPerSecond * 1024) / 1000;
    this.sliceBytes = Math.max(1, Math.round(this.bytesPerMs * SLICE_MS));
    this.nextAt = 0; // when the next slice may be sent
    this.timer = null;
  }

  _transform(chunk, _encoding, callback) {
    let offset = 0;
    const step = () => {
      if (this.destroyed) return;
      const slice = chunk.subarray(offset, offset + this.sliceBytes);
      offset += slice.length;
      this.push(slice);

      const now = Date.now();
      this.nextAt = Math.max(this.nextAt, now) + slice.length / this.bytesPerMs;
      this.timer = setTimeout(offset < chunk.length ? step : callback, Math.max(0, this.nextAt - now));
    };
    const wait = this.nextAt - Date.now();
    if (wait > 0) this.timer = setTimeout(step, wait);
    else step();
  }

  _destroy(err, callback) {
    clearTimeout(this.timer);
    callback(err);
  }
}
