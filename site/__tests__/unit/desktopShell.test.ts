/*
 * The console's side of the desktop shell: the shell's object is accepted only when it is whole, and everything
 * the shell sends is checked before the voice acts on it.
 */
import { describe, expect, it } from "vitest";

import {
  desktopBridgeOf,
  desktopRoleOf,
  instanceMarkOf,
  NOTICE_SUMMARY_MAX,
  NOTICE_WIRE_DETAIL_MAX,
  pageIdentityOf,
  shellNavigationPathOf,
  voiceFailureNoticeWireOf,
} from "../../lib/desktopShell";
import {
  askedFor,
  FIRST_AREA,
  FIRST_ASK,
  NO_INSET,
  overlayAreaOf,
  overlayCommandOf,
  overlayCovers,
  overlayExtentOf,
  overlayFloorOf,
  overlayHideControlShown,
  overlayInsetOf,
  overlayModeOf,
  overlayReportOf,
  overlayStatusOf,
  overlayWantsWhole,
} from "../../lib/desktopShellOverlay";
import { focusRectReplyOf, shellBuildOf } from "../../lib/desktopShellWire";
import { REVEAL_WHY_MAX, revealReplyOf } from "../../lib/revealReply";
import { voiceViewOf } from "../../lib/voiceWindow";

describe("overlayHideControlShown", () => {
  it("draws the X on the corner orb only under a shell that can hide its window, never once the view is the stage", () => {
    expect([
      overlayHideControlShown({ canHide: true, staged: false }),
      overlayHideControlShown({ canHide: true, staged: true }),
      overlayHideControlShown({ canHide: false, staged: false }),
    ]).toEqual([true, false, false]);
  });
});

/** A stand-in method; never called here. */
const noop = (): undefined => undefined;

/** Every method the console calls, present. */
const WHOLE = {
  onOverlayCommand: noop,
  onPageIdentity: noop,
  publishPageIdentity: noop,
  reportOverlayStatus: noop,
  requestOverlay: noop,
};

