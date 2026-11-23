import { describe, expect, it } from "vitest";

import {
  e2eRunId,
  e2eSteps,
  landmarkOf,
  NEXT_ERROR_OVERLAY,
  pickSteps,
  QUEUE_EMPTY,
  queueCardState,
  sidebarLink,
  speaksE2e,
  speaksE2eMenuBar,
} from "../../../desktop/e2ePlan.js";

describe("queueCardState", () => {
  it("reads the Queue's measured-zero line by its marker inside the page body", () => {
    expect(QUEUE_EMPTY).toBe('main [data-page-empty="queue"]');
  });

  it("opens a row, calls a proven-empty Queue empty, and calls neither unproven", () => {
    const table = [
      { emptyShown: false, rowShown: true },
      { emptyShown: true, rowShown: false },
      { emptyShown: false, rowShown: false },
      { emptyShown: true, rowShown: true },
    ].map((shown) => queueCardState(shown));
    expect(table).toEqual(["row", "empty", "unproven", "row"]);
  });
});

describe("NEXT_ERROR_OVERLAY", () => {
  it("names Next's error dialog inside the portal, never the portal a healthy dev page always mounts", () => {
    expect(NEXT_ERROR_OVERLAY).toBe("nextjs-portal [data-nextjs-dialog]");
  });
});

describe("e2eSteps", () => {
  it("walks the Queue, its card, its pinned tab, the voice's reading of it and the + first, then the rest", () => {
    expect(e2eSteps().map((step) => step.id)).toEqual([
      "queue",
      "queue-card",
      "queue-pinned",
      "queue-screen-reading",
      "new-tab",
      "alignment",
      "pull-requests",
      "workstreams",
      "automations",
      "fleet",
      "settings",
      "settings-presence",
      "voice",
      "orb-drag",
      "docs",
      "pages",
    ]);
  });

  it("takes a published page as its own step, after the docs", () => {
    expect(e2eSteps().at(-1)).toEqual({ id: "pages", kind: "published-page" });
  });

  it("reaches every console page by its sidebar link, since none is reached only by address", () => {
    const reach = e2eSteps().flatMap((step) => (step.kind === "page" ? [`${step.id}:${step.reach}`] : []));
    expect(reach).toEqual([
      "queue:sidebar",
      "alignment:sidebar",
      "pull-requests:sidebar",
      "workstreams:sidebar",
      "automations:sidebar",
      "fleet:sidebar",
    ]);
  });

  it("takes the docs as their own step, since the shell opens them in its viewer rather than as a page", () => {
    expect(e2eSteps().filter((step) => step.id === "docs")).toEqual([{ id: "docs", kind: "docs" }]);
  });
});

