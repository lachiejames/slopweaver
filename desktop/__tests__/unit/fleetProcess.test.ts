import { describe, expect, it } from "vitest";

import { openCmuxArgs, openTabScript } from "../../src/fleetProcess";

describe("an automatic recovery leaves cmux behind what you are reading", () => {
  it("opens cmux in the background, and types the tab without activating it", () => {
    expect(openCmuxArgs({ raise: false })).toEqual(["-g", "-a", "cmux"]);
    expect(openTabScript({ raise: false })).not.toContain("activate");
    expect(openTabScript({ raise: false })).toContain("input text (item 1 of argv) & return to t");
  });

  it("brings cmux to the front on your own press, after the line is typed", () => {
    expect(openCmuxArgs({ raise: true })).toEqual(["-a", "cmux"]);
    const script = openTabScript({ raise: true });
    expect(script.indexOf("activate")).toBe(script.indexOf("input text (item 1 of argv) & return to t") + 1);
  });
});
