import { describe, expect, it } from "vitest";

import type { VantaPolicyVersionObservation } from "../../../../../browser/vantaPolicyVersion.js";
import { policyVersionLines } from "../../../../../cli/commands/vanta/policyVersionRun.js";

/** A read that opened the version menu and found one file input — each case below changes one field. */
const OPENED: VantaPolicyVersionObservation = {
  buttons: ["Edit", "More"],
  fileInputs: [{ accept: ".pdf", hidden: true, name: "file" }],
  finalUrl: "https://app.vanta.com/c/acme/policies/access-control",
  menuItems: ["New version", "Archive"],
  opened: "clicked More",
  screenshotPath: "/shots/menu.png",
  title: "Access Control Policy",
};

describe("policyVersionLines", () => {
  it("reports the page, how the menu opened, every item, every file input, the buttons and the shot", () => {
    expect(policyVersionLines({ observation: OPENED })).toEqual([
      "policy page: Access Control Policy",
      "  settled on https://app.vanta.com/c/acme/policies/access-control",
      "  menu opened: clicked More",
      "  2 menu item(s): New version | Archive",
      "  1 file input(s)",
      '    accept=".pdf" name="file" hidden=true',
      "  page buttons: Edit | More",
      "  screenshot: /shots/menu.png",
    ]);
  });

  it("says nothing was clicked when no control declared a menu, and none when the menu held no item", () => {
    expect(
      policyVersionLines({
        observation: { ...OPENED, fileInputs: [], menuItems: [], opened: null, screenshotPath: null },
      }),
    ).toEqual([
      "policy page: Access Control Policy",
      "  settled on https://app.vanta.com/c/acme/policies/access-control",
      "  menu opened: no control declared aria-haspopup — nothing was clicked",
      "  0 menu item(s): none",
      "  0 file input(s)",
      "  page buttons: Edit | More",
    ]);
  });
});