describe("landmarkOf", () => {
  it("waits on a page's heading with its skeleton gone", () => {
    expect(landmarkOf({ step: { id: "fleet", kind: "page", path: "/fleet", reach: "sidebar" } })).toEqual({
      absent: "[data-console-loading]",
      present: "h1",
      viewerControls: [],
      words: "/fleet's heading, its skeleton gone",
    });
  });

  it("waits on the same heading for a page reached by address as for one reached by its link", () => {
    const byAddress = landmarkOf({ step: { id: "unlinked", kind: "page", path: "/unlinked", reach: "address" } });
    const byLink = landmarkOf({ step: { id: "unlinked", kind: "page", path: "/unlinked", reach: "sidebar" } });
    expect(byAddress).toEqual({
      absent: "[data-console-loading]",
      present: "h1",
      viewerControls: [],
      words: "/unlinked's heading, its skeleton gone",
    });
    expect(byAddress).toEqual(byLink);
  });

  it("waits on the fixture's own marked heading in the frame, and the viewer's Back and Reveal in Finder", () => {
    expect(landmarkOf({ step: { id: "pages", kind: "published-page" } })).toEqual({
      absent: undefined,
      present: "main[data-desktop-e2e-published-page] h1",
      viewerControls: [
        { name: "Back to the Queue", role: "link" },
        { name: "Reveal in Finder", role: "button" },
      ],
      words: "the published page's heading inside the viewer's frame, with its Back to the Queue and Reveal in Finder",
    });
  });

  it("waits on the pinned Queue tab's heading, the card the step opened since replaced by the Queue link", () => {
    expect(landmarkOf({ step: { id: "queue-pinned", kind: "queue-pinned" } })).toEqual({
      absent: "[data-console-loading]",
      present: "h1",
      viewerControls: [],
      words: "the pinned Queue tab's heading, its skeleton gone",
    });
  });

  it("waits on the pinned Queue tab's heading after the voice's window asked for the Queue", () => {
    expect(landmarkOf({ step: { id: "queue-screen-reading", kind: "queue-screen" } })).toEqual({
      absent: "[data-console-loading]",
      present: "h1",
      viewerControls: [],
      words: "the pinned Queue tab's heading, the Queue the voice was handed",
    });
  });

  it("waits on the pinned Queue tab's heading after the + step, its chosen page's tab closed again", () => {
    expect(landmarkOf({ step: { id: "new-tab", kind: "new-tab" } })).toEqual({
      absent: "[data-console-loading]",
      present: "h1",
      viewerControls: [],
      words: "the pinned Queue tab's heading once the chosen page's tab closed",
    });
  });

  it("waits on the voice window's message box inside its card", () => {
    expect(landmarkOf({ step: { id: "voice", kind: "voice" } }).present).toBe(
      'section[aria-label="the voice"] textarea[aria-label="message"]',
    );
  });

  it("waits on the settings dialog's own nav, not any dialog", () => {
    expect(landmarkOf({ step: { id: "settings", kind: "settings", tab: "opening" } }).present).toBe(
      '[role="dialog"] nav[aria-label="settings"]',
    );
  });

  it("waits on the Presence tab's own button marked current, which only pressing it makes true", () => {
    expect(landmarkOf({ step: { id: "settings-presence", kind: "settings", tab: "presence" } })).toEqual({
      absent: undefined,
      present: '[role="dialog"] nav[aria-label="settings"] button[data-section="presence"][aria-current="true"]',
      viewerControls: [],
      words: "the settings dialog on its presence tab",
    });
  });
});

describe("sidebarLink", () => {
  it("matches the link by where it goes, bare or carrying the console's query", () => {
    expect(sidebarLink({ path: "/fleet" })).toBe(
      'aside.sw-glass-sidebar a[href="/fleet"], aside.sw-glass-sidebar a[href^="/fleet?"]',
    );
  });
});

describe("pickSteps", () => {
  it("takes every step when none is named", () => {
    expect(pickSteps({ only: [] }).steps.length).toBe(16);
  });

  it("keeps walk order whatever order the ids were named in", () => {
    expect(pickSteps({ only: ["voice", "queue"] }).steps.map((step) => step.id)).toEqual(["queue", "voice"]);
  });

  it("names an id that is no step", () => {
    expect(pickSteps({ only: ["queue", "now"] }).unknown).toEqual(["now"]);
  });
});