describe("desktopBridgeOf and desktopRoleOf", () => {
  it("reads a browser when there is no shell object", () => {
    expect(desktopRoleOf({ bridge: desktopBridgeOf({ value: undefined }) })).toBe("browser");
  });

  it("reads the window's role off a whole object", () => {
    expect(desktopRoleOf({ bridge: desktopBridgeOf({ value: { ...WHOLE, role: "overlay" } }) })).toBe("overlay");
    expect(desktopRoleOf({ bridge: desktopBridgeOf({ value: { ...WHOLE, role: "main" } }) })).toBe("main");
  });

  it("refuses an object missing one method, so a stale shell is a browser rather than half a shell", () => {
    const { onPageIdentity: _missing, ...partial } = WHOLE;
    expect(desktopBridgeOf({ value: { ...partial, role: "overlay" } })).toBe(undefined);
  });

  it("keeps a shell built while it still hid the voice for a look a shell, so a page rebuilt first loses nothing", () => {
    const older = { ...WHOLE, resumeOverlayAfterCapture: noop, role: "overlay", suspendOverlayForCapture: noop };
    expect(desktopRoleOf({ bridge: desktopBridgeOf({ value: older }) })).toBe("overlay");
  });

  it("refuses a role it does not know", () => {
    expect(desktopBridgeOf({ value: { ...WHOLE, role: "browser" } })).toBe(undefined);
  });

  it("keeps a shell built before it forwarded the overlay's status a shell, so its console window starts nothing", () => {
    expect(desktopRoleOf({ bridge: desktopBridgeOf({ value: { ...WHOLE, role: "main" } }) })).toBe("main");
    const newer = { ...WHOLE, onOverlayStatus: noop, overlayStatusNow: noop, role: "main" };
    expect(desktopRoleOf({ bridge: desktopBridgeOf({ value: newer }) })).toBe("main");
  });

  it("keeps a shell that draws the edge glow a shell, and refuses one whose glow report is not a function", () => {
    const newer = desktopBridgeOf({ value: { ...WHOLE, reportOverlayGlow: noop, role: "overlay" } })!;
    expect(newer.reportOverlayGlow).toBe(noop);
    expect(desktopBridgeOf({ value: { ...WHOLE, reportOverlayGlow: "yes", role: "overlay" } })).toBe(undefined);
  });

  it("keeps a shell that says it takes the open card a shell, and refuses a flag that is not a boolean", () => {
    const newer = desktopBridgeOf({ value: { ...WHOLE, carriesOpenCard: true, role: "main" } })!;
    expect(newer.carriesOpenCard).toBe(true);
    expect(desktopBridgeOf({ value: { ...WHOLE, carriesOpenCard: "yes", role: "main" } })).toBe(undefined);
  });

  // A malformed marker read as none would leave the page posting as a plain browser, ruled the owner's.
  it("reads every test-instance marker present as the test instance's, and none on the owner's own app or a browser", () => {
    const values: readonly unknown[] = ["e2e", "E2E", "", true];
    expect(values.map((instance) => instanceMarkOf({ value: { ...WHOLE, instance, role: "overlay" } }))).toEqual([
      "e2e",
      "e2e",
      "e2e",
      "e2e",
    ]);
    expect(instanceMarkOf({ value: { ...WHOLE, role: "overlay" } })).toBe(undefined);
    expect(instanceMarkOf({ value: undefined })).toBe(undefined);
  });

  // A test window whose bridge is refused draws as a browser; a mark read off the kept bridge would post unmarked.
  it("keeps the test-instance mark on a shell object the console refuses as its bridge", () => {
    const { onPageIdentity: _missing, ...partial } = WHOLE;
    const refused: readonly unknown[] = [
      { ...partial, instance: "e2e", role: "overlay" },
      { ...WHOLE, carriesOpenCard: "yes", instance: "e2e", role: "main" },
      { ...WHOLE, instance: "e2e", role: "browser" },
    ];
    expect(refused.map((value) => desktopBridgeOf({ value }))).toEqual([undefined, undefined, undefined]);
    expect(refused.map((value) => instanceMarkOf({ value }))).toEqual(["e2e", "e2e", "e2e"]);
  });

  it("refuses an object whose status method is there but not a function", () => {
    expect(desktopBridgeOf({ value: { ...WHOLE, onOverlayStatus: "yes", role: "main" } })).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...WHOLE, overlayStatusNow: 1, role: "main" } })).toBe(undefined);
  });

  it("keeps a voice window from a shell that cannot move the console to a card a shell, and refuses a non-function", () => {
    expect(desktopRoleOf({ bridge: desktopBridgeOf({ value: { ...WHOLE, role: "overlay" } }) })).toBe("overlay");
    const newer = { ...WHOLE, presentQueueCard: noop, role: "overlay" };
    expect(desktopRoleOf({ bridge: desktopBridgeOf({ value: newer }) })).toBe("overlay");
    expect(desktopBridgeOf({ value: { ...WHOLE, presentQueueCard: "/queue", role: "overlay" } })).toBe(undefined);
  });

  // A shell that opens Alignment cards too names the method for both pages.
  it("keeps a shell's console-card method beside an older shell's Queue-only one, and refuses a non-function", () => {
    const newer = desktopBridgeOf({ value: { ...WHOLE, presentConsoleCard: noop, role: "overlay" } })!;
    expect([newer.presentConsoleCard, newer.presentQueueCard]).toEqual([noop, undefined]);
    expect(desktopBridgeOf({ value: { ...WHOLE, presentConsoleCard: "/alignment", role: "overlay" } })).toBe(undefined);
  });

  it("keeps a voice window from a shell that cannot see the owner's screen a shell, and refuses a non-function", () => {
    const newer = { ...WHOLE, captureScreen: noop, role: "overlay" };
    expect(desktopBridgeOf({ value: newer })!.captureScreen).toBe(noop);
    expect(desktopBridgeOf({ value: { ...WHOLE, role: "overlay" } })!.captureScreen).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...WHOLE, captureScreen: true, role: "overlay" } })).toBe(undefined);
  });

  it("keeps a voice window from a shell that never shrinks it a shell, and refuses a non-function extent report", () => {
    const newer = { ...WHOLE, reportOverlayExtent: noop, role: "overlay" };
    expect(desktopBridgeOf({ value: newer })!.reportOverlayExtent).toBe(noop);
    expect(desktopBridgeOf({ value: { ...WHOLE, role: "overlay" } })!.reportOverlayExtent).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...WHOLE, reportOverlayExtent: 1, role: "overlay" } })).toBe(undefined);
  });

  it("keeps a voice window from a shell that sends no word on its area a shell, and refuses a non-function", () => {
    const newer = { ...WHOLE, onOverlayArea: noop, role: "overlay" };
    expect(desktopBridgeOf({ value: newer })!.onOverlayArea).toBe(noop);
    expect(desktopBridgeOf({ value: { ...WHOLE, role: "overlay" } })!.onOverlayArea).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...WHOLE, onOverlayArea: true, role: "overlay" } })).toBe(undefined);
  });

  it("keeps a voice window from a shell whose whole window is the work area a shell, and refuses a non-function", () => {
    const newer = { ...WHOLE, onOverlayInset: noop, role: "overlay" };
    expect(desktopBridgeOf({ value: newer })!.onOverlayInset).toBe(noop);
    expect(desktopBridgeOf({ value: { ...WHOLE, role: "overlay" } })!.onOverlayInset).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...WHOLE, onOverlayInset: true, role: "overlay" } })).toBe(undefined);
  });

  it("keeps a voice window from a shell that rests the orb on the work area a shell, and refuses a non-function", () => {
    const newer = { ...WHOLE, onOverlayFloor: noop, role: "overlay" };
    expect(desktopBridgeOf({ value: newer })!.onOverlayFloor).toBe(noop);
    expect(desktopBridgeOf({ value: { ...WHOLE, role: "overlay" } })!.onOverlayFloor).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...WHOLE, onOverlayFloor: 189, role: "overlay" } })).toBe(undefined);
  });

  it("keeps a voice window from a shell that cannot focus it a shell, and refuses a non-function", () => {
    const newer = { ...WHOLE, focusOverlay: noop, role: "overlay" };
    expect(desktopBridgeOf({ value: newer })!.focusOverlay).toBe(noop);
    expect(desktopBridgeOf({ value: { ...WHOLE, role: "overlay" } })!.focusOverlay).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...WHOLE, focusOverlay: "yes", role: "overlay" } })).toBe(undefined);
  });

  it("keeps a voice window from a shell that cannot hide it a shell, and refuses a non-function", () => {
    const newer = { ...WHOLE, hideOverlay: noop, role: "overlay" };
    expect(desktopBridgeOf({ value: newer })!.hideOverlay).toBe(noop);
    expect(desktopBridgeOf({ value: { ...WHOLE, role: "overlay" } })!.hideOverlay).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...WHOLE, hideOverlay: "hide", role: "overlay" } })).toBe(undefined);
  });

  it("keeps a console window from a shell that only loads pages whole a shell, and refuses a non-function", () => {
    const newer = { ...WHOLE, onNavigate: noop, role: "main" };
    expect(desktopBridgeOf({ value: newer })!.onNavigate).toBe(noop);
    expect(desktopBridgeOf({ value: { ...WHOLE, role: "main" } })!.onNavigate).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...WHOLE, onNavigate: "/queue", role: "main" } })).toBe(undefined);
  });

  // An app from before the failure toast is still the shell; the voice names the gap on its record instead.
  it("keeps a shell with or without the failure-toast methods, and refuses a non-function", () => {
    const newer = { ...WHOLE, onVoiceFailure: noop, reportVoiceFailure: noop, role: "overlay" };
    const bridge = desktopBridgeOf({ value: newer })!;
    expect([bridge.reportVoiceFailure, bridge.onVoiceFailure]).toEqual([noop, noop]);
    expect(desktopBridgeOf({ value: { ...WHOLE, role: "overlay" } })!.reportVoiceFailure).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...WHOLE, reportVoiceFailure: "toast", role: "overlay" } })).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...WHOLE, onVoiceFailure: 1, role: "main" } })).toBe(undefined);
  });

  it("keeps the toast's open-in-new-tab seam when the shell has it, and refuses one that is not a function", () => {
    const mainWindow = { ...WHOLE, role: "main" };
    expect(desktopBridgeOf({ value: { ...mainWindow, openQueueCardInNewTab: noop } })!.openQueueCardInNewTab).toBe(
      noop,
    );
    expect(desktopBridgeOf({ value: mainWindow })!.openQueueCardInNewTab).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...mainWindow, openQueueCardInNewTab: "open" } })).toBe(undefined);
  });

  it("keeps the viewer's Reveal in Finder seam when the shell has it, and refuses one that is not a function", () => {
    const mainWindow = { ...WHOLE, role: "main" };
    const reveal = async (): Promise<unknown> => null;
    expect(desktopBridgeOf({ value: { ...mainWindow, revealPageInFinder: reveal } })!.revealPageInFinder).toBe(reveal);
    expect(desktopBridgeOf({ value: mainWindow })!.revealPageInFinder).toBe(undefined);
    expect(desktopBridgeOf({ value: { ...mainWindow, revealPageInFinder: "reveal" } })).toBe(undefined);
  });
});

