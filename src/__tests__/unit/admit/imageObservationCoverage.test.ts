import { describe, expect, it } from "vitest";

import { admitDoor } from "../../../admit/door.js";
import {
  IMAGE_OBSERVATION_OVERRIDE,
  imageObservationFindings,
  imageObservationGate,
  imageObservationUnfitReasons,
} from "../../../admit/imageObservationCoverage.js";
import type { ReviewedImage } from "../../../admit/reviewVerdict.js";
import type { DoorRequest } from "../../../admit/types.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

/** A fit observation of one attachment. `over` replaces fields so a test states only what it is about. */
const seen = (over: Partial<ReviewedImage> = {}): ReviewedImage => ({
  artifactDigest: DIGEST_A,
  contextRetained: true,
  legible: true,
  observedContent: "the 15d timeseries, query env:staging, y axis 0 to 40",
  path: "/shots/pool.png",
  targetState: "data",
  ...over,
});

const ATTACHED_A = { digest: DIGEST_A, path: "/shots/pool.png" };
const ATTACHED_B = { digest: DIGEST_B, path: "/shots/errors.png" };

const codes = ({ attached, observations }: Parameters<typeof imageObservationFindings>[0]): readonly string[] =>
  imageObservationFindings({ attached, observations }).map((finding) => finding.code);

describe("imageObservationUnfitReasons", () => {
  it("finds nothing wrong with a picture whose target rendered and which reads", () => {
    expect(imageObservationUnfitReasons({ observation: seen() })).toEqual([]);
  });

  it("treats a legitimately empty query as evidence, not as a defect", () => {
    expect(imageObservationUnfitReasons({ observation: seen({ targetState: "zero-results" }) })).toEqual([]);
  });

  it("names the incident's own defect when the panel had not rendered", () => {
    expect(imageObservationUnfitReasons({ observation: seen({ targetState: "empty-panel" }) })).toEqual([
      "empty-panel",
    ]);
  });

  it("names every defect at once, in a stable order", () => {
    const observation = seen({ contextRetained: false, legible: false, targetState: "unloaded" });
    expect(imageObservationUnfitReasons({ observation })).toEqual(["unloaded", "illegible", "context-lost"]);
  });

  it("derives the defect from what was observed, never from the reason the reviewer stated", () => {
    // A reviewer that recorded `legible: false` and left `unfitReason` blank has still said the picture is
    // unreadable. A classifier reading the optional field would report it fit.
    expect(imageObservationUnfitReasons({ observation: seen({ legible: false }) })).toEqual(["illegible"]);
  });
});