describe("speaksE2e", () => {
  it("accepts a bundle carrying protocol 2", () => {
    const plist = "<dict>\n\t<key>SlopweaverDesktopE2EProtocol</key>\n\t<string>2</string>\n</dict>";
    expect(speaksE2e({ plist })).toBe(true);
  });

  it("refuses a bundle from before the switch", () => {
    expect(speaksE2e({ plist: "<dict><key>CFBundleName</key><string>Slopweaver</string></dict>" })).toBe(false);
  });

  it("refuses a marker that is only inside a comment", () => {
    const plist = "<dict><!-- <key>SlopweaverDesktopE2EProtocol</key><string>2</string> --></dict>";
    expect(speaksE2e({ plist })).toBe(false);
  });

  it("refuses a marker after an unclosed comment", () => {
    const plist = "<dict><!-- <key>SlopweaverDesktopE2EProtocol</key><string>2</string></dict>";
    expect(speaksE2e({ plist })).toBe(false);
  });

  it("accepts a real marker after a closed comment", () => {
    const plist = "<dict><!-- note --><key>SlopweaverDesktopE2EProtocol</key><string>2</string></dict>";
    expect(speaksE2e({ plist })).toBe(true);
  });

  it("accepts protocol 2 when an earlier entry names another", () => {
    const plist =
      "<dict><key>SlopweaverDesktopE2EProtocol</key><string>1</string><key>SlopweaverDesktopE2EProtocol</key><string>2</string></dict>";
    expect(speaksE2e({ plist })).toBe(true);
  });

  it("refuses a marker outside any dictionary", () => {
    expect(speaksE2e({ plist: "<key>SlopweaverDesktopE2EProtocol</key><string>2</string>" })).toBe(false);
  });

  it("refuses a marker nested in an inner dictionary or array, and reads a root one after it", () => {
    const nested =
      "<key>Metadata</key><dict><key>SlopweaverDesktopE2EProtocol</key><string>2</string></dict>" +
      "<key>List</key><array><dict><key>SlopweaverDesktopE2EProtocol</key><string>2</string></dict></array>";
    expect(speaksE2e({ plist: `<plist><dict>${nested}</dict></plist>` })).toBe(false);
    const root = "<key>SlopweaverDesktopE2EProtocol</key><string>2</string>";
    expect(speaksE2e({ plist: `<plist><dict>${nested}<key>Empty</key><dict/>${root}</dict></plist>` })).toBe(true);
  });

  it("refuses a key standing in another key's value slot, which is no entry of the dictionary", () => {
    const misaligned = "<key>Notes</key><key>SlopweaverDesktopE2EProtocol</key><string>2</string>";
    expect(speaksE2e({ plist: `<dict>${misaligned}</dict>` })).toBe(false);
    expect(speaksE2e({ plist: `<dict><key>Notes</key><string>x</string>${misaligned.slice(16)}</dict>` })).toBe(true);
  });

  it("refuses a root dictionary that is not a plist dictionary's shape, whatever the parser made of it", () => {
    const entry = "<key>SlopweaverDesktopE2EMenuBarProtocol</key><string>1</string>";
    expect(speaksE2eMenuBar({ plist: `<dict><array/><!ELEMENT x (<foo/>${entry}</dict>` })).toBe(false);
    expect(speaksE2eMenuBar({ plist: `<dict><key>Lone</key>${entry}</dict>` })).toBe(false);
    expect(speaksE2eMenuBar({ plist: `<dict><key>Odd</key><foo/>${entry}</dict>` })).toBe(false);
    expect(speaksE2eMenuBar({ plist: `<dict><key>List</key><array/>${entry}</dict>` })).toBe(true);
  });

  it("refuses protocol 1, whose windows do not mark the calls they place", () => {
    expect(speaksE2e({ plist: "<dict><key>SlopweaverDesktopE2EProtocol</key><string>1</string></dict>" })).toBe(false);
  });
});

