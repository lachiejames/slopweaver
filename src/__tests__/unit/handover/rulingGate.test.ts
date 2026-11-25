/**
 * The standing-gate projection and its two verdicts.
 *
 * Every case here is about ONE property the mechanism is only worth having if it holds: a reconstruction
 * cannot manufacture a refusal, silence is not a release, a subject narrows rather than broadens, and no
 * gate can name the verbs that fix the register.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import {
  dispatchGateVerdict,
  isUngateable,
  parseGateSelectors,
  parseGateSubjects,
  rulingGateId,
  rulingGateRefusalLines,
  rulingGateVerdict,
  type StandingGate,
  standingGatesOf,
  UNGATEABLE,
  unexpiredGates,
} from "../../../handover/rulingGate.js";
import { unwrap } from "../../../lib/result.js";

const SLUG = "scheduled-posts-go-to-owner-dm-only-291-8x";
const PLACED = "2026-09-21T03:01:34.000Z";
const RELEASED_AT = "2026-09-21T09:00:00.000Z";

/** A live ruling that places a gate, on `slack post` unless `verbs` names others. */
function placing({
  atIso = PLACED,
  subjects = [],
  untilIso,
  verbs = [{ noun: "slack", verb: "post" }],
}: {
  atIso?: string;
  subjects?: readonly string[];
  untilIso?: string;
  verbs?: readonly { noun: string; verb: string }[];
} = {}): RunEvent {
  return {
    anchor: "transcript:a0000036#a0000064",
    atIso,
    decidedIso: atIso,
    gate: { subjects, ...(untilIso === undefined ? {} : { untilIso }), verbs },
    kind: "ruling",
    ruling: "post only what someone has asked for",
  };
}

describe("standingGatesOf", () => {
  it("projects a gate a live ruling placed", () => {
    const gates = standingGatesOf({ events: [placing()], slug: SLUG });

    expect(gates.length).toBe(1);
    expect(gates[0]!.id).toBe(`${SLUG}#${PLACED}`);
    expect(gates[0]!.words).toBe("post only what someone has asked for");
    expect(gates[0]!.verbs).toEqual([{ noun: "slack", verb: "post" }]);
  });

  it("drops a gate an explicit release lifted", () => {
    const release: RunEvent = {
      anchor: "transcript:a0000036#later",
      atIso: RELEASED_AT,
      decidedIso: RELEASED_AT,
      gateReleases: [`${SLUG}#${PLACED}`],
      kind: "ruling",
      ruling: "ok, that one can go out now",
    };

    expect(standingGatesOf({ events: [placing(), release], slug: SLUG })).toEqual([]);
  });

  it("keeps a gate a LATER ruling merely said something else about — silence is not a release", () => {
    const later: RunEvent = {
      anchor: "transcript:a0000036#later",
      atIso: RELEASED_AT,
      decidedIso: RELEASED_AT,
      kind: "ruling",
      ruling: "also fix the double firing",
    };

    const gates = standingGatesOf({ events: [placing(), later], slug: SLUG });

    expect(gates.length).toBe(1);
    expect(gates[0]!.id).toBe(`${SLUG}#${PLACED}`);
  });

  it("ignores a gate on a RECONSTRUCTION, so a backfill can manufacture no refusal", () => {
    const backfilled: RunEvent = {
      anchor: "journal:runs/row.jsonl#x",
      atIso: "2026-09-21T10:00:00.000Z",
      backfilledFrom: PLACED,
      decidedIso: PLACED,
      gate: { subjects: [], verbs: [{ noun: "slack", verb: "post" }] },
      kind: "ruling",
      ruling: "reconstructed words",
    };

    expect(standingGatesOf({ events: [backfilled], slug: SLUG })).toEqual([]);
  });

  it("ignores a gate whose instant is not canonical, since no release could ever name it", () => {
    expect(standingGatesOf({ events: [placing({ atIso: "2026-09-21T03:01:34Z" })], slug: SLUG })).toEqual([]);
  });
});

