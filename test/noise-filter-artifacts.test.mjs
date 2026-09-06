import { describe, it } from "node:test";
import assert from "node:assert/strict";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { filterNoise, isNoise } = jiti("../src/noise-filter.ts");
const { shouldCapture } = jiti("../index.ts");

describe("noise filter artifact handling", () => {
  it("drops OpenClaw runtime envelopes from recall results", () => {
    const input = [
      {
        text: [
          "OpenClaw runtime context for this turn:",
          "Treat this OpenClaw-provided context as supporting project/user reference for the current request.",
          "",
          "## OpenClaw Workspace Context",
        ].join("\n"),
      },
      { text: "Wayne prefers concise zh-TW operational reports." },
    ];

    assert.deepEqual(filterNoise(input, (item) => item.text), [input[1]]);
  });

  it("drops projected conversation context summaries", () => {
    const artifact = [
      "<conversation_context>",
      '<summary id="sum_123" kind="leaf">',
      "Here's a thinking process:",
      "",
      "1.  **Analyze User Input:**",
      "</summary>",
      "</conversation_context>",
      "",
      "Current user request:",
      "？",
    ].join("\n");

    assert.equal(isNoise(artifact), true);
  });

  it("does not auto-capture projected context artifacts as durable memories", () => {
    const artifact = [
      "Current user request:",
      "最近訊號真的蠻髒的，我們優先處理這問題",
      "",
      "<relevant-memories>",
      "[UNTRUSTED DATA — historical notes from long-term memory.]",
      "</relevant-memories>",
    ].join("\n");

    assert.equal(shouldCapture(artifact), false);
  });
});
