/**
 * The board pruner — which rows still earn their keep, and which the register already decided.
 *
 * Three properties carry the module and each is asserted rather than described. **Conclusive and candidate are
 * different types**, so no `--settle` path can ever reach a text-rule verdict. **Every verdict carries a
 * witness**, because a bare verdict is the unfalsifiable output nobody reads twice. And **the two rails
 * outrank both text rules**: a row the owner ruled on, and a row paused on a person, survive whatever the slug says.
 *
 * The day-scope pair is the falsifiable core of the whole design and is asserted directly: the
 * `acme-ten-more-vulnerability-prs-8-sep` / `people-waiting-on-owner-8-sep` pair is indistinguishable
 * syntactically, so BOTH read `expired-day-scope` and NEITHER is conclusive. A test that only checked the
 * second would be evidence for a rule that is safe, when what makes it safe is that it never acts.
 */
import { describe, expect, it } from "vitest";

import type { BoardSection, RunDisposition } from "../../../handover/boardTypes.js";
import type { DerivedRowState } from "../../../handover/derivedRowState.js";
import type { DocStatus } from "../../../handover/doc.js";
import {
  PRUNE_DUPLICATE_SIBLING,
  PRUNE_EXPIRED_DAY_SCOPE,
  PRUNE_KEEP,
  PRUNE_RELAY_TAKEN_UP,
  PRUNE_SETTLED,
  PRUNE_SHIPPED_UNSETTLED,
  PRUNE_VERDICT_KINDS,
  type PruneCandidate,
  prunePass,
  pruneSummary,
  pruneVerdictOf,
} from "../../../handover/prune.js";
import type { RelayTakenUp } from "../../../handover/relayTakenUp.js";
import type { BoardRowKind } from "../../../handover/rowKind.js";

const NOW = "2026-09-20T00:00:00.000Z";

/** A derived state with nothing decided — the shape every candidate starts from. */
const OPEN_STATE: DerivedRowState = {
  artifact: undefined,
  datedRulings: [],
  findingRuling: undefined,
  fromRegister: [],
  ruling: undefined,
  settlement: undefined,
  settlementReason: undefined,
  settlementWitness: undefined,
  status: "ready",
  statusFrom: "authored",
  statusSummary: undefined,
};

/** The instant most cases are asked at — the day the day-scope pair's slugs name. */
const DEFAULT_ASKED_ISO = "2026-09-08T01:16:11.000Z";

/**
 * One candidate, built from the parts a rule actually reads so a test names only what it is changing.
 *
 * `askedIso` is read off the options object with an `in` check rather than taken as a destructuring default,
 * because a destructuring default fires on an explicit `undefined` too — so `candidate({ askedIso: undefined })`
 * silently got the default back and the no-asked-instant case asserted nothing. Every other field defaults normally;
 * none of them has a meaningful `undefined`.
 */
function candidate(options: {
  slug: string;
  derived?: DerivedRowState;
  run?: RunDisposition;
  askedIso?: string | undefined;
  authoredStatus?: DocStatus;
  section?: BoardSection;
  rowKind?: BoardRowKind;
  relayTakenUp?: RelayTakenUp;
}): PruneCandidate {
  const {
    slug,
    derived = OPEN_STATE,
    run = { kind: "never-started" },
    authoredStatus = "ready",
    section = "RUN NOW",
    rowKind = "ask",
  } = options;
  const askedIso = "askedIso" in options ? options.askedIso : DEFAULT_ASKED_ISO;
  const relayTakenUp = options.relayTakenUp;
  return { askedIso, authoredStatus, derived, priority: "p0", relayTakenUp, rowKind, run, section, slug };
}

/** The pass helper every case goes through, so the sibling rule can always resolve a base row. */
function verdictFor({
  rows,
  slug,
}: {
  rows: readonly PruneCandidate[];
  slug: string;
}): ReturnType<typeof pruneVerdictOf> {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const target = rows.find((row) => row.slug === slug)!;
  return pruneVerdictOf({ bySlug, candidate: target, nowIso: NOW });
}

describe("the verdict registry", () => {
  it("declares six kinds, keep last, so a rule order exists to assert against", () => {
    expect(PRUNE_VERDICT_KINDS.length).toBeGreaterThan(0);
    expect([...PRUNE_VERDICT_KINDS]).toEqual([
      PRUNE_SETTLED,
      PRUNE_SHIPPED_UNSETTLED,
      PRUNE_RELAY_TAKEN_UP,
      PRUNE_EXPIRED_DAY_SCOPE,
      PRUNE_DUPLICATE_SIBLING,
      PRUNE_KEEP,
    ]);
  });
});

