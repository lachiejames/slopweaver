/*
 * A window with no findings renders one quiet note that asks nothing, and the briefing's own schema accepts it.
 */
import { describe, expect, it } from "vitest";

import { sectionSchema } from "../../../../outbound/briefing/sectionSchema.js";
import { render } from "./harness.js";

describe("renderSelfImprovementSection — a quiet pass", () => {
  it("renders one quiet note that asks nothing, rather than an empty or refused section", () => {
    expect(render({ findings: [] })).toEqual({
      notes: [
        { headline: [{ kind: "text", text: "Nothing found this window — a quiet pass, and nothing to answer." }] },
      ],
      summary: "Self-improvement opportunities: 0 this window; nothing was changed",
    });
  });

  it("is a section the briefing's own schema accepts", () => {
    expect(sectionSchema.safeParse(render({ findings: [] })).success).toBe(true);
  });
});
