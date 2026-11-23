/**
 * `tickRecordGates.ts` — the seven tick-record gates over documents the shell read once, and the idle and
 * recipe-failure refusals' exact rendering.
 *
 * The recorder's own file drives these end to end; this one pins the pure layer directly: which gate's hatch
 * silences which block, the order blocks come back in, and the idle, voice and steer refusals line for line. The
 * documents every case hands the gates are `./tickRecordGatesFixtures.ts`.
 */
import { describe, expect, it } from "vitest";

import { approvedDraftRefusalLines } from "../../../../../cli/commands/supervisor/tickRecordApprovedDrafts.js";
import type { SupervisorTickDraft } from "../../../../../cli/commands/supervisor/tickRecordCore.js";
import {
  IDLE_ROWS_SHOWN,
  idleRefusalLines,
  tickRecordRefusals,
} from "../../../../../cli/commands/supervisor/tickRecordGates.js";
import { recipeFailureRefusalLines } from "../../../../../cli/commands/supervisor/tickRecordRecipeFailures.js";
import { steerRefusalLines } from "../../../../../cli/commands/supervisor/tickRecordSteers.js";
import { voiceRefusalLines } from "../../../../../cli/commands/supervisor/tickRecordVoice.js";
import { hatchFor } from "../../../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../../../hatch/render.js";
import type { SlackDraftItem } from "../../../../../outbound/slack/draftRegister.js";
import type { AnswerContext } from "../../../../../talk/answerContext.js";
import type { CardLandedRow } from "../../../../../talk/cardLanding.js";
import { buildCeilingsReading } from "../../../capacity/ceilingsDefaults.js";
import {
  ALL_SHUT,
  APPROVED,
  CLEAN,
  FREE_DRAFT,
  GROWING,
  IDLE_ONLY,
  MISSED,
  NO_DRAFTS,
  NO_STEERS,
  NOTION,
  NOTION_UNSEATED,
  ONE_APPROVED,
  ONE_DOC,
  ONE_MISSED,
  OWED,
  UNREAD,
} from "./tickRecordGatesFixtures.js";

