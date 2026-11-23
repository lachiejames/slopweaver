/**
 * The digest `tick open` prints: every reading derived into one line the chair acts on, a reading whose
 * budget ran out named as such, and a snapshot the render would refuse flagged before the chair writes a word.
 */
import { describe, expect, it } from "vitest";

import { CHAIR_LINE_PREFIX } from "../../../claude/chairBudgetAlert.js";
import { handRecheckLines, orgHealthLines } from "../../../supervisor/digestNotice.js";
import { type DigestReading, tickDigestLines } from "../../../supervisor/tickDigest.js";

/** Every input but the readings, as most cases hold them: pages and the owner's list fresh, no prior hold, the fix resolved. */
const QUIET: Omit<Parameters<typeof tickDigestLines>[0]["inputs"], "readings"> = {
  openPagesAgeMinutes: 10,
  priorHolds: { kind: "none" },
  recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
  runAgeMinutes: 5,
};

/**
 * The digest's gauge rows for a gauge that printed exactly this text, every other reading uncaptured.
 *
 * @param text what the gauge printed
 * @returns the digest lines that open `gauge`
 */
function gaugeRowsFor({ text }: { text: string }): readonly string[] {
  const readings = new Map<string, DigestReading>([["gauge", { kind: "text", text }]]);
  return tickDigestLines({ inputs: { ...QUIET, readings } }).filter((line) => line.startsWith("gauge"));
}

/** An `automation due --json` reading, its two declaration lists empty unless the case names them. */
const dueReading = (value: Record<string, unknown>): DigestReading => ({
  kind: "json",
  value: { missing: [], superseded: [], ...value },
});

const READINGS: ReadonlyMap<string, DigestReading> = new Map<string, DigestReading>([
  [
    "reconcile",
    { kind: "json", value: { headline: "Aligned.", intakeClause: "2 turns unwitnessed", starving: ["a", "b"] } },
  ],
  [
    "capacity",
    {
      kind: "json",
      value: {
        culprit: { kill: "kill 1", subject: "vitest", why: "hot" },
        hold: true,
        load: { load1: 30.2, load15: 10, load5: 20 },
        loadHold: 24,
      },
    },
  ],
  [
    "gauge",
    {
      kind: "text",
      text: "ok line\nPLAN plan-one: UNREAD — the provider answered 500\nREACT NOW: seat 4 idle\n",
    },
  ],
  [
    "recipe-due",
    dueReading({
      rejected: ["bad"],
      rows: [
        { due: true, recipeId: "r1" },
        { due: false, recipeId: "r2" },
      ],
      stranded: [],
    }),
  ],
  ["blocked", { kind: "json", value: [{ need: "decision", what: "merge #1415?" }, {}] }],
  ["standing", { kind: "json", value: { problems: [] } }],
  [
    "listen",
    { child: { durationMs: 60_004, kind: "timed-out", signal: "SIGKILL", timeoutMs: 60_000 }, kind: "unavailable" },
  ],
  [
    "fleet-health",
    {
      kind: "json",
      value: {
        actions: [
          {
            detail: "Check fleet health — syncs are dying mid-run",
            kind: "posted",
            monitorId: "fleet-unhealthy",
            stepId: "mon-health-deaths-0a1b2c",
          },
        ],
        readings: [{ monitorId: "fleet-unhealthy", state: "firing", subjects: [{ label: "2 died mid-run: r1, r2" }] }],
      },
    },
  ],
  [
    "org-health-read",
    { kind: "json", value: { historyPages: 1, snapshot: { incidents: [{ ref: "INC-98" }] }, threadsOpened: 1 } },
  ],
  [
    "org-health",
    {
      kind: "json",
      value: {
        actions: [
          {
            detail: "the note's key is malformed",
            kind: "refused",
            monitorId: "org-health",
            stepId: "mon-org-health-inc98",
          },
        ],
        readings: [{ monitorId: "org-health", state: "firing", subjects: [{ label: "INC-98 Critical · Pool" }] }],
      },
    },
  ],
  ["hold", { kind: "text", text: "merge hold: none\nmore" }],
  ["landing", { kind: "json", value: { kind: "skipped", nextDueAtIso: "2026-09-27T02:00:00Z", why: "not due" } }],
]);

