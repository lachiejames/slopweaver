/*
 * A session's card: the agent's words reach it as text, never markup, and its Stop link is the only ask a card can
 * make — present while the session is live, read back only when it names a real session id.
 */
import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  STOP_CONTROL_BOX,
  sessionCardFrameUrl,
  sessionCardHtml,
  sessionCardUrl,
  sessionLinkOf,
  stopControlPoint,
  stopLink,
  withinStopControl,
} from "../../src/sessionCard";
import type { AppSessionSnapshot } from "../../src/sessionControlProtocol";

const ID = "0b5e1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";

const SNAPSHOT: AppSessionSnapshot = {
  directory: "/work/acme",
  handle: `app:${ID}`,
  lastAgentText: '<script>alert("x")</script>',
  ledgerKey: "abc-1",
  openedAtIso: "2026-11-09T01:00:00.000Z",
  sessionId: ID,
  state: "running",
  title: "abc-1",
  vendor: "codex",
};

describe("escapeHtml", () => {
  it("replaces every markup character", () => {
    expect(escapeHtml({ text: `<a href="x">'&'</a>` })).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("sessionCardHtml", () => {
  it("shows the agent's words as text, never as markup", () => {
    const html = sessionCardHtml({ note: undefined, snapshot: SNAPSHOT });
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain('<script>alert("x")</script>');
  });

  it("offers Stop while the session is live, and not once it has ended", () => {
    expect(sessionCardHtml({ note: undefined, snapshot: SNAPSHOT })).toContain(`href="${stopLink({ sessionId: ID })}"`);
    expect(sessionCardHtml({ note: undefined, snapshot: { ...SNAPSHOT, state: "closed" } })).not.toContain(
      "slopweaver-session:",
    );
  });

  it("pins Stop to the box a press clicks, whatever length of text sits above it", () => {
    const html = sessionCardHtml({ note: undefined, snapshot: SNAPSHOT });
    expect(html).toContain(".stop{position:fixed;left:16px;bottom:16px;width:64px;height:30px;");
    expect(html).toContain("padding-bottom:46px}");
  });

  it("forbids every load but its own inline style", () => {
    expect(sessionCardHtml({ note: undefined, snapshot: SNAPSHOT })).toContain(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
  });

  it("names the vendor the session runs on beside its state", () => {
    expect(sessionCardHtml({ note: undefined, snapshot: SNAPSHOT })).toContain(`Working · Codex · app:${ID}`);
    expect(sessionCardHtml({ note: undefined, snapshot: { ...SNAPSHOT, vendor: "claude" } })).toContain(
      `Working · Claude · app:${ID}`,
    );
  });

  it("carries the control plane's note when it has one", () => {
    expect(sessionCardHtml({ note: "Stopped here", snapshot: SNAPSHOT })).toContain('<p class="note">Stopped here</p>');
  });
});

describe("stopControlPoint", () => {
  it("lands in the middle of the pinned Stop, measured up from the content's bottom", () => {
    expect(STOP_CONTROL_BOX).toEqual({ bottom: 16, height: 30, left: 16, width: 64 });
    expect(stopControlPoint({ contentHeight: 360 })).toEqual({ x: 48, y: 329 });
  });
});

describe("withinStopControl", () => {
  it("takes the Stop's own pixels, edges included at the top-left and excluded at the bottom-right", () => {
    expect(withinStopControl({ contentHeight: 360, ...stopControlPoint({ contentHeight: 360 }) })).toBe(true);
    expect(withinStopControl({ contentHeight: 360, x: 16, y: 314 })).toBe(true);
    expect(withinStopControl({ contentHeight: 360, x: 79, y: 343 })).toBe(true);
  });

  it("refuses a press beside, above or below the Stop", () => {
    expect(withinStopControl({ contentHeight: 360, x: 15, y: 320 })).toBe(false);
    expect(withinStopControl({ contentHeight: 360, x: 80, y: 320 })).toBe(false);
    expect(withinStopControl({ contentHeight: 360, x: 40, y: 313 })).toBe(false);
    expect(withinStopControl({ contentHeight: 360, x: 40, y: 344 })).toBe(false);
  });
});

describe("sessionCardFrameUrl", () => {
  it("is the card without its agent text, so two cards differing only in that text share one frame", () => {
    const later = { ...SNAPSHOT, lastAgentText: "more words" };
    expect(sessionCardFrameUrl({ note: undefined, snapshot: SNAPSHOT })).toBe(
      sessionCardFrameUrl({ note: undefined, snapshot: later }),
    );
    expect(sessionCardUrl({ note: undefined, snapshot: SNAPSHOT })).not.toBe(
      sessionCardUrl({ note: undefined, snapshot: later }),
    );
  });

  it("is the card itself once the agent has said nothing", () => {
    const { lastAgentText: _said, ...silent } = SNAPSHOT;
    expect(sessionCardFrameUrl({ note: undefined, snapshot: silent })).toBe(
      sessionCardUrl({ note: undefined, snapshot: silent }),
    );
  });

  it("changes with the state and the note, so either redraws at once", () => {
    const frame = sessionCardFrameUrl({ note: undefined, snapshot: SNAPSHOT });
    expect(sessionCardFrameUrl({ note: undefined, snapshot: { ...SNAPSHOT, state: "stopping" } })).not.toBe(frame);
    expect(sessionCardFrameUrl({ note: "Stop failed", snapshot: SNAPSHOT })).not.toBe(frame);
  });
});

describe("sessionLinkOf", () => {
  it("reads back the Stop link it rendered", () => {
    expect(sessionLinkOf({ url: stopLink({ sessionId: ID }) })).toEqual({ act: "stop", sessionId: ID });
  });

  it("reads nothing from a link naming no session id, or another scheme", () => {
    expect(sessionLinkOf({ url: "slopweaver-session:stop/not-an-id" })).toBe(undefined);
    expect(sessionLinkOf({ url: `https://example.com/stop/${ID}` })).toBe(undefined);
  });

  it("reads nothing from an escaped spelling of the id, or a malformed escape, rather than decoding it", () => {
    const escaped = `slopweaver-session:stop/%${ID.charCodeAt(0).toString(16)}${ID.slice(1)}`;
    expect(decodeURIComponent(escaped.slice("slopweaver-session:stop/".length))).toBe(ID);
    expect(sessionLinkOf({ url: escaped })).toBe(undefined);
    expect(sessionLinkOf({ url: "slopweaver-session:stop/%E0" })).toBe(undefined);
  });
});
