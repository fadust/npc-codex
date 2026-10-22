# Actor ownership and portrayal integration — 2026-10-18

NPC Codex remains the actor writer and sole actor prompt owner. Saga supplies applicable canon; BaiBai supplies recorded continuity hints and completed-event history. Selected BunnyMo references support manually approved portrayal in the existing dossier editor. No StorySuite dependency or CarrotKernel injector is installed.

## Read-only image appearance

`NPCStateDelta.imageActors({chatId, groupId, floor, sourceText})` supplies only IDs, names/aliases, archive flags and semantic accepted appearance to BaiBai Image. It verifies active chat, hydration and source text; the latest reply uses accepted state on the matching lineage, and older replies require an exact matching checkpoint. Unavailable history returns null rather than substituting current appearance. Image overlays these references temporarily; manual/global render overrides remain authoritative. No image plan writes a dossier, and no additional provider call is introduced. Portrait requests also supply their prose in BaiBai's `nl` field so a semantic-only ComfyUI workflow can serve both destinations.

## Upstream provenance and fixes

Selected behavior was ported from kohz87/npc_codex through 136d55e7efb720a3417af45bbe5e37651bdc69f3 (October 17): configurable custom fields, role-alias matching, distinctive-name recall, mentioned/deceased reference lines and editable aliases. Existing Codex lifecycle, storage and development machinery stays authoritative.

1. Custom fields require explicit evidence for the named actor, field and complete value. Another actor's value, numeric substrings, an empty source and negation cannot establish the field. A changed established value also requires a reason. Manual locks apply. Short aliases do not establish custom facts.
2. Role aliases require continuity evidence. The controller passes pre-scan presence through its presence reset, and the Saga admission adapter uses the same identity guard.
3. Ownership changes actual provider output: BaiBai omits only structured NPC rows uniquely owned by an enabled, hydrated Codex with actor injection enabled. History, scene context and stored BaiBai records remain. Disabled, unavailable or ambiguous ownership restores BaiBai's fallback.

Saga source revisions are captured before the first scan request and checked through final commit. Changes, replacement, disablement or missing revision support reject stale results. Changed canon revisions allow supported gap filling again; accepted development and locks remain protected.

## Using portrayal

Open a dossier's editor and expand **BunnyMo portrayal (reference only)**. Browse the selected references and provenance, select one, enter at most 600 characters expressing already accepted traits, and save to approve it. An empty guide disables it. Changes to its actor basis or reference revision stop injection until reviewed and saved again. It shares the existing actor budget and creates no model call, fact, event, archive or independent prompt slot.

The vendored references preserve the GPL-3.0 source and pinned revision in portrayal-references.js. Broad BunnyMo frameworks and automatic guide generation are deliberately outside this manual rollout. Narrative facts, knowledge restrictions, manual locks and current scene outrank the guide.

Read-only API: actorProfiles(), actorOwnership(), ownsActor(name), and openDossier(id/name/unique alias). Profiles return copies, omit private knowledge and never admit actors. Saga's Session analysis links existing named actors to their dossiers. BaiBai hints verify active chat identity, group, length, revision and coverage; partial coverage remains partial.

## Verification and rollback

The Ari fixture is a byte-identical vendored copy of Saga/tests/fixtures/layer1-ari.json. Saga production-path tests exercise chronology, dependent ages, mixed canon, unsupported power proposals, ambiguous Ari, invalidation and review. Codex tests add grounding, role continuity, seed revisions, locks, portrayal invalidation/budget, read-only profiles and stale first-request rejection in the synthetic host. BaiBai tests capture final host prompt slots and exercise ownership fallback without modifying stored actor rows.

Validation: 1,132 NPC tests, compatibility and runtime smoke; runtime inventory/syntax validation; prompt and Stage 9 measurements; verified package. BaiBai: 198 tests, 875 script assertions, 24 English tests and production build. Saga: shared-fixture integration and runtime (including the three-second deadline). Prompt counts are estimates; no paid provider usage or live-model quality is claimed.

Deployment uses backed-up file replacement with hash verification. No database, original lorebook, card or user setting is migrated. Disable Codex injection to return structured actor fallback to BaiBai; clear its guide to disable portrayal. For full rollback restore the recorded pre-deployment files and remove only files marked newly added in the deployment manifest, then reload SillyTavern.

## Prompt conflict and repetition review — pending deployment

The compact actor header retains identity, voice, relationship and knowledge rules. Default relationship boilerplate is omitted; custom criteria still use the existing budget. Low-score rules are conditional rather than describing every included actor as low-standing. Approved portrayal is omitted only when every clause already appears in accepted speech/mannerisms (with simple inflection normalization). Distinct timing advice remains. Existing basis, approval, reference and terminal-death checks still run first.

Saga labels evidence as source-era background, gives accepted actor development/lifecycle precedence, warns about unresolved names, and limits automatic story dependency expansion to relationship queries. Identity retrieval still expands dependencies. BaiBai shares memory rules between its history/state slots, preserves standalone state rules, and shortens time/ledger instructions while retaining full-date and no-double-accounting requirements. Original records and user-custom prompts are unchanged.

The deterministic Ari replay captures each extension slot before the corresponding story turn: 101 assertions, ten turns, zero live provider calls. Offline o200k_base counting across those slots decreased from 21,672 to 8,221 tokens (13,451 / 62.1% saved). This excludes preset, card, visible chat, other extensions and message framing; it is not provider billing. Synthetic continuity leaves and hidden assistant messages limit realism. Live model interpretation, browser integration and live SQLite were not assessed by this replay. These changes await deployment review.

## Appearance and presence handoff

NPC Codex resolves accepted current-form appearance, separates literal impression and bearing cues, and supplies them through its existing actor prompt alongside approved BunnyMo guidance. The UI and read-only actor profiles use the same projection. No additional BunnyMo injector is enabled.

Concrete physical details appear once. Bearing already in essential mannerisms is not repeated. Approved guide clauses duplicating accepted speech, appearance or presence are removed while distinct delivery guidance remains. Presence is an optional, budgeted cue for the actor's posture, movement and delivery; it cannot force audience reactions or establish personality or intent. Other actors respond according to their own accepted characterization, relationships and current context. Missing impressions remain unknown.

Saga canon and BaiBai completed continuity retain their existing owners. Actor knowledge restrictions, manual locks, stale-guide rejection, off-screen status and confirmed death still govern portrayal. The deterministic 10-turn Ari payload audit passed 203 assertions; this verifies provider input, not live-model obedience.