describe("the conclusive half — the register already decided", () => {
  it("prunes a settled row and names its own witness, with nothing to perform", () => {
    const rows = [
      candidate({
        derived: {
          ...OPEN_STATE,
          settlement: "answered",
          settlementWitness: "file:///pages/meeting-brief-acme-one-on-one-17-sep/index.html",
        },
        slug: "meeting-brief-acme-one-on-one-17-sep",
      }),
    ];

    expect(verdictFor({ rows, slug: "meeting-brief-acme-one-on-one-17-sep" })).toEqual({
      conclusive: true,
      kind: PRUNE_SETTLED,
      performWith: undefined,
      slug: "meeting-brief-acme-one-on-one-17-sep",
      witness: "settlement: answered — file:///pages/meeting-brief-acme-one-on-one-17-sep/index.html",
    });
  });

  it("settled OUTRANKS a day-scope slug, so a finished briefing is never reported as a candidate", () => {
    const rows = [
      candidate({
        derived: { ...OPEN_STATE, settlement: "answered", settlementWitness: "an artifact" },
        slug: "acme-workstreams-picture-7-sep",
        askedIso: "2026-09-07T09:00:00.000Z",
      }),
    ];

    expect(verdictFor({ rows, slug: "acme-workstreams-picture-7-sep" }).kind).toBe(PRUNE_SETTLED);
  });

  it("names a settled row with no witness rather than printing an empty one", () => {
    const rows = [candidate({ derived: { ...OPEN_STATE, settlement: "declined" }, slug: "a-row" })];

    expect(verdictFor({ rows, slug: "a-row" }).witness).toBe("settlement: declined — no witness recorded");
  });

  it("prunes a shipped ask row that never got its settlement, and prints the settle command", () => {
    const rows = [
      candidate({
        run: { atIso: "2026-09-14T22:00:00.000Z", kind: "closed", summary: "merged as #812" },
        slug: "atlas-publication-correctness-is-opt-in-and-must-2",
      }),
    ];

    expect(verdictFor({ rows, slug: "atlas-publication-correctness-is-opt-in-and-must-2" })).toEqual({
      conclusive: true,
      kind: PRUNE_SHIPPED_UNSETTLED,
      performWith:
        "slopweaver handover settle atlas-publication-correctness-is-opt-in-and-must-2 --as answered " +
        "--witness 'merged as #812'",
      slug: "atlas-publication-correctness-is-opt-in-and-must-2",
      witness: "closed 2026-09-14T22:00:00.000Z — merged as #812",
    });
  });

  it("single-quotes the witness, so a backtick in a run summary cannot run as a subshell when pasted", () => {
    const rows = [
      candidate({
        run: {
          atIso: "2026-09-14T22:00:00.000Z",
          kind: "closed",
          summary: "landed as #812; `derivedFrom` is required and the operator's $HOME is untouched",
        },
        slug: "a-row-with-shell-metacharacters",
      }),
    ];

    const verdict = verdictFor({ rows, slug: "a-row-with-shell-metacharacters" });

    expect(verdict).toEqual({
      conclusive: true,
      kind: PRUNE_SHIPPED_UNSETTLED,
      performWith:
        "slopweaver handover settle a-row-with-shell-metacharacters --as answered " +
        "--witness 'landed as #812; `derivedFrom` is required and the operator'\\''s $HOME is untouched'",
      slug: "a-row-with-shell-metacharacters",
      witness:
        "closed 2026-09-14T22:00:00.000Z — landed as #812; `derivedFrom` is required and the operator's " +
        "$HOME is untouched",
    });
  });

  it("leaves a shipped DOC row alone — only an ask row carries a settlement", () => {
    const rows = [
      candidate({
        rowKind: "doc",
        run: { atIso: "2026-09-14T22:00:00.000Z", kind: "closed", summary: "merged as #812" },
        slug: "a-doc-row",
      }),
    ];

    expect(verdictFor({ rows, slug: "a-doc-row" }).kind).toBe(PRUNE_KEEP);
  });
});

