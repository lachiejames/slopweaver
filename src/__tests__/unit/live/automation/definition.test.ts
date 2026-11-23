/**
 * `parseRecipeDefinition` / `resolveOnMissed` / `recipeEffectExceedsKind` — the owner's params-only and
 * missed-slot rules as pure functions, so every branch is a plain call with no seam to inject.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  parseRecipeDefinition,
  RECIPE_DEFINITION_SCHEMA_VERSION,
  resolveOnMissed,
} from "../../../../live/automation/definition.js";
import { BRIEFING_KIND, findRecipeKind, recipeEffectExceedsKind } from "../../../../live/automation/kinds.js";

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  cadence: "0 10 * * 1-5",
  destination: { kind: "slack" },
  effect: "read-write",
  kind: "alert-summary",
  params: {},
  recipeId: "knock-alerts",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  ...over,
});

describe("parseRecipeDefinition", () => {
  it("accepts a well-formed row and defaults enabled to true", () => {
    const parsed = unwrap(parseRecipeDefinition({ value: row() }));

    expect(parsed.recipeId).toBe("knock-alerts");
    expect(parsed.kind).toBe("alert-summary");
    expect(parsed.effect).toBe("read-write");
    expect(parsed.enabled).toBe(true);
    expect(parsed.cadence).toBe("0 10 * * 1-5");
  });

  it("refuses a kind this build does not register, naming the kind", () => {
    const error = unwrapErr(parseRecipeDefinition({ value: row({ kind: "exfiltrate" }) }));

    expect(error.code).toBe("UNKNOWN_KIND");
    expect(error.message).toContain("exfiltrate");
    expect(error.message).toBe(
      "recipe 'knock-alerts' names kind 'exfiltrate', which this build does not register — a newer build may, so " +
        "run `slopweaver automation due` from a checkout current with origin/main before treating the row as broken",
    );
  });

  it("refuses a row claiming more than its kind can do", () => {
    const error = unwrapErr(parseRecipeDefinition({ value: row({ effect: "write", kind: BRIEFING_KIND }) }));

    expect(error.code).toBe("EFFECT_EXCEEDS_KIND");
    expect(error.message).toContain("declares effect 'write'");
    expect(error.message).toContain("only capable of 'read'");
  });

  it("accepts a row declaring LESS than its kind can do, because narrowing is always safe", () => {
    const parsed = unwrap(parseRecipeDefinition({ value: row({ effect: "read", kind: "metrics-push" }) }));

    expect(parsed.effect).toBe("read");
    expect(parsed.kind).toBe("metrics-push");
  });

  it("reports every schema issue rather than only the first", () => {
    const error = unwrapErr(parseRecipeDefinition({ value: { schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION } }));

    expect(error.code).toBe("MALFORMED_DEFINITION");
    expect(error.message).toContain("recipeId");
    expect(error.message).toContain("cadence");
  });

  it("refuses a schema version this build does not write", () => {
    const error = unwrapErr(parseRecipeDefinition({ value: row({ schemaVersion: 2 }) }));

    expect(error.code).toBe("MALFORMED_DEFINITION");
    expect(error.message).toContain("schemaVersion");
  });

  it("refuses a recipeId every verb would read as a flag, so its failure can always be taken and explained", () => {
    const error = unwrapErr(parseRecipeDefinition({ value: row({ recipeId: "--help" }) }));

    expect(error.code).toBe("MALFORMED_DEFINITION");
    expect(error.message).toContain("a recipeId must not start with '-', which every verb reads as a flag");
  });

  it("refuses a recipeId no command can name: a NUL, a bidirectional override or a lone surrogate in it", () => {
    const refused = [
      `a${String.fromCharCode(0)}b`,
      `a${String.fromCharCode(0x202e)}b`,
      `a${String.fromCharCode(0xd800)}b`,
    ];

    for (const recipeId of refused) {
      const error = unwrapErr(parseRecipeDefinition({ value: row({ recipeId }) }));

      expect(error.code).toBe("MALFORMED_DEFINITION");
      expect(error.message).toContain(
        "a recipeId must not carry a control, format, separator or lone surrogate character, which no command can name",
      );
    }
  });

  it("loads a recipeId a quoted command carries, spaces and a paired surrogate included", () => {
    const recipeId = `acme digest ${String.fromCodePoint(0x1f600)}`;

    expect(unwrap(parseRecipeDefinition({ value: row({ recipeId }) })).recipeId).toBe(recipeId);
  });

  it("keeps an explicit onMissed rather than overriding it from the destination", () => {
    const parsed = unwrap(parseRecipeDefinition({ value: row({ onMissed: "backfill" }) }));

    expect(parsed.onMissed).toBe("backfill");
  });

  it("defaults onMissed from the destination when the row declared none", () => {
    const slack = unwrap(parseRecipeDefinition({ value: row() }));
    const push = unwrap(
      parseRecipeDefinition({
        value: row({ destination: { kind: "datadog-push" }, effect: "read-write", kind: "metrics-push" }),
      }),
    );

    expect(slack.onMissed).toBe("skip");
    expect(push.onMissed).toBe("backfill");
  });

  it("carries params through untouched, since the kind validates their shape", () => {
    const parsed = unwrap(
      parseRecipeDefinition({ value: row({ params: { lookbackDays: 3, metric: "sdlc.landings" } }) }),
    );

    expect(parsed.params).toEqual({ lookbackDays: 3, metric: "sdlc.landings" });
  });

  it("parks a disabled row without rejecting it", () => {
    const parsed = unwrap(parseRecipeDefinition({ value: row({ enabled: false }) }));

    expect(parsed.enabled).toBe(false);
  });

  it("leaves hold undefined on a row that declares none", () => {
    const parsed = unwrap(parseRecipeDefinition({ value: row() }));

    expect(parsed.hold).toBe(undefined);
  });

  it("carries an uncleared hold through, reason and instant intact", () => {
    const parsed = unwrap(
      parseRecipeDefinition({
        value: row({
          hold: {
            askedIso: "2026-09-19T04:24:57.000Z",
            clearedBy: null,
            reason: "owner 290-22: the alert-channel digests stay off",
          },
        }),
      }),
    );

    expect(parsed.hold).toEqual({
      askedIso: "2026-09-19T04:24:57.000Z",
      clearedBy: null,
      reason: "owner 290-22: the alert-channel digests stay off",
    });
  });

  it("carries the DM message a release names, so a reader can go and read it", () => {
    const parsed = unwrap(
      parseRecipeDefinition({
        value: row({
          hold: {
            askedIso: "2026-09-19T04:24:57.000Z",
            clearedBy: { atIso: "2026-09-20T01:00:00.000Z", dmChannel: "D0SYN000002", ts: "1789800000.000100" },
            reason: "owner 290-22: the alert-channel digests stay off",
          },
        }),
      }),
    );

    expect(parsed.hold?.clearedBy).toEqual({
      atIso: "2026-09-20T01:00:00.000Z",
      dmChannel: "D0SYN000002",
      ts: "1789800000.000100",
    });
  });

  it("leaves channelApprovals undefined on a row the owner has approved no channel for", () => {
    const parsed = unwrap(parseRecipeDefinition({ value: row() }));

    expect(parsed.channelApprovals).toBe(undefined);
  });

  it("carries the owner's recorded channel approval through, with the DM message that anchors it", () => {
    const parsed = unwrap(
      parseRecipeDefinition({
        value: row({
          channelApprovals: [
            {
              atIso: "2026-09-21T04:00:00.000Z",
              channel: "C0TEAM",
              dmChannel: "D0SYN000002",
              ts: "1789800000.000100",
            },
          ],
        }),
      }),
    );

    expect(parsed.channelApprovals).toEqual([
      { atIso: "2026-09-21T04:00:00.000Z", channel: "C0TEAM", dmChannel: "D0SYN000002", ts: "1789800000.000100" },
    ]);
  });

  it("refuses an approval with no ts, because it anchors no message a reader could check", () => {
    const error = unwrapErr(
      parseRecipeDefinition({
        value: row({
          channelApprovals: [{ atIso: "2026-09-21T04:00:00.000Z", channel: "C0TEAM", dmChannel: "D0SYN000002" }],
        }),
      }),
    );

    expect(error.code).toBe("MALFORMED_DEFINITION");
    expect(error.message).toContain("channelApprovals.0.ts");
  });

  it("refuses an approval that names no channel, which would admit nothing and read as admitting something", () => {
    const error = unwrapErr(
      parseRecipeDefinition({
        value: row({
          channelApprovals: [{ atIso: "2026-09-21T04:00:00.000Z", dmChannel: "D0SYN000002", ts: "1789800000.000100" }],
        }),
      }),
    );

    expect(error.code).toBe("MALFORMED_DEFINITION");
    expect(error.message).toContain("channelApprovals.0.channel");
  });

  it("refuses a hold that OMITS clearedBy, so a forgotten release never reads as an absent one", () => {
    const error = unwrapErr(
      parseRecipeDefinition({
        value: row({ hold: { askedIso: "2026-09-19T04:24:57.000Z", reason: "stays off" } }),
      }),
    );

    expect(error.code).toBe("MALFORMED_DEFINITION");
    expect(error.message).toContain("hold.clearedBy");
  });

  it("carries the Queue row a release names — where a session asks the owner, never in a DM", () => {
    const parsed = unwrap(
      parseRecipeDefinition({
        value: row({
          hold: {
            askedIso: "2026-09-21T03:01:34.801Z",
            clearedBy: { atIso: "2026-09-27T09:00:00.000Z", runSlug: "lift-the-vulnfix-topup-hold-on-acme-admin" },
            reason: "owner 291-8x: held",
          },
        }),
      }),
    );

    expect(parsed.hold?.clearedBy).toEqual({
      atIso: "2026-09-27T09:00:00.000Z",
      runSlug: "lift-the-vulnfix-topup-hold-on-acme-admin",
    });
  });

  it("refuses a release naming BOTH a message and a run, and says exactly which field is surplus", () => {
    const error = unwrapErr(
      parseRecipeDefinition({
        value: row({
          hold: {
            askedIso: "2026-09-21T03:01:34.801Z",
            clearedBy: { atIso: "2026-09-27T09:00:00.000Z", runSlug: "a-row", ts: "1789800000.000100" },
            reason: "held",
          },
        }),
      }),
    );

    expect(error.message).toBe('not a recipe definition: hold.clearedBy: Unrecognized key: "ts"');
  });

  it.each(["", "   ", "\u0085"])(
    "refuses a Queue release whose runSlug is %j, naming the field at its full path",
    (runSlug) => {
      const error = unwrapErr(
        parseRecipeDefinition({
          value: row({
            hold: {
              askedIso: "2026-09-21T03:01:34.801Z",
              clearedBy: { atIso: "2026-09-27T09:00:00.000Z", runSlug },
              reason: "held",
            },
          }),
        }),
      );

      expect(error.message).toBe(
        "not a recipe definition: hold.clearedBy.runSlug: must carry a non-whitespace character",
      );
    },
  );

  it.each(["   ", "yesterday"])("refuses a Queue release whose atIso is %j, since it records no instant", (atIso) => {
    const error = unwrapErr(
      parseRecipeDefinition({
        value: row({
          hold: { askedIso: "2026-09-21T03:01:34.801Z", clearedBy: { atIso, runSlug: "a-row" }, reason: "held" },
        }),
      }),
    );

    expect(error.message).toBe("not a recipe definition: hold.clearedBy.atIso: Invalid ISO datetime");
  });

  it("refuses a channel approval whose runSlug is only whitespace, so it cannot admit a team channel", () => {
    const error = unwrapErr(
      parseRecipeDefinition({
        value: row({
          channelApprovals: [{ atIso: "2026-09-27T09:00:00.000Z", channel: "C0TEAM", runSlug: "   " }],
        }),
      }),
    );

    expect(error.message).toBe(
      "not a recipe definition: channelApprovals.0.runSlug: must carry a non-whitespace character",
    );
  });

  it("carries a channel approval anchored to the owner's Queue answer", () => {
    const parsed = unwrap(
      parseRecipeDefinition({
        value: row({
          channelApprovals: [{ atIso: "2026-09-27T09:00:00.000Z", channel: "C0TEAM", runSlug: "a-row" }],
        }),
      }),
    );

    expect(parsed.channelApprovals).toEqual([
      { atIso: "2026-09-27T09:00:00.000Z", channel: "C0TEAM", runSlug: "a-row" },
    ]);
  });

  it("refuses a release with no ts, because it anchors no message a reader could check", () => {
    const error = unwrapErr(
      parseRecipeDefinition({
        value: row({
          hold: {
            askedIso: "2026-09-19T04:24:57.000Z",
            clearedBy: { atIso: "2026-09-20T01:00:00.000Z", dmChannel: "D0SYN000002" },
            reason: "stays off",
          },
        }),
      }),
    );

    expect(error.code).toBe("MALFORMED_DEFINITION");
    expect(error.message).toContain("hold.clearedBy.ts");
  });

  it("refuses a release with an EMPTY dmChannel rather than taking it as a cleared hold", () => {
    const error = unwrapErr(
      parseRecipeDefinition({
        value: row({
          hold: {
            askedIso: "2026-09-19T04:24:57.000Z",
            clearedBy: { atIso: "2026-09-20T01:00:00.000Z", dmChannel: "", ts: "1789800000.000100" },
            reason: "stays off",
          },
        }),
      }),
    );

    expect(error.code).toBe("MALFORMED_DEFINITION");
    expect(error.message).toContain("hold.clearedBy.dmChannel");
  });

  it("refuses a hold with an empty reason, because a rail nobody can read is one nobody can lift", () => {
    const error = unwrapErr(
      parseRecipeDefinition({
        value: row({ hold: { askedIso: "2026-09-19T04:24:57.000Z", clearedBy: null, reason: "" } }),
      }),
    );

    expect(error.code).toBe("MALFORMED_DEFINITION");
    expect(error.message).toContain("hold.reason");
  });

  it("carries a failure hold's finding slug, and strips a stored findingState — it is only ever derived", () => {
    const parsed = unwrap(
      parseRecipeDefinition({
        value: row({
          hold: {
            askedIso: "2026-09-29T02:05:00.000Z",
            clearedBy: null,
            finding: "recipe-failing-resync-atlas-vanta-a1",
            findingState: { held: false, line: "forged" },
            reason: "held by the store",
          },
        }),
      }),
    );

    expect(parsed.hold).toEqual({
      askedIso: "2026-09-29T02:05:00.000Z",
      clearedBy: null,
      finding: "recipe-failing-resync-atlas-vanta-a1",
      reason: "held by the store",
    });
  });

  it("refuses a failure hold whose finding is not a board row slug", () => {
    const error = unwrapErr(
      parseRecipeDefinition({
        value: row({
          hold: { askedIso: "2026-09-29T02:05:00.000Z", clearedBy: null, finding: "../escape", reason: "held" },
        }),
      }),
    );

    expect(error.code).toBe("MALFORMED_DEFINITION");
    expect(error.message).toContain("hold.finding: must be a board row slug");
  });

  it("carries an owner hold's placedBy and the row's names verbatim, and strips a stored placedByState", () => {
    const parsed = unwrap(
      parseRecipeDefinition({
        value: row({
          hold: {
            askedIso: "2026-10-19T11:48:00.000Z",
            clearedBy: null,
            placedBy: { anchor: "not even a scheme", words: "Hold the  vulnfix topup" },
            placedByState: { kind: "anchored" },
            reason: "the owner's pause",
          },
          names: ["vulnfix topup"],
        }),
      }),
    );

    expect([parsed.hold, parsed.names]).toEqual([
      {
        askedIso: "2026-10-19T11:48:00.000Z",
        clearedBy: null,
        placedBy: { anchor: "not even a scheme", words: "Hold the  vulnfix topup" },
        reason: "the owner's pause",
      },
      ["vulnfix topup"],
    ]);
  });

  it("refuses a placedBy with blank words or a key it does not declare, and a blank name", () => {
    const blankWords = unwrapErr(
      parseRecipeDefinition({
        value: row({
          hold: { askedIso: "x", clearedBy: null, placedBy: { anchor: "talk:t1", words: " " }, reason: "held" },
        }),
      }),
    );
    const extraKey = unwrapErr(
      parseRecipeDefinition({
        value: row({
          hold: {
            askedIso: "x",
            clearedBy: null,
            placedBy: { anchor: "talk:t1", by: "chair", words: "vulnfix" },
            reason: "held",
          },
        }),
      }),
    );
    const blankName = unwrapErr(parseRecipeDefinition({ value: row({ names: [""] }) }));

    expect(blankWords.message).toContain("hold.placedBy.words: must carry a non-whitespace character");
    expect(extraKey.message).toContain("hold.placedBy");
    expect(blankName.message).toContain("names.0: must carry a non-whitespace character");
  });
});

describe("resolveOnMissed", () => {
  it("skips a Slack destination — three summaries in a row is noise nobody asked for", () => {
    expect(resolveOnMissed({ destination: { kind: "slack" } })).toBe("skip");
  });

  it("backfills a push destination — a hole in a chart is data that is simply gone", () => {
    expect(resolveOnMissed({ destination: { kind: "datadog-push" } })).toBe("backfill");
    expect(resolveOnMissed({ destination: { kind: "local-atlas" } })).toBe("backfill");
  });
});

describe("the kind registry", () => {
  it("pins the one open kind to read, which is what makes it admissible at all", () => {
    const briefing = findRecipeKind({ kind: BRIEFING_KIND })!;

    expect(briefing.briefingOnly).toBe(true);
    expect(briefing.capability).toBe("read");
  });

  it("registers exactly one briefing-only kind, so the escape hatch cannot quietly multiply", () => {
    expect(findRecipeKind({ kind: "metrics-push" })!.briefingOnly).toBe(false);
    expect(findRecipeKind({ kind: "verb-run" })!.briefingOnly).toBe(false);
    expect(findRecipeKind({ kind: "alert-summary" })!.briefingOnly).toBe(false);
  });

  it("marks only the metric push as covering one slot per run, so backfill walks slots for nothing else", () => {
    expect(findRecipeKind({ kind: "metrics-push" })!.perSlot).toBe(true);
    expect(findRecipeKind({ kind: "verb-run" })!.perSlot).toBe(false);
    expect(findRecipeKind({ kind: "alert-summary" })!.perSlot).toBe(false);
    expect(findRecipeKind({ kind: "datadog-alert-digest" })!.perSlot).toBe(false);
    expect(findRecipeKind({ kind: BRIEFING_KIND })!.perSlot).toBe(false);
  });

  it("answers undefined for a name nothing registers", () => {
    expect(findRecipeKind({ kind: "nope" })).toBeUndefined();
  });
});

describe("recipeEffectExceedsKind", () => {
  it("refuses widening in every direction that matters", () => {
    expect(recipeEffectExceedsKind({ capability: "read", declared: "write" })).toBe(true);
    expect(recipeEffectExceedsKind({ capability: "read", declared: "read-write" })).toBe(true);
    expect(recipeEffectExceedsKind({ capability: "write", declared: "read-write" })).toBe(true);
    expect(recipeEffectExceedsKind({ capability: "write", declared: "read" })).toBe(true);
  });

  it("permits declaring the same, or less", () => {
    expect(recipeEffectExceedsKind({ capability: "read", declared: "read" })).toBe(false);
    expect(recipeEffectExceedsKind({ capability: "write", declared: "write" })).toBe(false);
    expect(recipeEffectExceedsKind({ capability: "read-write", declared: "read" })).toBe(false);
    expect(recipeEffectExceedsKind({ capability: "read-write", declared: "write" })).toBe(false);
    expect(recipeEffectExceedsKind({ capability: "read-write", declared: "read-write" })).toBe(false);
  });
});
