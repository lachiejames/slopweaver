/*
 * A hand step carrying a checklist: every line drawn, every command its own copy block,
 * every value's place named — and the template check still refusing a card that draws a word the record did not write.
 */
import { describe, expect, it } from "vitest";

import { tickedLines, ticksKey, toggledTicks } from "../../lib/checklistTicks";
import { type HandRecord, handCard, stepCardTemplateText } from "../../lib/handCard";
import { stepCardTexts } from "../../lib/handCardTexts";

const CHECKLIST = [
  {
    action: "Open the Credentials page for the SecOps project",
    command: undefined,
    find: undefined,
    url: "https://console.cloud.google.com/apis/credentials",
  },
  {
    action: "Paste the Client ID when the terminal asks for it",
    command: "slopweaver secrets set google-secops-client-id",
    find: ["Additional information", "Client ID"],
    url: undefined,
  },
  {
    action: "Paste the Client secret when the terminal asks for it",
    command: "slopweaver secrets set google-secops-client-secret",
    find: ["Client secrets", "Client secret"],
    url: undefined,
  },
];

const SECOPS: HandRecord = {
  checklist: CHECKLIST,
  cites: [],
  id: "secops-desktop-oauth-client",
  ifIgnored: undefined,
  literal: undefined,
  opened: undefined,
  unaddressed: undefined,
  unblocks: "The SecOps atlas reading detections",
  url: undefined,
  what: "Make a Desktop sign-in client for SecOps and store its two values",
  where: undefined,
  witness: "slopweaver hand done secops-desktop-oauth-client --did stored",
};

describe("a checklist step's card", () => {
  it("carries every line, draws no no-address row, and is fit to draw", () => {
    const built = handCard({ step: SECOPS });
    expect(built.form).toEqual({ kind: "drawn" });
    expect(built.card.checklist).toEqual(CHECKLIST);
    expect(built.card.copy).toBe(undefined);
    expect(built.card.rows.some((row) => row.label === "no address")).toBe(false);
    expect(stepCardTexts({ card: built.card })).toContain("Client secrets");
  });

  it("names a checklist line the record did not write as template text", () => {
    const built = handCard({ step: SECOPS });
    const drifted = {
      ...built.card,
      checklist: [{ action: "Click anything", command: undefined, find: undefined, url: undefined }],
    };
    expect(stepCardTemplateText({ card: drifted, step: SECOPS })).toEqual(["Click anything"]);
  });
});

describe("checklist ticks", () => {
  it("keys ticks by the step's id", () => {
    expect(ticksKey({ subject: "secops-desktop-oauth-client" })).toBe("sw-checklist:secops-desktop-oauth-client");
  });

  it("ticks and unticks one line, ascending, and drops a line the checklist does not have", () => {
    expect(toggledTicks({ count: 5, index: 3, stored: "" })).toBe("3");
    expect(toggledTicks({ count: 5, index: 0, stored: "3" })).toBe("0,3");
    expect(toggledTicks({ count: 5, index: 3, stored: "0,3" })).toBe("0");
    expect([...tickedLines({ count: 3, stored: "0,7,x,-1,1.5,2" })]).toEqual([0, 2]);
  });
});
