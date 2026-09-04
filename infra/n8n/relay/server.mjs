import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

async function readBody(request, maxBodyBytes) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("body_too_large");
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function loadSecret() {
  const secretFile = process.env.TC_INTAKE_SECRET_FILE;
  const secret = secretFile ? readFileSync(secretFile, "utf8").trim() : process.env.TC_INTAKE_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("TC intake secret must be at least 32 characters");
  return secret;
}

export function createRelayServer(options = {}) {
  const intakeUrl = options.intakeUrl ?? process.env.TC_APP_INTAKE_URL;
  const secret = options.secret ?? loadSecret();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!intakeUrl) throw new Error("TC_APP_INTAKE_URL is required");

  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method !== "POST" || request.url !== "/intake") {
      sendJson(response, 404, { ok: false, error: "not_found" });
      return;
    }

    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      sendJson(response, 415, { ok: false, error: "json_required" });
      return;
    }

    let rawBody;
    try {
      rawBody = await readBody(request, maxBodyBytes);
      JSON.parse(rawBody);
    } catch (error) {
      sendJson(response, error instanceof Error && error.message === "body_too_large" ? 413 : 400, {
        ok: false,
        error: error instanceof Error && error.message === "body_too_large" ? "body_too_large" : "invalid_json",
      });
      return;
    }

    const timestamp = Math.floor(now() / 1000).toString();
    const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");

    try {
      const upstream = await fetchImpl(intakeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "tile-concept-n8n-intake-relay/1.0",
          "x-tc-signature": `sha256=${signature}`,
          "x-tc-timestamp": timestamp,
        },
        body: rawBody,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const upstreamBody = await upstream.text();
      response.writeHead(upstream.status, {
        "cache-control": "no-store",
        "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      });
      response.end(upstreamBody);
    } catch {
      sendJson(response, 502, { ok: false, error: "intake_unavailable" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createRelayServer();
  server.listen(port, "0.0.0.0", () => {
    process.stdout.write(`intake relay listening on ${port}\n`);
  });
}

