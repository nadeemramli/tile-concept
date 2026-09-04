import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createRelayServer } from "./server.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("signs the exact JSON body and returns the upstream response", async (context) => {
  const secret = "a".repeat(64);
  const nowMs = 1_800_000_000_000;
  const rawBody = JSON.stringify({ submission_id: "lead-1", source: "tiktok", phone: "+60123456789" });

  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const receivedBody = Buffer.concat(chunks).toString("utf8");
    const timestamp = request.headers["x-tc-timestamp"];
    const expected = createHmac("sha256", secret).update(`${timestamp}.${receivedBody}`).digest("hex");

    assert.equal(receivedBody, rawBody);
    assert.equal(timestamp, "1800000000");
    assert.equal(request.headers["x-tc-signature"], `sha256=${expected}`);
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, lead_id: "lead-id" }));
  });
  context.after(() => upstream.close());
  const upstreamUrl = await listen(upstream);

  const relay = createRelayServer({ intakeUrl: upstreamUrl, secret, now: () => nowMs });
  context.after(() => relay.close());
  const relayUrl = await listen(relay);

  const response = await fetch(`${relayUrl}/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody,
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, lead_id: "lead-id" });
});

test("rejects invalid input before contacting the app", async (context) => {
  const relay = createRelayServer({ intakeUrl: "https://example.invalid", secret: "b".repeat(64) });
  context.after(() => relay.close());
  const relayUrl = await listen(relay);

  const invalidType = await fetch(`${relayUrl}/intake`, { method: "POST", body: "{}" });
  assert.equal(invalidType.status, 415);

  const invalidJson = await fetch(`${relayUrl}/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not-json",
  });
  assert.equal(invalidJson.status, 400);

  const health = await fetch(`${relayUrl}/healthz`);
  assert.equal(health.status, 200);
});

