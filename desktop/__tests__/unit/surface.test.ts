/**
 * The console's addresses as the shell loads and remembers them: every load flagged for the native surface, and
 * the flag never remembered as part of the page.
 */
import { describe, expect, it } from "vitest";

import {
  askedMoveOnCommit,
  consoleUrl,
  frameNavigationDecision,
  holdingPage,
  inAppViewPath,
  isBareDocument,
  isVoicePath,
  loadsAfterRecovery,
  loadsOnShow,
  moveOnShow,
  navigatedFrom,
  withoutSurfaceFlag,
} from "../../src/surface";

describe("holdingPage", () => {
  const html = decodeURIComponent(
    holdingPage({ detail: "Bringing the console up", title: "Starting Slopweaver" }).replace(
      "data:text/html;charset=utf-8,",
      "",
    ),
  );

  it("says what it is holding for", () => {
    expect(html).toContain("Starting Slopweaver");
    expect(html).toContain("Bringing the console up");
  });

  it("declares no drag region, which the Queue tab kept under every console page after it (calls 845b4e0d, 931550a2)", () => {
    expect(html).not.toContain("app-region");
  });
});

describe("moveOnShow", () => {
  it("asks the briefing you are reading to go to the voice's card in place, never a whole load", () => {
    const briefing = "/view?src=%2Fapi%2Fpage%2Fbrief%2Findex.html&back=%2Fqueue";
    expect(moveOnShow({ asked: "/queue?open=ask%3Aautomations", current: briefing })).toBe("navigate");
  });

  it("only brings forward a window already on the asked page, or with nothing asked", () => {
    expect(moveOnShow({ asked: "/queue?open=hand:h-1", current: "/queue?open=hand:h-1" })).toBe("show");
    expect(moveOnShow({ asked: undefined, current: "/automations" })).toBe("show");
  });

  it("loads the window whole only when no console page is committed in it", () => {
    expect(moveOnShow({ asked: "/queue", current: undefined })).toBe("load");
    expect(moveOnShow({ asked: undefined, current: undefined })).toBe("load");
  });
});

describe("askedMoveOnCommit", () => {
  const asked = "/queue?open=ask:automations";
  const answered = { asked, leaving: false, taken: true };
  const unanswered = { asked, leaving: false, taken: false };

  it("is settled when the asked page commits, in place or as a new document, whatever the query's escaping", () => {
    expect(askedMoveOnCommit({ ...unanswered, committed: "/queue?open=ask%3Aautomations", inPage: true })).toBe(
      "settled",
    );
    expect(askedMoveOnCommit({ ...unanswered, committed: "/queue?open=ask:automations", inPage: false })).toBe(
      "settled",
    );
  });

  it("is settled by any in-place commit once taken, so a superseded push never loads you back later", () => {
    expect(askedMoveOnCommit({ ...answered, committed: "/automations", inPage: true })).toBe("settled");
    expect(askedMoveOnCommit({ ...answered, committed: "/alignment?open=act:x", inPage: true })).toBe("settled");
  });

  it("is settled by a new document once a load toward the asked page started, a redirect's target included", () => {
    expect(askedMoveOnCommit({ ...answered, committed: "/alignment", inPage: false, leaving: true })).toBe("settled");
  });

  it("loads the asked page whole when a new document commits elsewhere, destroying the page that was moving", () => {
    expect(askedMoveOnCommit({ ...answered, committed: "/queue?open=hand:h-1", inPage: false })).toBe("load");
    expect(askedMoveOnCommit({ ...unanswered, committed: undefined, inPage: false })).toBe("load");
  });

  it("keeps waiting through an in-place commit elsewhere before the page has answered", () => {
    expect(askedMoveOnCommit({ ...unanswered, committed: "/view?src=%2Fa", inPage: true })).toBe("wait");
    expect(askedMoveOnCommit({ ...unanswered, committed: undefined, inPage: true })).toBe("wait");
  });
});