describe("imageObservationFindings", () => {
  it("is exact coverage when there are no attachments and no observations", () => {
    expect(imageObservationFindings({ attached: [], observations: [] })).toEqual([]);
  });

  it("is exact coverage when every attachment carries its own observation", () => {
    expect(
      imageObservationFindings({
        attached: [ATTACHED_A, ATTACHED_B],
        observations: [seen(), seen({ artifactDigest: DIGEST_B, path: "/shots/errors.png" })],
      }),
    ).toEqual([]);
  });

  it("reports an attachment nobody looked at, and names it", () => {
    const findings = imageObservationFindings({ attached: [ATTACHED_A, ATTACHED_B], observations: [seen()] });
    expect(findings.map((finding) => finding.code)).toEqual(["ANSWER_IMAGE_OBSERVATION_MISSING"]);
    expect(findings[0]!.summary).toContain("/shots/errors.png");
    expect(findings[0]!.severity).toBe("warn");
  });

  it("reports a verdict with no observations at all against an image-bearing answer", () => {
    expect(codes({ attached: [ATTACHED_A], observations: [] })).toEqual(["ANSWER_IMAGE_OBSERVATION_MISSING"]);
  });

  it("reports two observations of one picture", () => {
    expect(codes({ attached: [ATTACHED_A], observations: [seen(), seen()] })).toEqual([
      "ANSWER_IMAGE_OBSERVATION_DUPLICATE",
    ]);
  });

  it("reports a picture replaced at a reviewed path as stale", () => {
    // The hole the answer digest cannot see: `images` are path strings, so swapping the PNG leaves the
    // verdict binding and unchanged.
    const findings = imageObservationFindings({
      attached: [{ digest: DIGEST_B, path: "/shots/pool.png" }],
      observations: [seen()],
    });
    expect(findings.map((finding) => finding.code)).toEqual([
      "ANSWER_IMAGE_OBSERVATION_MISSING",
      "ANSWER_IMAGE_OBSERVATION_STALE",
    ]);
  });

  it("reports an observation about a picture this send does not carry at all", () => {
    expect(
      codes({ attached: [ATTACHED_A], observations: [seen(), seen({ artifactDigest: DIGEST_B, path: "/other.png" })] }),
    ).toEqual(["ANSWER_IMAGE_OBSERVATION_EXTRA"]);
  });

  it("refuses to let two observations with swapped paths cover two attachments", () => {
    // Each names real attached bytes, and neither describes the picture it claims to. Matching on digest
    // alone would call this exact coverage.
    expect(
      codes({
        attached: [ATTACHED_A, ATTACHED_B],
        observations: [
          seen({ artifactDigest: DIGEST_A, path: "/shots/errors.png" }),
          seen({ artifactDigest: DIGEST_B, path: "/shots/pool.png" }),
        ],
      }),
    ).toEqual([
      "ANSWER_IMAGE_OBSERVATION_MISSING",
      "ANSWER_IMAGE_OBSERVATION_PATH_MISMATCH",
      "ANSWER_IMAGE_OBSERVATION_PATH_MISMATCH",
    ]);
  });

  it("refuses an answer that attaches the same picture twice", () => {
    expect(codes({ attached: [ATTACHED_A, ATTACHED_A], observations: [seen()] })).toEqual([
      "ANSWER_IMAGE_ATTACHMENT_DUPLICATE",
    ]);
  });

  it("holds an unreadable picture, with no token to waive it", () => {
    const findings = imageObservationFindings({
      attached: [ATTACHED_A],
      observations: [seen({ legible: false, unfitReason: "illegible" })],
    });
    expect(findings.map((finding) => finding.code)).toEqual(["ANSWER_IMAGE_OBSERVATION_UNFIT"]);
    expect(findings[0]!.severity).toBe("hold");
    expect(findings[0]!.summary).toContain("cannot be read at the size Slack renders the preview");
  });

  it("holds each of the four closed reasons", () => {
    const unfit: readonly ReviewedImage[] = [
      seen({ legible: false, unfitReason: "illegible" }),
      seen({ contextRetained: false, unfitReason: "context-lost" }),
      seen({ targetState: "unloaded", unfitReason: "unloaded" }),
      seen({ targetState: "empty-panel", unfitReason: "empty-panel" }),
    ];
    const severities = unfit.map(
      (observation) => imageObservationFindings({ attached: [ATTACHED_A], observations: [observation] })[0]!.severity,
    );
    expect(severities).toEqual(["hold", "hold", "hold", "hold"]);
  });

  it("still holds an unfit observation that names bytes this send does not carry", () => {
    // A verdict cannot become sendable by also being malformed.
    const findings = imageObservationFindings({
      attached: [ATTACHED_A],
      observations: [seen(), seen({ artifactDigest: DIGEST_B, legible: false, path: "/other.png" })],
    });
    expect(findings.map((finding) => finding.code)).toEqual([
      "ANSWER_IMAGE_OBSERVATION_EXTRA",
      "ANSWER_IMAGE_OBSERVATION_UNFIT",
    ]);
    expect(findings[1]!.severity).toBe("hold");
  });

  it("keeps the hold when one of two conflicting observations says the picture is fine", () => {
    const findings = imageObservationFindings({
      attached: [ATTACHED_A],
      observations: [seen(), seen({ legible: false, unfitReason: "illegible" })],
    });
    expect(findings.map((finding) => finding.code)).toEqual([
      "ANSWER_IMAGE_OBSERVATION_DUPLICATE",
      "ANSWER_IMAGE_OBSERVATION_UNFIT",
    ]);
  });

  it("lets the token waive a coverage GAP, and never an unfit picture", () => {
    // The two arms are deliberately different and this is where the difference is real rather than stated.
    // A coverage gap is self-correctable, so the house's block-by-default-WITH-a-break-glass contract
    // applies and the door records the waiver. An unfit observation is the owner's own arm: a
    // reviewer opened the picture and wrote down that it is unreadable, and `admitDoor` waives a `warn`
    // only, so no token, grant or hatch reaches it.
    const request: DoorRequest = {
      action: { kind: "verb", noun: "turn", verb: "answer" },
      artifact: {},
      meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
    };
    const env = { SLOPWEAVER_DOOR_OVERRIDE: IMAGE_OBSERVATION_OVERRIDE };
    const gap = imageObservationGate({ attached: [ATTACHED_A], observations: [] });
    const unfitPicture = imageObservationGate({
      attached: [ATTACHED_A],
      observations: [seen({ legible: false, unfitReason: "illegible" })],
    });

    expect(admitDoor({ env, gates: [gap], request }).status).toBe("pass");
    expect(admitDoor({ env, gates: [unfitPicture], request }).status).toBe("hold");
  });

  it("gives every coverage-shape finding the one dedicated token", () => {
    const findings = imageObservationFindings({
      attached: [ATTACHED_A, ATTACHED_B],
      observations: [seen({ artifactDigest: DIGEST_B, path: "/nowhere.png" })],
    });
    const overrides = findings.map((finding) => (finding.severity === "warn" ? finding.override : "HELD"));
    expect(overrides).toEqual([IMAGE_OBSERVATION_OVERRIDE, IMAGE_OBSERVATION_OVERRIDE]);
  });
});
