/**
 * The lines `tick open` prints first, read directly: a broken automation names whether its finding can be
 * seated and the command that acts, and the seatable list leaves out exactly what the previous pass held and what a seat already holds.
 */
import { describe, expect, it } from "vitest";

import { brokenAutomationLines, seatableLines } from "../../../supervisor/digestActFirst.js";
import type { DigestInputs, DigestReading, PriorHolds, RecipeFixCheckout } from "../../../supervisor/digestRead.js";

const FINDING = "recipe-failing-resync-corpus-notion";

/** Digest inputs over the given readings, with the previous pass's holds and where a recipe's fix resolves. */
const inputsOf = ({
  priorHolds = { kind: "none" },
  readings,
  recipeFixCheckout = { kind: "resolved", path: "/c/slopweaver" },
}: {
  priorHolds?: PriorHolds;
  readings: ReadonlyMap<string, DigestReading>;
  recipeFixCheckout?: RecipeFixCheckout;
}): DigestInputs => ({
  openPagesAgeMinutes: undefined,
  priorHolds,
  readings,
  recipeFixCheckout,
  runAgeMinutes: undefined,
});

/** A `recipe-due` reading's rows, shaped as `automation due --json` writes them in a capture. */
const RECIPE_DUE_ROWS: readonly unknown[] = [
  {
    due: false,
    heldOnFinding: FINDING,
    lastRunAtIso: "2026-10-12T13:00:00.000Z",
    offReason: "held",
    recipeId: "resync-corpus-notion",
  },
  { due: false, offReason: "held", recipeId: "owner-approval" },
  { due: false, offReason: "disabled", recipeId: "switched-off" },
  { due: true, recipeId: "resync-corpus-slack" },
];

const RECIPE_DUE: DigestReading = { kind: "json", value: { rows: RECIPE_DUE_ROWS } };

/** A cmux reading holding one seat per path. */
const cmuxOf = ({ paths }: { paths: readonly string[] }): DigestReading => ({
  kind: "json",
  value: paths.map((currentDirectory) => ({ currentDirectory })),
});

/** A reconcile reading with the given row lists. */
const reconcileOf = ({
  aligned = [],
  held = [],
  ready = [],
  repolessRows = [],
  sharedSlugs = [],
}: {
  aligned?: readonly unknown[];
  held?: readonly unknown[];
  ready?: readonly unknown[];
  repolessRows?: readonly string[];
  sharedSlugs?: readonly string[];
}): DigestReading => ({ kind: "json", value: { aligned, held, misaligned: [], ready, repolessRows, sharedSlugs } });

