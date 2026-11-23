/*
 * The mid-investigation report and the owner's note-or-Queue criterion. The
 * routing table is the owner's own worked examples, each with the urgency a seat would pick for it.
 */
import { describe, expect, it } from "vitest";

import { parseHandPostArgs } from "../../../cli/commands/hand/core.js";
import { parseHandoverRegisterArgs } from "../../../cli/commands/handover/askRowArgs.js";
import {
  buildMidStateSurface,
  type MidStateReport,
  type MidStateUrgency,
  midStateReportMarkdown,
  midStateRoute,
} from "../../../hand/midState.js";
import { midStateStepId } from "../../../hand/midStateCommands.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const BREAKING: MidStateUrgency = {
  breaks: "every merge to main stays queued",
  by: "now",
  kind: "breaking",
  noteWhat: "Ask Rosa for read access to the org's Actions runner settings, so merges can run again",
};

const report = (over: Partial<MidStateReport> = {}): MidStateReport => ({
  access: {
    holder: "Rosa",
    what: "read access to the org's Actions runner settings",
    wouldSettle: "whether the runner pool is empty or the jobs are mislabelled",
  },
  askSlug: "actions-runner-outage-access",
  codex: "Codex read the same docs and agrees a queued job should be picked up",
  context: "work",
  decision: {
    blastRadius: "every engineer merging today",
    evidence: ["https://github.com/acme/acme-admin/actions/runs/1", "runner label ubuntu-latest-8"],
    lean: "ask Rosa for the access now",
    observedBy: "workspace:77",
    optionsText:
      "ask Rosa for read access :: one message to the owner\nkeep pulling without it :: hours, maybe no answer",
    problem: "Jobs sit queued although the docs say a runner picks them up",
    question: "Should Rosa be asked for read on the runner settings?",
    risk: "merges stay blocked while we guess",
    stillReal: "the latest run is still queued",
  },
  docs: ["https://docs.github.com/en/actions/hosting-your-own-runners"],
  documented: "a queued job is picked up by a matching runner",
  hedge: "email GitHub support now while we keep pulling",
  observed: "jobs sit queued with no runner assigned",
  row: "actions-runner-outage",
  tried: ["re-ran the failed jobs", "checked the runner labels in the workflow"],
  urgency: BREAKING,
  why: "I do not know why",
  ...over,
});

describe("midStateRoute — the owner's worked examples", () => {
  const cases: readonly { example: string; urgency: MidStateUrgency; route: "note" | "queue" }[] = [
    { example: "a subscription nobody can say is used, no deadline", route: "queue", urgency: { kind: "none" } },
    {
      example: "the subscription renews tomorrow for $12k, cancellation today",
      route: "note",
      urgency: { breaks: "a $12k renewal", by: "today", kind: "breaking", noteWhat: "Say who uses the tool" },
    },
    { example: "an Actions runner outage, the team blocked", route: "note", urgency: BREAKING },
    {
      example: "every seat waiting on one decision",
      route: "note",
      urgency: { kind: "fleet-idle", noteWhat: "Pick the store layout" },
    },
    {
      example: "the orb designs the owner is keen to see",
      route: "note",
      urgency: { kind: "keen", noteWhat: "Pick your favourite orb designs" },
    },
    { example: "a design pick the owner has not said they are keen on", route: "queue", urgency: { kind: "none" } },
    { example: "a new steer while every seat is busy", route: "queue", urgency: { kind: "none" } },
    {
      example: "a send the owner approved, low priority, stopped on a sign-in only the owner does",
      route: "note",
      urgency: { kind: "blocked-send", noteWhat: "Sign in to Gmail", send: "the approved reply to the supplier" },
    },
    {
      example: "payment failures rise sharply, customer impact not yet known",
      route: "note",
      urgency: {
        ifSilent: "customers may be failing to pay while nobody tells the owner",
        kind: "close-call",
        noteWhat: "Read the payment-failure report: impact still unknown",
      },
    },
    {
      example: "a steer of the owner's the fleet cannot act on",
      route: "note",
      urgency: {
        ifSilent: "the owner's steer sits undone and they find out days later",
        kind: "close-call",
        noteWhat: "Say whether to drop the steer or grant what it needs",
      },
    },
  ];

  it.each(cases)("$example → $route", ({ urgency, route }) => {
    expect(midStateRoute({ urgency }).kind).toBe(route);
  });

  it("says why a Queue-only report is not urgent, and that the seat parks it", () => {
    expect(midStateRoute({ urgency: { kind: "none" } }).reason).toContain("the seat parks this thread");
  });

  it("names what silence risks on a close call, the owner's risk-based tie-breaker", () => {
    expect(
      midStateRoute({ urgency: { ifSilent: "an account lapses unpaid", kind: "close-call", noteWhat: "Say" } }).reason,
    ).toBe("pushed as a floating note: unsaid, an account lapses unpaid; when the two risks are close, surface");
  });

  it("names what breaks and by when on a breaking note", () => {
    expect(midStateRoute({ urgency: BREAKING }).reason).toBe(
      "pushed as a floating note: every merge to main stays queued by now, and the owner's act can still change it",
    );
  });
});