describe("tickRecordRefusals", () => {
  it("returns no block at all when every hatch is open", () => {
    expect(
      tickRecordRefusals({
        approvedDrafts: NO_DRAFTS,
        capacity: OWED,
        draft: FREE_DRAFT,
        open: {
          approvedDrafts: true,
          idle: true,
          load: true,
          recipeFailures: true,
          steers: true,
          sweep: true,
          voice: true,
        },
        reconciliation: ONE_DOC,
        steers: ONE_MISSED,
        voice: UNREAD,
      }),
    ).toStrictEqual([]);
  });

  it("returns exactly the idle block when only its hatch is shut", () => {
    const blocks = tickRecordRefusals({
      approvedDrafts: NO_DRAFTS,
      capacity: OWED,
      draft: FREE_DRAFT,
      open: IDLE_ONLY,
      reconciliation: ONE_DOC,
      steers: ONE_MISSED,
      voice: UNREAD,
    });

    expect(blocks.length).toBe(1);
    expect(blocks[0]!).toContain("  p2 the-doc");
  });

  it("returns no idle block once no lane fills, even with its hatch shut", () => {
    const blocks = tickRecordRefusals({
      approvedDrafts: NO_DRAFTS,
      capacity: { kind: "not-owed", why: "no lane is filling (claude lean, codex lean)" },
      draft: FREE_DRAFT,
      open: IDLE_ONLY,
      reconciliation: ONE_DOC,
      steers: ONE_MISSED,
      voice: UNREAD,
    });

    expect(blocks).toStrictEqual([]);
  });

  it("returns every refusing gate in gate order — sweep, then idle", () => {
    // No `outcomes` on the reconciliation, so the sweep gate cannot judge; the load gate passes a free machine.
    const blocks = tickRecordRefusals({
      approvedDrafts: NO_DRAFTS,
      capacity: OWED,
      draft: FREE_DRAFT,
      open: ALL_SHUT,
      reconciliation: ONE_DOC,
      steers: NO_STEERS,
      voice: CLEAN,
    });

    expect(blocks.length).toBe(2);
    expect(blocks[0]![0]!).toContain("the sweep gate could not judge this tick");
    expect(blocks[1]!).toContain("  p2 the-doc");
  });

  it("puts an unread word of the owner's FIRST and an owed steer SECOND, ahead of every other refusing gate", () => {
    const blocks = tickRecordRefusals({
      approvedDrafts: NO_DRAFTS,
      capacity: OWED,
      draft: FREE_DRAFT,
      open: ALL_SHUT,
      reconciliation: ONE_DOC,
      steers: ONE_MISSED,
      voice: UNREAD,
    });

    expect(blocks.length).toBe(4);
    expect(blocks[0]!).toStrictEqual(voiceRefusalLines({ verdict: UNREAD }));
    expect(blocks[1]!).toStrictEqual(
      steerRefusalLines({ verdict: { kind: "refused", steers: [MISSED], undated: [], undecodedRelays: 0 } }),
    );
    expect(blocks[2]![0]!).toContain("the sweep gate could not judge this tick");
  });

  it("judges a steer against the tick's START, so one spoken after it started does not refuse", () => {
    expect(
      tickRecordRefusals({
        approvedDrafts: NO_DRAFTS,
        capacity: OWED,
        draft: FREE_DRAFT,
        open: {
          approvedDrafts: true,
          idle: true,
          load: true,
          recipeFailures: true,
          steers: false,
          sweep: true,
          voice: true,
        },
        reconciliation: ONE_DOC,
        steers: {
          kind: "read",
          steers: [{ ...MISSED, registeredAtIso: "2026-09-21T00:20:00.001Z" }],
          undecodedRelays: 0,
        },
        voice: CLEAN,
      }),
    ).toStrictEqual([]);
  });

  it("lets the steer hatch silence the steer block and nothing else", () => {
    const blocks = tickRecordRefusals({
      approvedDrafts: NO_DRAFTS,
      capacity: OWED,
      draft: FREE_DRAFT,
      open: IDLE_ONLY,
      reconciliation: ONE_DOC,
      steers: { kind: "unreadable", why: "talk/relays.jsonl did not read" },
      voice: CLEAN,
    });

    expect(blocks.length).toBe(1);
    expect(blocks[0]!).toContain("  p2 the-doc");
  });

  it("returns no voice block for a stretch still being spoken with nothing finished unread", () => {
    expect(
      tickRecordRefusals({
        approvedDrafts: NO_DRAFTS,
        capacity: OWED,
        draft: FREE_DRAFT,
        open: {
          approvedDrafts: true,
          idle: true,
          load: true,
          recipeFailures: true,
          steers: true,
          sweep: true,
          voice: false,
        },
        reconciliation: ONE_DOC,
        steers: NO_STEERS,
        voice: { kind: "clean", stillSpoken: [GROWING] },
      }),
    ).toStrictEqual([]);
  });

  it("lets the voice hatch silence the voice block and nothing else", () => {
    const blocks = tickRecordRefusals({
      approvedDrafts: NO_DRAFTS,
      capacity: OWED,
      draft: FREE_DRAFT,
      open: {
        approvedDrafts: true,
        idle: false,
        load: true,
        recipeFailures: true,
        steers: true,
        sweep: true,
        voice: true,
      },
      reconciliation: ONE_DOC,
      steers: NO_STEERS,
      voice: UNREAD,
    });

    expect(blocks.length).toBe(1);
    expect(blocks[0]!).toContain("  p2 the-doc");
  });
});