describe("the relay rule — a voice relay the chair's own registers say it took up", () => {
  const filed: RelayTakenUp = {
    because: "row the-cut-row was cut from this relay (same talk:…)",
    settlement: "filed",
    witness: "the-cut-row",
  };

  it("is conclusive and performs a settle with the settlement the register decided", () => {
    const verdict = pruneVerdictOf({
      bySlug: new Map(),
      candidate: candidate({ relayTakenUp: filed, slug: "talk-a00000630000" }),
      nowIso: NOW,
    });

    expect(verdict).toEqual({
      conclusive: true,
      kind: PRUNE_RELAY_TAKEN_UP,
      performWith: "slopweaver handover settle talk-a00000630000 --as filed --witness the-cut-row",
      slug: "talk-a00000630000",
      witness: filed.because,
    });
  });

  it("yields to the owner's ruling on the relay row, which keeps it", () => {
    const ruled: DerivedRowState = {
      ...OPEN_STATE,
      ruling: { anchor: "transcript:a0000036#291-8", from: "authored", words: "keep this one open" },
    };

    const verdict = pruneVerdictOf({
      bySlug: new Map(),
      candidate: candidate({ derived: ruled, relayTakenUp: filed, slug: "talk-a00000630000" }),
      nowIso: NOW,
    });

    expect(verdict.kind).toBe(PRUNE_KEEP);
  });

  it("counts toward what the register already decided", () => {
    const pass = prunePass({
      candidates: [candidate({ relayTakenUp: filed, slug: "talk-a00000630000" }), candidate({ slug: "live-work" })],
      nowIso: NOW,
    });

    expect(pass.counts[PRUNE_RELAY_TAKEN_UP]).toBe(1);
    expect(pruneSummary({ pass })).toBe(
      "2 row(s) read, 1 survive — 1 the register already decided, 0 candidate(s) needing a session's judgement",
    );
  });
});

describe("the two rails — the owner's word and a person's pause outrank every text rule", () => {
  it("keeps a row the owner ruled on even when its slug names a day that has passed", () => {
    const rows = [
      candidate({
        derived: {
          ...OPEN_STATE,
          ruling: {
            anchor: "transcript:a0000036#291-8",
            from: "authored",
            words: "keep it open until the batch lands",
          },
        },
        slug: "acme-people-waiting-8-sep-e2e-16894-and-every-open-ask",
      }),
    ];

    const verdict = verdictFor({ rows, slug: "acme-people-waiting-8-sep-e2e-16894-and-every-open-ask" });

    expect(verdict.kind).toBe(PRUNE_KEEP);
    expect(verdict.conclusive).toBe(false);
    expect(verdict.witness).toBe(
      "the owner ruled on this row (transcript:a0000036#291-8) — their word outranks every rule below",
    );
  });

  it("keeps a row paused on a person, and says a pause is a state rather than a countdown", () => {
    const rows = [candidate({ authoredStatus: "paused", slug: "acme-people-waiting-8-sep-and-every-open-ask" })];

    const verdict = verdictFor({ rows, slug: "acme-people-waiting-8-sep-and-every-open-ask" });

    expect(verdict.kind).toBe(PRUNE_KEEP);
    expect(verdict.witness).toBe("paused on a person — a state, not a countdown; the board remembers it");
  });

  it("keeps a row the board placed in PAUSED even when its own line still reads ready", () => {
    const rows = [candidate({ section: "PAUSED", slug: "acme-people-waiting-8-sep-and-every-open-ask" })];

    expect(verdictFor({ rows, slug: "acme-people-waiting-8-sep-and-every-open-ask" }).kind).toBe(PRUNE_KEEP);
  });
});