describe("revealReplyOf", () => {
  it("reads null as Finder asked", () => {
    expect(revealReplyOf({ value: null })).toEqual({ kind: "revealed" });
  });

  it("reads one bounded line as the reason, unchanged, at both edges of its length", () => {
    const longest = "x".repeat(REVEAL_WHY_MAX);
    expect(revealReplyOf({ value: "!" })).toEqual({ kind: "refused", why: "!" });
    expect(revealReplyOf({ value: longest })).toEqual({ kind: "refused", why: longest });
    expect(revealReplyOf({ value: 'the page "a" is not on disk, so there is nothing to reveal' })).toEqual({
      kind: "refused",
      why: 'the page "a" is not on disk, so there is nothing to reveal',
    });
  });

  it("reads anything else as unreadable rather than showing it as a reason", () => {
    const others: readonly unknown[] = [
      undefined,
      false,
      true,
      0,
      "",
      "   ",
      "a\nb",
      "a\rb",
      "x".repeat(REVEAL_WHY_MAX + 1),
      {},
      [],
      { why: "a" },
    ];
    expect(others.map((value) => revealReplyOf({ value }))).toEqual(others.map(() => ({ kind: "unreadable" })));
  });
});

describe("voiceFailureNoticeWireOf", () => {
  const NOTICE = {
    detail: "card: refused",
    summary: "The voice couldn't open the card",
  };

  it("takes exactly a one-line summary and a reason, the reason allowed empty", () => {
    expect(voiceFailureNoticeWireOf({ value: NOTICE })).toStrictEqual(NOTICE);
    expect(voiceFailureNoticeWireOf({ value: { ...NOTICE, detail: "" } })).toStrictEqual({ ...NOTICE, detail: "" });
  });

  it("takes a card's key beside them, the shortest and the longest id alike", () => {
    const longest = `act:${"a".repeat(160)}`;
    const taken = ["ask:a", longest].map((cardKey) => voiceFailureNoticeWireOf({ value: { ...NOTICE, cardKey } }));
    expect(taken).toStrictEqual([
      { ...NOTICE, cardKey: "ask:a" },
      { ...NOTICE, cardKey: longest },
    ]);
  });

  it("refuses a missing or extra field, a blank summary, a two-line summary, and anything over its bound", () => {
    const { detail: _dropped, ...missing } = NOTICE;
    const refused = [
      missing,
      { ...NOTICE, extra: 1 },
      { ...NOTICE, dedupeKey: "tool:open_card" },
      { ...NOTICE, summary: "" },
      { ...NOTICE, summary: "one\ntwo" },
      { ...NOTICE, summary: "s".repeat(NOTICE_SUMMARY_MAX + 1) },
      { ...NOTICE, detail: "d".repeat(NOTICE_WIRE_DETAIL_MAX + 1) },
      { ...NOTICE, detail: 7 },
      [NOTICE],
      "toast",
    ].map((value) => voiceFailureNoticeWireOf({ value }));
    expect(refused).toEqual(Array.from({ length: 10 }, () => undefined));
  });

  it("refuses a card key that is not exactly a Queue card's, or is present but empty", () => {
    const refused = [
      undefined,
      "",
      7,
      "ask:",
      "ask:a b",
      "ask:a\nb",
      "ask:a:b",
      "ask:a&open=hand:b",
      "recipe:a",
      "align:a",
      "https://example.com/queue?open=ask:a",
      `ask:${"a".repeat(161)}`,
      "pr:42",
      "pr:acme.widgets.042",
    ].map((cardKey) => voiceFailureNoticeWireOf({ value: { ...NOTICE, cardKey } }));
    expect(refused).toEqual(Array.from({ length: 14 }, () => undefined));
  });

  it("takes a pull request's key that names its repository", () => {
    expect(voiceFailureNoticeWireOf({ value: { ...NOTICE, cardKey: "pr:acme.widgets.42" } })).toStrictEqual({
      ...NOTICE,
      cardKey: "pr:acme.widgets.42",
    });
  });
});

