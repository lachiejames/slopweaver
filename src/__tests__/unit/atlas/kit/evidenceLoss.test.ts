import { describe, expect, it } from "vitest";

import { evidenceOf, refuseEvidenceLoss } from "../../../../atlas/kit/evidenceLoss.js";
import { atlasPublishErrorLines } from "../../../../atlas/kit/publishErrors.js";
import { unwrapErr } from "../../../../lib/result.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

/** One entity shaped the way the kit's own contract shapes them: artifacts hang off `sources`. */
function entity({ id, digests }: { id: string; digests: readonly string[] }): unknown {
  return {
    id,
    sources: [
      {
        artifacts: digests.map((sha256) => ({
          byteLength: 10,
          kind: "page-png",
          mediaType: "image/png",
          relativePath: `artifacts/${sha256}.png`,
          sha256,
        })),
        endpoint: "/settings/profile",
      },
    ],
  };
}

describe("evidenceOf", () => {
  it("counts entities and the distinct artifacts they reach", () => {
    const measured = evidenceOf({
      entities: [entity({ digests: [DIGEST_A], id: "one" }), entity({ digests: [DIGEST_B], id: "two" })],
    });
    expect(measured).toEqual({ artifacts: 2, entities: 2 });
  });

  it("counts one shared picture once, because content addressing makes two rows share a file", () => {
    const measured = evidenceOf({
      entities: [entity({ digests: [DIGEST_A], id: "one" }), entity({ digests: [DIGEST_A], id: "two" })],
    });
    expect(measured).toEqual({ artifacts: 1, entities: 2 });
  });

  it("counts nothing for entities carrying no artifact at all", () => {
    expect(evidenceOf({ entities: [entity({ digests: [], id: "one" })] })).toEqual({ artifacts: 0, entities: 1 });
  });

  it("counts nothing for an empty kind file", () => {
    expect(evidenceOf({ entities: [] })).toEqual({ artifacts: 0, entities: 0 });
  });

  it("ignores a digest-shaped string that is not an artifact reference", () => {
    expect(evidenceOf({ entities: [{ id: "one", proofSha: DIGEST_A }] })).toEqual({ artifacts: 0, entities: 1 });
  });
});