describe("the day-scope rule — a candidate, never an act", () => {
  it("fires on a day-scoped row whose day has passed, and stays NON-conclusive", () => {
    const rows = [candidate({ slug: "acme-people-waiting-8-sep-e2e-16894-and-every-open-ask" })];

    const verdict = verdictFor({ rows, slug: "acme-people-waiting-8-sep-e2e-16894-and-every-open-ask" });

    expect(verdict.kind).toBe(PRUNE_EXPIRED_DAY_SCOPE);
    expect(verdict.conclusive).toBe(false);
    expect(verdict.witness).toBe(
      "the slug names 2026-09-08, asked 2026-09-08, now 2026-09-20 — day-scoped and that day has passed",
    );
  });

  it("carries its command as proposeWith and declares no performWith FIELD at all", () => {
    const rows = [candidate({ slug: "acme-people-waiting-8-sep-e2e-16894-and-every-open-ask" })];

    const verdict = verdictFor({ rows, slug: "acme-people-waiting-8-sep-e2e-16894-and-every-open-ask" });

    expect(Object.keys(verdict).toSorted()).toEqual(["conclusive", "kind", "proposeWith", "slug", "witness"]);
  });

  it("fires IDENTICALLY on the day-STAMPED twin, which is why it may never act on its own", () => {
    const rows = [candidate({ slug: "acme-ten-more-vulnerability-prs-8-sep" })];

    const verdict = verdictFor({ rows, slug: "acme-ten-more-vulnerability-prs-8-sep" });

    expect(verdict.kind).toBe(PRUNE_EXPIRED_DAY_SCOPE);
    expect(verdict.conclusive).toBe(false);
  });

  it("does not fire when the named day is still ahead", () => {
    const rows = [candidate({ askedIso: "2026-09-19T09:00:00.000Z", slug: "meeting-brief-acme-weekly-25-sep" })];

    expect(verdictFor({ rows, slug: "meeting-brief-acme-weekly-25-sep" }).kind).toBe(PRUNE_KEEP);
  });

  it("does not fire on a row naming TODAY, since the day is still running at any hour of it", () => {
    const slug = "your-voice-frictions-what-has-landed-7-oct";
    const row = candidate({ askedIso: "2026-10-07T04:00:00.000Z", slug });
    const bySlug = new Map([[slug, row]]);

    const midday = pruneVerdictOf({ bySlug, candidate: row, nowIso: "2026-10-07T10:47:00.000Z" });
    const lastMs = pruneVerdictOf({ bySlug, candidate: row, nowIso: "2026-10-07T23:59:59.999Z" });

    expect(midday.kind).toBe(PRUNE_KEEP);
    expect(lastMs.kind).toBe(PRUNE_KEEP);
  });

  it("fires from the midnight that ENDS the named day", () => {
    const slug = "your-voice-frictions-what-has-landed-7-oct";
    const row = candidate({ askedIso: "2026-10-07T04:00:00.000Z", slug });

    const verdict = pruneVerdictOf({
      bySlug: new Map([[slug, row]]),
      candidate: row,
      nowIso: "2026-10-08T00:00:00.000Z",
    });

    expect(verdict.kind).toBe(PRUNE_EXPIRED_DAY_SCOPE);
    expect(verdict.witness).toBe(
      "the slug names 2026-10-07, asked 2026-10-07, now 2026-10-08 — day-scoped and that day has passed",
    );
  });

  it("does not fire when the named day is far from the ask — that date is a citation, not a scope", () => {
    const rows = [candidate({ askedIso: "2026-09-19T09:00:00.000Z", slug: "acme-ruling-on-2-sep-still-stands" })];

    expect(verdictFor({ rows, slug: "acme-ruling-on-2-sep-still-stands" }).kind).toBe(PRUNE_KEEP);
  });

  it("does not fire on a row with no asked instant, because the correlation cannot be made", () => {
    const rows = [candidate({ askedIso: undefined, slug: "acme-work-day-briefing-8-sep-demo" })];

    expect(verdictFor({ rows, slug: "acme-work-day-briefing-8-sep-demo" }).kind).toBe(PRUNE_KEEP);
  });

  it("does not fire on a trailing turn id, which names no month at all", () => {
    const rows = [candidate({ askedIso: "2026-09-19T09:00:00.000Z", slug: "acme-react-now-cards-290-9" })];

    expect(verdictFor({ rows, slug: "acme-react-now-cards-290-9" }).kind).toBe(PRUNE_KEEP);
  });

  it("does not fire on a three-letter run that is not a month", () => {
    const rows = [candidate({ askedIso: "2026-09-19T09:00:00.000Z", slug: "bump-the-8-day-window" })];

    expect(verdictFor({ rows, slug: "bump-the-8-day-window" }).kind).toBe(PRUNE_KEEP);
  });
});

describe("the duplicate-sibling rule — safe only because the base row must be on the board and terminal", () => {
  it("fires when the base row is settled", () => {
    const base = "linear-through-its-official-sdk-this-repo-versus-the-archive-including-cassettes";
    const rows = [
      candidate({
        askedIso: "2026-09-14T09:00:00.000Z",
        derived: { ...OPEN_STATE, settlement: "answered", settlementWitness: "shipped in #700" },
        slug: base,
      }),
      candidate({ askedIso: "2026-09-14T09:00:00.000Z", slug: `${base}-2` }),
    ];

    const verdict = verdictFor({ rows, slug: `${base}-2` });

    expect(verdict.kind).toBe(PRUNE_DUPLICATE_SIBLING);
    expect(verdict.conclusive).toBe(false);
    expect(verdict.witness).toBe(`base row ${base} is terminal (settlement: answered) and this is sibling 2`);
  });

  it("names a closed base row's terminal rather than a settlement it does not have", () => {
    const rows = [
      candidate({
        askedIso: "2026-09-14T09:00:00.000Z",
        rowKind: "doc",
        run: { atIso: "2026-09-15T00:00:00.000Z", kind: "closed", summary: "landed" },
        slug: "a-base-row",
      }),
      candidate({ askedIso: "2026-09-14T09:00:00.000Z", slug: "a-base-row-3" }),
    ];

    expect(verdictFor({ rows, slug: "a-base-row-3" }).witness).toBe(
      "base row a-base-row is terminal (a closed event) and this is sibling 3",
    );
  });

  it("does NOT fire when the base row is still live", () => {
    const rows = [
      candidate({ askedIso: "2026-09-14T09:00:00.000Z", slug: "a-base-row" }),
      candidate({ askedIso: "2026-09-14T09:00:00.000Z", slug: "a-base-row-2" }),
    ];

    expect(verdictFor({ rows, slug: "a-base-row-2" }).kind).toBe(PRUNE_KEEP);
  });

  it("does NOT fire on a trailing turn id, because stripping it names no row on the board", () => {
    const rows = [
      candidate({ askedIso: "2026-09-19T09:00:00.000Z", slug: "land-acme-admin-16672-resolve-tsconfig-290-7" }),
    ];

    expect(verdictFor({ rows, slug: "land-acme-admin-16672-resolve-tsconfig-290-7" }).kind).toBe(PRUNE_KEEP);
  });
});

