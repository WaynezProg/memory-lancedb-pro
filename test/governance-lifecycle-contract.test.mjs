import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const {
  buildSmartMetadata,
  isMemoryVisibleInMode,
  parseSmartMetadata,
} = jiti("../src/smart-metadata.ts");

const NOW = 1_800_000_000_000;

function entry(metadata) {
  return {
    text: "memory text",
    category: "fact",
    importance: 0.7,
    timestamp: NOW - 10_000,
    metadata: JSON.stringify(metadata),
  };
}

describe("memory lifecycle contract", () => {
  it("round-trips governance states and relationship arrays", () => {
    for (const state of [
      "confirmed",
      "superseded",
      "obsolete_preference",
      "conflicting",
      "archived",
    ]) {
      const source = entry({
        state,
        supersedes: ["old-a", "old-b", "old-a"],
        superseded_by: "new-c",
        canonical_key: "workflow:session-cleanup",
        supersession_reason: "method_migration",
      });

      const parsed = parseSmartMetadata(source.metadata, source);
      const rebuilt = buildSmartMetadata(source, {});

      assert.equal(parsed.state, state);
      assert.deepEqual(parsed.supersedes, ["old-a", "old-b"]);
      assert.equal(parsed.superseded_by, "new-c");
      assert.equal(parsed.canonical_key, "workflow:session-cleanup");
      assert.equal(parsed.supersession_reason, "method_migration");
      assert.deepEqual(rebuilt.supersedes, ["old-a", "old-b"]);
    }
  });

  it("normalizes a legacy supersedes string to an array", () => {
    const source = entry({ supersedes: "old-a" });
    assert.deepEqual(
      parseSmartMetadata(source.metadata, source).supersedes,
      ["old-a"],
    );
  });

  it("keeps active, history, and review visibility disjoint", () => {
    const meta = (state, extra = {}) =>
      parseSmartMetadata(entry({ state, ...extra }).metadata, entry({ state, ...extra }));

    assert.equal(isMemoryVisibleInMode(meta("confirmed"), "active", NOW), true);
    assert.equal(isMemoryVisibleInMode(meta("superseded"), "active", NOW), false);
    assert.equal(isMemoryVisibleInMode(meta("archived"), "history", NOW), true);
    assert.equal(isMemoryVisibleInMode(meta("obsolete_preference"), "history", NOW), true);
    assert.equal(isMemoryVisibleInMode(meta("conflicting"), "history", NOW), false);
    assert.equal(isMemoryVisibleInMode(meta("conflicting"), "review", NOW), true);
    assert.equal(isMemoryVisibleInMode(meta("pending"), "review", NOW), true);
    assert.equal(
      isMemoryVisibleInMode(meta("confirmed", { valid_until: NOW - 1 }), "active", NOW),
      false,
    );
  });
});