/** The act-first lines a digest opens on when neither the Queue leader, the plans, the sidebar nor the ready list read. */
const UNREAD_HEAD: readonly string[] = [
  "queue leader: NOT READ — not captured this tick; what stops the owner's work is UNKNOWN this pass, not none",
  "boots refused: UNKNOWN — claude-plans: not captured this tick",
  "broken: no automation is held on a failure",
  "sidebar: UNKNOWN — freshness: not captured this tick",
  "seatable: UNKNOWN — reconcile carries no ready list",
  "held: UNKNOWN — the reconciliation carries no `rankedCount`",
];

describe("tickDigestLines", () => {
  it("derives one line per reading, in the order the chair acts on them", () => {
    const lines = tickDigestLines({
      inputs: {
        openPagesAgeMinutes: 120,
        priorHolds: { kind: "none" },
        readings: READINGS,
        recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
        runAgeMinutes: undefined,
      },
    });

    expect(lines).toEqual([
      ...UNREAD_HEAD,
      "reconcile: Aligned.",
      "intake: 2 turns unwitnessed",
      "starving: 2 ready item(s) with nobody on them — a, b",
      "machine: HOLD — load 30.2/20.0/10.0 against 24; culprit vitest (hot): kill 1",
      "events: not captured this tick",
      "turn sweep: NOT READ — not captured this tick; open dispatches are UNKNOWN this pass, not zero",
      "gauge: PLAN plan-one: UNREAD — the provider answered 500",
      "gauge: REACT NOW: seat 4 idle",
      "watch-report: not captured this tick",
      "depth: not captured this tick",
      "recipes: 1 due",
      "recipes band UNKNOWN: r1 — lateness UNKNOWN",
      "recipes: rejected bad",
      "blocked turns: 2",
      "blocked: decision — merge #1415?",
      "blocked: (no need) — (no what)",
      "listen: unavailable — timed out after 60s (killed)",
      "friction: not captured this tick",
      "close-done: not captured this tick",
      "hand-recheck: not captured this tick",
      "queue refusals: NOT READ — not captured this tick; withheld Queue cards are UNKNOWN this pass, not zero",
      "fleet health: TRIPPED — 2 died mid-run: r1, r2",
      "fleet health: posted mon-health-deaths-0a1b2c — Check fleet health — syncs are dying mid-run",
      "org-health-read: read whole — 1 incident(s) open or recently resolved",
      "org health: FIRING — INC-98 Critical · Pool",
      "org health: refused mon-org-health-inc98 — the note's key is malformed",
      "merge hold: merge hold: none",
      "landing: not due — next 2026-09-27T02:00:00Z",
      "open pages: 120 min old — past 90, the render refuses it; re-read each open page and set openPagesReviewed",
      "owner's list: none in this seat",
    ]);
  });

  it("names the other shape of each reading rather than dropping it", () => {
    const readings = new Map<string, DigestReading>([
      ["reconcile", { kind: "json", value: { intakeClause: "none", starving: [] } }],
      ["capacity", { kind: "json", value: { hold: false, load: { load1: 1 }, loadHold: 24 } }],
      ["gauge", { kind: "json", value: {} }],
      ["recipe-due", dueReading({ rejected: [], rows: [], stranded: ["r9", { id: "r8" }] })],
      ["blocked", { kind: "json", value: [] }],
      ["standing", { kind: "json", value: { problems: ["disk low"] } }],
      [
        "fleet-health",
        {
          kind: "json",
          value: {
            actions: [],
            readings: [
              { because: "the slot ledger would not list", monitorId: "fleet-unhealthy", state: "unmeasurable" },
            ],
          },
        },
      ],
      ["org-health-read", { child: { durationMs: 900, exitCode: 4, kind: "exited" }, kind: "unavailable" }],
      [
        "org-health",
        {
          kind: "json",
          value: {
            actions: [],
            readings: [{ because: "a read is under way", monitorId: "org-health", state: "unmeasurable" }],
          },
        },
      ],
      ["hold", { kind: "json", value: {} }],
      [
        "landing",
        {
          kind: "json",
          value: {
            dispatchable: [1, 2],
            kind: "read",
            presses: [
              { number: 7, outcome: "pressed", repoSlug: "o/r" },
              { detail: "blocked", number: 8, outcome: "failed", repoSlug: "o/r" },
            ],
            registrations: [{ number: 9, outcome: "registered", repoSlug: "o/r" }],
          },
        },
      ],
    ]);

    expect(tickDigestLines({ inputs: { ...QUIET, readings } })).toEqual([
      ...UNREAD_HEAD,
      "reconcile: (no headline field)",
      "intake: none",
      "starving: 0 ready item(s) with nobody on them",
      "machine: clear — load unreadable against 24",
      "events: not captured this tick",
      "turn sweep: NOT READ — not captured this tick; open dispatches are UNKNOWN this pass, not zero",
      "gauge: captured as JSON, not text",
      "watch-report: not captured this tick",
      "depth: not captured this tick",
      "recipes: none due",
      "recipes: stranded r9",
      'recipes: stranded {"id":"r8"}',
      "blocked turns: 0",
      "standing: disk low",
      "listen: not captured this tick",
      "friction: not captured this tick",
      "close-done: not captured this tick",
      "hand-recheck: not captured this tick",
      "queue refusals: NOT READ — not captured this tick; withheld Queue cards are UNKNOWN this pass, not zero",
      "fleet health: UNMEASURABLE — the slot ledger would not list",
      "org-health-read: unavailable — exit 4",
      "org health: UNMEASURABLE — a read is under way",
      "merge hold: captured as JSON, not text",
      "landing: read — 2 dispatchable, 1 pressed, 1 registered, 1 failed",
      "landing: #? (no repo) (no action) — (no detail)",
      "landing: #? (no repo) (no action) — (no detail)",
      "landing pressed: #7 o/r",
      "landing registered: #9 o/r",
      "landing failed: #8 o/r — blocked",
      "open pages: 10 min old",
      "owner's list: 5 min old",
    ]);
  });

  it("names the rows the chair used to pull out by hand, in the shapes tick-660 captured", () => {
    const readings = new Map<string, DigestReading>([
      [
        "reconcile",
        {
          kind: "json",
          value: {
            headline: "Aligned.",
            ready: [
              {
                id: "land-a",
                label: "acme/acme-admin#17560 needs a rebase",
                priority: "p1",
                ready: true,
                standing: "ready",
              },
              { id: "land-b", label: "x".repeat(120) },
            ],
            starving: [],
          },
        },
      ],
      [
        "capacity",
        {
          kind: "json",
          value: {
            hold: true,
            holdSubjects: ["session 4c27ef1a"],
            load: { load1: 41.6, load15: 20, load5: 30 },
            loadHold: 22,
            recentBoots: { boots: [{ sessionId: "aaaaaaaa-1111" }, {}], hold: 3, windowSeconds: 180 },
          },
        },
      ],
      [
        "events",
        {
          kind: "text",
          text:
            "alert\t2026-09-27T07:02:55Z\tmachine\tcapacity-hold\tcpu\tmachine capacity: HOLD on cpu\n" +
            "info\t2026-09-27T07:03:00Z\tmachine\tnote\tcpu\tnot an alert\n",
        },
      ],
      [
        "watch-report",
        {
          kind: "json",
          value: {
            rows: [
              { cwd: "/w/clerk-test-user-cleanup", quietMinutes: 57, signal: "needs-input" },
              { cwd: "/w/busy", quietMinutes: 1, signal: "working" },
              { cwd: "/w/quiet", quietMinutes: 12, signal: "silent" },
            ],
            suppressed: 2057,
          },
        },
      ],
      [
        "depth",
        {
          kind: "json",
          value: {
            rows: [
              {
                depth: { known: true, value: { depthTokens: 257_585 } },
                slug: "shallow",
                verdict: { known: true, value: "under-threshold" },
              },
              {
                depth: { known: true, value: { depthTokens: 712_400 } },
                slug: "deep-seat",
                verdict: { known: true, value: "respawn" },
              },
              { depth: { known: false }, slug: "unmeasured", verdict: { known: false } },
            ],
          },
        },
      ],
      [
        "close-done",
        {
          kind: "json",
          value: {
            counts: { closed: 1, driftClosed: 0, failed: 0, held: 0, kept: 1 },
            outcomes: [
              { item: { kind: "kept", row: { slug: "still-open" } }, kind: "kept" },
              { item: { kind: "candidate", row: { slug: "scheduled-asks-seat-86e35a65" } }, kind: "closed" },
            ],
          },
        },
      ],
      [
        "landing",
        {
          kind: "json",
          value: {
            dispatchable: [
              {
                action: "spawn-coderabbit",
                actionDetail: "1 unresolved CodeRabbit comment",
                number: 17927,
                repoSlug: "acme/acme-admin",
              },
            ],
            kind: "read",
            presses: [],
            registrations: [],
          },
        },
      ],
    ]);
    const lines = tickDigestLines({
      inputs: { ...QUIET, readings },
    });
    const about = ({ prefixes }: { prefixes: readonly string[] }): readonly string[] =>
      lines.filter((line) => prefixes.some((prefix) => line.startsWith(prefix)));

    expect(
      about({ prefixes: ["ready:", "machine:", "event", "watch", "depth:", "closed:", "kept:", "landing:"] }),
    ).toEqual([
      "ready: p1 land-a — acme/acme-admin#17560 needs a rebase",
      `ready: unprioritised land-b — ${"x".repeat(100)}…`,
      "machine: HOLD — load 41.6/30.0/20.0 against 22; 2 boot(s) in the last 180s (session aaaaaaaa, (no sessionId)); subjects session 4c27ef1a",
      "event: capacity-hold cpu — machine capacity: HOLD on cpu",
      "watch: needs-input 57m — clerk-test-user-cleanup",
      "watch: silent 12m — quiet",
      "watch: 2057 suppressed",
      "depth: deep-seat 712k respawn",
      "closed: scheduled-asks-seat-86e35a65",
      "kept: still-open",
      "landing: read — 1 dispatchable, 0 pressed, 0 registered, 0 failed",
      "landing: #17927 acme/acme-admin spawn-coderabbit — 1 unresolved CodeRabbit comment",
    ]);
  });

  it("says a quiet fleet in words, and counts what a list cuts", () => {
    const readings = new Map<string, DigestReading>([
      ["events", { kind: "text", text: "info\t2026-09-27T07:03:00Z\tmachine\tnote\tcpu\tnothing\n" }],
      [
        "watch-report",
        {
          kind: "json",
          value: {
            rows: Array.from({ length: 10 }, (_, index) => ({
              cwd: `/w/s${String(index)}`,
              quietMinutes: 5,
              signal: "silent",
            })),
            suppressed: 0,
          },
        },
      ],
      ["depth", { kind: "json", value: { rows: [] } }],
    ]);
    const lines = tickDigestLines({
      inputs: { ...QUIET, readings },
    });

    expect(lines.filter((line) => /^(events|watch|depth)/.test(line))).toEqual([
      "events: no alerts",
      "watch: silent 5m — s0",
      "watch: silent 5m — s1",
      "watch: silent 5m — s2",
      "watch: silent 5m — s3",
      "watch: silent 5m — s4",
      "watch: silent 5m — s5",
      "watch: silent 5m — s6",
      "watch: silent 5m — s7",
      "watch: and 2 more",
      "depth: every seat under threshold",
    ]);
  });

  it("names a field a drifted document dropped instead of printing undefined, and caps the rejected recipes", () => {
    const readings = new Map<string, DigestReading>([
      ["capacity", { kind: "json", value: { culprit: { subject: "cpu" } } }],
      [
        "recipe-due",
        dueReading({
          rejected: Array.from({ length: 9 }, (_, index) => `bad${String(index)}`),
          rows: [],
          stranded: [],
        }),
      ],
      ["listen", { kind: "json", value: {} }],
      ["close-done", { kind: "json", value: {} }],
      ["landing", { kind: "json", value: { kind: "skipped" } }],
    ]);
    const lines = tickDigestLines({
      inputs: { ...QUIET, readings },
    });

    expect(lines.filter((line) => /^(machine|recipes|listener|close-done|landing)/.test(line))).toEqual([
      "machine: clear — load unreadable; culprit cpu ((no why)): (no kill)",
      "recipes: none due",
      "recipes: rejected bad0",
      "recipes: rejected bad1",
      "recipes: rejected bad2",
      "recipes: rejected bad3",
      "recipes: rejected bad4",
      "recipes: rejected bad5",
      "recipes: rejected bad6",
      "recipes: rejected bad7",
      "recipes rejected: and 1 more",
      "listener: (no grade) — (no why)",
      "close-done: closed ?, parked ?, driftClosed ?, failed ?, held ?, kept ?",
      "landing: not due — next (no nextDueAtIso)",
    ]);
  });

  it("caps the standing problems and the gauge's REACT lines like every other list", () => {
    const nine = Array.from({ length: 9 }, (_, index) => `p${String(index)}`);
    const readings = new Map<string, DigestReading>([
      ["standing", { kind: "json", value: { problems: nine } }],
      ["gauge", { kind: "text", text: nine.map((one) => `REACT NOW: ${one}`).join("\n") }],
    ]);
    const lines = tickDigestLines({
      inputs: { ...QUIET, readings },
    });

    expect(lines.filter((line) => /^(standing|gauge)/.test(line))).toEqual([
      "gauge: the gauge printed no plan readings",
      "gauge: REACT NOW: p0",
      "gauge: REACT NOW: p1",
      "gauge: REACT NOW: p2",
      "gauge: REACT NOW: p3",
      "gauge: REACT NOW: p4",
      "gauge: REACT NOW: p5",
      "gauge: REACT NOW: p6",
      "gauge: REACT NOW: p7",
      "gauge: and 1 more",
      "standing: p0",
      "standing: p1",
      "standing: p2",
      "standing: p3",
      "standing: p4",
      "standing: p5",
      "standing: p6",
      "standing: p7",
      "standing: and 1 more",
    ]);
  });

  it("keeps the chair's near-wall line when the gauge printed no REACT NOW line", () => {
    const chair =
      "CHAIR — the supervisor chair spends plan-five, whose all-models week is at 99% (allowed), resets 2026-11-02T09:00:00.000Z: hand the chair to plan-three before it walls";

    expect(gaugeRowsFor({ text: `plan-five *  no 5h limit  99%\n${chair}\nnext fable spawn -> plan-three\n` })).toEqual(
      ["gauge: the gauge printed no plan readings", `gauge: ${chair}`],
    );
  });

  it("keeps every CHAIR line ahead of the capped REACT NOW lines, never folding one into the overflow count", () => {
    // A counterexample: nine chair lines ahead of a tenth pushed the last chair plan's
    // cap into "and 2 more", naming no plan.
    const chairLines = Array.from({ length: 10 }, (_, index) => `${CHAIR_LINE_PREFIX} chair plan c${String(index)}`);
    const reactLines = Array.from({ length: 9 }, (_, index) => `REACT NOW: r${String(index)}`);

    expect(gaugeRowsFor({ text: [...reactLines, ...chairLines].join("\n") })).toEqual([
      "gauge: the gauge printed no plan readings",
      ...chairLines.map((one) => `gauge: ${one}`),
      ...reactLines.slice(0, 8).map((one) => `gauge: ${one}`),
      "gauge: and 1 more",
    ]);
  });

  it("lifts EVERY plan line uncapped, ahead of the chair and capped react lines — read, unread and paused alike", () => {
    // The plan-five blind spot: a plan the tick printed no row for was spent to its wall.
    const planLines = [
      "PLAN plan-a: week 62% resets 2026-11-09T01:00:00.000Z · fable 0% resets 2026-11-09T01:00:00.000Z",
      "PLAN plan-b: UNREAD — the provider answered 500",
      "PLAN plan-c: PAUSED since 2026-11-01T00:00:00.000Z — resting",
      ...Array.from({ length: 7 }, (_, index) => `PLAN plan-x${String(index)}: UNREAD — no login`),
    ];
    const chair = `${CHAIR_LINE_PREFIX} the chair spends plan-b, whose reading failed`;
    const reactLines = Array.from({ length: 9 }, (_, index) => `REACT NOW: r${String(index)}`);

    expect(gaugeRowsFor({ text: ["header", ...reactLines, chair, ...planLines].join("\n") })).toEqual([
      ...planLines.map((one) => `gauge: ${one}`),
      `gauge: ${chair}`,
      ...reactLines.slice(0, 8).map((one) => `gauge: ${one}`),
      "gauge: and 1 more",
    ]);
  });

  it("lists the plans and then says nothing to react to when the gauge printed no chair or react line", () => {
    expect(gaugeRowsFor({ text: "PLAN plan-a: UNREAD — no login\n" })).toEqual([
      "gauge: PLAN plan-a: UNREAD — no login",
      "gauge: nothing to react to",
    ]);
  });

  it("names a landing reading captured as text instead of reading it", () => {
    const readings = new Map<string, DigestReading>([["landing", { kind: "text", text: "not json" }]]);
    const lines = tickDigestLines({
      inputs: { ...QUIET, readings },
    });

    expect(lines.filter((line) => line.startsWith("landing"))).toEqual(["landing: captured as text, not JSON"]);
  });

  it("says nothing about an open-pages file still inside the render's ceiling beyond its age", () => {
    const lines = tickDigestLines({
      inputs: {
        openPagesAgeMinutes: 30,
        priorHolds: { kind: "none" },
        readings: new Map(),
        recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
        runAgeMinutes: 5,
      },
    });

    expect(lines.filter((line) => line.startsWith("open pages") || line.startsWith("owner's list"))).toEqual([
      "open pages: 30 min old",
      "owner's list: 5 min old",
    ]);
  });

  it("names every due recipe up to the shared cap of eight", () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({ due: true, recipeId: `r${String(index)}` }));
    const readings = new Map<string, DigestReading>([["recipe-due", dueReading({ rows })]]);
    const lines = tickDigestLines({ inputs: { ...QUIET, readings } });

    expect(lines.filter((line) => line.startsWith("recipes"))).toEqual([
      "recipes: 9 due",
      ...Array.from({ length: 8 }, (_, index) => `recipes band UNKNOWN: r${String(index)} — lateness UNKNOWN`),
      "recipes due: and 1 more",
    ]);
  });

  it("orders due recipes by band, most late first, an unknown band last, each with how late it is", () => {
    const row = ({ band, id, lateByMs }: { band: string; id: string; lateByMs: number }): unknown => ({
      due: true,
      recipeId: id,
      tolerance: { band, lateByMs },
    });
    const rows = [
      row({ band: "comfortable", id: "calm", lateByMs: 60_000 }),
      row({ band: "sideways", id: "odd", lateByMs: 0 }),
      row({ band: "overdue", id: "notion", lateByMs: 7_200_000 }),
      row({ band: "urgent", id: "slack", lateByMs: 600_000 }),
      { due: false, recipeId: "not-due" },
    ];
    const readings = new Map<string, DigestReading>([["recipe-due", dueReading({ rows })]]);
    const lines = tickDigestLines({ inputs: { ...QUIET, readings } });

    expect(lines.filter((line) => line.startsWith("recipes"))).toEqual([
      "recipes: 4 due",
      "recipes overdue: notion — 2.0h late",
      "recipes urgent: slack — 10.0m late",
      "recipes comfortable: calm — 1.0m late",
      "recipes band UNKNOWN: odd — 0.0m late",
    ]);
  });

  it("says UNKNOWN for a missing rows list, a row with no due verdict and a due row naming no recipe", () => {
    const recipeLinesOf = ({ value }: { value: Record<string, unknown> }): readonly string[] =>
      tickDigestLines({
        inputs: {
          openPagesAgeMinutes: 10,
          priorHolds: { kind: "none" },
          readings: new Map<string, DigestReading>([["recipe-due", dueReading(value)]]),
          recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
          runAgeMinutes: 5,
        },
      }).filter((line) => line.startsWith("recipes"));

    expect([
      recipeLinesOf({ value: {} }),
      recipeLinesOf({ value: { rows: [{ recipeId: "r" }] } }),
      recipeLinesOf({ value: { rows: [{ due: true, recipeId: "", tolerance: {} }, { recipeId: "q" }] } }),
      // lateness is measured from a firing already past, so a negative one is no reading.
      recipeLinesOf({
        value: { rows: [{ due: true, recipeId: "r", tolerance: { band: "urgent", lateByMs: -60_000 } }] },
      }),
      // JSON's 1e309 parses to Infinity, and no elapsed time the producer computes is non-finite.
      recipeLinesOf({
        value: { rows: [{ due: true, recipeId: "r", tolerance: { band: "urgent", lateByMs: Infinity } }] },
      }),
    ]).toEqual([
      ["recipes: UNKNOWN — recipe-due carries no rows list"],
      ["recipes: UNKNOWN — 1 row(s) carry no due verdict"],
      [
        "recipes: UNKNOWN — 1 row(s) carry no due verdict",
        "recipes: 1 due",
        "recipes band UNKNOWN: UNKNOWN (the row names no recipeId) — lateness UNKNOWN",
      ],
      ["recipes: 1 due", "recipes urgent: r — lateness UNKNOWN"],
      ["recipes: 1 due", "recipes urgent: r — lateness UNKNOWN"],
    ]);
  });
});

