/*
 * A hand step's link is a web address the Queue can read and the desktop app's viewer can open, never a `file://` one
 * (one such card blanks every hand card on the Queue).
 */
import { describe, expect, it } from "vitest";

import { localFileUrl } from "../../../hand/localFileUrl.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";
import { consoleViewerUrl } from "../../../pages/url.js";

const DRAFT: HandStepDraft = {
  checkIn: true,
  id: "tobias-9am-brief-7-oct",
  postedBy: "workspace:1",
  postedIso: "2026-10-06T17:35:00.000Z",
  unblocks: "Nothing waits on you, this is the brief for your 9am with Tobias",
  what: "Read the brief for your 9am with Tobias",
  where: "the desktop app",
  witness: "slopweaver hand list shows it done",
};

/** A step built by the real builder from the draft with a case's changes. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(buildHandStep({ draft: { ...DRAFT, ...over } }));
}

describe("localFileUrl", () => {
  it("passes a step with no link", () => {
    expect(localFileUrl({ step: step() })).toBe(undefined);
  });

  it("passes a web link", () => {
    const url = "http://localhost:3000/view?src=%2Fapi%2Fpage%2Ftobias-9am-brief%2Findex.html&back=%2Fqueue";
    expect(localFileUrl({ step: step({ url }) })).toBe(undefined);
  });

  it("refuses a published page's file:// address, naming that page's viewer address", () => {
    const url = "file:///Users/someone/.slopweaver/pages/tobias-9am-brief/index.html";
    const refused = localFileUrl({ step: step({ url }) })!;
    expect(refused.code).toBe("INVALID_FIELD");
    expect(refused.message).toContain(
      "pass the page's viewer address instead: http://localhost:3000/view?src=%2Fapi%2Fpage%2Ftobias-9am-brief%2Findex.html&back=%2Fqueue",
    );
  });

  it("refuses any other file:// address, pointing at publishing it as a page", () => {
    const url = "file:///Users/someone/Desktop/brief.html";
    const refused = localFileUrl({ step: step({ url }) })!;
    expect(refused.code).toBe("INVALID_FIELD");
    expect(refused.message).toContain(
      "publish it as a page with `slopweaver page publish <slug> --page <file> --review <id>`",
    );
    expect(refused.message).toContain(
      "http://localhost:3000/view?src=%2Fapi%2Fpage%2F<slug>%2Findex.html&back=%2Fqueue",
    );
  });
});

describe("consoleViewerUrl", () => {
  it("is the viewer route framing the page's console document, with the Queue as its way back", () => {
    expect(consoleViewerUrl({ consoleBase: "http://localhost:3000", slug: "leavers-access-briefing" })).toBe(
      "http://localhost:3000/view?src=%2Fapi%2Fpage%2Fleavers-access-briefing%2Findex.html&back=%2Fqueue",
    );
  });
});