describe("navigatedFrom", () => {
  it("keeps the page you were on as where a navigated document opens from", () => {
    expect(navigatedFrom({ from: "/queue?open=hand:h-1" })).toBe("/queue?open=hand:h-1");
  });

  it("opens from no page when the viewer navigated, so its Back cannot go round a redirect", () => {
    expect(navigatedFrom({ from: "/view?back=%2Fmodel&src=%2Fdocs" })).toBe(undefined);
    expect(navigatedFrom({ from: undefined })).toBe(undefined);
  });

  it("breaks the redirect loop: Back to an alias of a docs page goes back to the Queue the second time", () => {
    const viewer = "/view?back=%2Fmodel&src=%2Fdocs";
    expect(inAppViewPath({ from: navigatedFrom({ from: viewer }), path: "/docs/model" })).toBe(
      "/view?back=%2Fqueue&src=%2Fdocs%2Fmodel",
    );
  });
});

describe("isBareDocument", () => {
  it("names a local page, any file the console serves, and a docs page", () => {
    expect(isBareDocument({ path: "/api/page/vanta-evidence/index.html" })).toBe(true);
    expect(isBareDocument({ path: "/api/draft-media/a.png" })).toBe(true);
    expect(isBareDocument({ path: "/docs" })).toBe(true);
    expect(isBareDocument({ path: "/docs/console/queue#cards" })).toBe(true);
  });

  it("names a static file the console serves, so a link to one never replaces the console", () => {
    expect(isBareDocument({ path: "/icon.svg" })).toBe(true);
    expect(isBareDocument({ path: "/diagram.CSS?v=1" })).toBe(true);
    expect(isBareDocument({ path: "/_next/static/chunks/app.js" })).toBe(true);
    expect(isBareDocument({ path: "/demo.avif" })).toBe(true);
  });

  it("judges the decoded path the server routes on, and a path that does not decode as a document", () => {
    expect(isBareDocument({ path: "/icon%2Esvg" })).toBe(true);
    expect(isBareDocument({ path: "/%61pi/page/a/index.html" })).toBe(true);
    expect(isBareDocument({ path: "/queue%E0%A4%A" })).toBe(true);
    expect(isBareDocument({ path: "/queue?open=a%2Esvg" })).toBe(false);
  });

  it("leaves every console page alone, a near-miss included", () => {
    expect(isBareDocument({ path: "/queue?open=hand:h-1" })).toBe(false);
    expect(isBareDocument({ path: "/view?src=/api/page/a/index.html" })).toBe(false);
    expect(isBareDocument({ path: "/docsearch" })).toBe(false);
    expect(isBareDocument({ path: "/api" })).toBe(false);
  });
});

describe("inAppViewPath", () => {
  it("frames a card's local page, with the card you were on as the way back", () => {
    expect(inAppViewPath({ from: "/queue?open=hand:h-1&tag=ev", path: "/api/page/vanta-evidence/index.html" })).toBe(
      "/view?back=%2Fqueue%3Fopen%3Dhand%3Ah-1%26tag%3Dev&src=%2Fapi%2Fpage%2Fvanta-evidence%2Findex.html",
    );
  });

  it("keeps the viewer's own way back when a page links another page", () => {
    const first = inAppViewPath({ from: "/queue?open=hand:h-1", path: "/api/page/a/index.html" });
    expect(inAppViewPath({ from: first, path: "/api/page/b/index.html" })).toBe(
      "/view?back=%2Fqueue%3Fopen%3Dhand%3Ah-1&src=%2Fapi%2Fpage%2Fb%2Findex.html",
    );
  });

  it("goes back to the Queue when the window is on no console page", () => {
    expect(inAppViewPath({ from: undefined, path: "/docs" })).toBe("/view?back=%2Fqueue&src=%2Fdocs");
    expect(inAppViewPath({ from: "/api/page/a/index.html", path: "/docs" })).toBe("/view?back=%2Fqueue&src=%2Fdocs");
    expect(inAppViewPath({ from: "/view?src=%2Fdocs", path: "/docs" })).toBe("/view?back=%2Fqueue&src=%2Fdocs");
  });

  it("keeps a document's own query and fragment inside the viewer's address", () => {
    expect(inAppViewPath({ from: "/queue", path: "/docs/console/queue?x=1#cards" })).toBe(
      "/view?back=%2Fqueue&src=%2Fdocs%2Fconsole%2Fqueue%3Fx%3D1%23cards",
    );
  });

  it("loads a console page as it is, the viewer itself included", () => {
    expect(inAppViewPath({ from: "/queue", path: "/view?src=%2Fdocs" })).toBe("/view?src=%2Fdocs");
  });

  it("loads a console page as it is", () => {
    expect(inAppViewPath({ from: "/queue", path: "/pull-requests/o/r/1?tab=files" })).toBe(
      "/pull-requests/o/r/1?tab=files",
    );
  });
});

