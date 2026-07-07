import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { createRetriever, DEFAULT_RETRIEVAL_CONFIG } = jiti("../src/retriever.ts");

function entry(id, text, metadata, scoreSeed = 0.9) {
  return {
    id,
    text,
    vector: [scoreSeed, 1 - scoreSeed],
    category: "preference",
    scope: "global",
    importance: scoreSeed,
    timestamp: Date.now(),
    metadata: JSON.stringify(metadata),
  };
}

function createHarness(entries) {
  const store = {
    hasFtsSupport: true,
    async vectorSearch() {
      return entries.map((memory, index) => ({
        entry: memory,
        score: 0.95 - index * 0.05,
      }));
    },
    async bm25Search() {
      return entries.map((memory, index) => ({
        entry: memory,
        score: 0.95 - index * 0.05,
      }));
    },
    async hasId(id) {
      return entries.some((memory) => memory.id === id);
    },
  };

  const embedder = {
    async embedQuery() {
      return [1, 0];
    },
  };

  return createRetriever(store, embedder, {
    ...DEFAULT_RETRIEVAL_CONFIG,
    filterNoise: false,
    rerank: "none",
    minScore: 0,
    hardMinScore: 0,
    recencyWeight: 0,
    timeDecayHalfLifeDays: 0,
    lengthNormAnchor: 0,
  });
}

describe("retriever supersession policy", () => {
  it("excludes obsolete preferences from auto-recall recommendation queries", async () => {
    const oldPreference = entry("old-pref", "User prefers B", {
      state: "obsolete_preference",
      superseded_by: "new-pref",
    });
    const newPreference = entry("new-pref", "User now prefers C", {
      state: "confirmed",
      supersedes: ["old-pref"],
    });
    const retriever = createHarness([oldPreference, newPreference]);

    const results = await retriever.retrieve({
      query: "what should I recommend to Wayne?",
      limit: 5,
      scopeFilter: ["global"],
      source: "auto-recall",
    });

    assert.deepEqual(results.map((r) => r.entry.id), ["new-pref"]);
  });

  it("keeps historical memories discoverable for history-intent queries", async () => {
    const oldPreference = entry("old-pref", "User prefers B", {
      state: "obsolete_preference",
      superseded_by: "new-pref",
    });
    const newPreference = entry("new-pref", "User now prefers C", {
      state: "confirmed",
      supersedes: ["old-pref"],
    });
    const retriever = createHarness([oldPreference, newPreference]);

    const results = await retriever.retrieve({
      query: "Wayne 以前偏好什麼?",
      limit: 5,
      scopeFilter: ["global"],
      source: "auto-recall",
    });

    assert.deepEqual(
      new Set(results.map((r) => r.entry.id)),
      new Set(["old-pref", "new-pref"]),
    );
  });

  it("downranks superseded memories in auto-recall", async () => {
    const oldMethod = entry("old-method", "Use old workflow", {
      state: "superseded",
      superseded_by: "new-method",
    });
    const newMethod = entry("new-method", "Use new workflow", {
      state: "confirmed",
      supersedes: ["old-method"],
    }, 0.6);
    const retriever = createHarness([oldMethod, newMethod]);

    const results = await retriever.retrieve({
      query: "current workflow recommendation",
      limit: 5,
      scopeFilter: ["global"],
      source: "auto-recall",
    });

    assert.equal(results[0].entry.id, "new-method");
    assert.ok(
      results.find((r) => r.entry.id === "old-method").score <
        results.find((r) => r.entry.id === "new-method").score,
    );
  });
});
