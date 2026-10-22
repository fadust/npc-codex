# Saga Layer 1 canon adapter

Unreleased change on `codex/layer1-canon-adapter`; application and persisted schema versions remain unchanged.

When `Saga.bridge.canonStatus().enabled` is true, `runCastPass` obtains applicable evidence before constructing the existing cast request. Raw card/lorebook canon candidates are replaced by Saga's filtered, revisioned passages. `saga-canon.js` resolves new identity admission and reuses existing dossiers; ambiguity/unavailability defers the affected new identity. A completed no-match allows ordinary creation. Evidence-only relatives do not create dossiers.

The existing cast response supplies seed fields. Canon seeding validates copied wording against the supplied version-compatible passages, fills empty supported fields and preserves manual locks, accepted development and terminal death. No additional extraction request, event writer, database or vector backend is added. Scanner routing, persistence, stale-operation guards, relationships and knowledge ownership remain with existing NPC modules. Disabling Saga Layer 1 restores the original canon path.

The shared synthetic integration fixture and production adapter tests live in the companion Saga fork at `tests/fixtures/layer1-ari.json` and `tools/scripts/test-layer1-integration.mjs`; check out the forks in sibling `Saga` and `npc_codex` directories to run them. They cover ambiguity, unavailable evidence, dossier reuse, strict grounding, manual locks, development, terminal death and no relative fan-out. The full NPC suite (1,123 tests plus compatibility/runtime smoke), validation, prompt measurements and package checks pass. Existing prompt baselines remain unchanged; canon content varies with the selected evidence. No live NPC provider scan was performed during the synthetic source-analysis pilot.

Saga implementation and operating notes: [fadust/Saga, Layer 1 branch](https://github.com/fadust/Saga/tree/codex/layer1-integration). Direct World Engine integration and CarrotKernel actor-prompt ownership remain deferred to Layer 3.
