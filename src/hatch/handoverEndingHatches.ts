/**
 * The escape-hatch rows for how a run's handover ENDS — `handover finish|settle|park`: the checks it never read, the
 * page it never carded, the seat it would close mid-turn or off its own landing, and the lesson it never recorded.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position, directly before
 * `./handoverOwnerActionHatches.ts`. Add a row for a new handover-ending refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on a handover ending, in register order. */
export const HANDOVER_ENDING_HATCHES = [
  {
    caught:
      "this run raised a pull request and nothing has read its checks since — a draft sat " +
      "with two red checks because the session that pushed it never looked once, and the owner found them " +
      "unaided",
    command: "slopweaver handover finish|settle",
    exceptions: [
      "the pull request was closed or superseded, so there are no checks left to read",
      "GitHub is unreachable from this session and the read genuinely cannot be taken",
    ],
    id: "unread-checks",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNREAD_CHECKS" },
    lane: "ambient",
    reader: "src/cli/commands/handover/checksReadGate.ts",
    standing: "proposed",
  },
  {
    caught:
      "the run's deliverable is a page and nothing put it in front of the owner — no question naming it, no ruling, no " +
      "hand step — the way nine briefings the owner asked for were settled with a page witness and never carded",
    command: "slopweaver handover finish|settle|close or slopweaver page publish",
    exceptions: [
      "the page is an internal artifact nobody reacts to — a regenerated proof page, a fixture",
      "the page reached the owner another way the gate cannot read, and the settle reason says where",
    ],
    id: "uncarded-page",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNCARDED_PAGE" },
    lane: "ambient",
    reader: "src/cli/commands/handover/uncardedPageGate.ts",
    standing: "proposed",
  },
  {
    caught:
      "the seat being parked is another session whose screen shows a running turn or a line queued behind one, " +
      "so closing it now would end it mid-thought — the same idle read `session close-done` takes before any close — " +
      "or it is the caller's own seat with a line queued behind this park, which closing would drop unread",
    command: "slopweaver handover park",
    exceptions: [
      "the seat is wedged: its turn has shown no progress across several reads and it is holding capacity the owner's steered work needs",
      "the screen's busy marker is stale chrome left by a turn that already ended, confirmed by reading the screen yourself",
      "the line queued in your own composer carries no instruction (stray text), confirmed by reading the screen yourself",
    ],
    id: "park-running-seat",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_PARK_RUNNING_SEAT" },
    lane: "ambient",
    reader: "src/cli/commands/handover/parkRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "the row carries the owner's standing-session ruling, so its seat stays open between the owner's turns and waiting for them is " +
      "the intended state, not a park — `session close-done` must not park the dedicated session between the owner's turns",
    command: "slopweaver handover park",
    exceptions: [
      "the owner said to close the seat early and that has not been recorded yet as a ruling ending the standing session",
      "the seat is being replaced at once by a fresh seat on the same row, and the park is how its checkpoint survives",
    ],
    id: "park-standing-session",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_PARK_STANDING_SESSION" },
    lane: "ambient",
    reader: "src/cli/commands/handover/parkRun.ts",
    standing: "proposed",
  },
  {
    caught:
      "the seat would park on its OWN open pull request's checks, or on a clock while its run's own pull request is " +
      "open (or its pull requests will not read), and waiting for CI, rebasing, fixing red CI and " +
      "landing are the work, not a reason to close (a session that does ninety-nine percent " +
      "and says bye at the last one percent is a massive bug) — one seat parked itself on its CI seven times in a day",
    command: "slopweaver handover park",
    exceptions: [
      "the branch is shared with another run whose seat is the one landing that pull request, and this seat's own work is done",
      "the pull request is held on a person, not on CI, and the seat has nothing left to do until they act",
      "the run records no worktree, or its branch or pull requests will not read, and you have checked the pull request is another branch's",
    ],
    id: "park-own-landing",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_PARK_OWN_LANDING" },
    lane: "ambient",
    reader: "src/cli/commands/handover/parkOwnLanding.ts",
    standing: "proposed",
  },
  {
    caught: "the run is closing without recording what it learned, and a run that learns nothing twice learns nothing",
    command: "slopweaver handover settle",
    exceptions: ["the run was a pure mechanical repeat of a documented procedure"],
    id: "no-lessons",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_NO_LESSONS" },
    lane: "ambient",
    reader: "src/knowledge/declared.ts",
    standing: "ruled",
  },
] as const satisfies readonly EscapeHatch[];
