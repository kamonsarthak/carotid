# carotid

**A zero-config dev proxy that makes `localhost` behave like the real world:** open your app on your phone by scanning a QR code, then make the network slow, flaky or dead while you watch every request go by.

```
npx carotid 3000
```

```
  carotid v0.1.0

  Local     http://localhost:2345
  Network   http://192.168.1.20:2345   <- open this on your phone
  Target    http://localhost:3000
  Chaos     profile 3g (300ms ±100, 200 KB/s, 1% fail), 0 rules
  Config    none (create carotid.yaml here to add rules, it loads live)
  Stats     http://localhost:2345/__carotid/stats

  █▀▀▀▀▀█ ▄▀ ▄▀ █▀▀▀▀▀█
  █ ███ █ ▀█▄▀▄ █ ███ █      (a real, scannable QR code)
  █ ▀▀▀ █ █ ▄ ▀ █ ▀▀▀ █
  ▀▀▀▀▀▀▀ ▀ █ ▀ ▀▀▀▀▀▀▀

  Requests appear below. Press Ctrl+C to stop.

14:02:11 GET     /                          200    412ms  delay 371ms, throttle 200KB/s
14:02:11 GET     /assets/index.js           200    1.9s   delay 284ms, throttle 200KB/s
14:02:12 WS      /?token=abc                101    303ms  delay 301ms
14:02:14 POST    /api/cart                  503    344ms  delay 339ms, fail 503
14:02:14 GET     /favicon.ico               200      3ms  favicon fallback
```

## The demo

1. Your app is running on `localhost:3000`, the way it always is.
2. Run `npx carotid 3000 --profile 3g`.
3. Point your phone's camera at the QR code in the terminal. Your app opens on the phone, hot reload included.
4. Tap around. On the phone the app now feels like it is on a 3G connection; in the terminal you see each request with its status, how long it took, and what carotid did to it.
5. Create a `carotid.yaml`, write `profile: offline`, hit save. No restart: the next tap on the phone fails, and you find out what your app does when the network goes away.

## Install

Nothing to install; `npx` runs it on demand:

```
npx carotid 3000
```

Or add it to a project:

```
npm install --save-dev carotid
```

Requires Node.js 18.3 or newer. Works on Windows, macOS and Linux.

## Usage

```
carotid <port> [options]     proxy localhost:<port>, print a LAN URL + QR code
carotid export [options]     save the traffic captured by a running carotid
```

| Option | Meaning |
| --- | --- |
| `-p, --profile <name>` | Apply a network profile (table below) |
| `-l, --listen <port>` | Port carotid listens on. Default `2345`; if that is busy carotid takes the next free one |
| `--no-qr` | Do not print the QR code |
| `-h, --help` | Help |
| `-v, --version` | Version |

```
carotid 3000                        # just LAN access, QR code and the request log
carotid 5173 --profile slow-3g      # Vite app on a bad connection
carotid 8080 --listen 9000          # choose carotid's own port
```

What you get without any configuration:

- **LAN access.** carotid listens on all interfaces, finds your machine's LAN address, and prints the URL plus a QR code.
- **A transparent proxy.** HTTP, streaming responses (SSE) and WebSocket upgrades pass straight through, so hot reload in Vite, Next.js and webpack keeps working. Headers are preserved, including `Host`.
- **A live request log.** One line per request: time, method, path, status, duration, and the chaos that was applied.
- **A favicon.** If your app has no `/favicon.ico`, carotid serves a small generated icon whose colour depends on the port, so three localhost tabs are easy to tell apart and your log has no favicon 404s. If your app serves its own favicon, carotid never touches it.
- **A waiting page.** Started carotid before your dev server? The page says so and loads by itself once the server is up.

## Profiles

| Profile | Latency | Bandwidth | Failures | Feels like |
| --- | --- | --- | --- | --- |
| `3g` | 300 ms ± 100 | 200 KB/s (~1.6 Mbit/s) | 1% get a 503 | An average phone on 3G |
| `slow-3g` | 2000 ms ± 500 | 50 KB/s (~400 kbit/s) | 2% get a 503 | One bar of signal |
| `flaky-wifi` | 150 ms ± 150 | 1000 KB/s | 5% get 502/503/504, 5% dropped, 3% cut mid-response | Coffee-shop wifi |
| `airplane-mode` | hangs 2 to 6 s | n/a | 100% dropped after the hang | The signal just vanished and nothing has noticed yet |
| `offline` | none | n/a | 100% dropped immediately | No network at all |

`airplane-mode` and `offline` also block page loads, so load the page first and then switch profile in `carotid.yaml`.

Profiles live in one file, [`src/profiles/index.js`](src/profiles/index.js). The numbers are easy to change.

## Config: `carotid.yaml`

Optional. Put it in the folder you run carotid from; it is detected automatically and **reloaded on every save**, with a one-line notice in the terminal:

```
  [config] carotid.yaml reloaded: profile 3g (300ms ±100, 200 KB/s, 1% fail), 2 rules
```

```yaml
profile: 3g

rules:
  # A slow endpoint
  - path: /api/search
    delay: 1200         # ms
    jitter: 400         # random +/- ms

  # 1 in 4 writes fails
  - path: /api/**
    method: [POST, PUT]
    fail: 25            # percent
    status: 503         # or a list: [500, 502, 503]

  # Thin pipe that sometimes dies halfway
  - path: /downloads/**
    throttle: 30        # KB/s
    cut: 10             # percent of responses cut mid-body

  # Exempt something from the profile
  - path: /health
    delay: 0
    jitter: 0
    fail: 0
```