describe("tickRecordRefusals — the approved-draft gate", () => {
  it("puts a held approved draft THIRD, after the voice and steer blocks and ahead of the sweep", () => {
    const blocks = tickRecordRefusals({
      approvedDrafts: ONE_APPROVED,
      capacity: OWED,
      draft: FREE_DRAFT,
      open: ALL_SHUT,
      reconciliation: ONE_DOC,
      steers: ONE_MISSED,
      voice: UNREAD,
    });

    expect(blocks.length).toBe(5);
    expect(blocks[2]!).toStrictEqual(
      approvedDraftRefusalLines({
        answers: new Map(),
        verdict: {
          drafts: [APPROVED],
          kind: "refused",
          landings: [],
          skippedLines: 0,
          unreadApproved: [],
          unreadableLandings: [],
          unsureIds: [],
        },
      }),
    );
    expect(blocks[3]![0]!).toContain("the sweep gate could not judge this tick");
  });

  it("passes an approved draft recorded after the tick started — it is the next tick's", () => {
    const later = { ...APPROVED, draft: { ...APPROVED.draft, tsIso: "2026-09-21T00:20:00.001Z" } };

    expect(
      tickRecordRefusals({
        approvedDrafts: { ...NO_DRAFTS, items: [later] },
        capacity: OWED,
        draft: FREE_DRAFT,
        open: { ...ALL_SHUT, idle: true, sweep: true },
        reconciliation: ONE_DOC,
        steers: NO_STEERS,
        voice: CLEAN,
      }),
    ).toStrictEqual([]);
  });

  it("passes a released approved draft and a held one with no approval", () => {
    const released: SlackDraftItem = { ...APPROVED, state: "released" };
    const { approval: _dropped, ...unapproved } = APPROVED.draft;

    expect(
      tickRecordRefusals({
        approvedDrafts: { ...NO_DRAFTS, items: [released, { ...APPROVED, draft: unapproved }] },
        capacity: OWED,
        draft: FREE_DRAFT,
        open: { ...ALL_SHUT, idle: true, sweep: true },
        reconciliation: ONE_DOC,
        steers: NO_STEERS,
        voice: CLEAN,
      }),
    ).toStrictEqual([]);
  });

  it("refuses an unreadable register rather than passing it", () => {
    const blocks = tickRecordRefusals({
      approvedDrafts: { kind: "unreadable", why: "EACCES" },
      capacity: OWED,
      draft: FREE_DRAFT,
      open: { ...ALL_SHUT, idle: true, sweep: true },
      reconciliation: ONE_DOC,
      steers: NO_STEERS,
      voice: CLEAN,
    });

    expect(blocks.length).toBe(1);
    expect(blocks[0]![0]!).toContain("the Slack draft register could not be judged — EACCES");
  });

  it("lets its own hatch silence its block and nothing else", () => {
    const blocks = tickRecordRefusals({
      approvedDrafts: ONE_APPROVED,
      capacity: OWED,
      draft: FREE_DRAFT,
      open: IDLE_ONLY,
      reconciliation: ONE_DOC,
      steers: NO_STEERS,
      voice: CLEAN,
    });

    expect(blocks.length).toBe(1);
    expect(blocks[0]!).toContain("  p2 the-doc");
  });
});

describe("tickRecordRefusals — the unseated-recipe-failure gate", () => {
  it("puts an unseated failure finding LAST, after the idle block, with set-repo before its spawn", () => {
    const blocks = tickRecordRefusals({
      approvedDrafts: NO_DRAFTS,
      capacity: OWED,
      draft: FREE_DRAFT,
      open: { ...ALL_SHUT, sweep: true },
      reconciliation: NOTION_UNSEATED,
      steers: NO_STEERS,
      voice: CLEAN,
    });

    expect(blocks.length).toBe(2);
    expect(blocks[0]!).toContain("  p2 the-doc");
    expect(blocks[1]!).toStrictEqual(
      recipeFailureRefusalLines({
        verdict: { kind: "refused", rows: [{ id: NOTION, repoless: true, standing: "blocked" }] },
      }),
    );
  });

  it("refuses a reconciliation it cannot read, naming the re-run, rather than passing it", () => {
    const { fleet: _fleet, ...unsaid } = NOTION_UNSEATED;
    const blocks = tickRecordRefusals({
      approvedDrafts: NO_DRAFTS,
      capacity: OWED,
      draft: FREE_DRAFT,
      open: { ...ALL_SHUT, idle: true, sweep: true },
      reconciliation: unsaid,
      steers: NO_STEERS,
      voice: CLEAN,
    });

    expect(blocks.length).toBe(1);
    expect(blocks[0]![0]!).toContain(
      "the unseated-recipe-failure gate could not judge this tick — the reconciliation does not say whether its " +
        "fleet was observed",
    );
    expect(blocks[0]!.at(-1)!).toContain("Re-run `slopweaver handover reconcile --json` with this checkout");
  });

  it("is answered by a completed spawn onto the finding", () => {
    const spawned: SupervisorTickDraft = {
      ...FREE_DRAFT,
      actions: [
        {
          kind: "spawned",
          label: "notion resync repair",
          outcome: "completed",
          subject: { id: NOTION, kind: "handover" },
        },
      ],
    };

    expect(
      tickRecordRefusals({
        approvedDrafts: NO_DRAFTS,
        capacity: OWED,
        draft: spawned,
        open: { ...ALL_SHUT, idle: true, sweep: true },
        reconciliation: NOTION_UNSEATED,
        steers: NO_STEERS,
        voice: CLEAN,
      }),
    ).toStrictEqual([]);
  });

  it("lets its own hatch silence its block and nothing else", () => {
    const blocks = tickRecordRefusals({
      approvedDrafts: NO_DRAFTS,
      capacity: OWED,
      draft: FREE_DRAFT,
      open: { ...ALL_SHUT, recipeFailures: true, sweep: true },
      reconciliation: NOTION_UNSEATED,
      steers: NO_STEERS,
      voice: CLEAN,
    });

    expect(blocks.length).toBe(1);
    expect(blocks[0]!).toContain("  p2 the-doc");
  });
});