describe("unexpiredGates", () => {
  const withExpiry = standingGatesOf({
    events: [placing({ untilIso: "2026-09-21T14:00:00.000Z" })],
    slug: SLUG,
  });

  it("keeps a gate whose lapse is still ahead", () => {
    expect(unexpiredGates({ gates: withExpiry, nowIso: "2026-09-21T13:59:00.000Z" }).length).toBe(1);
  });

  it("drops a gate that has lapsed", () => {
    expect(unexpiredGates({ gates: withExpiry, nowIso: "2026-09-21T14:00:01.000Z" })).toEqual([]);
  });

  it("keeps every gate when the clock itself is unreadable, so a bad --now cannot switch the owner's rulings off", () => {
    expect(unexpiredGates({ gates: withExpiry, nowIso: "not an instant" }).length).toBe(1);
  });
});

describe("rulingGateVerdict — the precise half", () => {
  const wholeVerb = standingGatesOf({ events: [placing()], slug: SLUG });
  const scoped = standingGatesOf({ events: [placing({ subjects: ["iso-policy-acceptance-daily"] })], slug: SLUG });

  it("refuses the verb it names", () => {
    expect(rulingGateVerdict({ gates: wholeVerb, noun: "slack", verb: "post" }).length).toBe(1);
  });

  it("leaves a verb it does not name alone", () => {
    expect(rulingGateVerdict({ gates: wholeVerb, noun: "slack", verb: "read-thread" })).toEqual([]);
  });

  it("refuses only the subject it names", () => {
    expect(
      rulingGateVerdict({ gates: scoped, noun: "slack", subject: "iso-policy-acceptance-daily", verb: "post" }).length,
    ).toBe(1);
    expect(rulingGateVerdict({ gates: scoped, noun: "slack", subject: "vulnfix-digest", verb: "post" })).toEqual([]);
  });

  it("does not refuse a caller that names no subject at all", () => {
    expect(rulingGateVerdict({ gates: scoped, noun: "slack", verb: "post" })).toEqual([]);
  });
});

describe("dispatchGateVerdict — the blunt half", () => {
  const scoped = standingGatesOf({ events: [placing({ subjects: ["CH-GATED-SUBJECT"] })], slug: SLUG });

  it("refuses when the subject is a WHOLE argv token", () => {
    const argv = ["node", "cli", "slack", "post", "--channel", "CH-GATED-SUBJECT"];

    expect(dispatchGateVerdict({ argv, gates: scoped, noun: "slack", verb: "post" }).length).toBe(1);
  });

  it("does not refuse on a substring of a token — the no-resemblance rule", () => {
    const argv = ["node", "cli", "slack", "post", "--channel", "CH-GATED-SUBJECT-X"];

    expect(dispatchGateVerdict({ argv, gates: scoped, noun: "slack", verb: "post" })).toEqual([]);
  });

  it("refuses every invocation of a gate that names no subject", () => {
    const argv = ["node", "cli", "slack", "post", "--text", "hello"];

    expect(
      dispatchGateVerdict({
        argv,
        gates: standingGatesOf({ events: [placing()], slug: SLUG }),
        noun: "slack",
        verb: "post",
      }).length,
    ).toBe(1);
  });

  // r2 of this change, measured against the shipped binary: `--doc <path>` was refused and `--doc=<path>`
  // was not, on the same gate — one character switched the owner's ruling off. `parseFlags.ts` accepts both.
  it("refuses the --flag=value spelling exactly as it refuses --flag value", () => {
    const argv = ["node", "cli", "slack", "post", "--channel=CH-GATED-SUBJECT"];

    expect(dispatchGateVerdict({ argv, gates: scoped, noun: "slack", verb: "post" }).length).toBe(1);
  });

  it("splits a --flag=value token at the FIRST = only, so a value containing one still matches whole", () => {
    const valued = standingGatesOf({ events: [placing({ subjects: ["a=b"] })], slug: SLUG });

    expect(
      dispatchGateVerdict({
        argv: ["node", "cli", "slack", "post", "--doc=a=b"],
        gates: valued,
        noun: "slack",
        verb: "post",
      }).length,
    ).toBe(1);
    // The falsifiable half: the leading half of the same token is not the subject, so it must not match.
    expect(
      dispatchGateVerdict({
        argv: ["node", "cli", "slack", "post", "--doc=a=b"],
        gates: scoped,
        noun: "slack",
        verb: "post",
      }),
    ).toEqual([]);
  });

  it("matches a gate that names the FLAG itself, in either spelling", () => {
    const flagged = standingGatesOf({ events: [placing({ subjects: ["--force"] })], slug: SLUG });

    expect(
      dispatchGateVerdict({
        argv: ["node", "cli", "slack", "post", "--force"],
        gates: flagged,
        noun: "slack",
        verb: "post",
      }).length,
    ).toBe(1);
    expect(
      dispatchGateVerdict({
        argv: ["node", "cli", "slack", "post", "--force=1"],
        gates: flagged,
        noun: "slack",
        verb: "post",
      }).length,
    ).toBe(1);
  });

  it("does not split a positional that merely contains an = sign", () => {
    const valued = standingGatesOf({ events: [placing({ subjects: ["CH-GATED-SUBJECT"] })], slug: SLUG });
    const argv = ["node", "cli", "slack", "post", "CH-GATED-SUBJECT=trailing"];

    expect(dispatchGateVerdict({ argv, gates: valued, noun: "slack", verb: "post" })).toEqual([]);
  });
});

