/*
 * The owner's standing word on a class of act takes every act of its kinds off the check-in list, and nothing else:
 * `autonomy list --json` carries the class steer on each entry, `readAutonomy` reads it as the act's steer
 * when the owner has said nothing about that act in particular, and `rowsOf` drops every steered act.
 */

import { describe, expect, it } from "vitest";

import { readAutonomy } from "../../components/live/readAutonomy";
import type { LiveState } from "../../components/live/useLive";
import { rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;
const PR = "https://github.com/lachiejames/slopweaver/pull/1336";
const STANDING = {
  actionId: "class.self-merge-own-prs",
  anchor: "transcript:a0000032#70ca5dd7",
  bySession: "supervisor",
  kinds: "press-merge-when-ready,land-own-pull-request",
  steer: "press merge when ready on my green pull requests",
  steeredIso: "2026-09-26T06:30:00.000Z",
};

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-26T06:40:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** One act as the ledger prints it. */
function entry({ actionId, kind, extra = {} }: { actionId: string; kind: string; extra?: Record<string, unknown> }) {
  return { action: { actionId, doneIso: "2026-09-26T06:00:00.000Z", kind, subject: PR, why: "green" }, ...extra };
}

const read = readAutonomy([
  entry({ actionId: "a-press", extra: { classSteer: STANDING }, kind: "press-merge-when-ready" }),
  entry({
    actionId: "a-own-word",
    extra: { classSteer: STANDING, latestSteer: { steer: "that one went out broken" } },
    kind: "press-merge-when-ready",
  }),
  entry({ actionId: "a-finding", kind: "open-internal-finding-pull-request" }),
  entry({ actionId: "a-mislabelled", extra: { classSteer: STANDING }, kind: "slack.post.as-me" }),
])!;

describe("a class-settled act on the owner's check-in list", () => {
  it("reads the class word as the act's steer, and the owner's own word on the act over it", () => {
    expect(read.map((row) => row.steer)).toEqual([STANDING.steer, "that one went out broken", undefined, undefined]);
  });

  it("leaves only kinds the class does not name on the list", () => {
    const rows = rowsOf({
      reviewers: LOADING,
      standing: LOADING,
      acts: ready({ value: read }),
      board: LOADING,
      drafts: LOADING,
      hands: LOADING,
      landing: LOADING,
      placer: ACME_PLACER,
      posts: LOADING,
      reviews: LOADING,
      imports: LOADING,
    }).filter((row) => row.kind === "act");
    expect(rows.map((row) => row.id).toSorted()).toEqual(["a-finding", "a-mislabelled"]);
  });
});