describe("recipeFailureRefusalLines", () => {
  it("renders the hatch's four lines, each row with the commands that seat it, and the way through — line for line", () => {
    const vanta = "recipe-failing-resync-atlas-vanta-2026-10-12t02-00-00.000z-a1";

    expect(
      recipeFailureRefusalLines({
        verdict: {
          kind: "refused",
          rows: [
            { id: NOTION, repoless: true, standing: "blocked" },
            { id: vanta, repoless: false, standing: "ready" },
          ],
        },
      }),
    ).toStrictEqual([
      ...hatchRefusalLines({
        detail: "this tick read 2 broken automation finding(s) with no seat, no spawn and no reason",
        hatch: hatchFor({ id: "unseated-recipe-failure" }),
      }),
      `  ${NOTION} (blocked, names no repo: — cmux spawn refuses it until it does)`,
      `    slopweaver handover set-repo ${NOTION} --repo <main checkout>`,
      `    slopweaver cmux spawn ${NOTION} --model opus`,
      `  ${vanta} (ready)`,
      `    slopweaver cmux spawn ${vanta} --model opus`,
      'Record each spawn as a `spawned` action whose subject is {"kind":"handover","id":"<slug>"}, or record a ' +
        "hold-rationale judgement with that subject saying why this tick leaves the broken automation unrepaired. " +
        "Capacity is not a reason on its own here: a failing integration is owed a seat whatever the machine says.",
    ]);
  });
});