describe("brokenAutomationLines", () => {
  it("names a finding whose row names no repo as unseatable, with the set-repo and the spawn that fix it", () => {
    const linesWith = ({
      recipeFixCheckout,
      reconcile = reconcileOf({ held: [{ id: FINDING }], repolessRows: [FINDING] }),
    }: {
      recipeFixCheckout: RecipeFixCheckout;
      reconcile?: DigestReading;
    }): readonly string[] =>
      brokenAutomationLines({
        inputs: inputsOf({
          readings: new Map([
            ["recipe-due", RECIPE_DUE],
            ["cmux", cmuxOf({ paths: [] })],
            ["reconcile", reconcile],
          ]),
          recipeFixCheckout,
        }),
      });
    const prefix = `BROKEN resync-corpus-notion — OFF on finding ${FINDING}, last ran 2026-10-12T13:00:00.000Z; `;
    const resolved: RecipeFixCheckout = { kind: "resolved", path: "/c/slopweaver" };
    const contradicted =
      `${prefix}UNSEATED, seatability UNKNOWN — reconcile calls its row repoless but carries it on ready or on ` +
      "no held row";

    expect([
      linesWith({ recipeFixCheckout: resolved }),
      // a bare `--repo slopweaver` is refused where no checkout of that name is declared.
      linesWith({ recipeFixCheckout: { kind: "unresolved", why: "no declared checkout is named slopweaver" } }),
      // a repoless row is blocked, so on held and never on ready; either way off that is no reading.
      linesWith({
        recipeFixCheckout: resolved,
        reconcile: reconcileOf({
          ready: [{ id: FINDING, label: "fix", priority: "p0", ready: true, standing: "ready" }],
          repolessRows: [FINDING],
        }),
      }),
      linesWith({ recipeFixCheckout: resolved, reconcile: reconcileOf({ repolessRows: [FINDING] }) }),
    ]).toEqual([
      [
        `${prefix}UNSEATED and UNSEATABLE, its row names no repo: — slopweaver handover set-repo ${FINDING} ` +
          `--repo /c/slopweaver, then slopweaver cmux spawn ${FINDING} --model opus`,
      ],
      [
        `${prefix}UNSEATED and UNSEATABLE, its row names no repo:, and no checkout to give it resolves — ` +
          "no declared checkout is named slopweaver",
      ],
      [contradicted],
      [contradicted],
    ]);
  });

  it("says a seat is on a finding only when a worktree basename equals its id exactly, and spawns only on a whole ready row", () => {
    const linesWith = ({
      paths,
      ready = [{ id: FINDING, label: "fix notion", priority: "p0", ready: true, standing: "ready" }],
    }: {
      paths: readonly string[];
      ready?: readonly unknown[];
    }): readonly string[] =>
      brokenAutomationLines({
        inputs: inputsOf({
          readings: new Map([
            ["recipe-due", RECIPE_DUE],
            ["cmux", cmuxOf({ paths })],
            ["reconcile", reconcileOf({ ready })],
          ]),
        }),
      });
    const prefix = `BROKEN resync-corpus-notion — OFF on finding ${FINDING}, last ran 2026-10-12T13:00:00.000Z; `;

    expect([
      linesWith({ paths: [`/w/${FINDING}`] }),
      linesWith({ paths: [`/w/${FINDING}-2`, `/w/${FINDING}/sub`] }),
      linesWith({ paths: [], ready: [{ id: FINDING, priority: "p0", ready: true, standing: "ready" }] }),
      // a row on ready that reads paused is no ready row, so no spawn is offered on it.
      linesWith({
        paths: [],
        ready: [{ id: FINDING, label: "fix", priority: "p0", ready: false, standing: "paused" }],
      }),
    ]).toEqual([
      [`${prefix}a seat is on it`],
      [`${prefix}UNSEATED — slopweaver cmux spawn ${FINDING} --model opus`],
      [
        `${prefix}UNSEATED, seatability UNKNOWN — its ready row lacks the label, priority or ready standing every ready board row carries`,
      ],
      [
        `${prefix}UNSEATED, seatability UNKNOWN — its ready row lacks the label, priority or ready standing every ready board row carries`,
      ],
    ]);
  });

  it("calls a seat on the finding only once the board says no other doc claims its id", () => {
    const linesWith = ({ readings }: { readings: ReadonlyMap<string, DigestReading> }): readonly string[] =>
      brokenAutomationLines({
        inputs: inputsOf({
          readings: new Map([["recipe-due", RECIPE_DUE], ["cmux", cmuxOf({ paths: [`/w/${FINDING}`] })], ...readings]),
        }),
      });
    const prefix = `BROKEN resync-corpus-notion — OFF on finding ${FINDING}, last ran 2026-10-12T13:00:00.000Z; `;

    expect([
      linesWith({ readings: new Map([["reconcile", reconcileOf({ sharedSlugs: [FINDING] })]]) }),
      linesWith({ readings: new Map() }),
      linesWith({
        readings: new Map([
          ["reconcile", reconcileOf({ ready: [{ label: "mystery", priority: "p1", ready: true, standing: "ready" }] })],
        ]),
      }),
      linesWith({ readings: new Map([["reconcile", reconcileOf({})]]) }),
    ]).toEqual([
      [`${prefix}a seat carries its id, but more than one doc claims it, so which doc that seat is on is UNKNOWN`],
      [
        `${prefix}a seat carries its id, but whether another doc claims that id too is UNKNOWN — ` +
          "reconcile: not captured this tick",
      ],
      [
        `${prefix}a seat carries its id, but reconcile carries 1 ready row(s) naming no id, so whether another doc ` +
          "claims it too is UNKNOWN",
      ],
      [`${prefix}a seat is on it`],
    ]);
  });

  it("names a finding no board row carries, and an unread cmux or reconcile as UNKNOWN rather than seated", () => {
    const linesWith = ({ readings }: { readings: ReadonlyMap<string, DigestReading> }): readonly string[] =>
      brokenAutomationLines({ inputs: inputsOf({ readings: new Map([["recipe-due", RECIPE_DUE], ...readings]) }) });
    const prefix = `BROKEN resync-corpus-notion — OFF on finding ${FINDING}, last ran 2026-10-12T13:00:00.000Z; `;

    expect([
      linesWith({
        readings: new Map([
          ["cmux", cmuxOf({ paths: [] })],
          ["reconcile", reconcileOf({})],
        ]),
      }),
      linesWith({ readings: new Map([["reconcile", reconcileOf({})]]) }),
      linesWith({ readings: new Map([["cmux", cmuxOf({ paths: [] })]]) }),
      linesWith({
        readings: new Map([
          ["cmux", { kind: "json", value: [{ currentDirectory: "/w/other" }, { title: "no directory" }] }],
          ["reconcile", reconcileOf({ ready: [{ id: FINDING }] })],
        ]),
      }),
      linesWith({
        readings: new Map([
          ["cmux", { kind: "json", value: [{ currentDirectory: "" }] }],
          ["reconcile", reconcileOf({ ready: [{ id: FINDING }] })],
        ]),
      }),
      linesWith({
        readings: new Map([
          ["cmux", cmuxOf({ paths: [] })],
          ["reconcile", { kind: "json", value: { held: [], ready: [], repolessRows: [] } }],
        ]),
      }),
    ]).toEqual([
      [`${prefix}UNSEATED and on no ready, held or in-flight row, so nothing can seat it`],
      [`${prefix}seat UNKNOWN — cmux: not captured this tick`],
      [`${prefix}UNSEATED, seatability UNKNOWN — reconcile: not captured this tick`],
      [`${prefix}seat UNKNOWN — cmux: 1 workspace(s) carry no currentDirectory, so no seat can be ruled out`],
      [`${prefix}seat UNKNOWN — cmux: 1 workspace(s) carry no currentDirectory, so no seat can be ruled out`],
      [`${prefix}UNSEATED, seatability UNKNOWN — reconcile carries no aligned list`],
    ]);
  });

  it("names a finding reconcile places a session on, and one held on the board, without a spawn, a standing it cannot carry as UNKNOWN", () => {
    const linesWith = ({ reconcile }: { reconcile: DigestReading }): readonly string[] =>
      brokenAutomationLines({
        inputs: inputsOf({
          readings: new Map([
            ["recipe-due", RECIPE_DUE],
            ["cmux", cmuxOf({ paths: ["/w/elsewhere"] })],
            ["reconcile", reconcile],
          ]),
        }),
      });
    const prefix = `BROKEN resync-corpus-notion — OFF on finding ${FINDING}, last ran 2026-10-12T13:00:00.000Z; `;
    const nameless =
      "UNSEATED, seatability UNKNOWN — reconcile carries 1 ready row(s) naming no id, any of which could be this one";

    expect([
      linesWith({ reconcile: reconcileOf({ aligned: [{ rank: 3, row: { id: FINDING, standing: "in-flight" } }] }) }),
      linesWith({ reconcile: reconcileOf({ held: [{ id: FINDING, standing: "paused" }] }) }),
      linesWith({ reconcile: reconcileOf({ aligned: [{ rank: 3, row: { id: FINDING } }] }) }),
      linesWith({ reconcile: reconcileOf({ aligned: [{ rank: 3, row: { id: FINDING, standing: "" } }] }) }),
      linesWith({ reconcile: reconcileOf({ held: [{ id: FINDING, standing: "ready" }] }) }),
      linesWith({ reconcile: reconcileOf({ held: [{ id: FINDING, standing: 7 }] }) }),
      // a ready row naming no id could be this finding's own.
      linesWith({
        reconcile: reconcileOf({
          ready: [
            { id: FINDING, label: "fix", priority: "p0", ready: true, standing: "ready" },
            { label: "mystery", priority: "p1", ready: true, standing: "ready" },
          ],
        }),
      }),
      linesWith({
        reconcile: reconcileOf({
          ready: [{ id: "", label: "mystery", priority: "p1", ready: true, standing: "ready" }],
        }),
      }),
    ]).toEqual([
      [`${prefix}reconcile places a session on its row (in-flight)`],
      [`${prefix}UNSEATED, its row is held on the board (paused)`],
      [`${prefix}reconcile places a session on its row (standing UNKNOWN)`],
      [`${prefix}reconcile places a session on its row (standing UNKNOWN)`],
      [`${prefix}UNSEATED, its row is held on the board (standing UNKNOWN)`],
      [`${prefix}UNSEATED, its row is held on the board (standing UNKNOWN)`],
      [`${prefix}${nameless}`],
      [`${prefix}${nameless}`],
    ]);
  });

  it("prints no command for a finding two docs claim, in one list or across two", () => {
    const linesWith = ({ reconcile }: { reconcile: DigestReading }): readonly string[] =>
      brokenAutomationLines({
        inputs: inputsOf({
          readings: new Map([
            ["recipe-due", RECIPE_DUE],
            ["cmux", cmuxOf({ paths: [] })],
            ["reconcile", reconcile],
          ]),
        }),
      });
    const prefix = `BROKEN resync-corpus-notion — OFF on finding ${FINDING}, last ran 2026-10-12T13:00:00.000Z; `;

    const shared = `${prefix}UNSEATED, seatability UNKNOWN — more than one doc claims this id, so set-repo and cmux spawn both refuse it`;

    expect([
      linesWith({ reconcile: reconcileOf({ ready: [{ id: FINDING }, { id: FINDING }], sharedSlugs: [FINDING] }) }),
      linesWith({
        reconcile: reconcileOf({
          held: [{ id: FINDING }],
          ready: [{ id: FINDING }],
          repolessRows: [FINDING],
          sharedSlugs: [FINDING],
        }),
      }),
      linesWith({
        reconcile: { kind: "json", value: { aligned: [], held: [], misaligned: [], ready: [], repolessRows: [] } },
      }),
      // a list repeating the id is ambiguous even when sharedSlugs, contradicting it, is empty.
      linesWith({ reconcile: reconcileOf({ ready: [{ id: FINDING }, { id: FINDING }], sharedSlugs: [] }) }),
      linesWith({ reconcile: reconcileOf({ held: [{ id: FINDING }, { id: FINDING }], sharedSlugs: [] }) }),
      // held and ready are disjoint for one doc, so the id on both is two docs.
      linesWith({ reconcile: reconcileOf({ held: [{ id: FINDING }], ready: [{ id: FINDING }], sharedSlugs: [] }) }),
    ]).toEqual([
      [shared],
      [shared],
      [`${prefix}UNSEATED, seatability UNKNOWN — reconcile carries no sharedSlugs list`],
      [shared],
      [shared],
      [shared],
    ]);
  });

  it("leaves a row OFF on the owner's approval or disabled out, and says UNKNOWN when the due reading is missing", () => {
    const quiet = inputsOf({ readings: new Map([["recipe-due", { kind: "json", value: { rows: [] } }]]) });
    const ownerHeld = inputsOf({
      readings: new Map([
        [
          "recipe-due",
          {
            kind: "json",
            value: {
              rows: [
                { offReason: "held", recipeId: "owner-approval" },
                { offReason: "disabled", recipeId: "switched-off" },
              ],
            },
          },
        ],
      ]),
    });

    expect([
      brokenAutomationLines({ inputs: quiet }),
      brokenAutomationLines({ inputs: ownerHeld }),
      brokenAutomationLines({ inputs: inputsOf({ readings: new Map() }) }),
      brokenAutomationLines({
        inputs: inputsOf({ readings: new Map([["recipe-due", { kind: "json", value: { rejected: [] } }]]) }),
      }),
    ]).toEqual([
      ["broken: no automation is held on a failure"],
      ["broken: no automation is held on a failure"],
      ["broken: UNKNOWN — recipe-due: not captured this tick"],
      ["broken: UNKNOWN — recipe-due carries no rows list"],
    ]);
  });

  it("says UNKNOWN for a row whose hold will not read, never that nothing is held", () => {
    const malformed = [
      { heldOnFinding: 123, offReason: "held", recipeId: "r" },
      { heldOnFinding: "" },
      "not a row",
      { heldOnFinding: "../x", lastRunAtIso: null, offReason: "held", recipeId: "escapes" },
      {},
      { recipeId: "" },
      { heldOnFinding: FINDING, lastRunAtIso: null, offReason: "disabled", recipeId: "not-off-as-held" },
      { heldOnFinding: FINDING, offReason: "held", recipeId: "no-last-run" },
      // an empty last run printed "last ran ;".
      { heldOnFinding: FINDING, lastRunAtIso: "", offReason: "held", recipeId: "empty-last-run" },
    ];
    const linesWith = ({ rows }: { rows: readonly unknown[] }): readonly string[] =>
      brokenAutomationLines({
        inputs: inputsOf({
          readings: new Map([
            ["recipe-due", { kind: "json", value: { rows } }],
            ["cmux", cmuxOf({ paths: [`/w/${FINDING}`] })],
            ["reconcile", reconcileOf({})],
          ]),
        }),
      });
    const unknown = [
      "broken: UNKNOWN — recipe-due row r carries no readable hold",
      "broken: UNKNOWN — recipe-due row (no recipeId) carries no readable hold",
      "broken: UNKNOWN — recipe-due row (no recipeId) carries no readable hold",
      "broken: UNKNOWN — recipe-due row escapes carries no readable hold",
      "broken: UNKNOWN — recipe-due row (no recipeId) carries no readable hold",
      "broken: UNKNOWN — recipe-due row (no recipeId) carries no readable hold",
      "broken: UNKNOWN — recipe-due row not-off-as-held carries no readable hold",
      "broken: UNKNOWN — recipe-due row no-last-run carries no readable hold",
      "broken: UNKNOWN — recipe-due row empty-last-run carries no readable hold",
    ];

    expect([linesWith({ rows: malformed }), linesWith({ rows: [...RECIPE_DUE_ROWS, malformed[0]] })]).toEqual([
      unknown,
      [
        `BROKEN resync-corpus-notion — OFF on finding ${FINDING}, last ran 2026-10-12T13:00:00.000Z; a seat is on it`,
        unknown[0],
      ],
    ]);
  });

  it("says UNKNOWN for a recipe the reading carries twice, seating neither finding, a malformed copy included", () => {
    const linesWith = ({ second }: { second: unknown }): readonly string[] =>
      brokenAutomationLines({
        inputs: inputsOf({
          readings: new Map([
            [
              "recipe-due",
              {
                kind: "json",
                value: {
                  rows: [
                    { heldOnFinding: "f-a", lastRunAtIso: null, offReason: "held", recipeId: "r" },
                    second,
                    ...RECIPE_DUE_ROWS,
                  ],
                },
              },
            ],
            ["cmux", cmuxOf({ paths: [`/w/${FINDING}`, "/w/f-a"] })],
            ["reconcile", reconcileOf({})],
          ]),
        }),
      });
    const notion = `BROKEN resync-corpus-notion — OFF on finding ${FINDING}, last ran 2026-10-12T13:00:00.000Z; a seat is on it`;
    const twice = "broken: UNKNOWN — recipe-due carries more than one row for r";

    expect([
      linesWith({ second: { heldOnFinding: "f-b", lastRunAtIso: null, offReason: "held", recipeId: "r" } }),
      linesWith({ second: { heldOnFinding: "f-b", lastRunAtIso: "", offReason: "held", recipeId: "r" } }),
    ]).toEqual([
      [notion, twice],
      [notion, "broken: UNKNOWN — recipe-due row r carries no readable hold", twice],
    ]);
  });
});

