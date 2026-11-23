/**
 * The order `handover wake` spends its reseats in: a park on work still to land before one whose pull request
 * ended, a doc naming no `repo:` last, each group least recently tried first — never slug order, which let rows
 * re-parking at the front of the alphabet take every reseat while older parks starved.
 */
import { describe, expect, it } from "vitest";

import type { ParkWakeJudgement } from "../../../handover/parkWake.js";
import { inWakeOrder } from "../../../handover/wakeOrder.js";

const OPEN_DUE: ParkWakeJudgement = {
  kind: "due",
  observed: { atIso: "2026-11-06T06:00:00.000Z", kind: "at" },
  reason: "its instant passed",
};
const MERGED_DUE: ParkWakeJudgement = {
  kind: "due",
  observed: { kind: "checks", number: 1, prState: "MERGED", repo: "acme/acme" },
  reason: "it merged",
};
const CLOSED_DUE: ParkWakeJudgement = {
  kind: "due",
  observed: { kind: "checks", number: 1, prState: "CLOSED", repo: "acme/acme" },
  reason: "it closed",
};

/** One due park, due since the given instant, with this run's judgement of it. */
function park({
  slug,
  atIso,
  judgement = OPEN_DUE,
  namesRepo = true,
}: {
  slug: string;
  atIso: string;
  judgement?: ParkWakeJudgement;
  /** Whether the park's doc names the `repo:` that `cmux spawn` needs. */
  namesRepo?: boolean;
}): {
  readonly slug: string;
  readonly dueSinceIso: string;
  readonly key: string;
  readonly candidate: { readonly docRepo: string | undefined };
  readonly judgement: ParkWakeJudgement;
} {
  const docRepo = namesRepo ? "acme/acme" : undefined;
  return { candidate: { docRepo }, dueSinceIso: atIso, judgement, key: `k-${slug}`, slug };
}

/** The slugs of the parks, in the order given. */
function slugs({ parks }: { parks: readonly { readonly slug: string }[] }): readonly string[] {
  return parks.map((entry) => entry.slug);
}

describe("inWakeOrder", () => {
  it("puts the longest-due park first, whatever its slug", () => {
    const due = [
      park({ atIso: "2026-11-06T05:52:00.000Z", slug: "a-requeued-every-tick" }),
      park({ atIso: "2026-11-05T06:50:51.212Z", slug: "acme-trim-queue-card-text" }),
      park({ atIso: "2026-11-06T03:23:02.641Z", slug: "why-are-the-unit-tests-slow" }),
    ];
    expect(slugs({ parks: inWakeOrder({ due, lastTried: new Map() }) })).toEqual([
      "acme-trim-queue-card-text",
      "why-are-the-unit-tests-slow",
      "a-requeued-every-tick",
    ]);
  });

  it("puts a park whose pull request merged or closed after every other park, however old it is", () => {
    const due = [
      park({ atIso: "2026-11-01T00:00:00.000Z", judgement: MERGED_DUE, slug: "merged-days-ago" }),
      park({ atIso: "2026-11-01T01:00:00.000Z", judgement: CLOSED_DUE, slug: "closed-days-ago" }),
      park({ atIso: "2026-11-06T03:00:00.000Z", slug: "open-draft" }),
    ];
    expect(slugs({ parks: inWakeOrder({ due, lastTried: new Map() }) })).toEqual([
      "open-draft",
      "merged-days-ago",
      "closed-days-ago",
    ]);
  });

  it("puts a park whose doc names no repo after every other park, ended pull requests included", () => {
    const due = [
      park({ atIso: "2026-10-01T00:00:00.000Z", namesRepo: false, slug: "a-no-repo-oldest" }),
      park({ atIso: "2026-11-01T00:00:00.000Z", judgement: MERGED_DUE, slug: "merged" }),
      park({ atIso: "2026-11-06T03:00:00.000Z", slug: "open-draft" }),
    ];
    expect(slugs({ parks: inWakeOrder({ due, lastTried: new Map() }) })).toEqual([
      "open-draft",
      "merged",
      "a-no-repo-oldest",
    ]);
  });

  it("serves a park tried recently behind one in its group that has waited longer since its turn", () => {
    const due = [
      park({ atIso: "2026-11-05T01:00:00.000Z", slug: "failing-spawn" }),
      park({ atIso: "2026-11-05T03:00:00.000Z", slug: "never-tried" }),
    ];
    const lastTried = new Map([["k-failing-spawn", "2026-11-05T05:00:00.000Z"]]);
    expect(slugs({ parks: inWakeOrder({ due, lastTried }) })).toEqual(["never-tried", "failing-spawn"]);
  });

  it("keeps the group ahead of the rotation: a never-tried ended park still waits behind a recently tried open one", () => {
    const due = [
      park({ atIso: "2026-11-01T00:00:00.000Z", judgement: MERGED_DUE, slug: "merged-never-tried" }),
      park({ atIso: "2026-11-05T01:00:00.000Z", slug: "open-tried" }),
    ];
    const lastTried = new Map([["k-open-tried", "2026-11-06T05:00:00.000Z"]]);
    expect(slugs({ parks: inWakeOrder({ due, lastTried }) })).toEqual(["open-tried", "merged-never-tried"]);
  });

  it("orders by the instant, not the string, across a park written without milliseconds", () => {
    const due = [
      park({ atIso: "2026-11-05T14:15:00.500Z", slug: "a-half-second-later" }),
      park({ atIso: "2026-11-05T14:15:00Z", slug: "b-whole-second" }),
    ];
    expect(slugs({ parks: inWakeOrder({ due, lastTried: new Map() }) })).toEqual([
      "b-whole-second",
      "a-half-second-later",
    ]);
  });

  it("breaks a tie on the due instant by slug", () => {
    const at = "2026-11-05T09:00:00.000Z";
    const due = [park({ atIso: at, slug: "zeta" }), park({ atIso: at, slug: "alpha" })];
    expect(slugs({ parks: inWakeOrder({ due, lastTried: new Map() }) })).toEqual(["alpha", "zeta"]);
  });

  it("returns nothing for no parks", () => {
    expect(inWakeOrder({ due: [], lastTried: new Map() })).toEqual([]);
  });
});