describe("a whole pass", () => {
  it("counts every kind, keeps the survivors in arrival order, and states the trim in one line", () => {
    const base = "a-base-row";
    const candidates = [
      candidate({ derived: { ...OPEN_STATE, settlement: "answered", settlementWitness: "done" }, slug: base }),
      candidate({ askedIso: "2026-09-14T09:00:00.000Z", slug: `${base}-2` }),
      candidate({ slug: "acme-people-waiting-8-sep-and-every-open-ask" }),
      candidate({
        run: { atIso: "2026-09-19T00:00:00.000Z", kind: "closed", summary: "shipped" },
        slug: "a-turn-spirals-past-a-clean-verdict-p2",
      }),
      candidate({ askedIso: "2026-09-19T12:53:22.000Z", slug: "acme-plugin-mirror-per-seat-291-33" }),
      candidate({ askedIso: "2026-09-19T08:22:30.000Z", slug: "acme-board-freshness-291-15" }),
    ];

    const pass = prunePass({ candidates, nowIso: NOW });

    expect(pass.considered).toBe(6);
    expect(pass.counts).toEqual({
      [PRUNE_DUPLICATE_SIBLING]: 1,
      [PRUNE_EXPIRED_DAY_SCOPE]: 1,
      [PRUNE_KEEP]: 2,
      [PRUNE_RELAY_TAKEN_UP]: 0,
      [PRUNE_SETTLED]: 1,
      [PRUNE_SHIPPED_UNSETTLED]: 1,
    });
    expect(pass.survivors.map((verdict) => verdict.slug)).toEqual([
      "acme-plugin-mirror-per-seat-291-33",
      "acme-board-freshness-291-15",
    ]);
    expect(pruneSummary({ pass })).toBe(
      "6 row(s) read, 2 survive — 2 the register already decided, 2 candidate(s) needing a session's judgement",
    );
  });

  it("reports an empty board as zero rather than refusing it", () => {
    const pass = prunePass({ candidates: [], nowIso: NOW });

    expect(pass.considered).toBe(0);
    expect(pass.survivors).toEqual([]);
    expect(pruneSummary({ pass })).toBe(
      "0 row(s) read, 0 survive — 0 the register already decided, 0 candidate(s) needing a session's judgement",
    );
  });

  it("never marks a candidate verdict conclusive, so no --settle path can reach a text rule", () => {
    const base = "a-base-row";
    const candidates = [
      candidate({ derived: { ...OPEN_STATE, settlement: "answered", settlementWitness: "done" }, slug: base }),
      candidate({ askedIso: "2026-09-14T09:00:00.000Z", slug: `${base}-2` }),
      candidate({ slug: "acme-people-waiting-8-sep-and-every-open-ask" }),
    ];

    const conclusiveKinds = prunePass({ candidates, nowIso: NOW })
      .verdicts.filter((verdict) => verdict.conclusive)
      .map((verdict) => verdict.kind);

    expect(conclusiveKinds).toEqual([PRUNE_SETTLED]);
  });

  it("gives every verdict a non-empty witness", () => {
    const candidates = [
      candidate({ slug: "acme-people-waiting-8-sep-and-every-open-ask" }),
      candidate({ askedIso: "2026-09-19T09:00:00.000Z", slug: "a-plain-live-row-291-33" }),
    ];

    const empty = prunePass({ candidates, nowIso: NOW }).verdicts.filter((verdict) => verdict.witness.length === 0);

    expect(empty).toEqual([]);
  });
});