describe("refuseEvidenceLoss", () => {
  it("refuses the measured case: a failed run republishing every page with no screenshots", () => {
    const refused = refuseEvidenceLoss({
      changes: [
        {
          attemptFailed: true,
          existing: { artifacts: 31, entities: 31 },
          incoming: { artifacts: 0, entities: 31 },
          kind: "page",
        },
      ],
      platform: "github",
    });
    expect(refused.isErr()).toBe(true);
    expect(atlasPublishErrorLines({ error: unwrapErr(refused) })[0]).toBe(
      "this github run FAILED and would publish less than the store already holds, so it is refused:",
    );
    expect(atlasPublishErrorLines({ error: unwrapErr(refused) })[1]).toBe(
      "  page (degraded): 31 entities / 0 artifact(s), replacing 31 / 31",
    );
    expect(atlasPublishErrorLines({ error: unwrapErr(refused) })[2]).toContain("the record that worked still stands");
  });

  it("refuses a failed run that lost rows even when its artifacts held", () => {
    const refused = refuseEvidenceLoss({
      changes: [
        {
          attemptFailed: true,
          existing: { artifacts: 4, entities: 9 },
          incoming: { artifacts: 4, entities: 2 },
          kind: "method",
        },
      ],
      platform: "notion",
    });
    expect(refused.isErr()).toBe(true);
    expect(atlasPublishErrorLines({ error: unwrapErr(refused) })[1]).toBe(
      "  method (degraded): 2 entities / 4 artifact(s), replacing 9 / 4",
    );
  });

  it("refuses a SUCCEEDING pass that would empty a kind, which is the owner's ruling", () => {
    const refused = refuseEvidenceLoss({
      changes: [
        {
          attemptFailed: false,
          existing: { artifacts: 0, entities: 500 },
          incoming: { artifacts: 0, entities: 0 },
          kind: "control",
        },
      ],
      platform: "vanta",
    });
    expect(refused.isErr()).toBe(true);
    expect(atlasPublishErrorLines({ error: unwrapErr(refused) })[0]).toBe(
      "this vanta publish would empty a kind the store already holds, so it is refused:",
    );
    expect(atlasPublishErrorLines({ error: unwrapErr(refused) })[1]).toBe(
      "  control (emptied): 0 entities / 0 artifact(s), replacing 500 / 0",
    );
  });

  it("refuses an emptying publish even when the store held only one entity", () => {
    const refused = refuseEvidenceLoss({
      changes: [
        {
          attemptFailed: false,
          existing: { artifacts: 0, entities: 1 },
          incoming: { artifacts: 0, entities: 0 },
          kind: "policy",
        },
      ],
      platform: "vanta",
    });
    expect(refused.isErr()).toBe(true);
    expect(atlasPublishErrorLines({ error: unwrapErr(refused) })[1]).toBe(
      "  policy (emptied): 0 entities / 0 artifact(s), replacing 1 / 0",
    );
  });

  it("admits the emptying publish when the operator has opened the hatch for this run", () => {
    const allowed = refuseEvidenceLoss({
      changes: [
        {
          attemptFailed: false,
          existing: { artifacts: 0, entities: 500 },
          incoming: { artifacts: 0, entities: 0 },
          kind: "control",
        },
      ],
      overrideOpen: true,
      platform: "vanta",
    });
    expect(allowed.isOk()).toBe(true);
  });

  it("lets a failed run that kept everything publish, which is what a failed status is FOR", () => {
    const allowed = refuseEvidenceLoss({
      changes: [
        {
          attemptFailed: true,
          existing: { artifacts: 31, entities: 31 },
          incoming: { artifacts: 31, entities: 31 },
          kind: "page",
        },
      ],
      platform: "github",
    });
    expect(allowed.isOk()).toBe(true);
  });

  it("lets a SUCCEEDING run shrink a kind to a non-zero count, because a genuinely deleted record is a fact", () => {
    const allowed = refuseEvidenceLoss({
      changes: [
        {
          attemptFailed: false,
          existing: { artifacts: 31, entities: 31 },
          incoming: { artifacts: 0, entities: 4 },
          kind: "page",
        },
      ],
      platform: "github",
    });
    expect(allowed.isOk()).toBe(true);
  });

  it("allows a 0 to 0 publish, where there is nothing to lose", () => {
    const allowed = refuseEvidenceLoss({
      changes: [
        {
          attemptFailed: false,
          existing: { artifacts: 0, entities: 0 },
          incoming: { artifacts: 0, entities: 0 },
          kind: "audit",
        },
      ],
      platform: "vanta",
    });
    expect(allowed.isOk()).toBe(true);
  });

  it("compares against nothing on a first publish, and on a publish after a reset archived the directory", () => {
    const allowed = refuseEvidenceLoss({
      changes: [{ attemptFailed: true, existing: null, incoming: { artifacts: 0, entities: 0 }, kind: "page" }],
      platform: "github",
    });
    expect(allowed.isOk()).toBe(true);
  });

  it("names every kind that would lose evidence, under whichever rule caught it", () => {
    const refused = refuseEvidenceLoss({
      changes: [
        {
          attemptFailed: true,
          existing: { artifacts: 3, entities: 3 },
          incoming: { artifacts: 0, entities: 3 },
          kind: "page",
        },
        {
          attemptFailed: false,
          existing: { artifacts: 9, entities: 9 },
          incoming: { artifacts: 0, entities: 0 },
          kind: "entity",
        },
        {
          attemptFailed: true,
          existing: { artifacts: 1, entities: 5 },
          incoming: { artifacts: 1, entities: 1 },
          kind: "method",
        },
      ],
      platform: "notion",
    });
    expect(refused.isErr()).toBe(true);
    expect(atlasPublishErrorLines({ error: unwrapErr(refused) })).toHaveLength(5);
    expect(atlasPublishErrorLines({ error: unwrapErr(refused) })[0]).toBe(
      "this notion publish would empty a kind the store already holds, so it is refused:",
    );
    expect(atlasPublishErrorLines({ error: unwrapErr(refused) })[1]).toBe(
      "  page (degraded): 3 entities / 0 artifact(s), replacing 3 / 3",
    );
    expect(atlasPublishErrorLines({ error: unwrapErr(refused) })[2]).toBe(
      "  entity (emptied): 0 entities / 0 artifact(s), replacing 9 / 9",
    );
    expect(atlasPublishErrorLines({ error: unwrapErr(refused) })[3]).toBe(
      "  method (degraded): 1 entities / 1 artifact(s), replacing 5 / 1",
    );
  });

  it("allows a generation with no kinds being written at all", () => {
    expect(refuseEvidenceLoss({ changes: [], platform: "github" }).isOk()).toBe(true);
  });
});
