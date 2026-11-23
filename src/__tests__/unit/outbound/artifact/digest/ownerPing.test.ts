import { describe, expect, it } from "vitest";

import { digestToUpdate } from "../../../../../outbound/artifact/digest.js";
import type { DigestForm } from "../../../../../outbound/artifact/digestFields.js";
import { updateArtifactSchema } from "../../../../../outbound/artifact/schema.js";
import { knockForm } from "./harness.js";

/**
 * The owner ping. A digest runs UNATTENDED, so an owner who cannot be resolved must not cost the whole digest —
 * but the failure has to be visible in the message AND reported to the caller, never silently dropped.
 */
describe("digestToUpdate — the owner ping degrades, never refuses", () => {
  function ownedForm(): DigestForm {
    return {
      items: [
        {
          count: 706,
          owner: { ask: "can you take a look?", person: "tony" },
          severity: "red",
          substance: "Every example sign-up has failed since launch.",
          ticket: { id: "KK-1770", url: "https://example.invalid/KK-1770" },
          title: "example sign-up registration",
        },
      ],
      kind: "digest",
      label: "Knock",
      window: "24h",
    };
  }

  it("emits a real mention run when the person resolves", () => {
    const card = digestToUpdate({ form: ownedForm(), isKnownPerson: (person) => person === "tony" });
    const paragraph = card.artifact.detail[1]!;

    expect(paragraph.type).toBe("paragraph");
    expect(paragraph.type === "paragraph" ? paragraph.runs : []).toContainEqual({ person: "tony", type: "mention" });
    expect(card.unresolvedOwners).toEqual([]);
  });

  it("degrades to VISIBLE plain text when the person does not resolve", () => {
    const card = digestToUpdate({ form: ownedForm(), isKnownPerson: () => false });
    const paragraph = card.artifact.detail[1]!;
    const runs = paragraph.type === "paragraph" ? paragraph.runs : [];

    expect(runs.some((run) => run.type === "mention")).toBe(false);
    expect(runs).toContainEqual({ text: "tony (unresolved)", type: "text" });
  });

  it("reports the unresolved owner so the caller can warn, rather than dropping it silently", () => {
    expect(digestToUpdate({ form: ownedForm(), isKnownPerson: () => false }).unresolvedOwners).toEqual(["tony"]);
  });

  it("still derives a SENDABLE card when the owner does not resolve", () => {
    const card = digestToUpdate({ form: ownedForm(), isKnownPerson: () => false });

    expect(updateArtifactSchema.safeParse(card.artifact).success).toBe(true);
  });

  it("carries the ask alongside the tag", () => {
    const card = digestToUpdate({ form: ownedForm(), isKnownPerson: () => true });
    const paragraph = card.artifact.detail[1]!;

    expect(paragraph.type === "paragraph" ? paragraph.runs : []).toContainEqual({
      text: " can you take a look?",
      type: "text",
    });
  });

  it("gives an owner-only item a paragraph, even with no substance", () => {
    const form: DigestForm = {
      items: [{ count: 1, owner: { person: "tony" }, severity: "orange", title: "something" }],
      kind: "digest",
      label: "Knock",
      window: "24h",
    };
    const card = digestToUpdate({ form, isKnownPerson: () => true });

    // Without this the owner would have nowhere to render and the ping would vanish.
    expect(card.artifact.detail.length).toBe(2);
    expect(card.artifact.detail[1]!.type).toBe("paragraph");
  });

  it("never invents an owner for an item that declares none", () => {
    const card = digestToUpdate({ form: knockForm(), isKnownPerson: () => true });

    expect(card.unresolvedOwners).toEqual([]);
    expect(JSON.stringify(card.artifact)).not.toContain("owner:");
  });
});