describe("a gate binds a noun under either of its names", () => {
  /** A live ruling gating `run-due` under the noun spelled `noun`. */
  const gatedUnder = ({ noun }: { noun: string }): ReturnType<typeof standingGatesOf> =>
    standingGatesOf({ events: [placing({ verbs: [{ noun, verb: "run-due" }] })], slug: SLUG });

  it("refuses `automation run-due` for a gate recorded under the earlier noun, recipe", () => {
    const gates = gatedUnder({ noun: "recipe" });
    const argv = ["node", "cli", "automation", "run-due"];

    expect(rulingGateVerdict({ gates, noun: "automation", verb: "run-due" }).length).toBe(1);
    expect(dispatchGateVerdict({ argv, gates, noun: "automation", verb: "run-due" }).length).toBe(1);
  });

  it("refuses `recipe run-due` for a gate recorded under automation", () => {
    const gates = gatedUnder({ noun: "automation" });

    expect(rulingGateVerdict({ gates, noun: "recipe", verb: "run-due" }).length).toBe(1);
  });

  it("leaves another noun's verb of the same name alone", () => {
    expect(rulingGateVerdict({ gates: gatedUnder({ noun: "recipe" }), noun: "handover", verb: "run-due" })).toEqual([]);
  });
});

describe("UNGATEABLE", () => {
  it("is not empty, so every assertion below is about something", () => {
    expect(UNGATEABLE.length).toBeGreaterThan(0);
  });

  it("covers the verb that records a ruling and the verb that lifts a gate", () => {
    expect(isUngateable({ noun: "handover", verb: "rule" })).toBe(true);
    expect(isUngateable({ noun: "handover", verb: "gate" })).toBe(true);
  });

  it("leaves an ordinary verb gateable", () => {
    expect(isUngateable({ noun: "slack", verb: "post" })).toBe(false);
  });
});

