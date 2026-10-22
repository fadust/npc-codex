# NPC Codex fork changelog and upstream adoption

This file tracks our maintained fork's changes and its relationship to [NPC State Delta](https://github.com/kohz87/npc_state_delta). It does not replace the inherited [CHANGELOG.md](CHANGELOG.md) or claim that every upstream release has been merged.

## Current fork version — 2.0.2

23 October: added the read-only `imageActors` appearance API for BaiBai Image, with matching chat/source/lineage checks and exact-checkpoint historical fallback. Portrait prose is also sent as `nl` for semantic-only ComfyUI workflows. No scanner prompts, request budgets, state formats or numerical mechanics changed.

Version bumped on 18 October 2026 to package the integration and fixes below. 2.0.2 adds unique nickname recall; persisted formats are unchanged. No GitHub release or tag is implied.

## Comparison checkpoint — 18 October 2026

- Fork runtime reviewed: [`2e83180`](https://github.com/fadust/npc-codex/commit/2e8318067d8d4021b9d100df1df503ddb14eca30), merged into `main` as [`4ceb1f3`](https://github.com/fadust/npc-codex/commit/4ceb1f32303743c39a485de83c98af206567e03d) through [PR #2](https://github.com/fadust/npc-codex/pull/2). Both commits have identical file contents.
- Upstream reviewed: [`e5ef4b6`, v1.2.8](https://github.com/kohz87/npc_state_delta/commit/e5ef4b6), including the October 17 changes and October 18 display updates. The earlier adaptation was pinned through upstream `136d55e`, v1.2.6.
- At this checkpoint Git reported **42 ahead / 31 behind**. This counts commit ancestry, including merge and release commits; it is not a count of missing features. Adapted code retains different commit identities. Later documentation commits will change the count.
- At this comparison checkpoint NPC Codex was application version **2.0.0**. Our version sequence is independent of upstream's; the changes below are now recorded under 2.0.1.

## Our changes

### Unreleased — appearance, impression and bearing in actor portrayal

- The existing NPC Codex/BunnyMo actor prompt now separates accepted current-form physical appearance from impression and bearing. The dossier display and read-only actor profiles share the same projection; no second actor injector or model request is added.
- Repeated bearing stays in established mannerisms. BunnyMo guide clauses already supplied by accepted speech, appearance or presence are omitted; distinct guidance remains. Presence describes this actor's expression and carriage, never mandates other characters' feelings or reactions, and establishes no personality, intent or facts.
- Existing budget, knowledge, manual-lock, approval freshness, absence and terminal-death protections remain. Saga supplies canon; BaiBai keeps completed continuity. No persisted dossier schema or source migration.
- Verification: 10-turn deterministic Ari full-stack payload, 203 assertions, with production Saga retrieval, Codex admission/merge/injection, BunnyMo guide rendering, BaiBai replay/injection and World Engine context. Synthetic provider/embedding responses and memory store; no live-model obedience claim.

### Unreleased — separate face and full-body images

- Face portraits appear beside the NPC name and in the NPC list. A separate full-body render appears in the collapsed-list panel. Portrait tools select either composition with independent prompt drafts, preview, upload, replacement and removal. Each opens its own original resolution.
- Existing portraits stay in the face slot; no image is duplicated or regenerated automatically. Both assets use the existing canonical portrait owner, appearance-form support, freshness guards, persistence, rollback retention and native binary bundle. Older extension versions do not display the new full-body asset.
- **Presentations** is now overall impression and bearing: literal accepted impression/presence cues and carriage-related mannerisms. Physical traits, outfits and named forms remain under Appearance. No impression is inferred from personality, mood, demographics or clothing; absent cues stay unestablished. Existing appearance editor text can record `Impression:` and `Bearing:` clauses. This read-only projection adds no model request or stored authority; its story handoff is described below.
- Appearance starts collapsed with a visible disclosure arrow; expanding/collapsing uses the existing native details control and retains the chosen state during dossier refreshes.
- Appearance now displays Gender, Age bracket, Skin color, Face, Facial hair, Hairstyle, Hair color, Accessories, Body, Proportions and Outfit from the resolved accepted description. Grouping is presentation-only; unmatched clauses remain under Other details, and missing categories say Not specified. Age brackets are display-only bands (kid 0–12, teen 13–17, young adult 18–29, adult 30–44, middle-aged 45–64, old 65–79, very old 80+), preferring apparent age; nonhuman chronological ages remain unclassified. The editor guides users to cover these details without creating a second appearance authority or extra model calls.
- Tested with synthetic images and deterministic BaiBai responses; live image-provider likeness and framing quality remain unverified.

### Unreleased — BaiBai portraits and Codex presentation

- Portrait tools can call the existing BaiBai Image API v1 using accepted dossier prompts and the user's configured backend. Originals are stored in BaiBai's gallery; Codex only applies a preview after **Use as Portrait**. Existing chat, form, appearance and stale-result checks remain shared with the native image route. No chat message or scanner request is created by the adapter.
- Portrait boxes open an accessible full-size viewer with source dimensions and a 1:1 toggle. BaiBai originals are retained through the existing `generatedFrom` reference; older images without a retained original use their stored image. Deleting a gallery original makes that original unavailable.
- A slate/teal Codex theme preserves all dossier sections. **Hide NPC list** expands the left portrait area and fits the whole image without cropping; **Show NPC list** restores search and actor selection. Fitting cannot recover body parts absent from the source image.
- Dossier, Stat and Social Map share the layout. The expanded list restores the small portrait beside the actor name. **Refresh** beside **Edit dossier** delegates to the existing guarded recent-story refresh action.
- Verification: automated adapter/error/source checks plus a browser fixture using the production UI and a deterministic BaiBai response. Confirmed 1200 × 1800 at 1:1, preview without mutation, and explicit application. Live image-provider quality has not been tested in this change.

### Unreleased — NPC Codex runtime naming

- Console labels, diagnostics, errors, notifications and model-facing dossier headers now identify NPC Codex. `window.NPCCodex` is the primary public API; internal consumers prefer it. `window.NPCStateDelta` remains an alias to the exact same object for existing Saga/BaiBai integrations.
- Installation directory, settings/storage keys, writer locks, bundle identifiers, DOM/event identifiers and existing lifecycle hooks retain their compatibility names. Renaming those would require coordinated migration and could strand saved dossiers or split writers. Upstream attribution and historical records remain intact.

### Unreleased — BaiBai Image edit isolation

- Complete `bbi_image` illustration blocks no longer change NPC story fingerprints or enter scanner evidence. Tag insertion/replacement/removal therefore does not require another NPC scan or invalidate an in-flight result; edits to surrounding prose still use normal reconciliation and rescan safeguards.
- Old image-bearing history keys are remapped only when their exact raw-message fingerprints match. Unproven historical differences remain subject to existing recovery checks.
- Deterministic tests cover Ari image edits during/after scanning, real prose edits, LF/CRLF, malformed blocks, and proven-key migration. All 1,146 tests, runtime smoke, compatibility, validation and packaging passed. No model settings, scoring rules or persisted format versions changed.
- Browser verification on 18 October 2026 after backup and deployment: an actual BaiBai Image prompt edit produced zero NPC requests and kept revision 20; a subsequent prose edit completed one automatic scan in 22.601 seconds (three successful provider requests, no retry/failure) and saved revision 22. The updated bridge location and relaxed posture appeared in the actor prompt; established personality and private knowledge were preserved.
- Live limits: this was one paired synthetic Ari check. Earlier fear cues still influenced the model's mood interpretation. A harmless five-second unchanged-lineage warning remains for image-only edits; it does not dispatch a scan. The diagnostics NPC-count label also incorrectly displays zero despite listing both actors in its prompt.

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


## 22 October 2026 — Narrow BaiBai presence bridge

BaiBai supplies only source-verified, current-reply scene participants to the existing actor prompt. Codex projects present=true/worldActive=false for unique exact accepted names/aliases; no new actors, roster deletion, dossier writes, profile transfer or new model calls. Role labels, ambiguous names (including archived namesakes), manual present/worldActive locks and terminal deaths are excluded. Omitted/empty/null scene data leaves scanner results unchanged. Existing actor budget, exclusion, knowledge and TunnelVision canon gates remain owners.

The prompt projection is intentionally reversible: stored dossier/UI presence remains the scanner result; stale/removed BaiBai data disappears on prompt rebuild. BaiBai change/ready events refresh the injection; ordinary pre-generation refresh handles late summaries. The paired BaiBai fork stamps new single-floor summaries with a chat/group/floor/cleaned-prefix/swipe fingerprint captured before provider work. Its existing getFloor API exposes presenceSourceValid separately from leaf validity. Old, carried-over and batch-only summaries cannot authorize presence. Text/earlier-branch edits or swipe/chat changes fail closed without changing summary retention. Fingerprint checks are deterministic change detection, not cryptographic authentication.

Checks: production adapter tests; synthetic-host prompt delivery and invalidation; full Codex tests/compatibility/runtime smoke; module validation, prompt and Stage9 measurements; verified package. Existing prompt hashes/request budgets unchanged. Fresh checkout CRLF initially broke six LF-sensitive tests; normalizing test checkout files fixed these without changing tracked behavior. No paid-provider trial is claimed. Broader upstream adoption remains parked in the separate npc_codex working tree.

## 22 October 2026 - compatible upstream adoption through 1.2.19

Upstream main f6e92f580f1caf549f4840a8fdba5dd4af983ce3 reviewed. Adopted ordinary-scanner and standalone UI changes while retaining the deployed BaiBai presence bridge.

| Upstream | Disposition |
|---|---|
| 1.2.9 one-pass rewrite tolerance | Parked: this fork uses separate scanner and existing image-only edit isolation; accepting arbitrary rewritten replies would weaken source checks. |
| 1.2.10 World State presence authority | Parked broad override; retain source-verified narrow BaiBai prompt promotion, no saved actor takeover. |
| 1.2.11 repeat habit evidence | Adopted source tags for single-exchange scans and independent-message repeat handling. Capture reminders/catch-up parked with one-pass; no new background calls. |
| 1.2.12 relationship request reduction | Adapted narration-only targeting/context, retains Floris-log and BaiBai-image cleanup and existing scoring/dispatcher. Capture coverage flags not imported. |
| 1.2.13 What's sent | Adopted existing actor-injection preview. Story Block tabs and one-pass reminder placement have no matching owner in our stack; parked. |
| 1.2.14 compact hints, redundant work | Adopted expandable setting hints and unused/shared helper cleanup; fork already passes scene text and named IDs into injection. |
| 1.2.15 relationship changes, Advanced settings | Adopted badges using our existing dossier turn, not upstream's absent reply field; settings regrouped without changing values. Story Suite tab changes parked with that integration. |
| 1.2.16 prompt placement | Adopted correct explicit depth zero handling. No automatic depth migration or new prompt keys; user placement retained. One-pass static/tail architecture parked. |
| 1.2.17 compact/deduplicated one-pass | Parked: would introduce a second capture workflow and change story-model output requirements. |
| 1.2.18 helper cleanup | Adopted shared plain/escapeHtml imports. |
| 1.2.19 existing NPC memories | Adopted profileUpdates memory ingestion through existing bounded deduplication; manual memory locks honored on both paths. Scanner/import rules clarify additions and npcs[] location. |

Compatibility: saga-canon.js (TunnelVision bridge), actor-stack.js (including BaiBai), knowledge.js, actor-portrayal.js and scanner-routing.js are unchanged from deployed535e101. No settings defaults, provider/reasoning parameters, actor ownership, lifecycle format or persistent schema migration. NPC memories remain actor-specific accepted memories, not another BaiBai event-summary writer.

Verification: full1171tests plus compatibility and synthetic runtime smoke passed; three additional focused source/cleanup/memory-lock tests passed. Validation, prompt measurement, Stage9 budget assertions and verified ZIP passed. Scanner/full-window/retry prompts +39characters, dossier import +52; Refresh/backfill/relationship rules and dispatcher counts/output allowances unchanged. Existing prompt budget fixture updated for these explicit memory clarifications. LF normalization was required for source-layout tests on Windows, without semantic changes to unrelated files. No fresh provider trial required for these bounded changes.

Deployment/remote CI status is recorded separately in the workspace adoption report. Application remains2.0.2; no new release tag or data-format version claimed.

## 22 October 2026 - desktop-only UI

User requested removing mobile UI/features. Removed phone/tablet viewport and coarse-pointer stylesheet overrides, safe-area layouts, mobile fullscreen portrait dialogs, duplicate touchend handlers, and the phone-only Social Map cap/listener/short label. Desktop Codex header layout is now unconditional. Retained shared Pointer Events for mouse dragging, keyboard controls, viewport clamping, high-DPI images, desktop container queries and storage concurrency protections. Removed retired mobile-only assertions and phone/tablet browser fixture viewports. No scanner, canon/presence bridge, prompt, settings defaults or saved-data changes.

### 22 October 2026 — NPC Codex namespace

Renamed active underscore identifiers, controls, prompt key, package/install folder and persisted format names to `npc_codex`. Existing settings move to the new key with a non-serialized legacy bridge alias, and readers still accept pre-rename sidecars/native bundles. Existing file pointers and data remain owned by the same Codex records. Historical source provenance and upstream repository URLs retain their original names. No prompt wording, generation settings or actor ownership changes.
