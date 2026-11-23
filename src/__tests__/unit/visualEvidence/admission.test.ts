import { describe, expect, it } from "vitest";

import {
  admissionErrorOf,
  imageAdmissionVerdict,
  type ResolvedImageEvidence,
} from "../../../visualEvidence/admission.js";
import type { ArtifactIdentity, ImageRecord, ImageRef } from "../../../visualEvidence/types.js";
import { IMAGE_POLICY_VERSION } from "../../../visualEvidence/types.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

const identity = (over: Partial<ArtifactIdentity> = {}): ArtifactIdentity => ({
  digest: DIGEST_A,
  heightPx: 560,
  widthPx: 3000,
  ...over,
});

const ref = (over: Partial<ImageRef> = {}): ImageRef => ({
  artifactDigest: DIGEST_A,
  path: "/tmp/panel.png",
  ...over,
});

const passed = (over: Partial<Extract<ImageRecord, { outcome: "passed" }>> = {}): ImageRecord => ({
  artifact: identity(),
  crop: { kind: "cropped", rect: { height: 560, width: 3000, x: 0, y: 0 }, sourceDigest: DIGEST_B },
  outcome: "passed",
  policyVersion: IMAGE_POLICY_VERSION,
  readBack: {
    contextRetained: true,
    observedAtIso: "2026-09-13T01:00:00.000Z",
    observedContent: "timeseries, 10k y-axis, Aug 28 - Sep 12, query @err.code:(P2024 OR P2028)",
    observerSession: "workspace:146",
    targetState: "data",
  },
  receiptId: "rec-1",
  schemaVersion: 1,
  ...over,
});

const failed = (over: Partial<Extract<ImageRecord, { outcome: "failed" }>> = {}): ImageRecord => ({
  ...passed(),
  correction: "re-capture once the panel has rendered, then crop to the chart",
  outcome: "failed",
  reason: "empty-panel",
  readBack: {
    contextRetained: true,
    observedAtIso: "2026-09-13T01:00:00.000Z",
    observedContent: "'6 service values found (based on 100,794 logs)' above an empty white panel",
    observerSession: "workspace:146",
    targetState: "empty-panel",
  },
  ...over,
});

const item = (over: Partial<ResolvedImageEvidence> = {}): ResolvedImageEvidence => ({
  artifact: identity(),
  records: [passed()],
  ref: ref(),
  ...over,
});

