import { describe, expect, it } from "vitest";

import { digestToUpdate } from "../../../../../outbound/artifact/digest.js";
import type { DigestForm } from "../../../../../outbound/artifact/digestFields.js";

describe("digestToUpdate — the owner decision is taken ONCE", () => {
  it("keeps the rendered ping and the unresolved list consistent when the roster changes mid-derivation", () => {
    // Found by an adversarial review. The rendering and the unresolved list used to consult `isKnownPerson`
    // separately, and at the CLI seam each call is a fresh roster read. A resolver that flips between the two
    // rendered "(unresolved)" into the card while reporting NOTHING unresolved — so the refusal guard saw an
    // empty list, the warning never printed, and the degraded card posted. This is a plain injected fake that
    // changes its answer, not a mock: the seam is a function parameter.
    let calls = 0;
    const flips = (): boolean => {
      calls += 1;
      return calls > 1;
    };
    const form: DigestForm = {
      items: [{ count: 1, owner: { person: "ada-l" }, severity: "red", title: "x" }],
      kind: "digest",
      label: "L",
      window: "24h",
    };
    const result = digestToUpdate({ form, isKnownPerson: flips });
    const rendered = result.artifact.detail
      .filter((block) => block.type === "paragraph")
      .flatMap((block) => (block.type === "paragraph" ? block.runs : []));
    const renderedUnresolvedText = rendered.filter((run) => run.type === "text" && run.text.includes("(unresolved)"));

    // Exactly one decision was taken for the one owner...
    expect(calls).toBe(1);
    // ...so the card and the report agree: the FIRST answer was "absent", so both say unresolved.
    expect(result.unresolvedOwners).toEqual(["ada-l"]);
    expect(renderedUnresolvedText.length).toBe(1);
  });

  it("asks the roster once per DISTINCT owner, not once per item", () => {
    let calls = 0;
    const counting = (): boolean => {
      calls += 1;
      return true;
    };
    const form: DigestForm = {
      items: [
        { count: 1, owner: { person: "ada-l" }, severity: "red", title: "a" },
        { count: 2, owner: { person: "ada-l" }, severity: "orange", title: "b" },
        { count: 3, owner: { person: "grace-h" }, severity: "green", title: "c" },
      ],
      kind: "digest",
      label: "L",
      window: "24h",
    };
    digestToUpdate({ form, isKnownPerson: counting });

    expect(calls).toBe(2);
  });
});
