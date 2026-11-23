import { describe, expect, it } from "vitest";

import { detailActMarker, NEEDS_YOU } from "../../../hand/details.js";
import { NO_KIND_ANSWERS } from "../../../hand/kindAnswers.js";
import { BAND_JS, SNOOZE_JS } from "../../../hand/note/band.js";
import { handNoteBundleFiles, NOTE_EXECUTABLE } from "../../../hand/note/bundle.js";
import { CHECKLIST_JS } from "../../../hand/note/checklist.js";
import { CLIPBOARD_JS } from "../../../hand/note/clipboard.js";
import { OPEN_LINK_JS } from "../../../hand/note/desktopLink.js";
import { DETAILS_FIT_JS, DETAILS_JS, needYouSuffix, panelDetailEntry } from "../../../hand/note/details.js";
import { FIELDS_JS } from "../../../hand/note/fields.js";
import { FIT_ROWS_JS } from "../../../hand/note/fitRows.js";
import {
  handNotePanelBuild,
  handNotePanelSource,
  PANEL_BUTTON_GAP,
  PANEL_BUTTON_WIDTH,
  PANEL_PAD,
  PANEL_WIDTH,
  POLL_SECONDS,
} from "../../../hand/note/panel.js";
import { LEVEL_OFFSET, type NoteLevel } from "../../../hand/note/panelWire.js";
import { buildHandStep, type HandStep } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

/** A step whose literal carries every character that would break a program built by concatenation. */
const HOSTILE_LITERAL = ['echo "});" && \\', "$(whoami) · 'quote'"].join("\n");

/** A checklist step's draft fields: a page to open, then a secret stored with where its value sits. */
const SECOPS = {
  checklist: [
    { action: "Open the Credentials page", url: "https://console.cloud.google.com/apis/credentials" },
    {
      action: "Paste the Client ID when the terminal asks for it",
      command: "slopweaver secrets set google-secops-client-id",
      find: ["Additional information", "Client ID"],
    },
  ],
};

/** The liveness wiring a raise hands the panel, plus the slot and level it reserved for this one note. */
const LIVE = {
  beatPath: "/tmp/live/gcloud-signin.token-1.beat",
  consoleBase: "http://localhost:3000",
  kindAnswers: NO_KIND_ANSWERS,
  level: "ordinary",
  liveDir: "/tmp/live",
  slot: 0,
  token: "token-1",
  triage: { commandsDir: "/tmp/triage/commands", statePath: "/tmp/triage/state.json" },
  wantPath: "/tmp/live/gcloud-signin.want",
} as const;

function step(over: Partial<Parameters<typeof buildHandStep>[0]["draft"]> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "gcloud-signin",
        postedBy: "workspace:129",
        postedIso: "2026-09-19T04:35:44.113Z",
        unblocks: "handover run datadog-monitor-deploy",
        what: "Sign in to Google Cloud so the monitor deploy can finish",
        witness: "slopweaver hand done gcloud-signin",
        ...over,
      },
    }),
  );
}

/**
 * Make the shipped `fitRows` SOURCE callable, so a geometry assertion runs the arithmetic the note really
 * draws with instead of a restatement of it. The program runs in its own process and can import nothing,
 * so its algorithm exists only as text — evaluating that text here is what keeps one copy of it. It
 * touches nothing outside its arguments, which is what makes this a read rather than a re-implementation.
 */
function fitRowsOf({
  source,
}: {
  source: string;
}): (call: {
  rows: readonly { readonly height: number; readonly gap: number; readonly floor: number }[];
  fixed: number;
  budget: number;
}) => readonly number[] {
  // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text; see above
  const lifted = new Function(`${source}\nreturn fitRows;`)() as (...args: readonly unknown[]) => readonly number[];
  return ({ rows, fixed, budget }) => lifted(rows, fixed, budget);
}

/** `DETAILS_FIT_JS`'s three functions, lifted from the shipped source and called here by name. */
function detailsFitOf(): {
  grow: (call: { region: number }) => number;
  region: (call: { text: number; room: number }) => number;
  originY: (call: { originY: number; grow: number; floorY: number }) => number;
} {
  // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text; see above
  const lifted = new Function(
    `${DETAILS_FIT_JS}\nreturn [detailsGrow, detailsRegionHeight, openedOriginY];`,
  )() as readonly ((...args: readonly number[]) => number)[];
  const [detailsGrow, detailsRegionHeight, openedOriginY] = lifted;
  return {
    grow: ({ region }) => detailsGrow!(region),
    originY: ({ originY, grow, floorY }) => openedOriginY!(originY, grow, floorY),
    region: ({ text, room }) => detailsRegionHeight!(text, room),
  };
}