describe("midStateReportMarkdown", () => {
  it("prints the honest report in the owner's order, the why verbatim", () => {
    expect(midStateReportMarkdown({ report: report() })).toBe(
      [
        "## Mid-investigation: actions-runner-outage",
        "",
        "- **Tried:**",
        "  - re-ran the failed jobs",
        "  - checked the runner labels in the workflow",
        "- **Docs followed:**",
        "  - https://docs.github.com/en/actions/hosting-your-own-runners",
        "- **The docs say:** a queued job is picked up by a matching runner",
        "- **What happens instead:** jobs sit queued with no runner assigned",
        "- **Codex cross-check:** Codex read the same docs and agrees a queued job should be picked up",
        "- **Why:** I do not know why",
        "- **In parallel:** email GitHub support now while we keep pulling",
        "- **Access that would settle it:** read access to the org's Actions runner settings, held by Rosa — " +
          "whether the runner pool is empty or the jobs are mislabelled",
        "- **Route:** pushed as a floating note: every merge to main stays queued by now, and the owner's act can still change it",
      ].join("\n"),
    );
  });

  it("leaves out the hedge and access rows rather than printing placeholders", () => {
    const { access: _access, hedge: _hedge, ...bare } = report();
    const text = midStateReportMarkdown({ report: bare });
    expect([text.includes("In parallel"), text.includes("Access that would settle it")]).toEqual([false, false]);
  });
});

describe("buildMidStateSurface — the Queue line", () => {
  it("is a shaped handover register --finding, never a pausing ask, and round-trips through its parser", () => {
    const surface = unwrap(buildMidStateSurface({ report: report({ urgency: { kind: "none" } }) }));
    expect(surface.queue.argv.slice(0, 3)).toEqual(["slopweaver", "handover", "register"]);
    expect(unwrap(parseHandoverRegisterArgs({ rest: surface.queue.argv.slice(3) })).values).toEqual({
      ask: "Should Rosa be asked for read on the runner settings?",
      "blast-radius": "every engineer merging today",
      evidence: "https://github.com/acme/acme-admin/actions/runs/1,runner label ubuntu-latest-8",
      finding: true,
      lean: "ask Rosa for the access now",
      "observed-by": "workspace:77",
      options:
        "ask Rosa for read access :: one message to the owner\nkeep pulling without it :: hours, maybe no answer",
      problem: "Jobs sit queued although the docs say a runner picks them up",
      risk: "merges stay blocked while we guess",
      slug: "actions-runner-outage-access",
      "still-real": "the latest run is still queued",
    });
  });

  it("prints no note on a Queue-only report", () => {
    const surface = unwrap(buildMidStateSurface({ report: report({ urgency: { kind: "none" } }) }));
    expect([surface.route.kind, surface.note]).toEqual(["queue", undefined]);
  });
});

