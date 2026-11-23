/*
 * `renderProviderReadJson` and `renderProviderReadText`: a read's freshness and residue survive into both the
 * machine form and the human one, whichever source produced the document.
 */
import { describe, expect, it } from "vitest";

import {
  type ProviderReadDocument,
  renderProviderReadJson,
  renderProviderReadText,
} from "../../../../live/providerRead.js";
import { NOW } from "./fixtures.js";

describe("provider read rendering", () => {
  const document: ProviderReadDocument = {
    coverage: { detail: "one object", kind: "bounded", residue: ["more exists"] },
    data: { title: "Live" },
    readAtIso: NOW,
    source: "linear",
    target: { address: "AIL-1", identity: "AIL-1", kind: "issue" },
  };

  it("keeps freshness and residue in both machine and human forms", () => {
    expect(JSON.parse(renderProviderReadJson({ document }))).toEqual(document);
    expect(renderProviderReadText({ document })).toBe(
      "linear issue: AIL-1\n" +
        `read at: ${NOW}\n` +
        "coverage: bounded — one object\n" +
        "residue: more exists\n\n" +
        '{\n  "title": "Live"\n}',
    );
  });
});
