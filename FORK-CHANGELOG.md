# NPC Codex fork changelog and upstream adoption

This file tracks our maintained fork's changes and its relationship to [NPC State Delta](https://github.com/kohz87/npc_state_delta). It does not replace the inherited [CHANGELOG.md](CHANGELOG.md) or claim that every upstream release has been merged.

## Current fork version — 2.0.2

Version bumped on 18 October 2026 to package the integration and fixes below. 2.0.2 adds unique nickname recall; persisted formats are unchanged. No GitHub release or tag is implied.

## Comparison checkpoint — 18 October 2026

- Fork runtime reviewed: [`2e83180`](https://github.com/fadust/npc-codex/commit/2e8318067d8d4021b9d100df1df503ddb14eca30), merged into `main` as [`4ceb1f3`](https://github.com/fadust/npc-codex/commit/4ceb1f32303743c39a485de83c98af206567e03d) through [PR #2](https://github.com/fadust/npc-codex/pull/2). Both commits have identical file contents.
- Upstream reviewed: [`e5ef4b6`, v1.2.8](https://github.com/kohz87/npc_state_delta/commit/e5ef4b6), including the October 17 changes and October 18 display updates. The earlier adaptation was pinned through upstream `136d55e`, v1.2.6.
- At this checkpoint Git reported **42 ahead / 31 behind**. This counts commit ancestry, including merge and release commits; it is not a count of missing features. Adapted code retains different commit identities. Later documentation commits will change the count.
- At this comparison checkpoint NPC Codex was application version **2.0.0**. Our version sequence is independent of upstream's; the changes below are now recorded under 2.0.1.

## Our changes

### 2.0.2 — 18 October 2026

- Adopt unique nickname recall with shared-alias, role-label and overlapping-name guards. Keep custom-field fact validation canonical-name-only. Recall does not admit actors, change presence or override death. Only upstream adoption item 1 is enabled; items 2–4 remain deferred.

### 2.0.1 — 18 October 2026

| Commit | Change and purpose |
|---|---|
| [`04a05dc`](https://github.com/fadust/npc-codex/commit/04a05dc) | Saga canon resolution before actor admission and supported detail seeding; unresolved identities defer instead of becoming invented dossiers. |
| [`d957114`](https://github.com/fadust/npc-codex/commit/d957114) | Selected upstream Priority 1/2 behavior, fixes 1–3 below, explicit Saga/BaiBai/Codex ownership, and manually approved BunnyMo portrayal references. |
| [`bb6aab1`](https://github.com/fadust/npc-codex/commit/bb6aab1) | Shorter actor instructions and removal of redundant portrayal clauses, retaining custom criteria, knowledge restrictions, approval checks and the shared actor budget. |
| [`ff8f5c0`](https://github.com/fadust/npc-codex/commit/ff8f5c0) | Include the main card character as an actor unless explicitly designated narrator-only. |
| [`286cb78`](https://github.com/fadust/npc-codex/commit/286cb78) | Keep distinct canon identities separate across cast admission, continuity and death updates; retry supported personality/speech gaps; allow same-message formatter settlement while retaining chat, message and parent guards. |
| [`33f517a`](https://github.com/fadust/npc-codex/commit/33f517a) | Exclude Floris planning logs from scanner evidence; ambiguous name-keyed knowledge cannot select an arbitrary actor. |
| [`2e83180`](https://github.com/fadust/npc-codex/commit/2e83180) | Preserve supported family bonds without creating dossiers for relatives who are only mentioned. |

### 2.0.0 — 17 October 2026

The fork introduced knowledge gating, canon-first cast resolution and seeding, witnessed memories and intentions, NPC-to-NPC stances, narrative stat/status support, world schemas, and the Codex panel. The inherited baseline records NPC State Delta through 1.1.5. See [the existing changelog](CHANGELOG.md) for that history. Existing storage names remain compatible; the application version does not authorize a database migration.

## Upstream adoption matrix

**Adapted** means the behavior exists in our architecture, not that the upstream commit was merged verbatim. **Partial** identifies an actual difference. **Not adopted** means it is absent from this rollout, not necessarily rejected forever.

| Upstream change | Our status | Evidence and differences |
|---|---|---|
| **1.1.6: deceased-reference lines** | Adapted | `referenceBlock` in [core-mechanics.js](core-mechanics.js) supplies compact confirmed-dead references, never live actors. It shares a four-reference ceiling with living mentions, with at most three deceased lines. [Actor tests](tests/actor-stack.test.js) cover reference-only death behavior. |
| **1.1.6: custom fields** | Adapted and hardened | Up to six configured fields; normalization, explicit actor/field/value grounding, keep-by-default updates and manual locks. Settings/editor/scanner wiring is in [index.js](index.js), [core.js](core.js) and [core-mechanics.js](core-mechanics.js). Fix 1 below strengthens evidence handling. These fields do not add combat or progression rules. |
| **1.1.7: mentioned off-screen/archived NPC recall** | Adapted | Compact established-fact lines and `referencedNpcs` diagnostics are present. Mention alone does not put an actor on-screen. See `referenceBlock` and `injectionPreview`. |
| **1.1.7: distinctive name-part matching** | Adapted in 2.0.2 | `npcNamedInText` supports distinctive name parts, capitalization checks and shared-name rejection. Unique nickname aliases now also recall actors, with stricter rejection when another actor name or alias contains the same label. Role labels do not independently trigger recall. |
| **1.1.7: role-alias merge safety** | Adapted and hardened | `scanLabelsMatch` requires continuity for role-only matches: explicit same-person evidence, prior presence, or compatible place. Pre-scan presence survives controller reset; Saga admission shares the guard. Distinct canon identities receive additional protection. |
| **1.1.7: editable/lockable aliases** | Adapted | Dossier editor aliases and manual-field locks are retained in [index.js](index.js). Alias editing/API resolution and textual mention recall are separate paths; editing an alias does not imply every recall path uses it. |
| **1.1.8–1.1.10: opt-in one-pass narration capture and rewrite/comment-envelope fixes** | Not adopted | Our rollout keeps the separate scanner request. It does not ask the story model for a hidden Delta update block, so the capture-specific rewrite and comment-boundary fixes are not ports in this fork. Our formatter-settlement fix addresses our own automatic update path. |
| **1.1.11–1.1.12: Story Block tabs and duplicate-card defaults** | Not adopted | No Story Block sidebar integration or its tab/default-setting behavior. Codex retains its own dossier surface. |
| **1.2.0: Story Suite source-of-truth handshake** | Reimplemented for our stack, with narrower scope | [actor-stack.js](actor-stack.js), Saga revision guards and BaiBai actor ownership replace the relevant ownership behavior. No Story Suite handshake, per-area suite selector, Story Director calendar handoff, or RPG Battle stat warning is imported. |
| **1.2.0: hidden `STORY_BLOCKS_V1` World State reader** | Not adopted | BaiBai continuity comes through its checked snapshot API; the Story Block envelope reader is not present. This is not a claim of compatibility with Story Block's World State. |
| **1.2.1: shared Story Suite overlay and launcher behavior** | Not adopted | No shared overlay or suite-managed switches. |
| **1.2.2: read-only profiles and openDossier** | Reimplemented | `actorProfiles`, `resolveActor`, and `openDossier` expose our actor view and unique identity lookup. Profile copies omit private knowledge. This is our API, not full upstream API compatibility; eligibility behavior can differ. |
| **1.2.2: live mood/condition/outfit cards, Inner Chatter, shared styles and suite token overlay** | Not adopted | Our injection preview and prompt measurements are separate facilities. No Story Suite live-card/chatter rendering or token overlay is imported. |
| **1.2.3: chat reply numbers throughout dossiers/history** | Not adopted | No upstream reply-number migration or display conversion. Existing internal turn counters remain; they must not be described as equivalent chat reply numbers. |
| **1.2.3–1.2.6: card readability, narrow-pane rows, bubble alignment and floating-button refinements** | Not adopted | These changes concern the upstream present-card/Story Block UI, not the selected actor-state integration. |
| **1.2.7: a present-view card for every chatter speaker** | Not adopted | No corresponding Inner Chatter card layer. A speaker reference does not automatically create a Codex dossier. |
| **1.2.8: dossier Look label and README screenshots** | Not adopted | Upstream presentation/documentation changes; no runtime requirement for our stack. |

Upstream descriptions and release boundaries can be checked in its [changelog at the reviewed revision](https://github.com/kohz87/npc_state_delta/blob/e5ef4b6/CHANGELOG.md). The table groups all 31 ancestry-only commits by behavior; merge commits and release bookkeeping are not extra features.

## Fixes 1–3 and ownership in our stack

1. **Custom-field evidence:** accept only an explicit value for the correct actor and field. Another actor's value, a numeric substring, missing evidence or negation cannot establish it. Changes to an established value require a reason; locks remain authoritative.
2. **Role identity continuity:** pass pre-scan presence through the controller reset and use the same identity guard in Saga admission. Sharing a profession alone cannot overwrite an existing person.
3. **BaiBai/Codex prompt ownership:** the paired BaiBai fork omits a structured actor row only when an enabled, hydrated, injecting Codex uniquely owns that actor. Disabled/unavailable/ambiguous ownership restores BaiBai's fallback. This is a cross-fork change, not something installing Codex alone guarantees; stored BaiBai history and records are preserved.

| Owner | Responsibility in this rollout |
|---|---|
| **Saga** | Applicable source canon and versioned evidence; source changes invalidate stale actor seeding work. |
| **BaiBai** | Recorded story continuity and completed-event history. Codex reads a snapshot with chat/group/length and coverage checks. |
| **NPC Codex** | Accepted actor state and actor prompt ownership: identity, characterization, knowledge restrictions, relationships and development. |
| **BunnyMo references** | Manually approved portrayal guidance within Codex's existing actor budget. No independent actor writer/injector, automatic archive or new canonical fact. |

Direct World Engine integration and broader CarrotKernel actor ownership remain outside this adoption list. See [actor-stack.md](docs/actor-stack.md) for the integration contract and rollback approach; its earlier validation/deployment paragraphs are historical checkpoints, not the latest release status.

## Verification and known limits

At runtime commit `2e83180`, the saved full-suite run passed **1,140 tests**, plus compatibility and runtime smoke checks. The shared Ari ten-turn deterministic simulation passed **143 assertions**. Before merging PR #2, runtime validation, prompt measurement and package verification also passed. GitHub Actions did not run before that merge.

Those results do not establish live-model extraction quality. The live Ari trials exposed intermittent malformed scanner JSON, unsupported inference, incorrect presence and incomplete profile filling. The final family-bond correction was tested deterministically but had not received a completed live acceptance run at that checkpoint. The earlier nickname recall gap is addressed in 2.0.2; the fork retains stricter ambiguity guards.

This comparison is a code/provenance review of the listed upstream behaviors, not a fresh full live-stack test or an assertion that all upstream fixes are unnecessary. Future adoption should update this file with the upstream revision, fork commit, behavior differences and actual verification; do not clear GitHub's behind count by importing competing state owners solely to match history.