| Field | Meaning |
| --- | --- |
| `path` | Path pattern. `/api/users` exact, `/api/*` one segment, `/api/**` everything below (and `/api`), `**/*.png` by extension. Omit to match every path |
| `method` | One method or a list. Omit to match all |
| `delay` | Fixed latency in ms |
| `jitter` | Random ± ms on top of `delay` |
| `fail` | Percent of requests answered with an injected status instead of reaching your app |
| `status` | Status code for injected failures, or a list to pick from. Default 503 |
| `throttle` | Response bandwidth in KB/s |
| `drop` | Percent of requests whose connection is closed without any response |
| `cut` | Percent of responses cut off partway through the body |

How rules combine: the profile is the baseline; every rule that matches a request overrides the fields it sets; rules apply top to bottom, so later ones win.

`--profile` on the command line overrides `profile:` in the file.

If the file has a mistake, carotid tells you what and where, and keeps running with the previous rules:

```
  carotid.yaml has 2 problems:
    - unknown profile "4g"; available: 3g, slow-3g, flaky-wifi, airplane-mode, offline
    - rules[0].delay must be a number of milliseconds (0 or more), got "fast"
  Keeping the previous rules until the file is fixed.
```

A commented example is in [`examples/carotid.yaml`](examples/carotid.yaml).

## Stats and export

While carotid runs, `http://localhost:2345/__carotid/stats` returns JSON:

```json
{
  "target": "http://localhost:3000",
  "profile": "3g",
  "requests": { "total": 128, "buffered": 128, "capacity": 1000 },
  "status": { "2xx": 119, "3xx": 4, "4xx": 2, "5xx": 3, "none": 0, "codes": { "200": 119, "304": 4, "404": 2, "503": 3 } },
  "latency": { "avg": 412, "p50": 371, "p95": 1204, "max": 2210, "sample": 128 },
  "chaos": { "delay": 128, "throttle": 125, "fail": 3 },
  "recent": [ { "time": "…", "method": "GET", "url": "/", "status": 200, "duration": 412, "chaos": ["delay 371ms"] } ]
}
```

The last 1000 requests are kept in memory. To save them, run this in a second terminal while carotid is running:

```
carotid export                    # HAR, opens in browser devtools (Network tab > Import)
carotid export --format json      # carotid's own JSON
carotid export --out traffic.har --listen 2345
```

Exports contain request headers, including cookies and tokens. Look before you share one.

## Phone can't connect?

- The phone has to be on the **same Wi-Fi** as your computer. Guest networks and some office networks block devices from talking to each other.
- **Windows:** the first time, Windows Security asks whether Node.js may accept connections: click **Allow**. If you dismissed it, open *Allow an app through Windows Firewall*, find *Node.js JavaScript Runtime* and tick **Private**. Also check that your Wi-Fi is set to *Private network* (Settings > Network & Internet > Wi-Fi > your network).
- **macOS:** click **Allow** when asked whether `node` may accept incoming connections.
- **Linux:** open the port if you run a firewall, e.g. `sudo ufw allow 2345/tcp`.
- VPNs often take over routing. If carotid prints the wrong address, the banner also lists the other addresses it found.
- Vite 6+ and some other dev servers only accept requests for known host names. IP addresses are allowed by default, so the LAN URL works as is.

## Limitations

carotid is honest about what it is: an HTTP-level simulator.

- **It is not packet-level.** There is no real packet loss, reordering, TCP congestion or DNS delay. `drop` closes a socket; it does not lose packets. For that, use OS tools (`tc netem` on Linux, Network Link Conditioner on macOS, clumsy on Windows).
- **Throttling is on responses only**, per request, measured at the proxy. Upload speed is not limited, and ten parallel requests each get the full rate rather than sharing one pipe.
- **Latency is added once per request**, before it is forwarded. It does not model per-round-trip latency or slow connection setup.
- **WebSockets:** `delay`, `drop` and `fail` apply to the handshake. Messages on an open socket are not delayed, throttled or cut.
- **Bodies are not captured.** The request log and exports contain headers, sizes and timings, not content.
- **HTTP only.** No HTTPS, so browser features that need a secure context (service workers, camera, geolocation, clipboard) will not work on the phone over the LAN URL.
- **The favicon fallback is an SVG.** Current Chrome, Firefox, Edge and Safari render it; very old browsers may not.
- **It opens your dev server to your local network.** That is the point, but anyone on the same network can reach it, and `/__carotid/stats` too, while carotid runs. Use it on networks you trust.
- Stats and latency percentiles cover the last 1000 requests and are lost when carotid stops.

## Roadmap

Not in v1, but the code is laid out so they can be added:

- Web dashboard
- HTTPS with locally trusted certificates (mkcert)
- Public tunnel sharing
- mDNS (`carotid.local`)
- Request breakpoints and editing
- Mocking

## Development

```
git clone <this repo> && cd carotid
npm install
npm test                      # node:test, no extra tooling
node bin/carotid.js 3000
```

```
bin/carotid.js       entry point
src/cli.js           argument parsing
src/start.js         wires everything together for `carotid <port>`
src/proxy/           server, HTTP forwarding + chaos, WebSocket tunnel, throttle, favicon, /__carotid endpoints
src/rules/           path matching, the per-request chaos plan, config validation
src/profiles/        built-in network profiles
src/config/          carotid.yaml loading and hot reload
src/net/             LAN address detection, port picking
src/store/           ring buffer of recent requests + stats
src/ui/              banner, QR code, request log, colour
src/export/          HAR and JSON export
```

Dependencies: [`yaml`](https://www.npmjs.com/package/yaml) and [`qrcode-terminal`](https://www.npmjs.com/package/qrcode-terminal). The proxy itself is plain `node:http` and `node:net`.

## License

MIT