describe("approvedDraftRefusalLines", () => {
  it("renders the hatch's four lines, each owed draft with its release command, and the ways through", () => {
    expect(
      approvedDraftRefusalLines({
        answers: new Map(),
        verdict: {
          drafts: [APPROVED],
          kind: "refused",
          landings: [],
          skippedLines: 2,
          unreadApproved: [],
          unreadableLandings: [],
          unsureIds: [],
        },
      }),
    ).toStrictEqual([
      ...hatchRefusalLines({
        detail:
          "1 held Slack draft(s), recorded before this tick started, already carry the owner's approval and are unsent " +
          "with no hold saying why — the owner's yes on a call is the send, never a reason to ask again",
        hatch: hatchFor({ id: "approved-draft-held" }),
      }),
      '  sd-0a1b2c3d recorded 2026-09-21T00:06:00.000Z, approved at talk-call:541f50a8-0000-4000-8000-000000000001#turn_SendIt "Fuck, that is an excellent draft. Love it. Send it"',
      "    slopweaver slack reply --as me --draft sd-0a1b2c3d --approve 0123456789abcdef0123456789abcdef",
      "For EACH approved row: the owner's yes is settled, never re-read as not one (`hold --reason not-owner-yes` is refused " +
        "on it until a newer word from the owner lands on its card), so release it with the command shown. A mechanical fix first (em-dash, drip split, wrong tag, lowercase, a clickable link) is yours without asking: " +
        "re-cut with `slopweaver slack draft record --supersedes <id>` and the approval carries. Only a change of " +
        'meaning earns the owner\'s word again: re-cut with `--supersedes <id> --meaning-changed "<what>"`. A send blocked on ' +
        "something real is a hold the Queue card shows the owner: `slopweaver slack draft hold <id> --reason " +
        '<thread-moved|no-fleet-slot|slack-refused> --why "<what blocks it>"`.',
      "2 line(s) of the draft register did not read with this build: one that is not JSON at all is unseen by this " +
        "gate, never proof none is owed.",
      "Re-run this.",
    ]);
  });

  it("names a landing's card, the owner's words, the cut that stands and the approve line", () => {
    const { approval: _approval, ...words } = APPROVED.draft;
    const live: SlackDraftItem = { ...APPROVED, draft: { ...words, id: "sd-c57b4ade" }, id: "sd-c57b4ade" };
    const landing: CardLandedRow = {
      anchor: "talk-call:f9e9277d#12",
      atIso: "2026-10-08T00:16:55.000Z",
      cardKey: "ask:organisation-hunt-2026-10-07",
      decidedIso: "2026-10-08T00:16:54.000Z",
      kind: "landed",
      source: "transcript",
      words: "Yes, send it today",
      workSlug: "organisation-hunt-2026-10-07",
    };
    const answer: AnswerContext = {
      triage: { kind: "not-applicable" },
      voice: {
        kind: "found",
        turn: { beganIso: "2026-10-08T00:16:40.000Z", pointer: "talk-call:f9e9277d#11", text: "Want me to send it?" },
      },
    };
    const lines = approvedDraftRefusalLines({
      answers: new Map([["talk-call:f9e9277d#12", answer]]),
      verdict: {
        drafts: [],
        kind: "refused",
        landings: [{ item: live, landing, namedId: "sd-e8de7674" }],
        skippedLines: 0,
        unreadApproved: [],
        unreadableLandings: [
          { landing: { ...landing, cardKey: "hand:h-1" }, ledgerRow: 1, why: "2 hand-register lines did not read" },
        ],
        unsureIds: [],
      },
    });

    expect(lines.slice(4)).toStrictEqual([
      '  ask:organisation-hunt-2026-10-07 — the owner said "Yes, send it today" at talk-call:f9e9277d#12 (2026-10-08T00:16:54.000Z)',
      `    answering the voice's "Want me to send it?" (talk-call:f9e9277d#11)`,
      "    triage verdict: none — no relay carried these words, so none ruled on them",
      "    on sd-c57b4ade (the card names sd-e8de7674; this is the cut that stands), recorded 2026-09-21T00:06:00.000Z",
      "    yes: slopweaver slack draft approve sd-c57b4ade --anchor talk-call:f9e9277d#12",
      '    not: slopweaver slack draft hold sd-c57b4ade --reason not-owner-yes --why "<what they meant>"',
      '  hand:h-1 — the owner said "Yes, send it today" at talk-call:f9e9277d#12 (2026-10-08T00:16:54.000Z)',
      `    answering the voice's "Want me to send it?" (talk-call:f9e9277d#11)`,
      "    triage verdict: none — no relay carried these words, so none ruled on them",
      "    UNREADABLE: 2 hand-register lines did not read",
      "For EACH landing: read the owner's words above against the voice turn they answered and the relay's triage verdict, " +
        "never alone — a bare yes answers a question, and the question decides what it means. The command matching " +
        'the verdict is listed first. Not the owner\'s yes ("not yet", a question, about something else, or yes to "needs ' +
        'more info?"): `slopweaver slack draft hold <id> --reason not-owner-yes --why "<what they meant>"`. The owner\'s yes ' +
        'to the draft: `slopweaver slack draft approve <id> --anchor "<anchor>"`, then release it. A yes that is not ' +
        "sendable: approve it, then `slopweaver slack draft hold <id> --reason <thread-moved|no-fleet-slot|" +
        'slack-refused> --why "<what blocks it>"`. Every hold is printed on the owner\'s Queue card. An UNREADABLE card: fix ' +
        "what it names, or rebuild this seat on current main (`slopweaver dev build`).",
      "Re-run this.",
    ]);
    expect(lines[0]!).toContain("words landed on 2 card(s) naming a Slack draft and no session has judged them");
  });
});

