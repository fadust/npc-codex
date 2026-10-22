// Keep old bridge readers on the same object without duplicating saved settings.
export function codexSettings(root) {
    if (!root) return undefined;
    if (!root.npc_codex && root.npc_state_delta) root.npc_codex = root.npc_state_delta;
    Object.defineProperty(root, 'npc_state_delta', {
        configurable: true,
        enumerable: false,
        get() { return this.npc_codex; },
        set(value) { this.npc_codex = value; },
    });
    return root.npc_codex;
}