describe("shellBuildOf", () => {
  const STAMP = { committedIso: "2026-10-05T12:59:00Z", sha: "e".repeat(40), tree: "clean" };

  it("reads both stamps, and null as no stamp", () => {
    expect(shellBuildOf({ value: { dev: false, installed: null, running: STAMP } })).toEqual({
      dev: false,
      installed: undefined,
      running: STAMP,
    });
  });

  it("reads a run from source", () => {
    expect(shellBuildOf({ value: { dev: true, installed: null, running: null } })).toEqual({
      dev: true,
      installed: undefined,
      running: undefined,
    });
  });

  it("refuses a missing field, an extra field, a short sha, a bad instant and a bad tree word", () => {
    expect(shellBuildOf({ value: { dev: false, running: STAMP } })).toBe(undefined);
    expect(shellBuildOf({ value: { dev: false, extra: 1, installed: null, running: STAMP } })).toBe(undefined);
    expect(shellBuildOf({ value: { dev: false, installed: null, running: { ...STAMP, sha: "eeee" } } })).toBe(
      undefined,
    );
    expect(
      shellBuildOf({ value: { dev: false, installed: null, running: { ...STAMP, committedIso: "yesterday" } } }),
    ).toBe(undefined);
    expect(shellBuildOf({ value: { dev: false, installed: null, running: { ...STAMP, tree: "mixed" } } })).toBe(
      undefined,
    );
    expect(shellBuildOf({ value: { dev: "no", installed: null, running: null } })).toBe(undefined);
  });

  it("accepts a bridge carrying it, and refuses one where it is not a function", () => {
    expect(desktopRoleOf({ bridge: desktopBridgeOf({ value: { ...WHOLE, role: "main", shellBuild: noop } }) })).toBe(
      "main",
    );
    expect(desktopBridgeOf({ value: { ...WHOLE, role: "main", shellBuild: "yes" } })).toBe(undefined);
  });
});

