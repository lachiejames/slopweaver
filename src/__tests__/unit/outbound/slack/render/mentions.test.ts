/*
 * Mentions, user groups, broadcasts and citation chips render as structural elements, and an unresolvable mention
 * or group throws rather than posting prose or dropping it.
 */
import { describe, expect, it } from "vitest";

import type { UpdateArtifact } from "../../../../../outbound/artifact/types.js";
import { UnresolvedGroupError, UnresolvedMentionError } from "../../../../../outbound/slack/render.js";
import { minimalArtifact, render } from "./harness.js";

describe("renderUpdateCard — mentions, broadcasts and citations", () => {
  it("emits a resolved mention as a structural user element", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [
        {
          runs: [
            { bold: true, text: "before ", type: "text" },
            { person: "ada", type: "mention" },
            { range: "here", type: "broadcast" },
          ],
          type: "paragraph",
        },
      ],
    };

    const payload = render({ artifact });

    expect(payload.attachments[0].blocks[5]).toEqual({
      elements: [
        {
          elements: [
            { style: { bold: true }, text: "before ", type: "text" },
            { type: "user", user_id: "U_fake_ada" },
            { range: "here", type: "broadcast" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });

  it("emits a resolved user group as a structural usergroup element", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [{ runs: [{ handle: "engineers", type: "group" }], type: "paragraph" }],
    };

    const payload = render({ artifact });

    expect(payload.attachments[0].blocks[5]).toEqual({
      elements: [
        {
          elements: [{ type: "usergroup", usergroup_id: "S_fake_engineers" }],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });

  it("throws on an unresolvable user group rather than posting its handle as prose", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [{ runs: [{ handle: "nobody", type: "group" }], type: "paragraph" }],
    };

    expect(() => render({ artifact })).toThrow(UnresolvedGroupError);
  });

  it("throws on an unresolvable mention rather than dropping it silently", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      detail: [{ runs: [{ person: "nobody", type: "mention" }], type: "paragraph" }],
    };

    expect(() => render({ artifact })).toThrow(UnresolvedMentionError);
  });

  it("renders a citation chip as a labelled link to its source", () => {
    const artifact: UpdateArtifact = {
      ...minimalArtifact(),
      citations: [{ id: "c1", label: "[1]", url: "https://example.invalid/evidence" }],
      detail: [{ runs: [{ citationId: "c1", type: "citation" }], type: "paragraph" }],
    };

    const payload = render({ artifact });

    expect(payload.attachments[0].blocks[5]).toEqual({
      elements: [
        {
          elements: [{ text: "[1]", type: "link", url: "https://example.invalid/evidence" }],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });
});
