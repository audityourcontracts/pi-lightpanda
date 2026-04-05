/**
 * Lightpanda Browser Extension for pi
 *
 * Exposes the Lightpanda headless browser (v0.2.7, aarch64-macos) as pi tools.
 * Lightpanda is a Zig-built headless browser with JS execution — 9x faster than
 * Chrome, 16x less memory. Useful for scraping, AI agent browsing, JS-rendered pages.
 *
 * Tools registered:
 *   lightpanda_fetch  — Fetch a URL, execute JS, dump HTML/Markdown/semantic tree
 *   lightpanda_serve  — Start a CDP server (Playwright/Puppeteer compatible)
 *   lightpanda_stop   — Stop the running CDP server
 *
 * Commands:
 *   /lightpanda       — Show server status
 *
 * Binary: ~/.local/bin/lightpanda (v0.2.7)
 *
 * Usage: place this directory in ~/.pi/agent/extensions/ and reload with /reload
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawnSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Constants ────────────────────────────────────────────────────────────────

const BINARY = join(homedir(), ".local", "bin", "lightpanda");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9222;

// ─── Server state ─────────────────────────────────────────────────────────────

interface ServerState {
  proc: ChildProcess;
  host: string;
  port: number;
  startedAt: Date;
}

let server: ServerState | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function checkBinary(): string | null {
  if (!existsSync(BINARY)) {
    return `Lightpanda binary not found at ${BINARY}. Install with:\n  curl -fsSL -L https://github.com/lightpanda-io/browser/releases/download/0.2.7/lightpanda-aarch64-macos -o ${BINARY} && chmod +x ${BINARY}`;
  }
  return null;
}

function serverStatusLine(): string {
  if (!server) return "CDP: stopped";
  const elapsed = Math.round((Date.now() - server.startedAt.getTime()) / 1000);
  return `CDP: ws://${server.host}:${server.port} (${elapsed}s)`;
}

function killServer() {
  if (server) {
    try { server.proc.kill("SIGTERM"); } catch {}
    server = null;
  }
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function lightpandaExtension(pi: ExtensionAPI) {

  // ── Tool: lightpanda_fetch ──────────────────────────────────────────────────

  pi.registerTool({
    name: "lightpanda_fetch",
    label: "Lightpanda Fetch",
    description: [
      "Fetch a URL using Lightpanda — a headless browser with full JavaScript execution.",
      "Unlike plain curl, this renders the page (runs JS, XHR, fetch) before returning content.",
      "Use this when a page requires JavaScript to load its content.",
      "Returns HTML, Markdown, or a semantic accessibility tree depending on dump_mode.",
    ].join(" "),
    promptSnippet: "Fetch and render a JS-heavy URL with lightpanda_fetch",
    promptGuidelines: [
      "Use lightpanda_fetch instead of curl when a page needs JavaScript to render.",
      "Use dump_mode='markdown' for clean text extraction (default, best for LLM consumption).",
      "Use dump_mode='semantic_tree_text' to understand page structure and interactive elements.",
      "Use dump_mode='html' when you need the raw post-JS DOM.",
      "Set strip_mode to 'js,css' to strip scripts/styles from HTML dumps.",
      "Use wait_until='networkidle' for pages with async data loading (XHR/fetch driven).",
    ],
    parameters: Type.Object({
      url: Type.String({
        description: "URL to fetch and render",
      }),
      dump_mode: Type.Optional(
        Type.Union(
          [
            Type.Literal("html"),
            Type.Literal("markdown"),
            Type.Literal("semantic_tree"),
            Type.Literal("semantic_tree_text"),
          ],
          { description: "Output format. Default: markdown" }
        )
      ),
      strip_mode: Type.Optional(
        Type.String({
          description:
            "Comma-separated tag groups to strip from HTML dumps: js, css, ui, full. E.g. 'js,css'. Only applies to dump_mode=html.",
        })
      ),
      wait_until: Type.Optional(
        Type.Union(
          [
            Type.Literal("load"),
            Type.Literal("domcontentloaded"),
            Type.Literal("networkidle"),
            Type.Literal("done"),
          ],
          { description: "Wait condition. Default: done. Use networkidle for AJAX-heavy pages." }
        )
      ),
      wait_ms: Type.Optional(
        Type.Number({
          description: "Additional wait time in ms after page load. Default: 0 (lightpanda default is 5000).",
          minimum: 0,
          maximum: 30000,
        })
      ),
      obey_robots: Type.Optional(
        Type.Boolean({
          description: "Whether to respect robots.txt. Default: false.",
        })
      ),
      http_timeout: Type.Optional(
        Type.Number({
          description: "HTTP timeout in milliseconds. Default: 10000.",
          minimum: 1000,
          maximum: 60000,
        })
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate) {
      const err = checkBinary();
      if (err) return { content: [{ type: "text", text: err }], details: { error: true }, isError: true };

      const args: string[] = ["fetch"];
      args.push("--dump", params.dump_mode ?? "markdown");
      args.push("--log-level", "warn");
      args.push("--log-format", "logfmt");

      if (params.strip_mode) args.push("--strip-mode", params.strip_mode);
      if (params.wait_until) args.push("--wait-until", params.wait_until);
      if (params.wait_ms !== undefined) args.push("--wait-ms", String(params.wait_ms));
      if (params.obey_robots) args.push("--obey-robots");
      if (params.http_timeout !== undefined) args.push("--http-timeout", String(params.http_timeout));

      args.push(params.url);

      onUpdate?.(`Fetching ${params.url} (mode: ${params.dump_mode ?? "markdown"})…`);

      const result = spawnSync(BINARY, args, {
        encoding: "utf8",
        timeout: (params.http_timeout ?? 10000) + 8000, // give some extra headroom
        env: { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: "true" },
        // abort signal not directly supported by spawnSync, but timeout handles it
      });

      if (result.error) {
        return {
          content: [{ type: "text", text: `Lightpanda error: ${result.error.message}` }],
          details: { error: result.error.message },
          isError: true,
        };
      }

      const output = (result.stdout ?? "").trim();
      const stderr = (result.stderr ?? "").trim();

      if (result.status !== 0 && !output) {
        return {
          content: [{ type: "text", text: `Lightpanda exited with code ${result.status}.\nStderr: ${stderr}` }],
          details: { exitCode: result.status, stderr },
          isError: true,
        };
      }

      if (!output) {
        return {
          content: [{ type: "text", text: [
            `Lightpanda returned no content for: ${params.url}`,
            "",
            "The site likely uses bot protection or rendering Lightpanda can't handle. Alternatives:",
            "  • wayback_search — check the Wayback Machine for an archived snapshot",
            "  • curl — try a plain HTTP fetch (works if the page doesn't require JS)",
            "  • Playwright with Chromium — full Chrome rendering, handles most bot-protected sites",
            stderr ? `\nStderr: ${stderr}` : "",
          ].join("\n").trim() }],
          details: { url: params.url, empty: true, stderr: stderr || undefined },
        };
      }

      const truncated = output.length > 100_000;
      const text = truncated ? output.slice(0, 100_000) + "\n\n[OUTPUT TRUNCATED — use a narrower dump_mode or strip_mode]" : output;

      return {
        content: [{ type: "text", text }],
        details: {
          url: params.url,
          dump_mode: params.dump_mode ?? "markdown",
          bytes: output.length,
          truncated,
          stderr: stderr || undefined,
        },
      };
    },
  });

  // ── Tool: lightpanda_serve ──────────────────────────────────────────────────

  pi.registerTool({
    name: "lightpanda_serve",
    label: "Lightpanda Serve",
    description: [
      "Start the Lightpanda CDP (Chrome DevTools Protocol) server.",
      "This allows Playwright, Puppeteer, or chromedp to connect to Lightpanda instead of Chrome.",
      "The server runs in the background until stopped with lightpanda_stop or session end.",
      "Returns the WebSocket endpoint to use in your automation script.",
    ].join(" "),
    promptGuidelines: [
      "Start with lightpanda_serve before running any Playwright/Puppeteer scripts against Lightpanda.",
      "Use the returned browserWSEndpoint in puppeteer.connect() or playwright.connect().",
      "Only one server can run at a time — call lightpanda_stop first if you need to restart.",
    ],
    parameters: Type.Object({
      host: Type.Optional(
        Type.String({ description: `Host to bind. Default: ${DEFAULT_HOST}` })
      ),
      port: Type.Optional(
        Type.Number({ description: `Port to listen on. Default: ${DEFAULT_PORT}`, minimum: 1024, maximum: 65535 })
      ),
      timeout: Type.Optional(
        Type.Number({ description: "Inactivity timeout in seconds before disconnecting idle clients. Default: 30.", minimum: 1 })
      ),
      obey_robots: Type.Optional(
        Type.Boolean({ description: "Whether to respect robots.txt. Default: false." })
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate) {
      const err = checkBinary();
      if (err) return { content: [{ type: "text", text: err }], details: { error: true }, isError: true };

      if (server) {
        const ws = `ws://${server.host}:${server.port}`;
        return {
          content: [{ type: "text", text: `CDP server already running at ${ws}\nUse lightpanda_stop first to restart it.` }],
          details: { wsEndpoint: ws, alreadyRunning: true },
        };
      }

      const host = params.host ?? DEFAULT_HOST;
      const port = params.port ?? DEFAULT_PORT;

      const args: string[] = [
        "serve",
        "--host", host,
        "--port", String(port),
        "--timeout", String(params.timeout ?? 30),
        "--log-level", "warn",
        "--log-format", "logfmt",
      ];
      if (params.obey_robots) args.push("--obey-robots");

      onUpdate?.(`Starting Lightpanda CDP server on ${host}:${port}…`);

      const proc = spawn(BINARY, args, {
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: "true" },
      });

      // Wait briefly to detect immediate crash
      await new Promise<void>((resolve) => setTimeout(resolve, 600));

      if (proc.exitCode !== null) {
        let stderr = "";
        proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
        return {
          content: [{ type: "text", text: `Lightpanda CDP server failed to start (exit ${proc.exitCode}).\n${stderr}` }],
          details: { exitCode: proc.exitCode },
          isError: true,
        };
      }

      server = { proc, host, port, startedAt: new Date() };

      proc.on("exit", (code) => {
        if (server?.proc === proc) {
          server = null;
          // status line will update on next render
        }
      });

      const wsEndpoint = `ws://${host}:${port}`;

      return {
        content: [
          {
            type: "text",
            text: [
              `✓ Lightpanda CDP server running at ${wsEndpoint}`,
              ``,
              `Connect with Puppeteer:`,
              `  const browser = await puppeteer.connect({ browserWSEndpoint: "${wsEndpoint}" });`,
              ``,
              `Connect with Playwright:`,
              `  const browser = await chromium.connectOverCDP("${wsEndpoint}");`,
              ``,
              `Stop with: lightpanda_stop`,
            ].join("\n"),
          },
        ],
        details: { wsEndpoint, host, port, pid: proc.pid },
      };
    },
  });

  // ── Tool: lightpanda_stop ───────────────────────────────────────────────────

  pi.registerTool({
    name: "lightpanda_stop",
    label: "Lightpanda Stop",
    description: "Stop the running Lightpanda CDP server.",
    parameters: { type: "object" } as ReturnType<typeof Type.Object>,
    async execute() {
      if (!server) {
        return {
          content: [{ type: "text", text: "No Lightpanda CDP server is running." }],
          details: { wasStopped: false },
        };
      }

      const { host, port } = server;
      killServer();

      return {
        content: [{ type: "text", text: `✓ Lightpanda CDP server on ${host}:${port} stopped.` }],
        details: { wasStopped: true },
      };
    },
  });

  // ── Command: /lightpanda ────────────────────────────────────────────────────

  pi.registerCommand("lightpanda", {
    description: "Show Lightpanda browser status",
    handler: async (_args, ctx) => {
      const binaryOk = existsSync(BINARY);
      const lines: string[] = [
        `Lightpanda Extension`,
        `──────────────────────────────────────`,
        `Binary : ${BINARY}  ${binaryOk ? "✓" : "✗ NOT FOUND"}`,
      ];

      if (binaryOk) {
        const v = spawnSync(BINARY, ["version"], {
          encoding: "utf8",
          env: { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: "true" },
        });
        lines.push(`Version: ${v.stdout.trim() || "unknown"}`);
      }

      if (server) {
        const elapsed = Math.round((Date.now() - server.startedAt.getTime()) / 1000);
        lines.push(`CDP    : ✓ running at ws://${server.host}:${server.port}  (PID ${server.proc.pid}, ${elapsed}s uptime)`);
      } else {
        lines.push(`CDP    : stopped  (use lightpanda_serve to start)`);
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── Footer status ───────────────────────────────────────────────────────────

  // Update footer every 5 seconds while server is running
  let footerInterval: ReturnType<typeof setInterval> | null = null;

  function updateFooter(ctx: Parameters<Parameters<typeof pi.on>[1]>[1]) {
    if (server) {
      ctx.ui.setStatus("lightpanda", serverStatusLine());
    } else {
      ctx.ui.setStatus("lightpanda", "");
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Lightpanda extension loaded. Tools: lightpanda_fetch, lightpanda_serve, lightpanda_stop", "info");

    // Refresh footer status periodically while a server might be running
    footerInterval = setInterval(() => {
      ctx.ui.setStatus("lightpanda", server ? serverStatusLine() : "");
    }, 5000);
  });

  pi.on("agent_end", async (_event, ctx) => {
    updateFooter(ctx);
  });

  // ── Cleanup on exit ─────────────────────────────────────────────────────────

  pi.on("session_shutdown", async () => {
    if (footerInterval) clearInterval(footerInterval);
    if (server) {
      killServer();
    }
  });
}
