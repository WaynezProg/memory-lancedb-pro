import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { MemoryStore: SrcMemoryStore } = jiti("../src/store.ts");
const { MemoryStore: DistMemoryStore } = await import("../dist/src/store.js");

// Full 64-char hex ids (legacy markdown / #decision imports) match prefixRegex,
// so delete()/update() used to treat them as prefixes and only scan the first
// 1000 rows in storage order.
const HEX_ID = "9ebbf013c697ac19e17bb659b202a8bccedb2428335ece2d55cd482a341698dd";
const HEX_ID_2 = "9ebbf013" + "0".repeat(56);
const SCOPE = "agent:test";
const FILLER_ROWS = 1005;

for (const [label, MemoryStore] of [["src", SrcMemoryStore], ["dist", DistMemoryStore]]) {
  describe(`MemoryStore full hex id lookup beyond 1000 rows (${label})`, () => {
    let workDir;
    let store;

    before(async () => {
      workDir = mkdtempSync(path.join(tmpdir(), "memory-lancedb-hexid-"));
      store = new MemoryStore({ dbPath: path.join(workDir, "db"), vectorDim: 4 });
      await store.bulkStore(
        Array.from({ length: FILLER_ROWS }, (_, i) => ({
          text: `filler memory ${i}`,
          vector: [0, 0, 0, 1],
          category: "fact",
          scope: "global",
          importance: 0.5,
          metadata: "{}",
        })),
      );
      for (const id of [HEX_ID, HEX_ID_2]) {
        await store.importEntry({
          id,
          text: `legacy decision ${id.slice(-4)}`,
          vector: [1, 0, 0, 0],
          category: "decision",
          scope: SCOPE,
          importance: 0.7,
          timestamp: Date.now(),
          metadata: "{}",
        });
      }
      assert.equal(await store.count(), FILLER_ROWS + 2);
    });

    after(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    it("update() resolves a full 64-char hex id stored after the first 1000 rows", async () => {
      const updated = await store.update(HEX_ID, { importance: 0.9 }, [SCOPE]);
      assert.ok(updated, "expected update to find the row");
      assert.equal(updated.id, HEX_ID);
      assert.equal(updated.importance, 0.9);
      assert.equal((await store.getById(HEX_ID)).importance, 0.9);
    });

    it("update() still enforces scope for an exact hex id", async () => {
      await assert.rejects(
        store.update(HEX_ID, { importance: 0.1 }, ["agent:other"]),
        /outside accessible scopes/,
      );
    });

    it("ambiguous short prefixes still throw", async () => {
      await assert.rejects(store.update("9ebbf013", { importance: 0.2 }), /Ambiguous prefix/);
      await assert.rejects(store.delete("9ebbf013"), /Ambiguous prefix/);
    });

    it("a unique prefix beyond the first 1000 rows resolves", async () => {
      const updated = await store.update("9ebbf013c697", { importance: 0.8 }, [SCOPE]);
      assert.equal(updated?.id, HEX_ID);
      assert.equal(updated?.importance, 0.8);
    });

    it("delete() removes only the exact hex id", async () => {
      assert.equal(await store.delete(HEX_ID, [SCOPE]), true);
      assert.equal(await store.hasId(HEX_ID), false);
      assert.equal(await store.hasId(HEX_ID_2), true);
      assert.equal(await store.count(), FILLER_ROWS + 1);
    });

    it("delete() returns false for an unknown hex id", async () => {
      assert.equal(await store.delete("f".repeat(64), [SCOPE]), false);
    });
  });
}
