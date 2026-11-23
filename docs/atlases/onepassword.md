# The 1Password atlas holds no secret, as a property rather than a promise

Part of [Atlases](../atlases.md).

It is the one atlas built to a stronger line than the others, because of what it is a map OF. Three
independent mechanisms carry that, so no single mistake defeats all three:

1. **A closed command allowlist** (`atlas/onepassword/inventory.ts`) — a caller names a SURFACE and the argv
   is looked up, so no caller can supply one. `op item get`, `op document get` and `op read` are absent from
   the table. A vault's item COUNT comes off `op vault get`, which is why listing items is unreachable
   rather than merely unused.
2. **An allowlist projection** (`atlas/onepassword/model.ts`) — provider JSON is PARSED THROUGH a closed
   schema, so a field 1Password adds next month is dropped at the boundary rather than stored because
   nobody thought to exclude it. Deliberately unlike the Vanta atlas, which stores the payload wholesale.
3. **A pre-write sensitivity gate** (`atlas/onepassword/sensitivity.ts`), wired into the kit's own publish
   guard so a sync cannot forget to call it. A forbidden key name or a credential-shaped value REFUSES the
   whole generation rather than redacting it — nothing half-written is left behind. A kind file is scanned
   one `.jsonl` line at a time, the exact bytes the kit writes, so a kind that only grows (stale events are
   kept, never dropped) never meets the one-string serialisation ceiling; a finding names its line.

A private-denylist hit is **recorded and printed, not refused**: this atlas's entire subject is the
organisation, so refusing on those words would only ever admit an empty atlas.

It needs two unrelated credentials, and either may be absent — the roster comes from an `op` CLI session
and the activity feed from an Events API token, which is structurally incapable of returning an item's
contents. A run with one half configured publishes that half and marks the other `not-configured`. The `op`
session belongs to a dedicated account that is **CLI-only** — never added to the desktop app, which refuses a
second account on the same team — and the sync signs it in itself from `onepassword-atlas-password`
([why](../security/credentials.md)).

Credentials come from the secrets store, not this repository — see [security/credentials.md](../security/credentials.md) and
[environment.md](../environment.md).
