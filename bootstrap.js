/* NPC Codex v2.0.2 bootstrap. */
import { prepareNpcStateHardening } from './hardening.js';

await prepareNpcStateHardening();
await import('./scanner-routing.js');
await import('./calendar-settings.js');
await import('./index.js');
try {
    await import('./destructive-settlement.js');
} catch (error) {
    console.error('[NPC Codex] destructive history settlement failed to load', error);
}
try {
    await import('./full-cast.js');
} catch (error) {
    console.error('[NPC Codex] optional full-cast scanner failed to load', error);
}
try {
    await import('./dossier-ui.js');
} catch (error) {
    console.error('[NPC Codex] dossier UI failed to load', error);
}
try {
    await import('./dossier-tools.js');
} catch (error) {
    console.error('[NPC Codex] supporting tools UI failed to load', error);
}
try {
    await import('./launcher-ui.js');
} catch (error) {
    console.error('[NPC Codex] dossier launcher failed to load', error);
}
try {
    await import('./dossier-experience.js');
} catch (error) {
    console.error('[NPC Codex] consolidated dossier experience failed to load', error);
}
try {
    await import('./relationship-map.js');
} catch (error) {
    console.error('[NPC Codex] relationship map failed to load', error);
}
try {
    await import('./continuity-ui.js');
} catch (error) {
    console.error('[NPC Codex] continuity UI failed to load', error);
}
try {
    await import('./scanner-output-ui.js');
} catch (error) {
    console.error('[NPC Codex] scanner output/UI refinement failed to load', error);
}