describe("handNotePanelSource", () => {
  it("puts the whole step on ONE declared line, as JSON, and nowhere else", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/markers", step: step() });
    const first = source.split("\n")[0]!;
    expect(first).toBe(
      `const STEP = {"beatPath":"${LIVE.beatPath}","build":"${handNotePanelBuild()}",` +
        '"buttonGap":8,"buttonWidth":84,"cascadeFromLeft":false,"checklist":[],"desktopLinks":{},"detailCount":0,"detailEntries":[],"detailsNeedYou":"","eyebrow":"SLOPWEAVER \u00b7 ONE STEP","id":"gcloud-signin","kindAnswers":{"muteKind":false,"whenWorse":false},"levelOffset":0,"literal":"",' +
        '"liveDir":"/tmp/live","markerDir":"/tmp/markers","pad":20,"pollSeconds":0.25,"quotes":[],' +
        '"slot":0,"token":"token-1",' +
        '"triage":{"commandsDir":"/tmp/triage/commands","statePath":"/tmp/triage/state.json","freshMs":3000},' +
        '"unaddressed":"","unblocks":"handover run datadog-monitor-deploy","url":"","wantPath":"/tmp/live/gcloud-signin.want",' +
        '"what":"Sign in to Google Cloud so the monitor deploy can finish","where":"","width":420,' +
        '"witness":"slopweaver hand done gcloud-signin"};',
    );
  });

  it("draws each quote as a row directly under the sentence, a click on it opening its permalink", () => {
    const permalink = "https://acme.slack.com/archives/C0SYN000004/p1790126312750189";
    const source = handNotePanelSource({
      ...LIVE,
      markerDir: "/tmp/markers",
      step: step({ quotes: [{ permalink, text: "our sdk is old af", who: "Jonah Yates" }] }),
    });
    expect(source.split("\n")[0]).toContain(
      `"quotes":[{"line":"“our sdk is old af” — Jonah Yates","url":"${permalink}"}]`,
    );
    const what = source.indexOf("rows.push({ view: label(STEP.what,");
    const quotes = source.indexOf("for (var qi = 0; qi < STEP.quotes.length; qi += 1) {");
    const literal = source.indexOf("var literalField = null;");
    expect(what).toBeGreaterThan(0);
    expect(quotes).toBeGreaterThan(what);
    expect(literal).toBeGreaterThan(quotes);
    // The overlays are built AFTER the rows are fitted and laid out, so each one sits on its quote's final frame.
    expect(
      source.indexOf("var quoteOverlay = $.NSButton.alloc.initWithFrame(quoteViews[qo].view.frame);"),
    ).toBeGreaterThan(source.indexOf("var fitted = fitRows(plan, FIXED_HEIGHT, MAX_CONTENT_HEIGHT);"));
    expect(source).toContain("openLink(quoteViews[qp].url);");
  });

  it("maps every console link it can open to the desktop app's address, and no link elsewhere", () => {
    const briefing = "http://localhost:3000/api/page/dead-code-audit/index.html";
    const card = "http://localhost:3000/queue?open=ask%3Aa-row";
    const permalink = "https://acme.slack.com/archives/C0SYN000004/p1790126312750189";
    const source = handNotePanelSource({
      ...LIVE,
      markerDir: "/tmp/m",
      step: step({
        checklist: [
          { action: "Read the briefing", url: briefing },
          { action: "Open the provider", url: "https://console.cloud.google.com/apis/credentials" },
        ],
        quotes: [{ permalink, text: "our sdk is old af", who: "Jonah Yates" }],
        url: card,
      }),
    });
    const wire = JSON.parse(source.split("\n")[0]!.slice("const STEP = ".length, -1)) as Record<string, unknown>;
    expect(wire["desktopLinks"]).toEqual({
      [briefing]: "slopweaver://open?path=%2Fapi%2Fpage%2Fdead-code-audit%2Findex.html",
      [card]: "slopweaver://open?path=%2Fqueue%3Fopen%3Dask%253Aa-row",
    });
  });

  it("opens every link through openLink, which prefers a registered app and falls back to the link", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    expect(source.split("openURL(").length - 1).toBe(1);
    expect(source.split("function openLink(").length - 1).toBe(1);
    expect([
      source.includes("openLink(STEP.url);"),
      source.includes("openLink(drawn.line.url);"),
      source.includes("openLink(detailsActButtons[d].url);"),
      source.includes("openLink(quoteViews[qp].url);"),
      source.includes("workspace.URLForApplicationToOpenURL(deepUrl)"),
    ]).toEqual([true, true, true, true, true]);
  });

  it("runs openLink as emitted: the app's address whenever the desktop app can take it, the link otherwise", () => {
    const opened: string[] = [];
    const refused = "http://localhost:3000/voice";
    const runOpenLink = ({
      handler,
      installed,
      launches = true,
      url,
    }: {
      handler: string | undefined;
      installed: string | undefined;
      launches?: boolean;
      url: string;
    }): void => {
      // `handler` is the bundle identifier LaunchServices resolves the deep address to, `installed` the one at
      // /Applications/Slopweaver.app; `undefined` is no handler, or nothing installed there.
      type Bundled = { bundleId: string | undefined; isNil: () => boolean; text: string };
      const foundation = {
        NSArray: { arrayWithObject: (one: Bundled) => [one] },
        NSBundle: {
          bundleWithURL: (at: Bundled) => ({
            bundleIdentifier: { js: at.bundleId },
            isNil: () => at.bundleId === undefined,
          }),
        },
        NSDictionary: { dictionary: {} },
        NSURL: {
          // named-object-params-exempt: a fake of Foundation's NSURL, which the emitted JXA calls positionally
          fileURLWithPath: (path: string): Bundled => ({ bundleId: installed, isNil: () => false, text: path }),
          // named-object-params-exempt: a fake of Foundation's NSURL, which the emitted JXA calls positionally
          URLWithString: (text: string): Bundled => ({ bundleId: undefined, isNil: () => false, text }),
        },
        NSWorkspace: {
          sharedWorkspace: {
            openURL: (target: Bundled) => {
              opened.push(target.text);
            },
            // named-object-params-exempt: a fake of NSWorkspace's selector, which the emitted JXA calls positionally
            openURLsWithApplicationAtURLOptionsConfigurationError: (targets: readonly Bundled[], app: Bundled) => {
              opened.push(`${targets.map((target) => target.text).join(",")} with ${app.text}`);
              return { isNil: () => launches === false };
            },
            URLForApplicationToOpenURL: () => ({
              bundleId: handler,
              isNil: () => handler === undefined,
              text: "the-handler",
            }),
          },
        },
      };
      const wire = {
        desktopLinks: { "http://localhost:3000/queue": "slopweaver://open?path=%2Fqueue", [refused]: null },
      };
      // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text, as above
      const lifted = new Function("$", "nsstr", "STEP", `${OPEN_LINK_JS}\nreturn openLink;`)(
        foundation,
        (value: string) => value,
        wire,
      ) as (target: string) => void;
      lifted(url);
    };
    const queue = "http://localhost:3000/queue";
    const direct = "slopweaver://open?path=%2Fqueue with /Applications/Slopweaver.app";
    runOpenLink({ handler: "ai.slopweaver.desktop", installed: "ai.slopweaver.desktop", url: queue });
    runOpenLink({ handler: undefined, installed: "ai.slopweaver.desktop", url: queue });
    runOpenLink({ handler: "com.acme.squatter", installed: "ai.slopweaver.desktop", url: queue });
    runOpenLink({ handler: "com.acme.squatter", installed: "ai.slopweaver.desktop", launches: false, url: queue });
    runOpenLink({ handler: "ai.slopweaver.desktop", installed: undefined, url: queue });
    runOpenLink({ handler: "com.acme.squatter", installed: "com.acme.squatter", url: queue });
    runOpenLink({ handler: undefined, installed: undefined, url: queue });
    runOpenLink({
      handler: "ai.slopweaver.desktop",
      installed: undefined,
      url: "https://acme.slack.com/archives/C1/p1",
    });
    // A console link the app refuses opens nothing while any desktop app is there, the link only with none.
    runOpenLink({ handler: undefined, installed: "ai.slopweaver.desktop", url: refused });
    runOpenLink({ handler: "ai.slopweaver.desktop", installed: undefined, url: refused });
    runOpenLink({ handler: undefined, installed: undefined, url: refused });
    expect(opened).toEqual([
      direct,
      direct,
      direct,
      direct,
      "slopweaver://open?path=%2Fqueue with the-handler",
      queue,
      queue,
      "https://acme.slack.com/archives/C1/p1",
      refused,
    ]);
  });

  it("carries the poster's reason for no link, which the note draws where the Open button would be", () => {
    const source = handNotePanelSource({
      ...LIVE,
      markerDir: "/tmp/markers",
      step: step({ unaddressed: "it happens on your phone" }),
    });
    expect(source.split("\n")[0]).toContain('"unaddressed":"it happens on your phone"');
    expect(source).toContain(
      "if (STEP.unaddressed.length > 0) { rows.push({ view: label('No link: ' + STEP.unaddressed",
    );
  });

  it("stamps a build id that is a digest of the PROGRAM and of nothing else", () => {
    // A raise keeps a note beating on this build and replaces one on an older build, so two raises of DIFFERENT
    // steps, slots and levels must agree on the build, or every keep would redraw a note already up.
    const one = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() }).split("\n")[0]!;
    const two = handNotePanelSource({
      beatPath: "/tmp/live/other-step.token-2.beat",
      consoleBase: "http://localhost:4000",
      kindAnswers: { muteKind: true, whenWorse: true },
      level: "meeting-prep",
      liveDir: "/tmp/live",
      markerDir: "/tmp/other",
      slot: 3,
      step: step({ id: "other-step", literal: HOSTILE_LITERAL, url: "http://localhost:4000/queue?open=hand%3Ax" }),
      token: "token-2",
      triage: { commandsDir: "/tmp/other/triage/commands", statePath: "/tmp/other/triage/state.json" },
      wantPath: "/tmp/live/other-step.want",
    }).split("\n")[0]!;
    expect(JSON.parse(one.slice("const STEP = ".length, -1))["build"]).toBe(handNotePanelBuild());
    expect(JSON.parse(two.slice("const STEP = ".length, -1))["build"]).toBe(handNotePanelBuild());
    expect(handNotePanelBuild().length).toBe(16);
  });

  it("closes a note once a newer raise of its own step has drawn, leaving NO marker", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    // No marker is written, so the step stays OPEN and the fresh note carries it. A `later` here would
    // silently defer a step nobody dismissed (lifecycle.test.ts runs the protocol).
    expect(source).toContain("  if (replacementDrawn()) { break; }");
    expect(source.includes("if (replacementDrawn()) { writeMarker(")).toBe(false);
  });

  it("writes its first beat only after its window is up, since an older note of its step closes on that beat", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    const shown = source.indexOf("panel.orderFrontRegardless;\n");
    expect(shown).toBeGreaterThan(0);
    expect(source.indexOf("\nbeat();\n")).toBeGreaterThan(shown);
    expect(source.split("\nbeat();\n").length).toBe(2);
    const pid = source.indexOf("nsstr(STEP.beatPath + '.pid')");
    expect([pid > 0, pid < source.indexOf("if (!mayDraw()) { $.exit(0); }")]).toEqual([true, true]);
  });

  it("draws at its reserved cascade slot and its level, one window per note", () => {
    const source = handNotePanelSource({ ...LIVE, level: "meeting-prep", markerDir: "/tmp/m", slot: 2, step: step() });
    const wire = JSON.parse(source.split("\n")[0]!.slice("const STEP = ".length, -1)) as Record<string, unknown>;
    expect([wire["slot"], wire["levelOffset"]]).toEqual([2, 1]);
    expect(source).toContain("var origin = cascadeOrigin(STEP.slot, {");
    expect(source).toContain("}, STEP.width, contentHeight, STEP.cascadeFromLeft);");
    expect(source).toContain("panel.setFrameTopLeftPoint($.NSMakePoint(origin.x, origin.y));");
    expect(source).toContain("panel.setLevel(Number($.NSFloatingWindowLevel) + STEP.levelOffset);");
    expect(source.indexOf("var origin = cascadeOrigin(")).toBeLessThan(source.indexOf("panel.orderFrontRegardless;"));
  });

  it("puts a meeting-prep note one level above an ordinary one, in the cascade from the other corner", () => {
    const wireOf = ({ level }: { level: "ordinary" | "meeting-prep" }): Record<string, unknown> =>
      JSON.parse(
        handNotePanelSource({ ...LIVE, level, markerDir: "/tmp/m", step: step() })
          .split("\n")[0]!
          .slice("const STEP = ".length, -1),
      ) as Record<string, unknown>;
    const [ordinary, prep] = [wireOf({ level: "ordinary" }), wireOf({ level: "meeting-prep" })];
    expect([ordinary["levelOffset"], ordinary["cascadeFromLeft"]]).toEqual([0, false]);
    expect([prep["levelOffset"], prep["cascadeFromLeft"]]).toEqual([1, true]);
  });

  it("embeds each level's offset from the wire's own table", () => {
    const offsetOf = ({ level }: { level: NoteLevel }): unknown =>
      (
        JSON.parse(
          handNotePanelSource({ ...LIVE, level, markerDir: "/tmp/m", step: step() })
            .split("\n")[0]!
            .slice("const STEP = ".length, -1),
        ) as Record<string, unknown>
      )["levelOffset"];
    expect(LEVEL_OFFSET).toEqual({ "meeting-prep": 1, ordinary: 0 });
    expect([offsetOf({ level: "ordinary" }), offsetOf({ level: "meeting-prep" })]).toEqual([
      LEVEL_OFFSET.ordinary,
      LEVEL_OFFSET["meeting-prep"],
    ]);
  });

  it("escapes a literal carrying a quote, a newline and a `});` into that one line", () => {
    const source = handNotePanelSource({
      ...LIVE,
      markerDir: "/tmp/markers",
      step: step({ literal: HOSTILE_LITERAL }),
    });
    const first = source.split("\n")[0]!;
    // The literal's own newline is ESCAPED rather than emitted, so the declaration is still one line: the
    // whole point of the boundary is that a step can never add a line to the program.
    expect(first.endsWith("};")).toBe(true);
    expect(JSON.parse(first.slice("const STEP = ".length, -1))["literal"]).toBe(HOSTILE_LITERAL);
    expect(HOSTILE_LITERAL.includes("\n")).toBe(true);
  });

  it("leaves the literal's own bytes out of every OTHER line of the program", () => {
    const source = handNotePanelSource({
      ...LIVE,
      markerDir: "/tmp/markers",
      step: step({ literal: HOSTILE_LITERAL }),
    });
    const rest = source.split("\n").slice(1).join("\n");
    expect(rest.includes("whoami")).toBe(false);
    expect(rest.includes('});" &&')).toBe(false);
  });

  it("carries the two exported constants into the program's own input", () => {
    const first = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() }).split("\n")[0]!;
    expect(first).toContain(`"pollSeconds":${String(POLL_SECONDS)}`);
    expect(first).toContain(`"width":${String(PANEL_WIDTH)}`);
  });

  it("builds NO ObjC closure — the measured reason the bundle launch hung", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    expect(source.includes("registerSubclass")).toBe(false);
    expect(source.includes("setAction")).toBe(false);
    expect(source.includes("setTarget")).toBe(false);
    expect(source).toContain("NSButtonTypePushOnPushOff");
  });

  it("pumps NSApplication's own event queue, the measured reason the owner got a wait cursor on hover", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    expect(source).toContain("app.finishLaunching");
    expect(source).toContain("app.nextEventMatchingMaskUntilDateInModeDequeue");
    expect(source).toContain("app.sendEvent(event)");
    expect(source.includes("NSRunLoop.currentRunLoop.runUntilDate")).toBe(false);
  });

  it("folds a step's details behind a disclosure row as ENTRIES, opened by a transparent overlay", () => {
    const source = handNotePanelSource({
      ...LIVE,
      markerDir: "/tmp/m",
      step: step({
        details: [
          "NEW   atlas-hex — 12m ago, once: exit 1",
          "FIXED resync — last failed 2h ago, its newest run succeeded",
        ],
      }),
    });
    const wire = JSON.parse(source.split("\n")[0]!.slice("const STEP = ".length, -1)) as Record<string, unknown>;
    expect(wire["detailEntries"]).toEqual([
      { act: "", meta: "12m ago, once", name: "atlas-hex", owner: "", reason: "exit 1", status: "NEW", url: "" },
      {
        act: "",
        meta: "",
        name: "resync",
        owner: "",
        reason: "last failed 2h ago, its newest run succeeded",
        status: "FIXED",
        url: "",
      },
    ]);
    expect(wire["detailCount"]).toBe(2);
    expect(source).toContain("if (pressed(detailsOverlay)) {");
    expect(source).toContain("detailsOverlay.setTransparent(true);");
    // Folded by default: the region joins the view only inside the toggle, never in the row layout.
    expect(source.split("effect.addSubview(detailsScroll)").length).toBe(2);
    expect(source).toContain("var detailsOpen = false;");
    // The whole emitted program still PARSES as JavaScript — compiled, never run, so nothing is drawn here.
    // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text
    expect(() => new Function(source)).not.toThrow();
  });

  it("draws the details as word-wrapped prose in a scroll view, never the char-wrapped mono run", () => {
    // The mono run below the fold must read cleanly. Char wrapping is what split
    // HOLDER_GONE across two lines; the region wraps on words and scrolls rather than growing without bound.
    expect(DETAILS_JS).toContain("style.setLineBreakMode($.NSLineBreakByWordWrapping);");
    expect(DETAILS_JS).toContain("detailsScroll.setDocumentView(detailsView);");
    expect(DETAILS_JS).toContain("detailsScroll.setHasVerticalScroller(true);");
    // Sized at OPEN against the screen the note is on then — a counterexample is a note laid out on the
    // main display and dragged to a shorter one, where a layout-time region carried its top off the screen.
    expect(DETAILS_JS).toContain(
      "    var region = detailsRegionHeight(detailsTextHeight, Number(visible.size.height) - SCREEN_MARGIN - contentHeight - DETAILS_GAP);",
    );
    expect(DETAILS_JS.indexOf("var region = detailsRegionHeight(")).toBeGreaterThan(
      DETAILS_JS.indexOf("function toggleDetails() {"),
    );
    expect(DETAILS_JS.includes("mono(")).toBe(false);
    expect(DETAILS_JS.includes("NSLineBreakByCharWrapping")).toBe(false);
    // Two measured bridge hazards: a top-level `function run` is JXA's entry handler, and the bridge has no
    // initWithString:attributes:. Either one throws before the note is drawn.
    expect(DETAILS_JS.includes("function run(")).toBe(false);
    expect(DETAILS_JS.includes(".initWithString")).toBe(false);
    // A text view draws the vibrant secondary colours unblended: dark grey on the dark HUD, measured on a raised note.
    expect(DETAILS_JS.includes("$.NSColor.secondaryLabelColor")).toBe(false);
    expect(DETAILS_JS).toContain("var prose = $.NSColor.labelColor.colorWithAlphaComponent(0.82);");
    expect(DETAILS_JS).toContain("text.setAttributesRange(attrs, $.NSMakeRange(at, Number(text.length) - at));");
  });

  it("caps the opened region's height, never below zero and with no floor to push the band off", () => {
    const fit = detailsFitOf();
    // A short list is drawn at its own height, whole, rounded to a whole point.
    expect(fit.region({ room: 700, text: 96.4 })).toBe(96);
    // A long one stops at the cap and scrolls — twelve entries of two wrapped lines is well past 240pt.
    expect(fit.region({ room: 700, text: 620 })).toBe(240);
    // The room the collapsed note leaves wins over the cap: the band stays on the display.
    expect(fit.region({ room: 130, text: 620 })).toBe(130);
    // No room at all is zero, never a negative frame and never the 60pt floor that could exceed the room.
    expect(fit.region({ room: -12, text: 620 })).toBe(0);
    // Growing down from high on the screen keeps the top edge; from low, the panel moves up to the frame's floor.
    expect(fit.originY({ floorY: 25, grow: 248, originY: 600 })).toBe(352);
    expect(fit.originY({ floorY: 25, grow: 248, originY: 100 })).toBe(25);
    // A region with a height grows the panel by it and its gap; an empty one grows nothing, gap included.
    expect([fit.grow({ region: 240 }), fit.grow({ region: 0 })]).toEqual([248, 0]);
  });

  it("never opens the note taller than its display — a shorter second screen, run through the shipped fit", () => {
    const fit = detailsFitOf();
    const margin = 48;
    const gap = 8;
    const titlebar = 28;
    // Measured on the proof note: 189pt of content drew a 217pt window, so the frame is content plus a titlebar.
    const opened = ({ content, visible, text }: { content: number; visible: number; text: number }): number =>
      content + titlebar + fit.grow({ region: fit.region({ room: visible - margin - content - gap, text }) });
    // Laid out for a 982pt main display, opened on a 600pt one: 472 + 28 + a 72pt region + 8, where the
    // layout-time region would have been 240 and the window 748pt.
    expect(opened({ content: 472, text: 302, visible: 600 })).toBe(580);
    // A folded note already filling the display opens no taller: no region, and no gap either.
    expect(opened({ content: 570, text: 302, visible: 600 })).toBe(598);
    // The bound in general: every opened window sits 20pt inside its display, the margin less the titlebar.
    const cases = [200, 350, 500, 540].map((content) => opened({ content, text: 900, visible: 600 }));
    expect(cases.filter((height) => height > 600 - (margin - titlebar))).toEqual([]);
    expect(cases.length).toBeGreaterThan(0);
  });

  it("embeds the details and field programs exactly once, each of their functions declared once", () => {
    const source = handNotePanelSource({
      ...LIVE,
      markerDir: "/tmp/m",
      step: step({ details: ["NEW   atlas-hex — 12:00Z: exit 1"] }),
    });
    const declared = ["detailsTitle", "toggleDetails", "label", "mono"].map(
      (name) => source.split(`function ${name}(`).length - 1,
    );
    expect([source.split(DETAILS_JS).length - 1, source.split(FIELDS_JS).length - 1, ...declared]).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
  });

  it("titles the disclosure row with its line count when folded, and as a hide row when open", () => {
    // Lifted with a folded step and no toggle, so the fragment's top level touches no AppKit at all.
    // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text
    const lifted = new Function("STEP", "hasDetails", "detailsToggle", `${DETAILS_JS}\nreturn detailsTitle;`) as (
      ...args: readonly unknown[]
    ) => (open: boolean) => string;
    const detailsTitle = lifted({ detailCount: 14, detailsNeedYou: "" }, false, null);
    expect([detailsTitle(false), detailsTitle(true)]).toEqual(["▸ Details (14)", "▾ Hide details"]);
    const needed = lifted({ detailCount: 14, detailsNeedYou: needYouSuffix({ count: 2 }) }, false, null);
    expect(needed(false)).toBe("▸ Details (14) · 2 need you");
  });

  it("says on the folded row how many entries need the owner, in their grammar, and nothing at zero", () => {
    expect([needYouSuffix({ count: 0 }), needYouSuffix({ count: 1 }), needYouSuffix({ count: 3 })]).toEqual([
      "",
      " · 1 needs you",
      " · 3 need you",
    ]);
  });

  it("opens the card a needs-you entry names on the console the note's own link opens, and nothing without one", () => {
    // The owner wants a button in front of them. The card is on the queue, never the sign-in page:
    // a page opened by NSWorkspace could land in the owner's personal Chrome profile.
    const line = `NEW resync-atlas-xero — 45m ago, once: ${NEEDS_YOU} — sign in to go.xero.com, in your work Chrome${detailActMarker({ id: "mon-signin-go-xero-com.2" })}`;
    const own = "http://localhost:3000/queue?open=hand%3Amon-health-syncs.4&context=slopweaver";
    expect(panelDetailEntry({ line, url: own }).url).toBe(
      "http://localhost:3000/queue?open=hand%3Amon-signin-go-xero-com.2",
    );
    expect(panelDetailEntry({ line, url: "" }).url).toBe("");
    expect(panelDetailEntry({ line: "NEW atlas-hex — 1m ago, once: exit 1", url: own }).url).toBe("");
    const source = handNotePanelSource({
      ...LIVE,
      markerDir: "/tmp/m",
      step: step({ details: [line], url: own }),
    });
    const wire = JSON.parse(source.split("\n")[0]!.slice("const STEP = ".length, -1)) as Record<string, unknown>;
    expect(wire["detailsNeedYou"]).toBe(" · 1 needs you");
    // The act line's control is a transparent button over that line, read off button state like every other.
    expect(source).toContain("detailsView.addSubview(actButton);");
    expect(source).toContain("if (pressed(detailsActButtons[d].button)) {");
    expect(source).toContain("openLink(detailsActButtons[d].url);");
    // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text
    expect(() => new Function(source)).not.toThrow();
  });

  it("reads Done and every snooze answer off button state and writes the matching marker", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    expect(source).toContain(
      "if (pressed(doneButton)) {\n    if (writeMarker('done')) { return true; }\n    unpress(doneButton);",
    );
    expect(source).toContain("if (snoozed !== null) {\n    if (writeMarker(snoozed)) { return true; }");
    // The band is its own module (./band.ts), embedded whole; the loop closes the note on the answer it reports.
    expect(source).toContain(BAND_JS);
    expect(source).toContain(SNOOZE_JS);
    expect(source).toContain("  if (serviceBand()) { break; }");
    expect(source).toContain(
      'var SNOOZE = [{"suffix":"snooze-1h","title":"1 hour"},{"suffix":"snooze-3h","title":"3 hours"},' +
        '{"suffix":"snooze-tomorrow","title":"Tomorrow"}];',
    );
  });

  it("never offers a bare dismiss: no Later button, no close button, and Not now… swaps the band in place", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    expect(source).not.toContain("button('Later'");
    expect(source).not.toContain("writeMarker('later')");
    expect(source).toContain("panel.standardWindowButton($.NSWindowCloseButton).setHidden(true);");
    expect(source).toContain("var notNowButton = button('Not now…', right - BUTTON_W - BUTTON_GAP);");
    expect(source).toContain("var backButton = button('Back', right);");
    expect(source).toContain("var mainBand = [openButton, copyButton, notNowButton, doneButton];");
    // The answers are hidden until Not now… is pressed, and Back undoes the swap rather than closing anything.
    expect(source).toContain("  choiceButton.setHidden(true);");
    expect(source).toContain("backButton.setHidden(true);");
    expect(source).toContain("    unpress(backButton);\n    showPage('main');");
    // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text
    expect(() => new Function(source)).not.toThrow();
  });

  it("declares the snooze answers BEFORE the lifecycle, whose markerPresent reads them", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    expect(source.indexOf("var SNOOZE = ")).toBeGreaterThan(0);
    expect(source.indexOf("var SNOOZE = ")).toBeLessThan(source.indexOf("function markerPresent()"));
  });

  it("counts a marker only once it reads back as a stamp, so an occupied path closes nothing", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    expect(source).toContain("if (typeof text === 'string' && text.trim().length > 0) { return true; }");
    expect(source).not.toContain("fileExistsAtPath(nsstr(STEP.markerDir");
  });

  it("fits three snooze answers and Back in one band, with Back clear of the answers", () => {
    const answersRightEdge = PANEL_PAD + 3 * PANEL_BUTTON_WIDTH + 2 * PANEL_BUTTON_GAP;
    const backLeftEdge = PANEL_WIDTH - PANEL_PAD - PANEL_BUTTON_WIDTH;
    expect(answersRightEdge).toBe(288);
    expect(backLeftEdge).toBe(316);
    expect(backLeftEdge - answersRightEdge).toBe(28);
  });

  it("never asks for NSEventMaskAny, the constant that dequeued ZERO events and killed every button", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step({ literal: "hello" }) });
    // NSUIntegerMax does not survive the JXA bridge's double, so what reaches the unsigned parameter matches
    // no event at all — measured on the owner's machine, 0 events for the panel's whole life.
    // `$.` is the whole assertion: the program NAMES the constant in its own comment, and what must never
    // come back is the bridge READ of it.
    expect(source.includes("$.NSEventMaskAny")).toBe(false);
    expect(source).toContain("var EVENT_MASK = 0x1FFFFFFFFFFFFF;");
    expect(source).toContain("app.nextEventMatchingMaskUntilDateInModeDequeue(\n    EVENT_MASK,");
  });

  it("the literal's own frame carries a transparent button, so clicking the command copies it", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step({ literal: "hello" }) });
    expect(source).toContain("literalOverlay = $.NSButton.alloc.initWithFrame(literalField.frame);");
    expect(source).toContain("literalOverlay.setTransparent(true);");
    expect(source).toContain("if (pressed(copyButton) || pressed(literalOverlay)) {");
  });

  it("checks the clipboard claim every poll instead of asserting it once", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step({ literal: "hello" }) });
    expect(source).toContain("if (String(board.changeCount) !== copiedAtChangeCount) { return false; }");
    expect(source).toContain("  refreshClipboardLabel();\n");
    expect(source).toContain("var CLIPBOARD_MOVED_ON = 'your clipboard has moved on");
  });

  it("embeds the clipboard program exactly once, each of its functions declared once", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step({ literal: "hello" }) });
    const declared = [
      "copyText",
      "copyLiteral",
      "clipboardHolds",
      "clipboardStillHoldsLiteral",
      "clipboardCaption",
      "refreshClipboardLabel",
    ].map((name) => source.split(`function ${name}(`).length - 1);
    expect([source.split(CLIPBOARD_JS).length - 1, ...declared]).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("confirms a matching count against the STRING, because an in-place write never moves the count", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step({ literal: "hello" }) });
    // Measured: setStringForType with no clearContents replaces the contents and leaves changeCount alone,
    // so a token that still matches proves nothing about what the owner would paste.
    expect(source).toContain("var current = board.stringForType($.NSPasteboardTypeString);");
    expect(source).toContain("return String(current.js) === text;");
    expect(source).toContain("function clipboardStillHoldsLiteral() { return clipboardHolds(STEP.literal); }");
    expect(source).toContain("if (current.isNil()) { return false; }");
  });

  it("takes its ownership token from clearContents, never from a changeCount read BACK", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step({ literal: "hello" }) });
    // The race this holds down: write here, another process writes, read ITS count back, and every later
    // poll matches a clipboard this note does not own while claiming the literal is on it — permanently.
    expect(source).toContain("var owned = String(board.clearContents);");
    expect(source).toContain("if (board.setStringForType(nsstr(text), $.NSPasteboardTypeString) === true) {");
    expect(source).toContain("function copyLiteral() { copyText(STEP.literal); }");
    expect(source).toContain("    copiedAtChangeCount = owned;");
    expect(source.includes("copiedAtChangeCount = String(board.changeCount)")).toBe(false);
  });

  it("sizes the clipboard caption on the LONGER of its two strings and settles it before the first pixel", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step({ literal: "hello" }) });
    // The row's height is measured once at layout, so the shorter string would clip the longer one.
    expect(source).toContain("clipboardLabel = label(CLIPBOARD_MOVED_ON, 11,");
    expect(source).toContain("refreshClipboardLabel();\npanel.orderFrontRegardless;");
  });

  it("fits EVERY row to the screen, so no field can push the button band off the display", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step({ literal: "hello" }) });
    expect(source).toContain("var SCREEN_MARGIN = 48;");
    expect(source).toContain(
      "var MAX_CONTENT_HEIGHT = $.NSScreen.mainScreen.visibleFrame.size.height - SCREEN_MARGIN;",
    );
    expect(source).toContain("var fitted = fitRows(plan, FIXED_HEIGHT, MAX_CONTENT_HEIGHT);");
    // The program embeds the SAME source the assertions below run, so one cannot drift from the other.
    expect(source).toContain(FIT_ROWS_JS);
    expect(source).toContain("    if (rows[q].view === literalField) { literalClipped = true; }");
    // Heights Codex measured through the real row code, against the 982pt usable here: a thousand
    // one-character lines of literal, and a `where` that alone drew more than the display.
    const fit = fitRowsOf({ source: FIT_ROWS_JS });
    const literal = { floor: 48, gap: 4, height: 10_210 };
    const where = { floor: 18, gap: 10, height: 1_100 };
    const unblocks = { floor: 18, gap: 0, height: 15 };
    // Levelled, not stripped: the command keeps as much as the row beside it rather than falling to 48.
    expect(fit({ budget: 982, fixed: 92, rows: [literal, where, unblocks] })).toEqual([430, 430, 15]);
    // No literal at all — the case the literal-only clamp skipped outright.
    expect(fit({ budget: 982, fixed: 92, rows: [where, unblocks] })).toEqual([865, 15]);
    // Already inside the budget: nothing is touched, so an ordinary note is drawn whole.
    expect(fit({ budget: 982, fixed: 92, rows: [{ floor: 48, gap: 4, height: 15 }, unblocks] })).toEqual([15, 15]);
    // A display smaller than the note's own furniture gives back floors, never a negative height.
    expect(fit({ budget: 40, fixed: 92, rows: [literal, unblocks] })).toEqual([48, 15]);
  });

  it("brings the whole fitted content back to the budget exactly, gaps included", () => {
    const fit = fitRowsOf({ source: FIT_ROWS_JS });
    const rows = [
      { floor: 48, gap: 4, height: 855 },
      { floor: 18, gap: 10, height: 1_585 },
      { floor: 18, gap: 10, height: 240 },
      { floor: 18, gap: 0, height: 60 },
    ];
    const fitted = fit({ budget: 982, fixed: 92, rows });
    expect(fitted).toEqual([283, 283, 240, 60]);
    expect(fitted.reduce((sum, height, i) => sum + height + rows[i]!.gap, 92)).toBe(982);
  });

  it("builds the click-to-copy overlay AFTER the rows are fitted and positioned, never before", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step({ literal: "hello" }) });
    // The overlay copies literalField.frame, so a reorder would silently leave it on the UNFITTED
    // rectangle — a transparent button hanging over the button band, swallowing clicks on Later and Done.
    // The p3 pre-mortem named this as the one thing a source-fragment test would not have caught.
    const fitted = source.indexOf("var fitted = fitRows(plan, FIXED_HEIGHT, MAX_CONTENT_HEIGHT);");
    const positioned = source.indexOf("  view.setFrameOrigin($.NSMakePoint(view.frame.origin.x, y));");
    const overlay = source.indexOf("  literalOverlay = $.NSButton.alloc.initWithFrame(literalField.frame);");
    expect(fitted).toBeGreaterThan(0);
    expect(positioned).toBeGreaterThan(fitted);
    expect(overlay).toBeGreaterThan(positioned);
  });
  it("lands on WHOLE points when the overflow divides three ways — r3's own counterexample", () => {
    const fit = fitRowsOf({ source: FIT_ROWS_JS });
    // Native AppKit heights for a step buildHandStep accepts, measured by the r3 review: a nine-line
    // `what`, a 517-line literal, a 32-line `where` and a 74-line `unblocks`. Dividing the overflow three
    // ways left the total 2.27e-13pt over 982 — true of the bound, and invisible on screen.
    const rows = [
      { floor: 18, gap: 8, height: 13 },
      { floor: 18, gap: 10, height: 171 },
      { floor: 48, gap: 4, height: 7_755 },
      { floor: 18, gap: 10, height: 14 },
      { floor: 18, gap: 10, height: 512 },
      { floor: 18, gap: 0, height: 1_036 },
    ];
    const fitted = fit({ budget: 982, fixed: 92, rows });
    expect(fitted).toEqual([13, 171, 216, 14, 216, 216]);
    expect(fitted.reduce((sum, height, i) => sum + height + rows[i]!.gap, 92)).toBe(980);
  });

  it("says the literal was clipped rather than showing half a command as if it were whole", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step({ literal: "hello" }) });
    expect(source).toContain("if (literalClipped && holds) { return CLIPPED_HOLDS; }");
    expect(source).toContain("if (literalClipped) { return CLIPPED_MOVED_ON; }");
    // Both clipped captions must be shorter than the string the row was MEASURED on, or swapping to one
    // would need a line the layout never reserved.
    // Each carries exactly one `·` escape, so source length and rendered length differ by the same
    // constant and comparing the declared literals is comparing what AppKit will measure.
    const caption = ({ name }: { name: string }): string =>
      source
        .split("\n")
        .find((l) => l.startsWith(`var ${name} =`))!
        .split("'")[1]!;
    expect(caption({ name: "CLIPBOARD_MOVED_ON" })).toBe(
      "your clipboard has moved on \\u00b7 click the command to copy it",
    );
    expect(caption({ name: "CLIPPED_HOLDS" }).length).toBeLessThan(caption({ name: "CLIPBOARD_MOVED_ON" }).length);
    expect(caption({ name: "CLIPPED_MOVED_ON" }).length).toBeLessThan(caption({ name: "CLIPBOARD_MOVED_ON" }).length);
  });

  it("draws NEITHER copy control on a step with no literal — there is nothing to put on a clipboard", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    expect(source).toContain("if (STEP.literal.length > 0) {\n  var copyX = PAD;");
    expect(source).toContain("if (literalField !== null) {");
    expect(source).toContain("var literalField = null;");
  });

  it("carries a checklist step's lines into the STEP line, each breadcrumb joined and each absent field empty", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step(SECOPS) });
    const wire = JSON.parse(source.split("\n")[0]!.slice("const STEP = ".length, -1)) as Record<string, unknown>;
    expect(wire["literal"]).toBe("");
    expect(wire["checklist"]).toEqual([
      {
        action: "Open the Credentials page",
        command: "",
        crumb: "",
        url: "https://console.cloud.google.com/apis/credentials",
      },
      {
        action: "Paste the Client ID when the terminal asks for it",
        command: "slopweaver secrets set google-secops-client-id",
        crumb: "Additional information › Client ID",
        url: "",
      },
    ]);
    // Nothing is copied at launch: the one launch copy is the literal's, and a checklist step carries none.
    expect(source).toContain("if (STEP.literal.length > 0) { copyLiteral(); }");
    // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text
    expect(() => new Function(source)).not.toThrow();
  });

  it("embeds the checklist program once, lays its rows out before the fit and its overlays after", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step(SECOPS) });
    expect(source.split(CHECKLIST_JS).length - 1).toBe(1);
    const at = ({ needle }: { needle: string }): number => source.indexOf(needle);
    expect(at({ needle: "checklistRows();\n" })).toBeLessThan(at({ needle: "var fitted = fitRows(" }));
    expect(at({ needle: "var fitted = fitRows(" })).toBeLessThan(at({ needle: "checklistOverlays();\n" }));
    expect(source).toContain(
      "serviceChecklist();\nserviceTriage();\nrefreshClipboardLabel();\npanel.orderFrontRegardless;",
    );
    expect(source).toContain("  serviceChecklist();\n  serviceTriage();\n  refreshClipboardLabel();\n");
  });

  it("draws a line's box from its own overlay's state, ticked and not", () => {
    // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text
    const tickText = new Function(`${CHECKLIST_JS}\nreturn tickText;`)() as (...args: readonly unknown[]) => string;
    const line = { action: "Click Create", command: "", crumb: "", url: "" };
    expect(tickText(0, line, false)).toBe("☐  1. Click Create");
    expect(tickText(2, line, true)).toBe("☑  3. Click Create");
  });

  it("copies a line's command on its own overlay and says so under it, never a word longer than it measured", () => {
    expect(CHECKLIST_JS).toContain("copyText(drawn.line.command);");
    expect(CHECKLIST_JS).toContain("if (clipboardHolds(drawn.line.command)) { copied = COPY_DONE; }");
    expect(CHECKLIST_JS).toContain("drawn.caption = label(COPY_IDLE, 11,");
    // oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text
    const [idle, done] = new Function(`${CHECKLIST_JS}\nreturn [COPY_IDLE, COPY_DONE];`)() as readonly string[];
    expect(done).toBe("copied ✓");
    expect(done!.length).toBeLessThan(idle!.length);
  });

  it("leaves a gap between the left and right button groups at the shipped geometry", () => {
    // Four buttons share one band — Open, Copy, Not now…, Done — and the failure this catches is a widened
    // button silently overlapping its neighbour, which no source-string assertion would see.
    const leftGroupRightEdge = PANEL_PAD + PANEL_BUTTON_WIDTH * 2 + PANEL_BUTTON_GAP;
    const rightGroupLeftEdge = PANEL_WIDTH - PANEL_PAD - PANEL_BUTTON_WIDTH * 2 - PANEL_BUTTON_GAP;
    expect(leftGroupRightEdge).toBe(196);
    expect(rightGroupLeftEdge).toBe(224);
    expect(rightGroupLeftEdge - leftGroupRightEdge).toBe(28);
  });

  it("closes itself on a marker, and calls a window closed some other way the shortest snooze, never `done`", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    expect(source).toContain("if (markerPresent()) { break; }");
    expect(source).toContain(
      "if (!panel.isVisible) {\n    if (writeMarker(SNOOZE[0].suffix)) { break; }\n    panel.orderFrontRegardless;",
    );
  });

  it("closes on an answer only once its marker landed — a press it could not record leaves the note up", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    expect(source).toContain("$.NSUTF8StringEncoding, null) === true;");
    expect(source).not.toContain("writeMarker('done'); break;");
    expect(source).not.toContain("writeMarker(snoozed); break;");
  });

  it("draws Open FIRST and as the default button when the step has a url — the artifact is the step", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    expect(source).toContain("  openButton = button('Open', PAD);");
    expect(source).toContain("  openButton.layer.setBackgroundColor($.NSColor.controlAccentColor.CGColor);");
    // A key equivalent and a bezel colour both drew grey on this never-key panel; neither may come back.
    expect(source).not.toContain("setKeyEquivalent");
    expect(source).not.toContain("setBezelColor");
    // Copy moves one slot right only when Open took the first; with no url it keeps PAD, leaving no gap.
    expect(source).toContain("  if (openButton !== null) { copyX = PAD + BUTTON_W + BUTTON_GAP; }");
    expect(source.indexOf("openButton = button('Open'")).toBeLessThan(source.indexOf("copyButton = button('Copy'"));
  });

  it("carries its raise token, want path and beat path into the one STEP line", () => {
    const first = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() }).split("\n")[0]!;
    const wire = JSON.parse(first.slice("const STEP = ".length, -1)) as Record<string, unknown>;
    expect(wire["token"]).toBe("token-1");
    expect(wire["wantPath"]).toBe("/tmp/live/gcloud-signin.want");
    expect(wire["beatPath"]).toBe("/tmp/live/gcloud-signin.token-1.beat");
  });

  it("checks it is still the wanted raise BEFORE touching the clipboard or drawing anything", () => {
    const source = handNotePanelSource({
      ...LIVE,
      markerDir: "/tmp/m",
      step: step({ literal: "x" }),
    });
    const early = source.indexOf("if (!mayDraw()) { $.exit(0); }");
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(source.indexOf("if (STEP.literal.length > 0) { copyLiteral(); }"));
    expect(early).toBeLessThan(source.indexOf("panel.orderFrontRegardless;"));
  });

  it("closes with NO marker once its own step's newer note has drawn, and never writes the want file", () => {
    const source = handNotePanelSource({ ...LIVE, markerDir: "/tmp/m", step: step() });
    expect(source).toContain("  if (replacementDrawn()) { break; }");
    expect(source.includes("if (replacementDrawn()) { writeMarker(")).toBe(false);
    // The panel WRITES only its own beat. A panel writing the shared token was the read-then-write race.
    expect(source).not.toContain("writeToFileAtomicallyEncodingError(nsstr(STEP.wantPath)");
    expect(source).toContain("nsstr(STEP.build).writeToFileAtomicallyEncodingError(nsstr(STEP.beatPath)");
    expect(source).toContain("panel.close;\nstopBeating();");
    // Closing leaves a tombstone, never an absent beat, which a raise would read as a note still starting.
    expect(source).toContain("var CLOSED_BEAT = 'closed';");
    expect(source).toContain("nsstr(CLOSED_BEAT).writeToFileAtomicallyEncodingError(nsstr(STEP.beatPath)");
    expect(source).not.toContain("removeItemAtPathError(nsstr(STEP.beatPath)");
  });
});