describe("loadsOnShow", () => {
  it("only brings forward a window an app activation finds on the console", () => {
    expect(loadsOnShow({ asked: undefined, current: "/queue?context=work&tag=priority:p1" })).toBe(false);
  });

  it("loads when the window is not on the console yet, asked or not", () => {
    expect(loadsOnShow({ asked: undefined, current: undefined })).toBe(true);
    expect(loadsOnShow({ asked: "/queue", current: undefined })).toBe(true);
  });

  it("keeps your context and filter when the bare page you are on is asked for", () => {
    expect(loadsOnShow({ asked: "/queue", current: "/queue?context=work&tag=priority:p1" })).toBe(false);
  });

  it("navigates to a different page", () => {
    expect(loadsOnShow({ asked: "/queue", current: "/automations" })).toBe(true);
  });

  it("navigates when an exact address on the same page differs, and not when it is the one shown", () => {
    expect(loadsOnShow({ asked: "/queue?open=hand:h-1", current: "/queue?context=work" })).toBe(true);
    expect(loadsOnShow({ asked: "/queue?open=hand:h-1", current: "/queue?open=hand:h-1" })).toBe(false);
  });
});

describe("loadsAfterRecovery", () => {
  const origin = "http://localhost:3000";

  it("leaves a window already on the recovered console alone, card, viewer and all", () => {
    expect(
      loadsAfterRecovery({
        current: "/queue?context=work&open=hand:h-1",
        origin,
        url: "http://localhost:3000/queue?context=work&open=hand:h-1&sw-surface=native",
      }),
    ).toBe(false);
    expect(
      loadsAfterRecovery({
        current: "/view?back=%2Fqueue&src=%2Fapi%2Fpage%2Fx%2Findex.html",
        origin,
        url: "http://localhost:3000/view?back=%2Fqueue&src=%2Fapi%2Fpage%2Fx%2Findex.html&sw-surface=native",
      }),
    ).toBe(false);
  });

  it("loads when no console page is committed in the window — a holding page, a failed load, nothing yet", () => {
    expect(loadsAfterRecovery({ current: undefined, origin, url: "data:text/html;charset=utf-8,Starting" })).toBe(true);
    expect(loadsAfterRecovery({ current: undefined, origin, url: "http://localhost:3000/queue" })).toBe(true);
    expect(loadsAfterRecovery({ current: undefined, origin, url: "" })).toBe(true);
  });

  it("loads the holding page when the recovery failed, whatever the window shows", () => {
    expect(loadsAfterRecovery({ current: "/queue", origin: undefined, url: "http://localhost:3000/queue" })).toBe(true);
  });

  it("loads when the console came back on another origin than the page the window shows", () => {
    expect(
      loadsAfterRecovery({ current: "/queue", origin: "http://localhost:3001", url: "http://localhost:3000/queue" }),
    ).toBe(true);
  });
});

describe("consoleUrl", () => {
  it("flags a page for the native surface, keeping its own query and hash", () => {
    expect(consoleUrl({ origin: "http://localhost:3000", path: "/queue?tag=ev#card-3" })).toBe(
      "http://localhost:3000/queue?tag=ev&sw-surface=native#card-3",
    );
  });

  it("does not repeat a flag the path already carries", () => {
    expect(consoleUrl({ origin: "http://localhost:3000", path: "/voice?sw-surface=native" })).toBe(
      "http://localhost:3000/voice?sw-surface=native",
    );
  });
});

