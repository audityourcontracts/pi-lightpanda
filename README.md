# pi-lightpanda

[Lightpanda](https://github.com/lightpanda-io/browser) headless browser extension for [pi](https://github.com/mariozechner/pi-coding-agent).

Adds three tools to pi:

| Tool | Description |
|------|-------------|
| `lightpanda_fetch` | Fetch a URL with full JS execution, returns HTML / Markdown / semantic tree |
| `lightpanda_serve` | Start a persistent CDP server for Playwright / Puppeteer scripts |
| `lightpanda_stop` | Stop the running CDP server |

And a `/lightpanda` command that shows binary and server status.

## Prerequisites — Lightpanda binary

The extension requires the `lightpanda` binary to be available at `~/.local/bin/lightpanda`.

Download it from the [Lightpanda releases page](https://github.com/lightpanda-io/browser/releases):

```bash
# macOS (Apple Silicon)
curl -fsSL -L \
  https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-macos \
  -o ~/.local/bin/lightpanda
chmod +x ~/.local/bin/lightpanda
```

```bash
# macOS (Intel x86_64)
curl -fsSL -L \
  https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-macos \
  -o ~/.local/bin/lightpanda
chmod +x ~/.local/bin/lightpanda
```

```bash
# Linux (x86_64)
curl -fsSL -L \
  https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux \
  -o ~/.local/bin/lightpanda
chmod +x ~/.local/bin/lightpanda
```

> Make sure `~/.local/bin` is in your `PATH`, or adjust the path in the commands above to somewhere that is.

Verify the install:

```bash
lightpanda version
```

## Install

```bash
pi install git:github.com/audityourcontracts/pi-lightpanda
```

Or add to `~/.pi/agent/settings.json` manually:

```json
{
  "packages": [
    "git:github.com/audityourcontracts/pi-lightpanda"
  ]
}
```

## Usage

### `lightpanda_fetch`

Fetches a URL and returns the rendered content. Unlike `curl`, it executes JavaScript before returning.

```
dump_mode:
  markdown         Clean prose — best for LLM consumption (default)
  html             Raw post-JS DOM
  semantic_tree    Accessibility tree with roles
  semantic_tree_text  Accessibility tree as plain text

strip_mode (html only):
  js,css           Strip scripts and styles
  ui               Strip UI-only elements
  full             Strip everything non-content

wait_until:
  done             Wait for full page load (default)
  networkidle      Wait until network goes quiet — use for XHR-heavy pages
  load / domcontentloaded
```

### `lightpanda_serve`

Starts a CDP WebSocket server that Playwright or Puppeteer can connect to:

```ts
// Playwright
const browser = await chromium.connectOverCDP("ws://127.0.0.1:9222");

// Puppeteer
const browser = await puppeteer.connect({ browserWSEndpoint: "ws://127.0.0.1:9222" });
```

Use `lightpanda_stop` to shut it down, or it is automatically killed when the pi session ends.

### `/lightpanda`

Shows the binary path, version, and CDP server status.

## Choosing a dump_mode

| Mode | Best for |
|------|----------|
| `markdown` | Reading articles, docs, blog posts — default for agents |
| `html` + `strip_mode=js,css` | When you need links and DOM structure preserved |
| `semantic_tree_text` | Understanding page layout and interactive elements |
| `semantic_tree` | Debugging accessibility or complex page structure |

## Limitations

- Lightpanda is fast but not Chrome-compatible for all sites. Complex SPAs (Next.js, React with heavy hydration) may return empty output — fall back to `curl` + `__NEXT_DATA__` JSON parsing in those cases.
- The CDP server (`lightpanda_serve`) supports Playwright and Puppeteer but not all Chrome DevTools features.

## License

MIT
