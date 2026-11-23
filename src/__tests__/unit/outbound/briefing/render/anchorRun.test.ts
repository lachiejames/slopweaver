/*
 * An anchor run renders as an in-page fragment link, and the section it targets carries that id.
 */
import { describe, expect, it } from "vitest";

import { renderBriefing } from "../../../../../outbound/briefing/render.js";
import { FORM, text } from "./harness.js";

describe("the one-index sections on the rendered page", () => {
  it("renders an anchor run as an in-page fragment link", () => {
    const section = { id: "todays-rulings", notes: [{ headline: text({ value: "One view." }) }], summary: "today" };
    const html = renderBriefing({
      form: {
        ...FORM,
        history: [section],
        recent: [{ headline: [{ kind: "anchor" as const, target: "todays-rulings", text: "today's rulings" }] }],
      },
    });

    expect(html).toContain('<a href="#todays-rulings">today&#39;s rulings</a>'.replace("&#39;", "'"));
    expect(html).toContain('<details id="todays-rulings">');
  });
});
