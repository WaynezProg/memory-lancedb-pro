import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { MemoryStore } = jiti("../src/store.ts");
const entry = (text) => ({ text, vector: [0.1, 0.2, 0.3], category: "fact", scope: "global", importance: 0.5, metadata: "{}" });
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("local write lock queue serializes real mixed writes and both optimize paths", { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "local-lock-mixed-"));
  const store = new MemoryStore({ dbPath: dir, vectorDim: 3 });
  const gate = deferred();
  try {
    const a = await store.store(entry("initial-a"));
    const b = await store.store(entry("initial-b"));
    const table = store.table;
    const entered = deferred();
    const events = [];
    const original = Object.fromEntries(["add", "delete", "optimize"].map((name) => [name, table[name].bind(table)]));
    let blockFirstDelete = true;
    for (const name of ["add", "delete", "optimize"]) {
      table[name] = async (...args) => {
        events.push(`${name}:start`);
        if (name === "delete" && blockFirstDelete) {
          blockFirstDelete = false;
          entered.resolve();
          await gate.promise;
        }
        try { return await original[name](...args); }
        finally { events.push(`${name}:end`); }
      };
    }
    const update = store.update(a.id, { text: "updated-a" }, ["global"]);
    await entered.promise;
    const storeNew = store.store(entry("new-row"));
    const remove = store.delete(b.id, ["global"]);
    const maintenance = store.runStorageMaintenance(7);
    const fold = store.foldIndices("queue-test");
    await pause(80);
    assert.deepEqual(events, ["delete:start"], "all other mutations and optimize wait behind the held update");
    gate.resolve();
    const [updated, created, deleted, report] = await Promise.all([update, storeNew, remove, maintenance, fold]);
    assert.equal(updated.text, "updated-a");
    assert.equal(deleted, true);
    assert.equal(report.retentionDays, 7);
    assert.equal((await store.getById(created.id)).text, "new-row");
    assert.equal(await store.getById(b.id), null);
    assert.equal(events.filter((e) => e === "optimize:start").length, 2);
    let active = 0;
    for (const event of events) {
      active += event.endsWith(":start") ? 1 : -1;
      assert.ok(active >= 0 && active <= 1, `overlapping mutation: ${events.join(", ")}`);
    }
    assert.equal(active, 0);
  } finally { gate.resolve(); await store.close?.(); rmSync(dir, { recursive: true, force: true }); }
});

test("local write lock queue preserves call order and rollback after competing updates", { timeout: 30000 }, async () => {
  for (let iteration = 0; iteration < 3; iteration++) {
    const dir = mkdtempSync(join(tmpdir(), "local-lock-rollback-"));
    const store = new MemoryStore({ dbPath: dir, vectorDim: 3 });
    const gate = deferred();
    try {
      const row = await store.store(entry("original"));
      const table = store.table;
      const originalDelete = table.delete.bind(table);
      const originalAdd = table.add.bind(table);
      const secondEntered = deferred();
      let deletes = 0; let adds = 0;
      table.delete = async (...args) => {
        deletes++;
        if (deletes === 2) { secondEntered.resolve(); await gate.promise; }
        return originalDelete(...args);
      };
      table.add = async (...args) => {
        adds++;
        if (adds === 2) throw new Error("injected second write failure");
        return originalAdd(...args);
      };
      const first = store.update(row.id, { text: "first" }, ["global"]);
      const second = store.update(row.id, { text: "second" }, ["global"]);
      await secondEntered.promise;
      assert.equal((await first).text, "first");
      gate.resolve();
      await assert.rejects(second, /latest available record restored/);
      assert.equal((await store.getById(row.id)).text, "first");
    } finally { gate.resolve(); await store.close?.(); rmSync(dir, { recursive: true, force: true }); }
  }
});
