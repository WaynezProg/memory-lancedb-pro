import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

type OriginClass = "owner" | "agent" | "system" | "untrusted";
type ProvenanceReader = (params: { workspaceDir: string; relativePath: string }) =>
  Promise<{ originClass: OriginClass } | undefined>;

// Use the host's provenance store, including taint recorded by file-write tools.
// Do not classify every existing workspace file as trusted.
const readHostProvenance: ProvenanceReader = async (params) => {
  const { readMemoryArtifactProvenance } = await import("openclaw/plugin-sdk/memory-core-host-runtime-core");
  return readMemoryArtifactProvenance(params);
};

export async function classifyWorkspaceMemoryPaths(
  params: { workspaceDir: string; relativePaths: string[] },
  readProvenance: ProvenanceReader = readHostProvenance,
) {
  return Promise.all(params.relativePaths.map(async (relativePath) => {
    const result = (originClass: OriginClass) => ({ relativePath, originClass });
    let workspace: string;
    let file: string;
    try {
      [workspace, file] = await Promise.all([
        realpath(params.workspaceDir), realpath(resolve(params.workspaceDir, relativePath)),
      ]);
    } catch {
      return result("untrusted");
    }
    const rel = relative(workspace, file);
    if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return result("untrusted");
    const segments = rel.split(sep);
    if ((segments.length === 1 && ["DREAMS.md", "dreams.md"].includes(segments[0])) ||
        (segments[0] === "memory" && ["dreaming", ".dreams"].includes(segments[1]))) return result("system");
    const curated = segments.length === 1 && ["MEMORY.md", "memory.md", "USER.md"].includes(segments[0]);
    if (!curated && !(segments[0] === "memory" && segments.at(-1)?.endsWith(".md"))) return result("untrusted");
    const recorded = await readProvenance({ workspaceDir: params.workspaceDir, relativePath: segments.join("/") });
    // Same legacy-file default as OpenClaw 2026.9.3 memory-core.
    return result(recorded?.originClass ?? "agent");
  }));
}
