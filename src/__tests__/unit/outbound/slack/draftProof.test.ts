/**
 * The merged draft proof verdict (`outbound/slack/draftProof.ts`): a held row's finding proof and first-message proof
 * as one list, each piece named once in `DRAFT_PROOF_MISSING`'s order.
 */
import { describe, expect, it } from "vitest";

import {
  draftProofRefusal,
  draftProofReleaseRefusal,
  draftProofVerdict,
  type ProofDraft,
} from "../../../../outbound/slack/draftProof.js";
import { DRAFT_PROOF_MISSING } from "../../../../outbound/slack/draftProofPieces.js";
import type { ParkedDraftPayload } from "../../../../outbound/slack/draftRegister.js";
import { findingProofRefusal } from "../../../../outbound/slack/findingProof.js";
import { type DraftMediaEvidence, firstMessageProofRefusal } from "../../../../outbound/slack/firstMessageProof.js";
import { annotatedRecord, SHOT_NOTE } from "../../../annotatedShotFixture.js";

const DIGEST = `sha256:${"a".repeat(64)}`;

/** A form declaring no problem, so only an explicit `kind: "finding"` raises one. */
const NONE_FORM = JSON.stringify({ kind: "one-card", lines: [], problem: { kind: "none" } });

/** A plain drip payload carrying `text`, the one field either rule reads. */
const plain = ({ text }: { text: string }): ParkedDraftPayload => ({
  form: "plain",
  text,
  unfurl_links: false,
  unfurl_media: false,
});

/** A payload whose first line carries the count and whose link renders. */
const PROVED_PAYLOAD = plain({
  text: "12 users tried to check out and could not\n\n<https://app.example.com/view|the view>",
});

/** A payload carrying no link. */
const BARE_PAYLOAD = plain({ text: "12 users tried to check out and could not" });

/** A top-level row in a team channel declaring `--kind message`, so it raises no finding unless a test says so. */
const ROW: ProofDraft = {
  act: undefined,
  actor: undefined,
  channel: "C0SYN123ABCD",
  form: NONE_FORM,
  impact: undefined,
  kind: "message",
  media: undefined,
  payload: PROVED_PAYLOAD,
  shape: "top-level",
  threadTs: undefined,
};

/** One picture whose bytes an annotated, unobstructed record vouches for. */
const VOUCHED: DraftMediaEvidence = {
  kind: "picture",
  records: [annotatedRecord({ digest: DIGEST })],
  sha256: DIGEST,
};

/** The stored file entry a row's `--media` leaves, which is all the finding rule counts. */
const FILE = { bytes: 1, name: "a.png", sha256: DIGEST };

/** One picture with no record at all. */
const UNRECORDED: DraftMediaEvidence = { kind: "picture", records: [], sha256: DIGEST };

describe("draftProofVerdict", () => {
  it("names a screenshot once when a finding that is also a first message misses it, ordered per DRAFT_PROOF_MISSING", () => {
    const verdict = draftProofVerdict({ draft: { ...ROW, kind: "finding" }, media: [] });
    expect(verdict).toStrictEqual({
      finding: ["screenshot", "impact"],
      firstMessage: ["screenshot", "annotation"],
      missing: ["screenshot", "annotation", "impact"],
    });
  });

  it("orders its merged list by the shared piece list, whatever order each rule found them in", () => {
    const verdict = draftProofVerdict({
      draft: { ...ROW, kind: "finding", payload: plain({ text: "the pool is exhausted" }) },
      media: [],
    });
    expect(DRAFT_PROOF_MISSING.filter((piece) => verdict.missing.includes(piece))).toEqual(verdict.missing);
    expect(verdict.missing).toEqual(["screenshot", "link", "annotation", "impact"]);
  });

  it("carries the leading receipt of a first message that misses nothing", () => {
    const verdict = draftProofVerdict({ draft: ROW, media: [VOUCHED] });
    expect(verdict).toStrictEqual({
      finding: [],
      firstMessage: [],
      leadingReceipt: { notes: [SHOT_NOTE], sha256: DIGEST },
      missing: [],
    });
  });

  it("carries no leading receipt while the row misses anything, even a finding piece the picture cannot fix", () => {
    const verdict = draftProofVerdict({ draft: { ...ROW, kind: "finding", media: [FILE] }, media: [VOUCHED] });
    expect(verdict).toStrictEqual({ finding: ["impact"], firstMessage: [], missing: ["impact"] });
  });

  it("carries no leading receipt for a first message missing its annotation", () => {
    const verdict = draftProofVerdict({ draft: ROW, media: [UNRECORDED] });
    expect(verdict).toStrictEqual({ finding: [], firstMessage: ["annotation"], missing: ["annotation"] });
  });

  it("owes only the finding rule's pieces on a thread reply, which is no first message", () => {
    const verdict = draftProofVerdict({
      draft: { ...ROW, kind: "finding", shape: "thread", threadTs: "1700000000.000100" },
      media: [],
    });
    expect(verdict).toStrictEqual({
      finding: ["screenshot", "impact"],
      firstMessage: [],
      missing: ["screenshot", "impact"],
    });
  });

  it("owes nothing for a thread reply that raises no finding", () => {
    const verdict = draftProofVerdict({
      draft: { ...ROW, shape: "thread", threadTs: "1700000000.000100" },
      media: [],
    });
    expect(verdict).toStrictEqual({ finding: [], firstMessage: [], missing: [] });
  });
});