describe("withoutSurfaceFlag", () => {
  it("takes the shell's flag back out and keeps the rest", () => {
    expect(withoutSurfaceFlag({ path: "/queue?tag=ev&sw-surface=native#card-3" })).toBe("/queue?tag=ev#card-3");
  });

  it("leaves a page with no flag as it was", () => {
    expect(withoutSurfaceFlag({ path: "/automations?tab=health" })).toBe("/automations?tab=health");
  });
});

describe("isVoicePath", () => {
  it("names the voice page whatever its query", () => {
    expect(isVoicePath({ path: "/voice?sw-surface=native" })).toBe(true);
  });

  it("does not name a page that only starts with it", () => {
    expect(isVoicePath({ path: "/voices" })).toBe(false);
    expect(isVoicePath({ path: "/queue" })).toBe(false);
  });
});

describe("frameNavigationDecision", () => {
  const VANTA = "https://app.vanta.com/c/acme/controls?controlId=0syn0006";
  const BRIEFING = "/api/page/iso-week-46-short/index.html";
  const own = ({ path, url }: { path: string | undefined; url: string }): string =>
    frameNavigationDecision({ isMainFrame: false, path, selfInitiated: true, url });

  it("leaves the window's own page to will-navigate", () => {
    expect(frameNavigationDecision({ isMainFrame: true, path: undefined, selfInitiated: true, url: VANTA })).toBe(
      "allow",
    );
    expect(
      frameNavigationDecision({
        isMainFrame: true,
        path: "/queue",
        selfInitiated: true,
        url: "http://localhost:3000/queue",
      }),
    ).toBe("allow");
  });

  it("lets a frame load the page its parent gave it, on the console or off it", () => {
    expect(
      frameNavigationDecision({
        isMainFrame: false,
        path: BRIEFING,
        selfInitiated: false,
        url: `http://localhost:3000${BRIEFING}`,
      }),
    ).toBe("allow");
    expect(frameNavigationDecision({ isMainFrame: false, path: undefined, selfInitiated: false, url: VANTA })).toBe(
      "allow",
    );
  });

  it("sends a briefing's own link off the console to your browser, as a ⌘-click would", () => {
    expect(own({ path: undefined, url: VANTA })).toBe("open-outside");
    expect(own({ path: undefined, url: "http://example.test/page" })).toBe("open-outside");
    expect(own({ path: undefined, url: "mailto:someone@example.test" })).toBe("open-outside");
  });

  it("refuses a scheme your browser does not open", () => {
    expect(own({ path: undefined, url: "file:///etc/hosts" })).toBe("block");
    expect(own({ path: undefined, url: "javascript:void(0)" })).toBe("block");
    expect(own({ path: undefined, url: "data:text/html,hi" })).toBe("block");
    expect(own({ path: undefined, url: "about:blank" })).toBe("block");
  });

  it("keeps another bare document in the frame", () => {
    expect(
      own({
        path: "/api/page/access-review-286-8/index.html",
        url: "http://localhost:3000/api/page/access-review-286-8/index.html",
      }),
    ).toBe("allow");
    expect(own({ path: "/docs/console", url: "http://localhost:3000/docs/console" })).toBe("allow");
    expect(own({ path: "/icon.svg", url: "http://localhost:3000/icon.svg" })).toBe("allow");
  });

  it("opens a console page as a new tab rather than inside the frame", () => {
    expect(
      own({ path: "/queue?open=post%3Asd-d62296fa", url: "http://localhost:3000/queue?open=post%3Asd-d62296fa" }),
    ).toBe("open-console-tab");
  });

  it("refuses the voice page", () => {
    expect(own({ path: "/voice?sw-surface=native", url: "http://localhost:3000/voice?sw-surface=native" })).toBe(
      "block",
    );
  });
});
