/**
 * Hue for a port. The golden angle spreads neighbouring ports (3000, 3001, 3002...)
 * far apart on the colour wheel, so their tabs are easy to tell apart.
 */
export function portHue(port) {
  return Math.round((port * 137.508) % 360);
}

/** Default favicon: a rounded square coloured by port, showing its last two digits. */
export function faviconSvg(port) {
  const label = String(port).slice(-2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="hsl(${portHue(port)}, 70%, 45%)"/>` +
    `<text x="32" y="45" font-family="system-ui, -apple-system, 'Segoe UI', Arial, sans-serif" ` +
    `font-size="36" font-weight="700" text-anchor="middle" fill="#fff">${label}</text>` +
    `</svg>`
  );
}

export function sendFavicon(req, res, port) {
  const body = Buffer.from(faviconSvg(port));
  res.writeHead(200, {
    'content-type': 'image/svg+xml',
    'content-length': body.length,
    'cache-control': 'no-cache',
    'x-carotid': 'favicon-fallback',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
