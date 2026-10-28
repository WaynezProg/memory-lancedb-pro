# Local integration: 2026-10-28

This branch records the deployed source integration, not deployment state.

## Source and retained behavior

- Upstream: `CortexReach/memory-lancedb-pro` commit `c0e2c7a3a8b5780b6133ddfd9e2f426bf0ea1b6c`.
- Local pre-integration source: `709baaa19e52193fa17e656880a7373274fb7f29`; the live source and generated runtime delta is preserved in snapshot commit `909fddc`.
- Merge: `1a4109f`; dedicated regression and CI registration: `3544c35`.
- See [LOCAL_PATCHES.md](../LOCAL_PATCHES.md) for the FIFO write queue, rollback, metadata updates, governance, scope, provenance, legacy ID, instance-path and ingress protections that require review on future upstream updates.
- `foldIndices()` and `runStorageMaintenance()` both acquire the same FIFO write queue and shared write lock as ordinary mutations. Upstream storage compaction, index folding and opt-in retention replace the old absence of maintenance.

## Reproducible regression checks

Run with Node.js and the project's development dependencies:

```sh
node --test test/local-write-lock-queue.test.mjs test/storage-maintenance.test.mjs test/fts-index-fold.test.mjs test/update-consistency-lancedb.test.mjs
node scripts/verify-ci-test-manifest.mjs
node scripts/verify-package-runtime.mjs
```

The publication-copy rerun passed 21/21 tests across the four files above, including the two dedicated queue regressions. CI manifest verification covered 154 entries exactly once, and compiled package runtime verification passed.

The dedicated real-LanceDB regression has two cases: concurrent store/update/delete plus both optimize paths; and competing updates with injected write failure and rollback, repeated three times. It is included in `npm test` and the CI manifest.

The integration was also checked against the broader local governance, scope, provenance and lifecycle regressions, TypeScript, package runtime verification, and an isolated two-plugin OpenClaw 2026.10.8 gateway. Those checks do not establish long-term latency or retrieval quality. One exact-text sample was excluded by the existing rerank window / hard score cutoff; no threshold tuning is included here.

No credentials, databases, stored memories, runtime configuration, private diagnostic output or backups belong in this branch. Test fixtures are synthetic.