describe("handNoteBundleFiles", () => {
  it("writes exactly three files, one of them executable", () => {
    const files = handNoteBundleFiles({ panelSource: "'x';" });
    expect(files.map((file) => file.relativePath)).toEqual([
      "Contents/Info.plist",
      `Contents/MacOS/${NOTE_EXECUTABLE}`,
      "Contents/Resources/panel.js",
    ]);
    expect(files.filter((file) => file.executable).map((file) => file.relativePath)).toEqual([
      `Contents/MacOS/${NOTE_EXECUTABLE}`,
    ]);
  });

  it("names its executable with CFBundleExecutable and carries NEITHER launchd key", () => {
    const plist = handNoteBundleFiles({ panelSource: "'x';" })[0]!.contents;
    expect(plist).toContain(`\t<key>CFBundleExecutable</key>\n\t<string>${NOTE_EXECUTABLE}</string>`);
    expect(plist.includes("<key>Program</key>")).toBe(false);
    expect(plist.includes("<key>ProgramArguments</key>")).toBe(false);
  });

  it("has no Dock tile, so raising a step adds nothing to notice", () => {
    const plist = handNoteBundleFiles({ panelSource: "'x';" })[0]!.contents;
    expect(plist).toContain("\t<key>LSUIElement</key>\n\t<true/>");
  });

  it("launches the panel by a path relative to the launcher itself", () => {
    const launcher = handNoteBundleFiles({ panelSource: "'x';" })[1]!.contents;
    expect(launcher).toBe(
      '#!/bin/sh\nset -eu\nexec /usr/bin/osascript -l JavaScript "$(dirname "$0")/../Resources/panel.js"\n',
    );
  });

  it("puts the composed program in Resources, byte for byte", () => {
    const source = handNotePanelSource({
      ...LIVE,
      markerDir: "/tmp/m",
      step: step({ literal: HOSTILE_LITERAL }),
    });
    expect(handNoteBundleFiles({ panelSource: source })[2]!.contents).toBe(source);
  });
});