describe("imageAdmissionVerdict", () => {
  it("admits a batch whose every attachment carries a believable passed record", () => {
    expect(imageAdmissionVerdict({ evidence: [item(), item()] })).toEqual({ kind: "admitted" });
  });

  it("admits an empty batch, because a message with no images has nothing to look at", () => {
    expect(imageAdmissionVerdict({ evidence: [] })).toEqual({ kind: "admitted" });
  });

  it("reports every unrecorded digest as missing", () => {
    const verdict = imageAdmissionVerdict({
      evidence: [
        item({ records: [] }),
        item({ artifact: identity({ digest: DIGEST_B }), records: [], ref: ref({ artifactDigest: DIGEST_B }) }),
      ],
    });
    expect(verdict).toEqual({ digests: [DIGEST_A, DIGEST_B], kind: "missing" });
  });

  it("holds a recorded failure, with no override token on the finding", () => {
    const verdict = imageAdmissionVerdict({ evidence: [item({ records: [failed()] })] });
    expect(verdict.kind).toBe("known-bad");
    const findings = verdict.kind === "known-bad" ? verdict.findings : [];
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("hold");
    expect(findings[0]!.code).toBe("image.empty-panel");
    expect(findings[0]!.summary).toBe(
      "/tmp/panel.png was looked at and recorded as unfit to send: the panel the claim rests on was still empty when the shutter fired",
    );
    expect(findings[0]!.correction).toBe("re-capture once the panel has rendered, then crop to the chart");
    expect(Object.hasOwn(findings[0]!, "override")).toBe(false);
  });

  it("names each closed failure reason in its own code", () => {
    const codes = (["unloaded", "empty-panel", "illegible", "context-lost"] as const).map((reason) => {
      const verdict = imageAdmissionVerdict({ evidence: [item({ records: [failed({ reason })] })] });
      return verdict.kind === "known-bad" ? verdict.findings[0]!.code : "none";
    });
    expect(codes).toEqual(["image.unloaded", "image.empty-panel", "image.illegible", "image.context-lost"]);
  });

  // THE ordering property: a dropped receiptId must not turn a hold into a hatchable refusal.
  it("holds a known-bad image even when the attachment cites no receipt at all", () => {
    const verdict = imageAdmissionVerdict({
      evidence: [item({ records: [failed()], ref: ref({ receiptId: undefined }) })],
    });
    expect(verdict.kind).toBe("known-bad");
  });

  it("holds a known-bad image even when another attachment in the batch has no record", () => {
    const verdict = imageAdmissionVerdict({
      evidence: [
        item({ records: [] }),
        item({
          artifact: identity({ digest: DIGEST_B }),
          records: [failed({ artifact: identity({ digest: DIGEST_B }) })],
          ref: ref({ artifactDigest: DIGEST_B }),
        }),
      ],
    });
    expect(verdict.kind).toBe("known-bad");
  });

  it("holds a known-bad image found under a renamed file, because records are keyed by bytes", () => {
    const verdict = imageAdmissionVerdict({
      evidence: [item({ records: [failed()], ref: ref({ path: "/tmp/totally-different-name.png" }) })],
    });
    expect(verdict.kind).toBe("known-bad");
    const findings = verdict.kind === "known-bad" ? verdict.findings : [];
    expect(findings[0]!.summary).toContain("/tmp/totally-different-name.png");
  });

  it("holds when a later look found a defect after an earlier pass", () => {
    const verdict = imageAdmissionVerdict({ evidence: [item({ records: [passed(), failed()] })] });
    expect(verdict.kind).toBe("known-bad");
  });

  // THE r1 counterexample. This test previously asserted the OPPOSITE — that a later pass admits the same
  // bytes — which is how the hole survived its author's own review. A failure is terminal for its bytes:
  // a real correction changes them, so it asks about a different digest.
  it("holds FOREVER once a failure is recorded, whatever is appended afterwards", () => {
    const verdict = imageAdmissionVerdict({ evidence: [item({ records: [failed(), passed()] })] });
    expect(verdict.kind).toBe("known-bad");
  });

  it("holds a failure buried among several later passes", () => {
    const verdict = imageAdmissionVerdict({
      evidence: [item({ records: [passed(), failed(), passed(), passed()] })],
    });
    expect(verdict.kind).toBe("known-bad");
  });

  it("names the FAILURE's own reason and correction, not a later record's", () => {
    const verdict = imageAdmissionVerdict({
      evidence: [
        item({
          records: [failed({ correction: "wait for the panel", reason: "unloaded" }), passed()],
        }),
      ],
    });
    expect(verdict.kind).toBe("known-bad");
    const findings = verdict.kind === "known-bad" ? verdict.findings : [];
    expect(findings[0]!.code).toBe("image.unloaded");
    expect(findings[0]!.correction).toBe("wait for the panel");
  });

  it("holds a terminated digest even when the later pass is itself unbelievable", () => {
    const verdict = imageAdmissionVerdict({
      evidence: [item({ records: [failed(), passed({ artifact: identity({ digest: DIGEST_B }) })] })],
    });
    expect(verdict.kind).toBe("known-bad");
  });
});

