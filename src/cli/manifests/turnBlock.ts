/**
 * The `turn` noun's BLOCKED-ON-THE-OWNER verbs, spread into `./turn.ts`.
 *
 * `block`/`unblock`/`blocked` are one feature rather than three verbs: `block` records that a step needs the owner
 * and shows it (hourglass on the card, tag in the thread), `unblock` records that the owner has done it and moves the
 * card on, and `blocked` lists what is standing against the owner for the fleet briefing to card and for a visible
 * session to resume. `block`/`unblock` are `external-write` + `doorRouted: true` for the same reason `status`
 * is; `blocked` is a pure read and posts nowhere at all, deliberately — the block reaches the owner through the
 * briefing, never the bot DM. `reach` is the trio's front door: it checks a page's sign-in before the answer
 * leans on it, and enters `block` when it is out.
 */
import {
  TURN_BLOCK_USAGE,
  TURN_BLOCKED_USAGE,
  TURN_REACH_USAGE,
  TURN_UNBLOCK_USAGE,
} from "../commands/turn/blockUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const turnBlockManifest: Readonly<Record<string, VerbManifestEntry>> = {
  block: lazy({
    load: () => import("../commands/turn/block.js").then((m) => m.turnBlockCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // `external-write`/`doorRouted: true` for the same two reasons `status` and `answer` carry them: it
      // edits the already-posted checklist and posts a real in-thread message, both through the real door.
      // `requiresApproval` stays false — the whole point of the state is that the turn stands down
      // immediately and visibly rather than pausing a session on an approval nobody is watching.
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example:
        "slopweaver turn block --brief ~/.slopweaver/briefs/C123-1712345678.000100.json --need sign-in " +
        '--what "sign in to Google Cloud locally so the monitor can deploy"',
      parseRejectIsIoFree: true,
      summary:
        "One step needs the owner: record the ask as not done, put an hourglass on the card, and tag the owner in the thread",
      usage: TURN_BLOCK_USAGE,
    },
  }),
  blocked: lazy({
    load: () => import("../commands/turn/blockedList.js").then((m) => m.turnBlockedCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "none",
      example: "slopweaver turn blocked --json",
      parseRejectIsIoFree: true,
      summary: "Every ask standing against the owner — what react-now must card, and what is owed a resume",
      usage: TURN_BLOCKED_USAGE,
    },
  }),
  reach: lazy({
    load: () => import("../commands/turn/reach.js").then((m) => m.turnReachCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // `external-write`/`doorRouted: true` because a signed-out page enters `turn block` itself, which edits the
      // card and tags the owner in the thread through the real door. Every page it only VISITS is a read.
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example:
        "slopweaver turn reach --brief ~/.slopweaver/briefs/C123-1712345678.000100.json --url https://admin.google.com/ac/users",
      parseRejectIsIoFree: true,
      summary:
        "Before the answer leans on a page in the owner's work Chrome, check it is signed in — or block the turn on their sign-in",
      usage: TURN_REACH_USAGE,
    },
  }),
  unblock: lazy({
    load: () => import("../commands/turn/unblock.js").then((m) => m.turnUnblockCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // `external-write`/`doorRouted: true`: with `--brief` it edits the standing checklist through the same
      // door `status` and `block` use. Without one it writes local state only, and reports that it did —
      // the flag is optional precisely so lifting the block never depends on the card being reachable.
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example:
        "slopweaver turn unblock --channel C123 --message-ts 1712345678.000100 " +
        '--note "signed in to Google Cloud" --brief ~/.slopweaver/briefs/C123-1712345678.000100.json',
      parseRejectIsIoFree: true,
      summary: "The owner did the thing: lift the block, move the card on, and print the line that resumes the turn",
      usage: TURN_UNBLOCK_USAGE,
    },
  }),
};