describe("parseGateSelectors", () => {
  const known = new Set(["slack post", "recipe run-due"]);

  it("reads a comma-separated list of exact pairs", () => {
    expect(unwrap(parseGateSelectors({ known, value: "slack post, recipe run-due" }))).toEqual([
      { noun: "slack", verb: "post" },
      { noun: "recipe", verb: "run-due" },
    ]);
  });

  it("refuses a verb this build does not register, rather than recording a gate that never fires", () => {
    const parsed = parseGateSelectors({ known, value: "slack broadcast" });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("GATE_VERB_UNKNOWN");
  });

  it("refuses a wildcard, because it is not a pair", () => {
    const parsed = parseGateSelectors({ known, value: "slack *" });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("GATE_VERB_UNKNOWN");
  });

  it("refuses an entry that is not two words", () => {
    const parsed = parseGateSelectors({ known, value: "slack" });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("GATE_SELECTOR_MALFORMED");
  });

  it("refuses an ungateable verb by name", () => {
    const parsed = parseGateSelectors({ known: new Set(["handover rule"]), value: "handover rule" });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().code).toBe("GATE_VERB_UNGATEABLE");
  });
});

describe("parseGateSubjects", () => {
  it("is empty when the flag was not passed", () => {
    expect(parseGateSubjects({ value: undefined })).toEqual([]);
  });

  it("splits on commas and drops the blank a trailing comma leaves", () => {
    expect(parseGateSubjects({ value: "a, b," })).toEqual(["a", "b"]);
  });
});

describe("rulingGateRefusalLines", () => {
  const gates: readonly StandingGate[] = standingGatesOf({ events: [placing()], slug: SLUG });

  it("says nothing when nothing refused", () => {
    expect(rulingGateRefusalLines({ action: "slopweaver slack post", gates: [] })).toEqual([]);
  });

  it("carries the owner's own words and the anchor, so the reader can go and check", () => {
    const lines = rulingGateRefusalLines({ action: "slopweaver slack post", gates }).join("\n");

    expect(lines).toContain("post only what someone has asked for");
    expect(lines).toContain("transcript:a0000036#a0000064");
    expect(lines).toContain(rulingGateId({ atIso: PLACED, slug: SLUG }));
  });

  it("says out loud that there is no hatch, and names the one thing that lifts it", () => {
    const lines = rulingGateRefusalLines({ action: "slopweaver slack post", gates }).join("\n");

    expect(lines).toContain("no escape hatch and no environment override");
    expect(lines).toContain("slopweaver handover gate release");
  });
});

describe("UNGATEABLE is held at the PROJECTION, not only at the flag parser", () => {
  /** A hand-written journal line, as a shared `$SLOPWEAVER_HOME` can legitimately contain. */
  function handWritten({ verbs }: { verbs: readonly { noun: string; verb: string }[] }): RunEvent {
    return {
      anchor: "transcript:a0000036#a0000064",
      atIso: PLACED,
      decidedIso: PLACED,
      gate: { subjects: [], verbs },
      kind: "ruling",
      ruling: "stop",
    };
  }

  it("drops a gate on the verb that LIFTS gates, which nothing else could ever undo", () => {
    const events = [handWritten({ verbs: [{ noun: "handover", verb: "gate" }] })];

    expect(standingGatesOf({ events, slug: SLUG })).toEqual([]);
  });

  it("drops a gate on the verb that RECORDS rulings", () => {
    const events = [handWritten({ verbs: [{ noun: "handover", verb: "rule" }] })];

    expect(standingGatesOf({ events, slug: SLUG })).toEqual([]);
  });

  it("drops the WHOLE gate when one pair is ungateable, matching what the writer would have refused", () => {
    const events = [
      handWritten({
        verbs: [
          { noun: "slack", verb: "post" },
          { noun: "handover", verb: "rule" },
        ],
      }),
    ];

    expect(standingGatesOf({ events, slug: SLUG })).toEqual([]);
  });

  it("still projects a gate naming only gateable verbs — the falsifiable half", () => {
    const events = [handWritten({ verbs: [{ noun: "slack", verb: "post" }] })];

    expect(standingGatesOf({ events, slug: SLUG }).length).toBe(1);
  });
});