describe("steerRefusalLines", () => {
  it("renders the hatch's four lines, each owed steer, and the way through — line for line", () => {
    expect(
      steerRefusalLines({ verdict: { kind: "refused", steers: [MISSED], undated: [], undecodedRelays: 0 } }),
    ).toStrictEqual([
      ...hatchRefusalLines({
        detail:
          "1 steer(s) the owner spoke over a Queue card registered before this tick started and carry no action, so " +
          "recording it puts each back on the owner's Queue as Not picked up",
        hatch: hatchFor({ id: "unpicked-steers" }),
      }),
      '  2026-09-21T00:10:00.000Z talk:a0000039-0000-4000-8000-000000000042 on ask:the-card (row talk-a00000390000, missed-pass) "ship the fix tonight"',
      "For EACH, act on the owner's words, then leave the witness: `slopweaver supervisor intake-mark --turn talk:<turnId> " +
        '--as card|answered|no-ask --witness "<what it became>"` (it clears every state above, a card that no longer ' +
        "exists included), or `slopweaver handover settle <row> --as answered|filed --witness <…>`, or take its row up " +
        "with `handover claim`/`start`. Never mark one you did not act on — the Queue reads that mark as done. Re-run this.",
    ]);
  });

  it("caps the steers it quotes, still names every one past the cap, and names the residue", () => {
    const steers = Array.from({ length: 13 }, (_, index) => ({ ...MISSED, turnId: `turn-${String(index)}` }));
    const undated = { ...MISSED, registeredAtIso: "garbled", turnId: "undated" };
    const lines = steerRefusalLines({ verdict: { kind: "refused", steers, undated: [undated], undecodedRelays: 2 } });

    expect(lines.filter((line) => line.includes(", missed-pass)")).length).toBe(10);
    expect(lines).toContain(
      `  … and 3 more, unquoted: talk:turn-10 (row ${MISSED.relaySlug}), talk:turn-11 (row ${MISSED.relaySlug}), ` +
        `talk:turn-12 (row ${MISSED.relaySlug})`,
    );
    expect(lines).toContain('  talk:undated on ask:the-card registered at "garbled", which does not parse');
    expect(lines).toContain(
      "2 line(s) of talk/relays.jsonl did not decode: a steer on one of them is unseen by this gate, never proof none " +
        "is owed.",
    );
  });

  it("refuses an unreadable read rather than passing it, naming why", () => {
    const lines = steerRefusalLines({ verdict: { kind: "unreadable", why: "talk/relays.jsonl did not read" } });

    expect(lines[0]!).toContain("could not be judged — talk/relays.jsonl did not read");
    expect(lines.at(-1)!).toContain("a check that reports clean on an input it never saw is worse than no check");
  });
});

/** The fill fields of a refusal whose capture measured no working-seat ceiling. */
const NO_SEAT_CEILING = {
  ceilingMeasurementProblem: null,
  seatsOwed: null,
  workingSeatCeiling: null,
  workingSeats: null,
} as const;

