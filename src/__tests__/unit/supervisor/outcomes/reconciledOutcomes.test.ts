/**
 * Reading a reconciliation's outcome coverage strictly: the declared source, then every row through the one schema
 * mirroring what reconcile emits, or a refusal naming the row and the field that did not read. Both consumers — the
 * sweep gate and the successor summary — read through this.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { outcomeFields } from "../../../../cli/commands/handover/reconcileOutcomes.js";
import { coverageOutcomes, outcomeCoverage } from "../../../../supervisor/outcomes/coverage.js";
import {
  readEmittedOutcomeFields,
  readReconciledOutcomes,
} from "../../../../supervisor/outcomes/reconciledOutcomes.js";

import { boardRow, emittedFields, emittedOutcome, seat } from "./emittedRowFixture.js";
import { keptStated } from "./keptStatedFixture.js";

/** One coverage row with a live seat and a waiting row, as reconcile emits it. */
const ROW = emittedOutcome({
  id: "scheduled-backups-landing-in-gcp",
  live: [seat({ rank: 1, session: "workspace:3" })],
  unspawned: [boardRow({ id: "r-2", label: "wire the bucket" })],
});

/** The row through JSON, the way a reader receives it: `undefined` fields dropped. */
const WIRE = JSON.parse(JSON.stringify(ROW)) as Record<string, unknown>;

/**
 * A present document carrying exactly the rows given, possibly malformed. Every well-formed row here has somebody on
 * it, so none is uncovered; a malformed one refuses before the uncovered list is compared.
 */
const present = ({ outcomes }: { outcomes: readonly unknown[] }) => ({
  outcomeSource: { count: outcomes.length, kind: "present" },
  outcomes,
  unanchoredOutcomes: [],
  uncoveredOutcomes: [],
});

/** The refusal's head — which row, which field — without the schema's own wording or the re-run advice. */
const refusedAt = ({ outcomes }: { outcomes: readonly unknown[] }): string =>
  unwrapErr(readReconciledOutcomes({ reconciliation: present({ outcomes }) })).message.split(": ")[0]!;

/** The wire row's first live seat and first waiting row, for a case to break one field of. */
const LIVE = (WIRE["live"] as Record<string, unknown>[])[0]!;
const WAITING = (WIRE["unspawned"] as Record<string, unknown>[])[0]!;

describe("readReconciledOutcomes", () => {
  it("reads a present register's rows: the owner's words, the anchor, who is on it and what waits", () => {
    expect(unwrap(readReconciledOutcomes({ reconciliation: present({ outcomes: [WIRE] }) }))).toEqual({
      outcomes: [
        {
          anchor: "transcript:s#t",
          id: "scheduled-backups-landing-in-gcp",
          liveSessions: ["workspace:3"],
          title: "Scheduled backups landing in GCP",
          unspawned: [{ id: "r-2", label: "wire the bucket" }],
          words: "backups land in GCP on a schedule",
        },
      ],
      source: "present",
    });
  });

  it("reads an absent register as no outcomes, distinctly from a present one holding none", () => {
    const absent = unwrap(
      readReconciledOutcomes({ reconciliation: emittedFields({ outcomeSource: { kind: "absent" }, outcomes: [] }) }),
    );
    const none = unwrap(readReconciledOutcomes({ reconciliation: present({ outcomes: [] }) }));

    expect([absent, none]).toEqual([
      { outcomes: [], source: "absent" },
      { outcomes: [], source: "present" },
    ]);
  });

  it("refuses a document that is not a record at all, and one whose `outcomes` is not a list", () => {
    const notADocument = unwrapErr(readReconciledOutcomes({ reconciliation: [WIRE] })).message;
    const notAList = unwrapErr(
      readReconciledOutcomes({ reconciliation: { ...present({ outcomes: [] }), outcomes: "none" } }),
    ).message;

    expect([notADocument.split(" — ")[0], notAList.split(": ")[0]]).toEqual([
      "the reconciliation is not a document",
      "the reconciliation's `outcomes` is malformed",
    ]);
  });

  it("names the second row when the first reads and the second does not, refusing the whole document", () => {
    expect(refusedAt({ outcomes: [WIRE, { ...WIRE, id: "second", anchor: "" }] })).toBe(
      'the reconciliation\'s outcome row 1 "second" is malformed at `anchor`',
    );
  });
});