describe("seatableLines", () => {
  const ready = [
    { id: "land-18099", label: "EEEE-861 rebase", priority: "p1", ready: true, standing: "ready" },
    { id: "seated-row", label: "already running", priority: "p1", ready: true, standing: "ready" },
    { id: "free-a", label: "fix the pool", priority: "p1", ready: true, standing: "ready" },
    { id: "free-b", priority: "p2", ready: true, standing: "ready" },
    { id: "free-c", label: "c", priority: "p2", ready: true, standing: "ready" },
    { id: "free-d", label: "d" },
    { id: "free-e", label: "e", priority: "p3", ready: true, standing: "ready" },
    { id: "free-f", label: "f", priority: "p3", ready: true, standing: "ready" },
  ];
  const held: PriorHolds = { held: new Map([["land-18099", "EEEE-861 waits on Smith"]]), kind: "read", tick: 11 };

  it("names the first three rows nothing holds and no seat is on, and none lacking a board row's label or priority, then each row the previous pass held", () => {
    const inputs = inputsOf({
      priorHolds: held,
      readings: new Map([
        ["reconcile", reconcileOf({ ready })],
        ["cmux", cmuxOf({ paths: ["/w/seated-row"] })],
      ]),
    });

    expect(seatableLines({ inputs })).toEqual([
      "seatable: 4 of 8 ready row(s)",
      "seatable: p1 free-a — fix the pool — slopweaver cmux spawn free-a --model opus",
      "seatable: p2 free-c — c — slopweaver cmux spawn free-c --model opus",
      "seatable: p3 free-e — e — slopweaver cmux spawn free-e --model opus",
      "seatable: 2 ready id(s) lack the label, priority or ready standing every ready board row carries, so none is offered — free-b, free-d",
      "held by tick 11: p1 land-18099 — EEEE-861 waits on Smith",
    ]);
  });

  it("offers no ready row when the previous pass's holds could not be read, since it may have held any", () => {
    const inputs = inputsOf({
      priorHolds: { kind: "unreadable", tick: 11, why: "tick-11/tick.json: not found" },
      readings: new Map([
        ["reconcile", reconcileOf({ ready: ready.slice(0, 1) })],
        ["cmux", cmuxOf({ paths: [] })],
      ]),
    });

    expect(seatableLines({ inputs })).toEqual([
      "seatable: UNKNOWN — tick 11's holds could not be read (tick-11/tick.json: not found), so none of 1 ready row(s) can be called unheld",
    ]);
  });

  it("names both unknowns when neither the seats nor the previous pass's holds were read", () => {
    const inputs = inputsOf({
      priorHolds: { kind: "unreadable", tick: 11, why: "tick-11/tick.json: not found" },
      readings: new Map([["reconcile", reconcileOf({ ready: ready.slice(0, 1) })]]),
    });

    expect(seatableLines({ inputs })).toEqual([
      "seatable: UNKNOWN — cmux: not captured this tick, so none of 1 ready row(s) can be called unseated",
      "seatable: UNKNOWN — tick 11's holds could not be read (tick-11/tick.json: not found), so none of 1 ready row(s) can be called unheld",
    ]);
  });

  it("counts a ready row with no id, or one cmux spawn refuses, rather than offering a spawn for it", () => {
    const noId = { label: "no id", priority: "p0", ready: true, standing: "ready" };
    const inputs = inputsOf({
      readings: new Map([
        ["reconcile", reconcileOf({ ready: [noId, { ...noId, id: "" }, { ...noId, id: "../x" }, ready[2]] })],
        ["cmux", cmuxOf({ paths: [] })],
      ]),
    });

    expect(seatableLines({ inputs })).toEqual([
      "seatable: 1 of 4 ready row(s)",
      "seatable: p1 free-a — fix the pool — slopweaver cmux spawn free-a --model opus",
      "seatable: 3 ready row(s) carry no id cmux spawn accepts, so none is offered",
    ]);
  });

  it("offers no ready row reconcile lists as naming no repo: or already places a session on", () => {
    const reconcile = reconcileOf({
      aligned: [{ rank: 1, row: { id: "y", standing: "in-flight" } }],
      ready: [
        { id: "x", label: "x", priority: "p1", ready: true, standing: "ready" },
        { id: "y", label: "y", priority: "p1", ready: true, standing: "ready" },
        ready[2],
      ],
      repolessRows: ["x"],
    });
    const inputs = inputsOf({
      readings: new Map([
        ["reconcile", reconcile],
        ["cmux", cmuxOf({ paths: [] })],
      ]),
    });

    expect(seatableLines({ inputs })).toEqual([
      "seatable: 1 of 3 ready row(s)",
      "seatable: p1 free-a — fix the pool — slopweaver cmux spawn free-a --model opus",
      "seatable: 1 ready id(s) name no repo:, so none is offered — x",
      "seatable: 1 ready id(s) reconcile already places a session on, so none is offered — y",
    ]);
  });

  it("offers no ready row, and seats no finding, when reconcile places a session on no row id", () => {
    const readings = new Map<string, DigestReading>([
      ["cmux", cmuxOf({ paths: [] })],
      [
        "reconcile",
        reconcileOf({
          aligned: [{ rank: 1, row: { standing: "in-flight" } }],
          ready: [ready[2], { id: FINDING, priority: "p0", ready: true, standing: "ready" }],
        }),
      ],
      ["recipe-due", RECIPE_DUE],
    ]);

    expect([
      seatableLines({ inputs: inputsOf({ readings }) }),
      brokenAutomationLines({ inputs: inputsOf({ readings }) }),
    ]).toEqual([
      [
        "seatable: UNKNOWN — reconcile places 1 session(s) on no row id, so none of 2 ready row(s) can be called unambiguous",
      ],
      [
        `BROKEN resync-corpus-notion — OFF on finding ${FINDING}, last ran 2026-10-12T13:00:00.000Z; UNSEATED, seatability UNKNOWN — reconcile places 1 session(s) on no row id`,
      ],
    ]);
  });

  it("offers no ready row whose id another doc also claims, on the ready list or off it", () => {
    const linesWith = ({ reconcile }: { reconcile: DigestReading }): readonly string[] =>
      seatableLines({
        inputs: inputsOf({
          readings: new Map([
            ["reconcile", reconcile],
            ["cmux", cmuxOf({ paths: [] })],
          ]),
        }),
      });
    const twoReady = [
      { id: "dup", label: "A", priority: "p1", ready: true, standing: "ready" },
      { id: "dup", label: "B", priority: "p1", ready: true, standing: "ready" },
      ready[2],
    ];

    expect([
      linesWith({ reconcile: reconcileOf({ ready: twoReady, sharedSlugs: ["dup"] }) }),
      linesWith({ reconcile: reconcileOf({ ready: [twoReady[0], ready[2]], sharedSlugs: ["dup"] }) }),
      linesWith({ reconcile: { kind: "json", value: { ready: [ready[2]] } } }),
      linesWith({
        reconcile: {
          kind: "json",
          value: { aligned: [], misaligned: [], ready: [ready[2]], repolessRows: [], sharedSlugs: [] },
        },
      }),
      // held and ready are disjoint for one doc, so an id on both is two docs, whatever sharedSlugs says.
      linesWith({ reconcile: reconcileOf({ held: [twoReady[0]], ready: [twoReady[1], ready[2]], sharedSlugs: [] }) }),
      // a ready list repeating an id contradicts an empty sharedSlugs, and the repeat wins.
      linesWith({ reconcile: reconcileOf({ ready: twoReady, sharedSlugs: [] }) }),
    ]).toEqual([
      [
        "seatable: 1 of 3 ready row(s)",
        "seatable: p1 free-a — fix the pool — slopweaver cmux spawn free-a --model opus",
        "seatable: 1 ready id(s) more than one doc claims, so none is offered — dup",
      ],
      [
        "seatable: 1 of 2 ready row(s)",
        "seatable: p1 free-a — fix the pool — slopweaver cmux spawn free-a --model opus",
        "seatable: 1 ready id(s) more than one doc claims, so none is offered — dup",
      ],
      ["seatable: UNKNOWN — reconcile carries no aligned list, so none of 1 ready row(s) can be called unambiguous"],
      ["seatable: UNKNOWN — reconcile carries no held list, so none of 1 ready row(s) can be called unambiguous"],
      [
        "seatable: 1 of 2 ready row(s)",
        "seatable: p1 free-a — fix the pool — slopweaver cmux spawn free-a --model opus",
        "seatable: 1 ready id(s) more than one doc claims, so none is offered — dup",
      ],
      [
        "seatable: 1 of 3 ready row(s)",
        "seatable: p1 free-a — fix the pool — slopweaver cmux spawn free-a --model opus",
        "seatable: 1 ready id(s) more than one doc claims, so none is offered — dup",
      ],
    ]);
  });

  it("calls no row seatable and prints no spawn when the seat reading is missing", () => {
    const inputs = inputsOf({
      priorHolds: held,
      readings: new Map([["reconcile", reconcileOf({ ready })]]),
    });

    expect(seatableLines({ inputs })).toEqual([
      "seatable: UNKNOWN — cmux: not captured this tick, so none of 8 ready row(s) can be called unseated",
      "seatable: 2 ready id(s) lack the label, priority or ready standing every ready board row carries, so none is offered — free-b, free-d",
      "held by tick 11: p1 land-18099 — EEEE-861 waits on Smith",
    ]);
  });

  it("says NONE when every ready row is held or seated, and UNKNOWN when reconcile is missing", () => {
    const inputs = inputsOf({
      priorHolds: held,
      readings: new Map([
        ["reconcile", reconcileOf({ ready: ready.slice(0, 2) })],
        ["cmux", cmuxOf({ paths: ["/w/seated-row"] })],
      ]),
    });

    expect([seatableLines({ inputs }), seatableLines({ inputs: inputsOf({ readings: new Map() }) })]).toEqual([
      ["seatable: NONE of 2 ready row(s)", "held by tick 11: p1 land-18099 — EEEE-861 waits on Smith"],
      ["seatable: UNKNOWN — reconcile: not captured this tick"],
    ]);
  });
});
