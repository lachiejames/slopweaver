/**
 * Each producer's document turned into its tick observation — the mapping `supervisor tick-draft` is.
 *
 * Documents come from `../tickDraftDocumentsFixture.ts`, built over the producers' own builders and serialised
 * through JSON first, so a key the producer omits is omitted here too rather than being present-and-undefined
 * only in a test. This file holds what is never drafted, and what was never supplied.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { draftTickSources } from "../../../../supervisor/tickDraftSources.js";
import { CAPTURED, diagnosticOf, STARTED } from "../tickDraftSourcesFixture.js";

describe("draftTickSources — what is never drafted, and what was never supplied", () => {
  it("records every source unavailable when no document is supplied, naming the flag and the verb", () => {
    const sources = unwrap(draftTickSources({ capturedIso: CAPTURED, captures: {}, startedIso: STARTED }));

    expect(sources.capacity.status).toBe("unavailable");
    expect(sources.capacity.observedAtIso).toBe(CAPTURED);
    expect(sources.capacity.witness).toStrictEqual({ command: "slopweaver supervisor tick-draft", exitCode: null });
    expect(diagnosticOf({ observation: sources.capacity })).toBe(
      "not supplied: no --capacity was given, so `slopweaver machine capacity --json` was not recorded this tick",
    );
  });

  it("never drafts depth, github or landings, and says why for each", () => {
    const sources = unwrap(draftTickSources({ capturedIso: CAPTURED, captures: {}, startedIso: STARTED }));

    expect(sources.depth.status).toBe("unavailable");
    expect(diagnosticOf({ observation: sources.depth })).toBe(
      "not drafted: `session depth` grades a session `review`, which is not a respawn decision, and nothing produces the tick's `respawnCandidate`",
    );
    expect(diagnosticOf({ observation: sources.github })).toContain("no pull-request source reaches this verb");
    expect(diagnosticOf({ observation: sources.landings })).toContain("no verb names what landed");
  });
});