describe("imageAdmissionVerdict — records that cannot be believed", () => {
  it("refuses a record written about different bytes", () => {
    const verdict = imageAdmissionVerdict({
      evidence: [item({ records: [passed({ artifact: identity({ digest: DIGEST_B }) })] })],
    });
    expect(verdict.kind).toBe("invalid");
    const issues = verdict.kind === "invalid" ? verdict.issues : [];
    expect(issues[0]).toBe(`/tmp/panel.png: the record names bytes ${DIGEST_B} but the file holds ${DIGEST_A}`);
  });

  it("refuses a record whose recorded dimensions do not match the decoded bytes", () => {
    const verdict = imageAdmissionVerdict({
      evidence: [item({ records: [passed({ artifact: identity({ heightPx: 6722, widthPx: 4032 }) })] })],
    });
    expect(verdict.kind).toBe("invalid");
    const issues = verdict.kind === "invalid" ? verdict.issues : [];
    expect(issues[0]).toBe(
      "/tmp/panel.png: the record was written about a 4032x6722 image and these bytes decode to 3000x560",
    );
  });

  it("refuses an attachment citing a receipt other than the one recorded for its bytes", () => {
    const verdict = imageAdmissionVerdict({
      evidence: [item({ ref: ref({ receiptId: "rec-borrowed" }) })],
    });
    expect(verdict.kind).toBe("invalid");
    const issues = verdict.kind === "invalid" ? verdict.issues : [];
    expect(issues[0]).toBe(
      "/tmp/panel.png: the attachment cites receipt rec-borrowed and the record for these bytes is rec-1",
    );
  });

  it("refuses a record judged by a newer policy version than this build knows", () => {
    const verdict = imageAdmissionVerdict({
      evidence: [item({ records: [passed({ policyVersion: IMAGE_POLICY_VERSION + 1 })] })],
    });
    expect(verdict.kind).toBe("invalid");
    const issues = verdict.kind === "invalid" ? verdict.issues : [];
    expect(issues[0]).toBe(
      `/tmp/panel.png: the record was judged by image policy v${String(IMAGE_POLICY_VERSION + 1)}, which is newer than this build's v${String(IMAGE_POLICY_VERSION)}`,
    );
  });

  it("refuses an attachment whose reference names bytes the file does not hold", () => {
    const verdict = imageAdmissionVerdict({ evidence: [item({ ref: ref({ artifactDigest: DIGEST_B }) })] });
    expect(verdict.kind).toBe("invalid");
    const issues = verdict.kind === "invalid" ? verdict.issues : [];
    expect(issues[0]).toBe(`/tmp/panel.png: the attachment reference names ${DIGEST_B} and the file holds ${DIGEST_A}`);
  });

  it("holds rather than reports invalid when one attachment is bad and another is unbelievable", () => {
    const verdict = imageAdmissionVerdict({
      evidence: [
        item({ records: [passed({ artifact: identity({ digest: DIGEST_B }) })] }),
        item({ records: [failed()] }),
      ],
    });
    expect(verdict.kind).toBe("known-bad");
  });
});

describe("admissionErrorOf", () => {
  it("returns undefined for an admitted batch", () => {
    expect(admissionErrorOf({ verdict: { kind: "admitted" } })).toBeUndefined();
  });

  it("carries the findings through on a hold", () => {
    const findings = [{ code: "image.illegible", correction: "crop it", severity: "hold" as const, summary: "bad" }];
    const error = admissionErrorOf({ verdict: { findings, kind: "known-bad" } });
    expect(error!.code).toBe("IMAGE_KNOWN_BAD");
    expect(error!.message).toBe("an image on this message was looked at and recorded as unfit to send");
  });

  it("pluralises the hold message for several bad images", () => {
    const one = { code: "image.illegible", correction: "crop it", severity: "hold" as const, summary: "bad" };
    const error = admissionErrorOf({ verdict: { findings: [one, one], kind: "known-bad" } });
    expect(error!.message).toBe("2 images on this message were looked at and recorded as unfit to send");
  });

  it("carries the digests through on a missing record", () => {
    const error = admissionErrorOf({ verdict: { digests: [DIGEST_A], kind: "missing" } });
    expect(error!.code).toBe("IMAGE_RECORD_MISSING");
    expect(error!.message).toBe(
      "an image on this message has no recorded read-back, so nothing has established that anybody looked at it",
    );
  });

  it("carries the issues through on unbelievable evidence", () => {
    const error = admissionErrorOf({ verdict: { issues: ["a.png: stale"], kind: "invalid" } });
    expect(error!.code).toBe("IMAGE_EVIDENCE_INVALID");
    expect(error!.message).toBe("the read-back record for this image cannot be believed: a.png: stale");
  });
});
