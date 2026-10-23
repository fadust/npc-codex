# Collapsed NPC list picture fix

The shared header layout hid the full-body hero even when the NPC list was collapsed. The collapsed layout now shows that existing picture pane beside the dossier stage; showing the list restores the list column. Dossier, Stat, Social Map and the original-size image viewer remain available.

This deployment candidate is based on 6e5102c, the installed revision. Only codex-header.js runtime styling changes; no scanner, prompt, settings, persistence or data migration changes are included.

Verification: synthetic Chrome list toggle, all three views and original-size lightbox verified. Header/map tests passed. Full checks run with LF working files to avoid Windows-only stylesheet regex failures; exact-commit CI is required before deployment. Live deployment/backup details are recorded separately in the workspace deployment manifest.

Follow-up: the sticky section bar (z-index 3) painted over the More menu because its shared header formed a lower stacking context (z-index 2). The shared header now uses z-index 4 so the existing dropdown stays above the section bar. Confirmed in the live Ari dossier; no menu actions or data behavior change.
