import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { Embedder } = jiti("../src/embedder.ts");

/**
 * Test: Ollama native fetch correctly aborts a slow HTTP request.
 *
 * Root cause (Issue #361 / PR #383):
 * OpenAI SDK's HTTP client does not reliably abort Ollama TCP connections
 * when AbortController.abort() fires in Node.js, causing stalled sockets
 * that hang until the gateway-level timeout.
 *
 * Fix: For Ollama endpoints (localhost:11434), use Node.js native fetch
 * instead of the OpenAI SDK. Native fetch properly closes TCP on abort.
 *
 * This test verifies the fix by:
 * 1. Mocking a slow Ollama-shaped server on a random local port (5s delay)
 * 2. Calling embedPassage with an AbortSignal that fires after 2s
 * 3. Asserting total time ≈ 2s (not 5s) — proving abort interrupted the request
 *
 * The base URL includes /ollama so isOllamaProvider() returns true without
 * conflicting with a real local Ollama service on 127.0.0.1:11434.
 */
test("Ollama embedWithNativeFetch aborts slow request within expected time", async () => {
  const SLOW_DELAY_MS = 5_000;
  const ABORT_AFTER_MS = 2_000;
  const DIMS = 1024;

  const server = http.createServer((req, res) => {
    if (req.url === "/ollama/api/embeddings" && req.method === "POST") {
      const timer = setTimeout(() => {
        if (res.writableEnded) return; // already aborted
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          data: [{ embedding: Array.from({ length: DIMS }, () => 0.1), index: 0 }]
        }));
      }, SLOW_DELAY_MS);
      req.on("aborted", () => clearTimeout(timer));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  assert.ok(port, "mock Ollama server should expose a random port");

  try {
    const embedder = new Embedder({
      provider: "openai-compatible",
      apiKey: "test-key",
      model: "mxbai-embed-large",
      baseURL: `http://127.0.0.1:${port}/ollama/v1`,
      dimensions: DIMS,
    });

    assert.ok(
      embedder.isOllamaProvider(),
      "isOllamaProvider() should return true for /ollama baseURL",
    );

    const start = Date.now();
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), ABORT_AFTER_MS);

    let errorCaught;
    try {
      await embedder.embedPassage("abort test probe", controller.signal);
      assert.fail("embedPassage should have thrown");
    } catch (e) {
      errorCaught = e;
    }

    clearTimeout(abortTimer);
    const elapsed = Date.now() - start;

    assert.ok(errorCaught, "embedPassage should have thrown (abort or timeout)");
    const msg = errorCaught instanceof Error ? errorCaught.message : String(errorCaught);
    assert.ok(
      /timed out|abort|ollama/i.test(msg),
      `Expected abort/timeout/Ollama error, got: ${msg}`,
    );

    // Elapsed time must be close to ABORT_AFTER_MS, NOT SLOW_DELAY_MS.
    // If abort worked: elapsed ≈ 2000ms.
    // If abort failed: elapsed ≈ 5000ms (waited for slow response).
    assert.ok(
      elapsed < SLOW_DELAY_MS * 0.75,
      `Expected abort ~${ABORT_AFTER_MS}ms, got ${elapsed}ms — abort did NOT interrupt slow request`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