describe("idleRefusalLines", () => {
  it("renders the hatch's four lines, each row, and the ways out — line for line", () => {
    const lines = idleRefusalLines({
      verdict: {
        ...NO_SEAT_CEILING,
        bindingCeilingId: null,
        ceilings: null,
        kind: "refused",
        load1: 3.77,
        rows: [{ id: "the-doc", priority: "p1" }],
        workspaceSpawns: 0,
      },
    });

    expect(lines).toStrictEqual([
      ...hatchRefusalLines({
        detail:
          "this tick read NO hold (1-minute load 3.77) and left 1 groomed ready p0–p2 doc or ask row(s) with no seat, no spawn and no reason",
        hatch: hatchFor({ id: "idle-capacity" }),
      }),
      "  p1 the-doc",
      "For EACH row, one of: `slopweaver cmux spawn <slug> --model <model>`, recorded as a `spawned` action whose " +
        'subject is {"kind":"handover","id":"<slug>"}; take it off RUN NOW (`slopweaver handover pause <slug> --on ' +
        "<who>`, or close it) and re-run `slopweaver handover reconcile --json` into this tick's --reconcile; or a " +
        'hold-rationale judgement whose subject is {"kind":"handover","id":"<slug>"} saying why this tick left it. ' +
        "A `role: supervisor` row is NAMED, never spawned.",
    ]);
  });

  it("caps the rows it prints and counts the rest", () => {
    const rows = Array.from({ length: IDLE_ROWS_SHOWN + 3 }, (_, index) => ({
      id: `doc-${String(index + 1)}`,
      priority: "p2" as const,
    }));
    const lines = idleRefusalLines({
      verdict: {
        ...NO_SEAT_CEILING,
        bindingCeilingId: null,
        ceilings: null,
        kind: "refused",
        load1: 5,
        rows,
        workspaceSpawns: 2,
      },
    });

    expect(lines.filter((line) => line.startsWith("  p2 doc-")).length).toBe(IDLE_ROWS_SHOWN);
    expect(lines.find((line) => line.startsWith("  … and 3 more — list them with"))!).toBe(
      "  … and 3 more — list them with `slopweaver handover reconcile --json | jq -r '.ready[] | " +
        'select((.kind == "doc" or .kind == "ask") and .groomed and (.priority == "p0" or .priority == "p1" or ' +
        '.priority == "p2")) | .id\'`, less any a seat is already on',
    );
    expect(lines.at(-1)!).toBe(
      '2 spawned action(s) name a workspace ({"kind":"session"}) rather than a row, so they answer no row here — ' +
        're-record each with subject {"kind":"handover","id":"<slug>"} and the workspace in its label.',
    );
  });

  it("with ceilings, prints the reading after the hatch and asks for a reason naming the binding ceiling", () => {
    const ceilings = buildCeilingsReading({
      machine: { hold: false, holdSubjects: [], idlePct: null, load1: 11, loadHold: 22 },
      observedAtIso: "2026-09-28T09:00:00.000Z",
      plans: { claude: [], codex: [], codexRoutedAlias: null, problems: [] },
    });
    const lines = idleRefusalLines({
      verdict: {
        ...NO_SEAT_CEILING,
        bindingCeilingId: "machine",
        ceilings,
        kind: "refused",
        load1: 11,
        rows: [{ id: "the-doc", priority: "p1" }],
        workspaceSpawns: 0,
      },
    });
    const hatch = hatchRefusalLines({
      detail:
        "this tick read headroom on every ceiling of a route, the lowest machine and left 1 groomed ready p0–p2 doc or ask " +
        "row(s) with no seat, no spawn and no reason",
      hatch: hatchFor({ id: "idle-capacity" }),
    });

    expect(lines.slice(0, hatch.length)).toStrictEqual(hatch);
    expect(lines.slice(hatch.length, hatch.length + 2)).toStrictEqual([
      "ceilings: lowest unused is machine — no plan could be read, so the machine alone admits a seat",
      "  machine open, 50% unused — load1 11/22",
    ]);
    expect(lines.at(-1)!).toContain(
      'a hold-rationale judgement whose subject is {"kind":"handover","id":"<slug>"} AND whose relatedSubjects ' +
        'carries {"kind":"ceiling","id":"machine","label":"<why that ceiling does not take this row>"}',
    );
  });

  it("below a measured seat ceiling, names the fill and the first rows owed, and refuses a Claude-ceiling reason", () => {
    const lines = idleRefusalLines({
      verdict: {
        bindingCeilingId: null,
        ceilingMeasurementProblem: null,
        ceilings: null,
        kind: "refused",
        load1: 3.77,
        rows: [{ id: "the-doc", priority: "p1" }],
        seatsOwed: 15,
        workingSeatCeiling: 20,
        workingSeats: 5,
        workspaceSpawns: 0,
      },
    });

    expect(lines).toStrictEqual([
      ...hatchRefusalLines({
        detail:
          "this tick read 5 working seat(s) against a measured ceiling of 20 (`slopweaver fleet ceiling`), so the " +
          "first 15 ready row(s) each needed a spawn or to leave RUN NOW, and left 1 groomed ready p0–p2 doc or ask " +
          "row(s) with no seat, no spawn and no reason",
        hatch: hatchFor({ id: "idle-capacity" }),
      }),
      "A hold-rationale naming a Claude ceiling cannot answer this arm: below the measured seat ceiling the plans " +
        "are not what binds. A spawn of a lower row does not answer a higher one.",
      "  p1 the-doc",
      "For EACH row, one of: `slopweaver cmux spawn <slug> --model <model>`, recorded as a `spawned` action whose " +
        'subject is {"kind":"handover","id":"<slug>"}; take it off RUN NOW (`slopweaver handover pause <slug> --on ' +
        "<who>`, or close it) and re-run `slopweaver handover reconcile --json` into this tick's --reconcile; or a " +
        'hold-rationale judgement whose subject is {"kind":"handover","id":"<slug>"} AND whose relatedSubjects ' +
        'carries {"kind":"ceiling","id":"machine","label":"<what held the machine>"} — the only ceiling that answers ' +
        "here. A `role: supervisor` row is NAMED, never spawned.",
    ]);
  });

  it("with an unmeasurable seat ceiling, says the tick cannot claim a number", () => {
    const lines = idleRefusalLines({
      verdict: {
        ...NO_SEAT_CEILING,
        bindingCeilingId: null,
        ceilingMeasurementProblem: "no seat was working while the plans were being read",
        ceilings: null,
        kind: "refused",
        load1: 3.77,
        rows: [{ id: "the-doc", priority: "p1" }],
        workspaceSpawns: 0,
      },
    });

    expect(lines).toContain(
      "The working-seat ceiling was not measured (no seat was working while the plans were being read), so every " +
        "ready row is owed as before and this tick cannot claim it filled to a number.",
    );
  });
});