describe("handRecheckLines", () => {
  const linesOf = ({ reading }: { reading: DigestReading | undefined }): readonly string[] =>
    handRecheckLines({
      inputs: {
        openPagesAgeMinutes: 10,
        priorHolds: { kind: "none" },
        readings: new Map(reading === undefined ? [] : [["hand-recheck", reading]]),
        recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
        runAgeMinutes: undefined,
      },
    });

  it("names each step the tick retired and each it could not read, by id, with what the read saw", () => {
    expect(
      linesOf({
        reading: {
          kind: "json",
          value: {
            alreadySettled: [],
            dryRun: false,
            retired: [{ because: "clerk opened https://dashboard.clerk.com signed in", id: "clerk-signin-6oct" }],
            unchecked: 4,
            unmet: [{ because: "they are not yet a member of C0123456789", id: "join-ops" }],
            unread: [{ because: "the relay lease was busy", id: "mon-signin-go-xero-com" }],
          },
        },
      }),
    ).toEqual([
      "hand recheck: 1 retired, 1 still needed, 1 unread",
      "hand recheck: retired clerk-signin-6oct — clerk opened https://dashboard.clerk.com signed in",
      "hand recheck: unread mon-signin-go-xero-com — the relay lease was busy",
    ]);
  });

  it("says the reading was not captured rather than reading as a quiet pass", () => {
    expect(linesOf({ reading: undefined })).toEqual(["hand-recheck: not captured this tick"]);
  });
});