describe("draftProofRefusal", () => {
  it("is empty for a verdict missing nothing", () => {
    expect(draftProofRefusal({ verdict: draftProofVerdict({ draft: ROW, media: [VOUCHED] }) })).toEqual([]);
  });

  it("concatenates the finding rule's lines and the first-message rule's lines, each naming its own pieces", () => {
    const verdict = draftProofVerdict({ draft: { ...ROW, kind: "finding" }, media: [] });
    const lines = draftProofRefusal({ verdict });
    expect(lines).toEqual([
      ...findingProofRefusal({ missing: ["screenshot", "impact"] }),
      ...firstMessageProofRefusal({ missing: ["screenshot", "annotation"] }),
    ]);
    expect(lines[0]).toContain("this draft raises a finding");
    expect(lines[0]).toContain("is missing screenshot, impact.");
    expect(lines.find((line) => line.startsWith("this draft is a first message"))).toContain(
      "is missing screenshot, annotation.",
    );
  });
});

describe("draftProofReleaseRefusal", () => {
  it("names the box to record, the retake and the drop for an annotation-only miss", () => {
    const verdict = draftProofVerdict({ draft: ROW, media: [UNRECORDED] });
    expect(draftProofReleaseRefusal({ id: "sd-1", verdict })).toBe(
      "sd-1 is a first message in a channel and is missing annotation, so it is not sent: the owner sends such a card back " +
        "unseen. Record the box already drawn into its screenshot (`slopweaver browser " +
        'image-record` with `annotations` and `obstruction: "none"`), draw the boxes onto an unannotated capture ' +
        "with `slopweaver browser annotate` and re-cut it, or retake an obscured capture and re-cut it, or drop it " +
        '(`slopweaver slack draft drop sd-1 --note "no proof"`).',
    );
  });

  it("names the re-cut with the superseding id for a link miss", () => {
    const verdict = draftProofVerdict({ draft: { ...ROW, payload: BARE_PAYLOAD }, media: [VOUCHED] });
    expect(draftProofReleaseRefusal({ id: "sd-2", verdict })).toBe(
      "sd-2 is a first message in a channel and is missing link, so it is not sent: the owner sends such a card back " +
        "unseen. Re-cut it with its proof (`slopweaver slack draft record … " +
        '--supersedes sd-2`), or drop it (`slopweaver slack draft drop sd-2 --note "no proof"`).',
    );
  });

  it("names both rules when a row is a finding and a first message", () => {
    const verdict = draftProofVerdict({ draft: { ...ROW, kind: "finding" }, media: [] });
    expect(draftProofReleaseRefusal({ id: "sd-3", verdict })).toBe(
      "sd-3 raises a finding and is a first message in a channel and is missing screenshot, annotation, impact, so " +
        "it is not sent: the owner sends such a card back unseen. Re-cut it with its proof " +
        '(`slopweaver slack draft record … --supersedes sd-3`), or drop it (`slopweaver slack draft drop sd-3 --note "no proof"`).',
    );
  });

  it("does not take the annotation-only fix for a finding that also misses its annotation", () => {
    const verdict = draftProofVerdict({ draft: { ...ROW, kind: "finding", media: [FILE] }, media: [UNRECORDED] });
    expect(verdict.missing).toEqual(["annotation", "impact"]);
    expect(draftProofReleaseRefusal({ id: "sd-4", verdict })).toContain("Re-cut it with its proof");
  });
});
