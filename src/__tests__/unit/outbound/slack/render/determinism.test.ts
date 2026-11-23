/* The same artifact rendered twice is byte-identical. */
import { describe, expect, it } from "vitest";

import type { UpdateArtifact } from "../../../../../outbound/artifact/types.js";
import { minimalArtifact, render } from "./harness.js";

describe("renderUpdateCard — determinism, which PR5.2 depends on", () => {
  it("produces byte-identical output for the same artifact rendered twice", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [
        { runs: [{ person: "ada", type: "mention" }], type: "paragraph" },
        { items: [[{ text: "one", type: "text" }]], type: "bullets" },
      ],
      primaryLink: { label: "Draft PR", url: "https://example.invalid/pr/5" },
    };

    const first = JSON.stringify(render({ artifact }));
    const second = JSON.stringify(render({ artifact }));

    expect(first).toBe(second);
  });
});