describe("orgHealthLines", () => {
  const failedRead: DigestReading = { child: { durationMs: 900, exitCode: 1, kind: "exited" }, kind: "unavailable" };
  const pass = (reading: Record<string, unknown>): DigestReading => ({
    kind: "json",
    value: { actions: [], readings: [{ monitorId: "org-health", ...reading }] },
  });
  const linesOf = ({ read, verdict }: { read: DigestReading; verdict: DigestReading }): readonly string[] =>
    orgHealthLines({
      inputs: {
        openPagesAgeMinutes: 10,
        priorHolds: { kind: "none" },
        readings: new Map([
          ["org-health-read", read],
          ["org-health", verdict],
        ]),
        recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
        runAgeMinutes: undefined,
      },
    });

  it("shows the verdict unmeasurable whatever the pass said, or whether it ran, when this tick's read failed", () => {
    const timedOut: DigestReading = {
      child: { durationMs: 60_004, kind: "timed-out", signal: "SIGKILL", timeoutMs: 60_000 },
      kind: "unavailable",
    };
    const said = ({ verdict }: { verdict: string }): readonly string[] => [
      "org-health-read: unavailable — exit 1",
      `org health: UNMEASURABLE — this tick's incident read did not complete, so the pass's "${verdict}" is not now's`,
    ];
    expect([
      linesOf({ read: failedRead, verdict: pass({ state: "clear" }) }),
      linesOf({
        read: failedRead,
        verdict: pass({ state: "firing", subjects: [{ label: "INC-98 Critical · Pool" }] }),
      }),
      linesOf({ read: failedRead, verdict: timedOut }),
    ]).toEqual([
      said({ verdict: "org health: clear" }),
      said({ verdict: "org health: FIRING — INC-98 Critical · Pool" }),
      said({ verdict: "org-health: unavailable — timed out after 60s (killed)" }),
    ]);
  });

  it("keeps an unmeasurable pass's own reason when this tick's read failed", () => {
    expect(
      linesOf({ read: failedRead, verdict: pass({ because: "a read is under way", state: "unmeasurable" }) }),
    ).toEqual(["org-health-read: unavailable — exit 1", "org health: UNMEASURABLE — a read is under way"]);
  });

  it("shows a clear pass as clear when this tick's read was whole", () => {
    const whole: DigestReading = { kind: "json", value: { snapshot: { incidents: [] } } };
    expect(linesOf({ read: whole, verdict: pass({ state: "clear" }) })).toEqual([
      "org-health-read: read whole — 0 incident(s) open or recently resolved",
      "org health: clear",
    ]);
  });
});