describe("shellNavigationPathOf", () => {
  it("takes the card the voice opened from the briefing the owner was reading, query and all", () => {
    const card = "/queue?open=ask%3Aautomations-page-replaces-per-failure-notes&context=work";
    expect(shellNavigationPathOf({ value: card })).toBe(card);
    expect(shellNavigationPathOf({ value: "/view?src=%2Fapi%2Fpage%2Fx%2Findex.html&back=%2Fqueue" })).toBe(
      "/view?src=%2Fapi%2Fpage%2Fx%2Findex.html&back=%2Fqueue",
    );
  });

  it("refuses anything that is not exactly a console page, so the shell loads the window whole instead", () => {
    const bad: unknown[] = [
      undefined,
      42,
      "",
      "queue",
      "//evil.example/queue",
      "https://evil.example/queue",
      "/\\evil.example",
      "/queue?open=a b",
      "/queue\n",
      "/voice",
      "/voice?orb=1",
      `/queue?open=${"x".repeat(8192)}`,
    ];
    expect(bad.map((value) => shellNavigationPathOf({ value }))).toEqual(bad.map(() => undefined));
  });
});

describe("overlayExtentOf", () => {
  it("measures the widget from the window's bottom edge, rounded up to a whole pixel, carrying the asks", () => {
    expect(overlayExtentOf({ asks: 2, floor: 0, viewportHeight: 832, wholeArea: false, widgetTop: 690.4 })).toEqual({
      asks: 2,
      height: 142,
      wholeArea: false,
    });
  });

  it("measures from the widget's floor while the whole window runs under the Dock", () => {
    // The same widget, 142 above its floor, in a 982-high window whose last 117 are the Dock and the band above it.
    expect(overlayExtentOf({ asks: 2, floor: 117, viewportHeight: 982, wholeArea: true, widgetTop: 723.4 })).toEqual({
      asks: 2,
      height: 142,
      wholeArea: true,
    });
  });

  it("measures a widget that outgrew the corner past the window's top, so the corner grows to hold it", () => {
    expect(overlayExtentOf({ asks: 0, floor: 0, viewportHeight: 144, wholeArea: false, widgetTop: -60 })).toEqual({
      asks: 0,
      height: 204,
      wholeArea: false,
    });
  });

  it("never reports a negative height", () => {
    expect(overlayExtentOf({ asks: 1, floor: 0, viewportHeight: 100, wholeArea: true, widgetTop: 140 })).toEqual({
      asks: 1,
      height: 0,
      wholeArea: true,
    });
  });
});

