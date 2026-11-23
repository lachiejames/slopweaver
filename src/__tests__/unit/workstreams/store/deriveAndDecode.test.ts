/**
 * A workstream's progress, derived from its own milestones and entries rather than a generic bar, and the two `jsonb`
 * documents decoded against their kind on every read and write.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { decodeAggregate, decodeWorkstreamDetail, decodeWorkstreamMeta } from "../../../../workstreams/store/decode.js";
import { deriveWorkstreamProgress, workstreamProgressLine } from "../../../../workstreams/store/derive.js";
import { ACME_META, acmeLocal, acmeOutcome, OWN_DETAIL } from "../../../workstreamStoreFixtures.js";

describe("deriveWorkstreamProgress", () => {
  it("counts finished milestones and names the one ready milestone as next", () => {
    const progress = deriveWorkstreamProgress({ aggregate: acmeOutcome() })!;

    expect(progress.doneCount).toBe(1);
    expect(progress.totalCount).toBe(3);
    expect(progress.ready.map((one) => one.id)).toEqual(["pilot"]);
    expect(progress.next!.id).toBe("pilot");
    expect(progress.complete).toBe(false);
    expect(workstreamProgressLine({ progress })).toBe("1 of 3 done, next: Pilot live");
  });

  it("orders ready milestones by position, not by the order they were handed in", () => {
    // Nothing done, milestones handed in reversed: scope and pilot are both ready, and scope sits first by position.
    const milestones = acmeOutcome().milestones.toReversed();
    const progress = deriveWorkstreamProgress({ aggregate: acmeOutcome({ entries: [], milestones }) })!;

    expect(milestones.map((one) => one.id)).toEqual(["rollout", "pilot", "scope"]);
    expect(progress.ready.map((one) => one.id)).toEqual(["scope", "pilot"]);
    expect(progress.next!.id).toBe("scope");
  });

  // Which milestone completion is taken from is the next test, whose only finished milestone is the definition of done.
  it("leaves nothing ready or next once every milestone is finished, and reads as the whole count", () => {
    const [scoped, piloted] = acmeOutcome().entries;
    const finish = { done: true, href: "https://example.com/acme/proof" };
    const entries = [
      scoped!,
      { ...piloted!, ...finish },
      { ...piloted!, ...finish, id: "00000000-0000-4000-8000-000000000003", milestoneId: "rollout", position: 2 },
    ];
    const progress = deriveWorkstreamProgress({ aggregate: acmeOutcome({ entries }) })!;

    expect(progress.complete).toBe(true);
    expect(progress.ready).toEqual([]);
    expect(progress.next).toBeNull();
    expect(workstreamProgressLine({ progress })).toBe("3 of 3 done");
  });

  it("takes completion from the definition of done alone, not from every milestone being finished", () => {
    // Only the definition of done is finished. The port refuses this order, but derive is judged on its own rule.
    const [scoped] = acmeOutcome().entries;
    const entries = [{ ...scoped!, href: "https://example.com/acme/proof", milestoneId: "rollout" }];
    const progress = deriveWorkstreamProgress({ aggregate: acmeOutcome({ entries }) })!;

    expect(progress.complete).toBe(true);
    expect(progress.doneCount).toBe(1);
    expect(progress.ready.map((one) => one.id)).toEqual(["scope", "pilot"]);
  });

  it("is null for a kind that carries no milestones", () => {
    expect(deriveWorkstreamProgress({ aggregate: acmeLocal({ id: "acme-scratch" }) })).toBeNull();
  });
});

describe("decodeWorkstreamDetail", () => {
  it("decodes an outcome detail, filling a defaulted field", () => {
    const { ending: _ending, ...withoutEnding } = OWN_DETAIL;
    const decoded = unwrap(decodeWorkstreamDetail({ kind: "outcome", owner: "acme-onboarding", value: withoutEnding }));

    expect(decoded["ending"]).toBeNull();
    expect(decoded["team"]).toBe("platform");
  });

  it("refuses a field of the retired five-step bar, naming where it is", () => {
    const problems = unwrapErr(
      decodeWorkstreamDetail({ kind: "outcome", owner: "acme-onboarding", value: { ...OWN_DETAIL, reaches: 50 } }),
    );

    expect(problems).toEqual(['acme-onboarding detail: Unrecognized key: "reaches"']);
  });

  it("judges a detail by its own kind: an outcome's fields are not a local workstream's", () => {
    // A valid local detail plus one outcome field, so the only rule that can refuse it is the foreign field.
    const value = { note: "kept on the page", team: OWN_DETAIL.team };

    expect(
      unwrap(decodeWorkstreamDetail({ kind: "local", owner: "acme-scratch", value: { note: value.note } })),
    ).toEqual({
      note: "kept on the page",
    });
    expect(unwrapErr(decodeWorkstreamDetail({ kind: "local", owner: "acme-scratch", value }))).toEqual([
      'acme-scratch detail: Unrecognized key: "team"',
    ]);
  });
});

describe("decodeWorkstreamMeta", () => {
  it("decodes the register document and refuses a channel key that is not a Slack id", () => {
    expect(unwrap(decodeWorkstreamMeta({ value: ACME_META }))).toEqual(ACME_META);
    const problems = unwrapErr(decodeWorkstreamMeta({ value: { ...ACME_META, channels: { general: "acme" } } }));
    expect(problems).toEqual(["register meta.channels.general: Invalid key in record"]);
  });
});

describe("decodeAggregate", () => {
  it("decodes an authored aggregate and refuses one whose kind is outside the closed set", () => {
    const local = acmeLocal({ id: "acme-scratch" });
    expect(unwrap(decodeAggregate({ value: local }))).toEqual(local);
    const problems = unwrapErr(decodeAggregate({ value: { ...local, kind: "acme" } }));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toContain("the workstream");
  });
});
