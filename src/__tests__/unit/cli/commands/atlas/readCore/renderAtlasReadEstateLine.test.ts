/*
 * `renderAtlasRead`'s estate line: a positive page whose records no authoritative surface has seen is qualified, and
 * a page off the authoritative surface carries no such line.
 */
import { describe, expect, it } from "vitest";

import { answerAtlasRead } from "../../../../../../atlas/kit/readAnswer.js";
import { renderAtlasRead } from "../../../../../../cli/commands/atlas/readCore.js";
import { FIXTURE_NOW_MS, snapshot } from "./harness.js";

describe("renderAtlasRead — the estate line", () => {
  /** The fixture's records, re-observed on the surfaces a case names. */
  function seenOn({ surface }: { surface: string }): ReturnType<typeof answerAtlasRead> {
    const base = snapshot();
    const kind = base.kinds[0]!;
    const entity = kind.entities[0]!;
    const kinds = [{ ...kind, entities: [{ ...entity, observations: [{ ...entity.observations[0]!, surface }] }] }];
    return answerAtlasRead({
      kinds,
      nowMs: FIXTURE_NOW_MS,
      selection: { includeStale: false },
      snapshot: { ...base, kinds },
    });
  }

  it("qualifies a POSITIVE page whose records no authoritative surface has ever seen", () => {
    const lines = renderAtlasRead({ acceptUnproven: false, result: seenOn({ surface: "dashboard" }) });
    const estate = lines.filter((line) => line.includes("NOT ANSWERABLE ABOUT THE ESTATE"));
    expect(estate.length).toBe(1);
    expect(estate[0]).toContain("all 1 stored record(s) here were observed on dashboard");
    expect(estate[0]).toContain("cloudflare declares no authoritative role for any of them");
  });

  it("stays silent when the records came off the authoritative surface", () => {
    const lines = renderAtlasRead({ acceptUnproven: false, result: seenOn({ surface: "rest-api" }) });
    expect(lines.filter((line) => line.includes("NOT ANSWERABLE ABOUT THE ESTATE"))).toEqual([]);
  });
});