describe("overlayInsetOf", () => {
  it("reads where the work area sits inside the window, edge by edge", () => {
    expect(overlayInsetOf({ value: { bottom: 117, left: 0, right: 0, top: 33 } })).toEqual({
      bottom: 117,
      left: 0,
      right: 0,
      top: 33,
    });
  });

  it("is nothing at all before the shell says otherwise", () => {
    expect(NO_INSET).toEqual({ bottom: 0, left: 0, right: 0, top: 0 });
  });

  it("drops a malformed inset, so a stray word never pushes the orb off the screen", () => {
    expect(
      [
        33,
        { bottom: 117, left: 0, right: 0 },
        { bottom: -1, left: 0, right: 0, top: 33 },
        { bottom: Number.POSITIVE_INFINITY, left: 0, right: 0, top: 33 },
        { bottom: "117", left: 0, right: 0, top: 33 },
        { bottom: 117, extra: 1, left: 0, right: 0, top: 33 },
        [117, 0, 0, 33],
        null,
      ].map((value) => overlayInsetOf({ value })),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("overlayFloorOf", () => {
  it("reads how far above the window's bottom edge the orb rests", () => {
    expect([0, 189, 151.2].map((value) => overlayFloorOf({ value }))).toEqual([0, 189, 151.2]);
  });

  it("drops a malformed floor, so a stray word never pushes the orb off the screen", () => {
    expect(
      [-1, Number.NaN, Number.POSITIVE_INFINITY, "189", { floor: 189 }, null, undefined].map((value) =>
        overlayFloorOf({ value }),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("askedFor", () => {
  it("starts over the whole work area, where the shell holds a fresh page, never asked for", () => {
    expect(FIRST_ASK).toEqual({ asks: 0, wholeArea: true });
    expect(askedFor({ before: FIRST_ASK, wholeArea: true })).toBe(FIRST_ASK);
  });

  it("counts a new ask each time the page turns from the corner to the whole work area", () => {
    const corner = askedFor({ before: FIRST_ASK, wholeArea: false });
    expect(corner).toEqual({ asks: 0, wholeArea: false });
    const grown = askedFor({ before: corner, wholeArea: true });
    expect(grown).toEqual({ asks: 1, wholeArea: true });
    expect(askedFor({ before: askedFor({ before: grown, wholeArea: false }), wholeArea: true })).toEqual({
      asks: 2,
      wholeArea: true,
    });
  });

  it("returns the same ask when nothing moved, so the render that derives it settles", () => {
    const corner = { asks: 3, wholeArea: false };
    expect(askedFor({ before: corner, wholeArea: false })).toBe(corner);
  });
});

describe("overlayCovers", () => {
  const asked = { asks: 2, wholeArea: true };

  it("opens once the shell says whole in answer to the newest ask", () => {
    expect(overlayCovers({ area: { asks: 2, whole: true }, ask: asked })).toBe(true);
  });

  it("stays shut on a whole the shell sent before it read the newest ask, a window it may have shrunk since", () => {
    expect(overlayCovers({ area: { asks: 1, whole: true }, ask: asked })).toBe(false);
  });

  it("stays shut while the shell says the window is the corner", () => {
    expect(overlayCovers({ area: { asks: 2, whole: false }, ask: asked })).toBe(false);
  });

  it("is open on a fresh page before any word, as the shell holds it over the whole work area", () => {
    expect(overlayCovers({ area: FIRST_AREA, ask: FIRST_ASK })).toBe(true);
  });
});

describe("overlayAreaOf", () => {
  it("reads the shell's word: whether the window is whole, and the asks it answers", () => {
    expect(overlayAreaOf({ value: { asks: 3, whole: true } })).toEqual({ asks: 3, whole: true });
    expect(overlayAreaOf({ value: { asks: 0, whole: false } })).toEqual({ asks: 0, whole: false });
  });

  it("drops a malformed word, so it never opens the stage over the corner", () => {
    expect(
      [
        true,
        { asks: 1, whole: "true" },
        { asks: -1, whole: true },
        { asks: 1.5, whole: true },
        { asks: 1, extra: 1, whole: true },
        [true, 1],
        null,
      ].map((value) => overlayAreaOf({ value })),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("focusRectReplyOf", () => {
  const MALFORMED = {
    kind: "refused",
    why: "the desktop app answered the highlight with nowhere the voice could draw it",
  };

  it("reads exactly a rect, or exactly a refusal made one line", () => {
    expect(focusRectReplyOf({ value: { rect: { height: 40, left: 10, top: 20, width: 200 } } })).toEqual({
      kind: "rect",
      rect: { height: 40, left: 10, top: 20, width: 200 },
    });
    expect(focusRectReplyOf({ value: { why: "the owner's screen changed\nsince the voice looked" } })).toEqual({
      kind: "refused",
      why: "the owner's screen changed since the voice looked",
    });
  });

  it("refuses, naming the desktop app, anything else it sent back", () => {
    const values = [
      undefined,
      [],
      { rect: { height: 40, left: 10, top: 20, width: 200 }, why: "both" },
      { rect: { height: 40, left: 10, top: 20, width: 200, x: 1 } },
      { rect: { height: Number.NaN, left: 10, top: 20, width: 200 } },
      { rect: { height: 40, left: -1, top: 20, width: 200 } },
      { why: "" },
      { why: "x".repeat(513) },
    ];
    expect(values.map((value) => focusRectReplyOf({ value }))).toEqual(values.map(() => MALFORMED));
  });
});

describe("overlayStatusOf", () => {
  it("accepts a call up or down in either view", () => {
    expect(overlayStatusOf({ value: { callActive: true, mode: "collapsed" } })).toEqual({
      callActive: true,
      mode: "collapsed",
    });
    expect(overlayStatusOf({ value: { callActive: false, mode: "expanded" } })).toEqual({
      callActive: false,
      mode: "expanded",
    });
  });

  it("drops anything that is not exactly a status", () => {
    const malformed = [
      null,
      undefined,
      "live",
      [true, "collapsed"],
      { callActive: "true", mode: "collapsed" },
      { callActive: true, mode: "stage" },
      { callActive: true, extra: 1, mode: "collapsed" },
    ];
    expect(malformed.map((value) => overlayStatusOf({ value }))).toEqual(malformed.map(() => undefined));
  });
});

describe("overlayReportOf", () => {
  it("applies a status as it came", () => {
    expect(overlayReportOf({ value: { callActive: true, mode: "expanded" } })).toEqual({
      status: { callActive: true, mode: "expanded" },
    });
  });

  it("reads the shell's null as a report that clears the status", () => {
    expect(overlayReportOf({ value: null })).toEqual({ status: undefined });
  });

  it("drops a malformed message, so it can never clear a live call's status", () => {
    expect([undefined, "off", { callActive: false }].map((value) => overlayReportOf({ value }))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("overlayModeOf", () => {
  it("expands for the stage and collapses for the corner", () => {
    expect((["stage", "corner"] as const).map((view) => overlayModeOf({ view }))).toEqual(["expanded", "collapsed"]);
  });

  it("sizes each window state: the orb and the messenger to the corner, full screen to the whole work area", () => {
    const states = ["minimised", "middle", "fullscreen"] as const;
    expect(
      states.map((shown) => ({
        mode: overlayModeOf({ view: voiceViewOf({ shown }) }),
        whole: overlayWantsWhole({
          edgeInOverlay: false,
          focusShown: false,
          landing: false,
          staged: shown === "fullscreen",
        }),
      })),
    ).toEqual([
      { mode: "collapsed", whole: false },
      { mode: "collapsed", whole: false },
      { mode: "expanded", whole: true },
    ]);
  });
});

describe("overlayCommandOf", () => {
  it("accepts the three commands and the shell's fold, and drops anything else", () => {
    expect(["activate", "collapse", "expand", "fold", "stop", 1].map((value) => overlayCommandOf({ value }))).toEqual([
      "activate",
      "collapse",
      "expand",
      "fold",
      undefined,
      undefined,
    ]);
  });
});

describe("pageIdentityOf", () => {
  it("accepts a console path and its title", () => {
    expect(pageIdentityOf({ value: { path: "/queue", title: "Queue" } })).toEqual({ path: "/queue", title: "Queue" });
  });

  it("drops a path off the console and a missing title", () => {
    expect(pageIdentityOf({ value: { path: "https://example.com/", title: "x" } })).toBe(undefined);
    expect(pageIdentityOf({ value: { path: "/queue" } })).toBe(undefined);
  });

  it("carries the open card's key", () => {
    expect(pageIdentityOf({ value: { open: "pr:acme.admin.18326", path: "/queue", title: "Queue" } })).toEqual({
      open: "pr:acme.admin.18326",
      path: "/queue",
      title: "Queue",
    });
  });

  it("keeps the page and drops an open card that is no card key", () => {
    expect(
      [7, "", "not a key", `pr:${"1".repeat(200)}`, "pr:18326"].map((open) =>
        pageIdentityOf({ value: { open, path: "/queue", title: "Queue" } }),
      ),
    ).toEqual([
      { path: "/queue", title: "Queue" },
      { path: "/queue", title: "Queue" },
      { path: "/queue", title: "Queue" },
      { path: "/queue", title: "Queue" },
      { path: "/queue", title: "Queue" },
    ]);
  });
});