describe("speaksE2eMenuBar", () => {
  const BOTH =
    "<dict><key>SlopweaverDesktopE2EMenuBarProtocol</key><string>1</string>" +
    "<key>SlopweaverDesktopE2EProtocol</key><string>2</string></dict>";

  it("accepts a bundle carrying menu bar protocol 1", () => {
    expect(speaksE2eMenuBar({ plist: BOTH })).toBe(true);
  });

  it("refuses a bundle that speaks only the base protocol, one commented out, and another version", () => {
    const dict = ({ entries }: { entries: string }): string => `<dict>${entries}</dict>`;
    const baseOnly = dict({ entries: "<key>SlopweaverDesktopE2EProtocol</key><string>2</string>" });
    expect(speaksE2eMenuBar({ plist: baseOnly })).toBe(false);
    const commented = dict({ entries: "<!-- <key>SlopweaverDesktopE2EMenuBarProtocol</key><string>1</string> -->" });
    expect(speaksE2eMenuBar({ plist: commented })).toBe(false);
    const otherVersion = dict({ entries: "<key>SlopweaverDesktopE2EMenuBarProtocol</key><string>2</string>" });
    expect(speaksE2eMenuBar({ plist: otherVersion })).toBe(false);
  });

  it("refuses the key written inside another value's CDATA, and still reads a real one after it", () => {
    const hidden =
      "<key>Notes</key><string><![CDATA[<key>SlopweaverDesktopE2EMenuBarProtocol</key><string>1</string>]]></string>";
    expect(speaksE2eMenuBar({ plist: `<dict>${hidden}</dict>` })).toBe(false);
    const real = "<key>SlopweaverDesktopE2EMenuBarProtocol</key><string>1</string>";
    expect(speaksE2eMenuBar({ plist: `<dict>${hidden}${real}</dict>` })).toBe(true);
  });

  it("refuses the menu bar key nested in an inner dictionary beside a top-level base key", () => {
    const plist =
      "<plist><dict><key>SlopweaverDesktopE2EProtocol</key><string>2</string><key>Metadata</key>" +
      "<dict><key>SlopweaverDesktopE2EMenuBarProtocol</key><string>1</string></dict></dict></plist>";
    expect(speaksE2eMenuBar({ plist })).toBe(false);
    expect(speaksE2e({ plist })).toBe(true);
  });

  it("is not moved off the root by markup inside a processing instruction or a doctype", () => {
    const plist =
      '<?xml version="1.0"?><!DOCTYPE plist [<!ENTITY e "</dict>">]><plist version="1.0"><dict>' +
      "<key>SlopweaverDesktopE2EProtocol</key><string>2</string><?depth-confuser </dict>?><key>Metadata</key>" +
      "<dict><key>SlopweaverDesktopE2EMenuBarProtocol</key><string>1</string></dict></dict></plist>";
    expect(speaksE2eMenuBar({ plist })).toBe(false);
    expect(speaksE2e({ plist })).toBe(true);
  });

  it("reads a root string written as CDATA as the string it is, the way XML defines it", () => {
    const plist =
      "<plist><dict><key>SlopweaverDesktopE2EMenuBarProtocol</key><string><![CDATA[1]]></string></dict></plist>";
    expect(speaksE2eMenuBar({ plist })).toBe(true);
  });

  it("refuses a protocol spelled as a numeric reference (closed, the stated residue), and reads an entity as text", () => {
    const referenced =
      "<plist><dict><key>SlopweaverDesktopE2EMenuBarProtocol</key><string>&#49;</string></dict></plist>";
    expect(speaksE2eMenuBar({ plist: referenced })).toBe(false);
    const marked =
      '<!DOCTYPE plist [<!ENTITY nested "<key>SlopweaverDesktopE2EMenuBarProtocol</key><string>1</string>">]>' +
      "<plist><dict><key>Notes</key><string>&nested;</string></dict></plist>";
    expect(speaksE2eMenuBar({ plist: marked })).toBe(false);
  });

  it("reads a real Info.plist's shape, declaration, doctype and whitespace included", () => {
    const plist = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      "<dict>",
      "\t<key>CFBundleName</key>",
      "\t<string>Slopweaver</string>",
      "\t<key>SlopweaverDesktopE2EMenuBarProtocol</key>",
      "\t<string>1</string>",
      "</dict>",
      "</plist>",
    ].join("\n");
    expect(speaksE2eMenuBar({ plist })).toBe(true);
  });

  it("refuses a document that is not well-formed XML, which the parser would otherwise repair", () => {
    const unclosed =
      "<plist><dict><key>SlopweaverDesktopE2EProtocol</key><string>2</string>" +
      "<key>SlopweaverDesktopE2EMenuBarProtocol</key><string>1</string></plist>";
    expect(speaksE2e({ plist: unclosed })).toBe(false);
    expect(speaksE2eMenuBar({ plist: unclosed })).toBe(false);
    expect(speaksE2eMenuBar({ plist: unclosed.replace("</plist>", "</dict></plist>") })).toBe(true);
  });

  it("refuses a dictionary that is not the one root element, a sibling or stray text beside it", () => {
    const entry = "<dict><key>SlopweaverDesktopE2EMenuBarProtocol</key><string>1</string></dict>";
    expect(speaksE2eMenuBar({ plist: `<junk/>${entry}` })).toBe(false);
    expect(speaksE2eMenuBar({ plist: `junk${entry}` })).toBe(false);
    expect(speaksE2eMenuBar({ plist: `<plist><junk/>${entry}</plist>` })).toBe(false);
    expect(speaksE2eMenuBar({ plist: `<plist>junk${entry}</plist>` })).toBe(false);
    expect(speaksE2eMenuBar({ plist: entry.replace("<dict>", "<dict>junk") })).toBe(false);
    expect(speaksE2eMenuBar({ plist: `<plist>${entry}</plist>` })).toBe(true);
  });

  it("leaves the base protocol's own check to the base key alone", () => {
    expect(speaksE2e({ plist: "<dict><key>SlopweaverDesktopE2EMenuBarProtocol</key><string>2</string></dict>" })).toBe(
      false,
    );
    expect(speaksE2e({ plist: BOTH })).toBe(true);
  });
});

describe("e2eRunId", () => {
  it("drops the fraction and the colons", () => {
    expect(e2eRunId({ startedIso: "2026-10-25T14:21:07.512Z" })).toBe("2026-10-25T142107Z");
  });
});