describe("voiceRefusalLines", () => {
  it("renders the hatch's four lines, each unread word, and the way through — line for line", () => {
    expect(voiceRefusalLines({ verdict: UNREAD })).toStrictEqual([
      ...hatchRefusalLines({
        detail:
          "1 stretch(es) of the owner's speech on a call are unread by the supervisor — finished, or a stretch still being " +
          "spoken that nobody has read the start of, whose call ended, or that stopped growing",
        hatch: hatchFor({ id: "unread-voice-words" }),
      }),
      '  2026-09-26T04:10:01.100Z talk-call:a0000035-0000-4000-8000-000000000038#segment_0_163 "put the policy proposal in Notion"',
      "Run `slopweaver talk unread`, read each for an explicit or IMPLIED steer and rule, register or " +
        "`supervisor intake-mark --turn talk-call:…` it, then `slopweaver talk unread --mark` — which prints what it " +
        "records as read, so act on anything new it shows — and re-run this.",
    ]);
  });

  it("lists a stretch still being spoken apart from the refusing words, as not refusing", () => {
    const lines = voiceRefusalLines({ verdict: { ...UNREAD, stillSpoken: [GROWING] } });

    expect(lines.slice(-3, -1)).toStrictEqual([
      "1 stretch(es) of the owner's speech are still being spoken, or inside the two-minute quiet floor, and do not refuse " +
        "this tick — each stays unread, and refuses a later tick once the floor has passed and it is final, its call " +
        "ends, or it stops growing:",
      '  2026-10-01T15:30:04.000Z talk-call:a0000053-0000-4000-8000-000000000056#turn_000000000000000000003 "I can actually see some of the things I\'ve said in there"',
    ]);
  });

  it("refuses an unreadable read rather than passing it, naming why", () => {
    const lines = voiceRefusalLines({ verdict: { kind: "unreadable", why: "call x's file was rewritten" } });

    expect(lines[0]!).toContain("the call files could not be read for unread words — call x's file was rewritten");
    expect(lines.at(-1)!).toContain("a check that reports clean on an input it never saw is worse than no check");
  });

  it("refuses a never-marked cursor, naming the first-read window and the two ways past it", () => {
    const lines = voiceRefusalLines({
      verdict: { kind: "refused", neverMarked: true, stillSpoken: [], unparseable: [], words: [] },
    });

    expect(lines[0]!).toContain("`talk unread` cursor has never been marked");
    expect(lines.at(-1)!).toContain("`--mark --adopt` when they were already read");
  });
});
