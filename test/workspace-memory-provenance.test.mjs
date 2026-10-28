import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
for (const root of ["../src", "../dist/src"]) {
  test(`${root} workspace classification preserves host provenance and path isolation`, async () => {
    const { classifyWorkspaceMemoryPaths } = jiti(`${root}/workspace-memory-provenance.js`);
    const { createOpenClawMemoryCapability } = jiti(`${root}/openclaw-memory-capability.js`);
    assert.equal(createOpenClawMemoryCapability({}).runtime.classifyWorkspaceMemoryPaths, classifyWorkspaceMemoryPaths);
    const temp = await mkdtemp(join(tmpdir(), "memory-provenance-"));
    try {
      const workspaceDir = join(temp, "workspace");
      const files = ["MEMORY.md", "USER.md", "memory.md", "SOUL.md", "memory/day.md", "memory/dreaming/report.md", "DREAMS.md"];
      for (const file of files) {
        const target = join(workspaceDir, file);
        await mkdir(join(target, ".."), { recursive: true });
        await writeFile(target, "test");
      }
      await writeFile(join(temp, "outside.md"), "outside");
      await symlink(join(temp, "outside.md"), join(workspaceDir, "memory/escape.md"));
      const readPaths = [];
      const classifications = await classifyWorkspaceMemoryPaths({
        workspaceDir, relativePaths: [...files, "missing.md", "../outside.md", "memory/escape.md"],
      }, async (params) => {
        readPaths.push(params.relativePath);
        return params.relativePath === "USER.md" ? { originClass: "untrusted" } : undefined;
      });
      assert.deepEqual(classifications.map(c => c.originClass), [
        "agent", "untrusted", "agent", "untrusted", "agent", "system", "system", "untrusted", "untrusted", "untrusted",
      ]);
      const canonicalPaths = await Promise.all(["MEMORY.md", "USER.md", "memory.md", "memory/day.md"].map(async file =>
        relative(await realpath(workspaceDir), await realpath(join(workspaceDir, file))).replaceAll("\\", "/")));
      assert.deepEqual(readPaths.sort(), canonicalPaths.sort());
      await assert.rejects(classifyWorkspaceMemoryPaths({workspaceDir, relativePaths:["MEMORY.md"]}, async () => {
        throw new Error("provenance unavailable");
      }), /provenance unavailable/);
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
}
