import qrcode from 'qrcode-terminal';

/** Compact QR code for the terminal (half-block characters), as a string. */
export function renderQr(text) {
  let out = '';
  qrcode.generate(text, { small: true }, (code) => {
    out = code;
  });
  return out.replace(/\s+$/, '');
}