/** Every way one emitted field can be malformed, each with the field the refusal must name. */
const MALFORMED: readonly { kind: string; row: unknown; at: string }[] = [
  { at: "`title`", kind: "an empty string", row: { ...WIRE, title: "" } },
  { at: "`words`", kind: "a missing string", row: { ...WIRE, words: undefined } },
  { at: "`rows`", kind: "a missing emitted count", row: { ...WIRE, rows: undefined } },
  { at: "`rows`", kind: "a count of the wrong type", row: { ...WIRE, rows: "1" } },
  { at: "`rows`", kind: "a fractional count", row: { ...WIRE, rows: 1.5 } },
  { at: "the row itself", kind: "an unknown key on the row", row: { ...WIRE, extra: 1 } },
  { at: "`live`", kind: "a list that is not one", row: { ...WIRE, live: {} } },
  {
    at: "`live.0.session`",
    kind: "a live seat with an empty session",
    row: { ...WIRE, live: [{ ...LIVE, session: "" }] },
  },
  {
    at: "`live.0.row`",
    kind: "a live seat with no row",
    row: { ...WIRE, live: [{ rank: 1, session: "workspace:3" }] },
  },
  { at: "`live.0.rank`", kind: "a live seat ranked zero", row: { ...WIRE, live: [{ ...LIVE, rank: 0 }] } },
  {
    at: "`unspawned.0.label`",
    kind: "a board row with no label",
    row: { ...WIRE, unspawned: [{ ...WAITING, label: undefined }] },
  },
  {
    at: "`unspawned.0.standing`",
    kind: "an enum value reconcile never writes",
    row: { ...WIRE, unspawned: [{ ...WAITING, standing: "running" }] },
  },
  {
    at: "`unspawned.0.ready`",
    kind: "a boolean of the wrong type",
    row: { ...WIRE, unspawned: [{ ...WAITING, ready: "yes" }] },
  },
  {
    at: "`unspawned.0.openedIso`",
    kind: "an empty optional string",
    row: { ...WIRE, unspawned: [{ ...WAITING, openedIso: "" }] },
  },
  {
    at: "`unspawned.0`",
    kind: "an unknown key on a board row",
    row: { ...WIRE, unspawned: [{ ...WAITING, extra: 1 }] },
  },
];

describe("readReconciledOutcomes refuses each malformed field kind, naming the row and the field", () => {
  it("covers every kind it claims to", () => {
    expect(MALFORMED.length).toBeGreaterThan(0);
  });

  it.each(MALFORMED)("refuses $kind at $at", ({ row, at }) => {
    expect(refusedAt({ outcomes: [row] })).toBe(
      `the reconciliation's outcome row 0 "scheduled-backups-landing-in-gcp" is malformed at ${at}`,
    );
  });

  it("refuses a row that is not a record, naming it by index alone", () => {
    expect(refusedAt({ outcomes: [null] })).toBe("the reconciliation's outcome row 0 is malformed at the row itself");
  });

  it("names the unknown key it refused", () => {
    const message = unwrapErr(
      readReconciledOutcomes({ reconciliation: present({ outcomes: [{ ...WIRE, extra: 1 }] }) }),
    ).message;

    expect(message).toContain('"extra"');
  });
});

describe("readEmittedOutcomeFields", () => {
  it("reads back exactly what reconcile emitted, source, seats, waiting rows, an opened instant and the lists included", () => {
    const outcomes = coverageOutcomes({ workstreams: keptStated({ ids: ["acme-bot-dogfooded"] }) }).outcomes;
    const seated = boardRow({ id: "the-bot-answers-in-a-thread", ready: false, standing: "in-flight" });
    const waiting = boardRow({
      id: "the-bot-answers-in-its-dm",
      openedIso: "2026-11-01T09:00:00.000Z",
      waitingHours: 3,
    });
    const report = outcomeCoverage({
      botHandles: [],
      outcomes,
      placed: [{ rank: 1, row: seated, session: "workspace:7" }],
      ranked: [seated, waiting],
    });
    const fields = outcomeFields({
      coverage: { outcomeSource: { count: 1, kind: "present" }, outcomes: report, unanchored: ["cites-nothing"] },
    });
    const wire: unknown = JSON.parse(JSON.stringify(fields));

    expect([report.outcomes[0]!.live.length, report.outcomes[0]!.unspawned.length]).toEqual([1, 1]);
    expect(unwrap(readEmittedOutcomeFields({ reconciliation: wire }))).toEqual(fields);
  });

  it("reads back an absent source exactly as reconcile emits it, its kind alone", () => {
    const fields = outcomeFields({
      coverage: { outcomeSource: { kind: "absent" }, outcomes: { outcomes: [], uncovered: [] }, unanchored: [] },
    });
    const wire: unknown = JSON.parse(JSON.stringify(fields));

    expect(unwrap(readEmittedOutcomeFields({ reconciliation: wire }))).toEqual({
      outcomeSource: { kind: "absent" },
      outcomes: [],
      unanchoredOutcomes: [],
      uncoveredOutcomes: [],
    });
  });
});
