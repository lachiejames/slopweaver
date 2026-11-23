/**
 * The escape-hatch rows for a SNAPSHOT of persisted state — a storage restore over the live volume, and a
 * briefing freeze that would open a new page history rather than extend one.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new snapshot or history refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on a restore or freeze of persisted state, in register order. */
export const STATE_SNAPSHOT_HATCHES = [
  {
    caught:
      "the storage tar unpacks over the LIVE Supabase Storage volume, so every object the live stack holds under the same path is replaced by the backup's copy",
    command: "slopweaver store restore --storage",
    exceptions: [
      "this is a disaster recovery onto a fresh or emptied stack and the backup's objects are the ones that should stand",
      "the restore proof deliberately seeded the volume and is putting it back",
    ],
    id: "restore-overwrites-storage",
    key: {
      kind: "command",
      incantation: "slopweaver store restore --from <src> --into <db> --storage --overwrite-storage",
    },
    lane: "ambient",
    reader: "src/cli/commands/store/backupCore.ts",
    standing: "proposed",
  },
  {
    caught:
      "the artifact id holds no frozen version, so this freeze would OPEN a history rather than extend one — and an id that DRIFTED off a live page reads exactly like a new page's, which is how the fleet briefing forked into 48 directories over 33 ticks and stranded 47 versions nobody could diff against",
    command: "slopweaver briefing freeze",
    exceptions: [
      "this genuinely is the first publish of a new page, and the id was read off the address of the page that was just published rather than copied from a previous run's script",
      "the store's history for this page was deliberately removed and is being re-opened from scratch",
    ],
    id: "freeze-opens-new-history",
    key: {
      incantation: "slopweaver briefing freeze --artifact <url|id> --page <html> --new",
      kind: "command",
    },
    lane: "ambient",
    reader: "src/cli/commands/briefing/freezeRun.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