describe("buildMidStateSurface — the note line", () => {
  it("is a checked hand post opening the Queue row, owned by it, and blocking", () => {
    const surface = unwrap(buildMidStateSurface({ report: report({ bySession: "workspace:77" }) }));
    expect(unwrap(parseHandPostArgs({ rest: surface.note!.argv.slice(3) })).values).toEqual({
      blocks: true,
      "by-session": "workspace:77",
      context: "work",
      id: "mid-state-actions-runner-outage-access",
      open: "ask:actions-runner-outage-access",
      row: "actions-runner-outage-access",
      unblocks: "board row actions-runner-outage: every merge to main stays queued by now",
      what: "Ask Rosa for read access to the org's Actions runner settings, so merges can run again",
      witness: "slopweaver hand done mid-state-actions-runner-outage-access --did answered-on-queue",
    });
  });

  it("keeps the Queue line beside it, so the note always has a card to open", () => {
    const surface = unwrap(buildMidStateSurface({ report: report() }));
    expect([surface.route.kind, surface.queue.argv[2], surface.note!.argv[2]]).toEqual(["note", "register", "post"]);
  });

  it("says what waits per note kind", () => {
    const idle = unwrap(
      buildMidStateSurface({ report: report({ urgency: { kind: "fleet-idle", noteWhat: "Pick the layout: store" } }) }),
    );
    const keen = unwrap(
      buildMidStateSurface({
        report: report({ urgency: { kind: "keen", noteWhat: "Pick your favourite orb: talk" } }),
      }),
    );
    const send = unwrap(
      buildMidStateSurface({
        report: report({
          urgency: { kind: "blocked-send", noteWhat: "Sign in to Gmail, so it can send", send: "the supplier reply" },
        }),
      }),
    );
    const close = unwrap(
      buildMidStateSurface({
        report: report({ urgency: { ifSilent: "an account lapses", kind: "close-call", noteWhat: "Say whether" } }),
      }),
    );
    const unblocks = ({ argv }: { argv: readonly string[] }): string | undefined =>
      argv[argv.indexOf("--unblocks") + 1];
    expect([idle, keen, send, close].map((surface) => unblocks({ argv: surface.note!.argv }))).toEqual([
      "board row actions-runner-outage, and every seat waiting on this answer",
      "board row actions-runner-outage, which you said you are keen to see",
      "board row actions-runner-outage: the supplier reply, which you already approved",
      "board row actions-runner-outage, before an account lapses",
    ]);
  });

  it("refuses a note sentence that names the fleet as the actor, by the register's own rule", () => {
    const refused = unwrapErr(
      buildMidStateSurface({
        report: report({ urgency: { kind: "keen", noteWhat: "The session will rerun the jobs" } }),
      }),
    );
    expect(refused.code).toBe("FLEET_CAN_DO_IT");
  });

  it("cuts a long id to the register's limit without a dangling separator", () => {
    expect(midStateStepId({ askSlug: `${"a".repeat(49)}-bcd` })).toBe(`mid-state-${"a".repeat(49)}`);
  });
});

describe("buildMidStateSurface — refusals", () => {
  it("refuses an empty tried list", () => {
    const refused = unwrapErr(buildMidStateSurface({ report: report({ tried: [] }) }));
    expect(refused.message).toBe("tried needs at least one entry");
  });

  it("refuses an ask slug that is the investigation's own row, which would not be a new card", () => {
    const refused = unwrapErr(buildMidStateSurface({ report: report({ askSlug: "actions-runner-outage" }) }));
    expect(refused.message).toContain("names the investigation's own row");
  });

  it("refuses a line past the cap", () => {
    const refused = unwrapErr(buildMidStateSurface({ report: report({ why: "x".repeat(321) }) }));
    expect(refused.message).toBe("why is 321 characters, past the 320 one line may carry");
  });

  it("refuses an evidence entry carrying a comma, which register would split", () => {
    const base = report();
    const refused = unwrapErr(
      buildMidStateSurface({ report: report({ decision: { ...base.decision, evidence: ["a, b"] } }) }),
    );
    expect(refused.message).toContain('"a, b" carries a comma');
  });

  it("refuses a question that does not ask, which register's card-alignment gate would refuse", () => {
    const base = report();
    const refused = unwrapErr(
      buildMidStateSurface({ report: report({ decision: { ...base.decision, question: "Ask Rosa" } }) }),
    );
    expect([refused.code, refused.message]).toEqual([
      "INVALID_FIELD",
      expect.stringContaining('ends in "?", so the card\'s heading would TELL the owner'),
    ]);
  });

  it("refuses a note step opening with --, which hand post's own parser reads as a missing --what", () => {
    expect(unwrapErr(parseHandPostArgs({ rest: ["--what", "--json"] }))).toEqual(["--what requires a value"]);
    const refused = unwrapErr(
      buildMidStateSurface({ report: report({ urgency: { kind: "keen", noteWhat: "--json" } }) }),
    );
    expect([refused.code, refused.message]).toEqual(["INVALID_FIELD", expect.stringContaining("note-what")]);
  });

  it("refuses a --by-session opening with --, which hand post's parser would refuse", () => {
    const refused = unwrapErr(buildMidStateSurface({ report: report({ bySession: "--json" }) }));
    expect([refused.code, refused.message]).toEqual(["INVALID_FIELD", expect.stringContaining("by-session")]);
  });

  it("refuses a register-only field opening with --, which register's parser would refuse", () => {
    const base = report();
    const refused = unwrapErr(
      buildMidStateSurface({ report: report({ decision: { ...base.decision, lean: "--json" } }) }),
    );
    expect([refused.code, refused.message]).toEqual(["INVALID_FIELD", expect.stringContaining("opens with --")]);
  });

  it("refuses a Queue shape with one option, by register's own rule", () => {
    const base = report();
    const refused = unwrapErr(
      buildMidStateSurface({
        report: report({ decision: { ...base.decision, optionsText: "ask Rosa :: a message" } }),
      }),
    );
    expect(refused.message).toContain("1 option(s)");
  });
});
