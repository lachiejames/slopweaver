// A publish writes nothing on disk, so a walk has no fixture directory to fail removing.
// deleted-with-code: pageFixtureCleanupFailed
import { describe, expect, it } from "vitest";

import { E2eCallErrors, E2eCallEvidenceErrors, E2eCallFlagErrors } from "../../../desktop/e2eCallErrors.js";
import { DesktopE2eErrors, E2eStepBlocks, E2eStepNotApplicables } from "../../../desktop/e2eErrors.js";
import { ON_CALL_RULING } from "../../../desktop/onCallHold.js";

describe("DesktopE2eErrors — the walk's fixture page", () => {
  it("names the page it could not publish, and that nothing was launched", () => {
    expect(DesktopE2eErrors.pageFixturePublishFailed({ detail: "store unreachable", slug: "desktop-e2e-a" })).toEqual({
      code: "PAGE_FIXTURE_PUBLISH_FAILED",
      message:
        "the walk could not publish its fixture page desktop-e2e-a: store unreachable — nothing was launched; check " +
        "the store with `slopweaver store status` and its local stack with `yarn store:start`, or leave pages out " +
        "with --only",
      slug: "desktop-e2e-a",
    });
  });

  it("names the page the store still holds, as the walk's own", () => {
    expect(
      DesktopE2eErrors.pageFixtureStoreCleanupFailed({ detail: "store unreachable", slug: "desktop-e2e-a" }),
    ).toEqual({
      code: "PAGE_FIXTURE_STORE_CLEANUP_FAILED",
      message:
        "the walk could not take its fixture page desktop-e2e-a out of the store: store unreachable — it is the " +
        "walk's own page and nothing of the owner's, so it is safe where it is, and `page find` lists it until its store " +
        "rows are removed",
      slug: "desktop-e2e-a",
    });
  });

  it("names the slug that makes no valid page, and that nothing was launched", () => {
    expect(DesktopE2eErrors.pageFixtureUnplanned({ slug: "desktop-e2e-a/b" })).toEqual({
      code: "PAGE_FIXTURE_UNPLANNED",
      message: '"desktop-e2e-a/b" is not a valid page slug, so no fixture page was planned — nothing was launched',
      slug: "desktop-e2e-a/b",
    });
  });
});

describe("DesktopE2eErrors — why a run never walked", () => {
  it("names each refusal and what to do next", () => {
    expect(
      [
        DesktopE2eErrors.bundleMissing({ path: "/x.app" }),
        DesktopE2eErrors.callConsoleNotOwners({ checkout: "/w", declared: [] }),
        DesktopE2eErrors.checkoutUnresolved({ detail: "no profile" }),
        DesktopE2eErrors.consoleNeverShown({ seconds: 30 }),
        DesktopE2eErrors.launchFailed({ detail: "spawn ENOENT", path: "/x.app" }),
        DesktopE2eErrors.unsupportedBuild({ path: "/x.app" }),
      ].map((error) => [error.code, error.message]),
    ).toEqual([
      ["BUNDLE_MISSING", "/x.app is not an app bundle with Contents/Info.plist — pass --app <path to Slopweaver.app>"],
      [
        "CALL_CONSOLE_NOT_HIS",
        "--call places real calls on /w's console, which is not one the owner's profile declares (none declared): `talk " +
          "transcript` refuses a console that is not the owner's writing the live talk store, so the call's transcript would " +
          "never end and the leg would STOP on it — nothing was launched; drop --checkout to run the call leg on the owner's " +
          "console",
      ],
      [
        "CHECKOUT_UNRESOLVED",
        "no checkout for the test instance to read the console from: no profile — pass --checkout <dir>",
      ],
      [
        "CONSOLE_NEVER_SHOWN",
        "the test instance showed no Queue page within 30s — it only reads the console, never starts it, so check " +
          "`slopweaver checkout console` and read the screenshot of what it showed instead",
      ],
      ["LAUNCH_FAILED", "could not launch /x.app as a test instance: spawn ENOENT"],
      [
        "UNSUPPORTED_BUILD",
        "/x.app carries no SlopweaverDesktopE2EProtocol 2 in its Info.plist: a build from before the test switch " +
          "would start as a full second copy of the owner's app, and one from before protocol 2 would record its calls as " +
          "the owner's words — nothing was launched; build or install a current one",
      ],
    ]);
  });

  it("names the menu bar protocol a --menu-bar run wanted, and the two ways on", () => {
    expect(DesktopE2eErrors.unsupportedMenuBarBuild({ path: "/x.app" })).toEqual({
      code: "UNSUPPORTED_MENU_BAR_BUILD",
      message:
        "/x.app carries no SlopweaverDesktopE2EMenuBarProtocol 1 in its Info.plist, so it would draw no Slopweaver " +
        "Test icon for --menu-bar — nothing was launched; build a current one, or drop --menu-bar",
      path: "/x.app",
    });
  });
});

describe("E2eCallErrors — why the call leg refused or could not drive", () => {
  it("names each refusal with what was found", () => {
    expect(
      [
        E2eCallErrors.audioInvalid({ path: "/m.wav" }),
        E2eCallErrors.audioSynthesisFailed({ detail: "exit 1" }),
        E2eCallErrors.callAlreadyLive({ live: 2 }),
        E2eCallErrors.callLockHeld({ detail: "pid 9" }),
        E2eCallErrors.cleanupFailed({ detail: "lease up" }),
        E2eCallErrors.controlMissing({ control: "Mute" }),
        E2eCallErrors.evidenceUnreadable({ detail: "EACCES", path: "/l.log" }),
        E2eCallErrors.interrupted(),
        E2eCallErrors.launchFailed({ detail: "timeout" }),
        E2eCallErrors.leasesUnreadable({ detail: "leases.json is not JSON" }),
        E2eCallErrors.neverLive({ seconds: 45 }),
        E2eCallErrors.voiceWindowUnclear({ found: 2 }),
      ].map((error) => [error.code, error.message]),
    ).toEqual([
      [
        "AUDIO_INVALID",
        "/m.wav is not a RIFF/WAVE file, so Chromium could not take it as a microphone — nothing was launched",
      ],
      ["AUDIO_SYNTHESIS_FAILED", "/usr/bin/say could not write the fake microphone's audio: exit 1"],
      [
        "CALL_ALREADY_LIVE",
        "2 voice call lease(s) are live on this machine — a call is up or being minted, so no test call is placed " +
          `beside it; re-run once it has ended (${ON_CALL_RULING})`,
      ],
      ["CALL_LOCK_HELD", "another `desktop e2e --call` holds the call leg's lock: pid 9"],
      ["CALL_CLEANUP_FAILED", "a test call could not be proven ended, so no further call is placed: lease up"],
      ["CALL_CONTROL_MISSING", 'the voice window showed no usable "Mute" control'],
      ["EVIDENCE_UNREADABLE", "could not read the call evidence at /l.log: EACCES"],
      ["CALL_INTERRUPTED", "interrupted before Talk was pressed, so no call was placed"],
      ["CALL_LAUNCH_FAILED", "could not launch the test instance for a call: timeout"],
      [
        "LEASES_UNREADABLE",
        "leases.json is not JSON — whether a call is live cannot be told, so no test call is placed",
      ],
      ["CALL_NEVER_LIVE", "the call never showed its mute control within 45s of the press"],
      ["VOICE_WINDOW_UNCLEAR", "2 live voice windows matched /voice; exactly one is crashed, so none was"],
    ]);
  });

  it("refuses part of the call leg without --call, naming the scenarios", () => {
    expect([
      E2eCallFlagErrors.holdWithoutCall().message,
      E2eCallFlagErrors.scenarioWithoutCall({ ids: ["call-live", "relaunch"] }).message,
    ]).toEqual([
      "--call-hold-minutes configures the call leg, so it needs --call",
      "--only names call scenario(s) without --call, which places no call: call-live, relaunch",
    ]);
  });

  it("refuses a card without --call, a card that is not a Queue card key, and card-read without a card", () => {
    expect([
      E2eCallFlagErrors.cardWithoutCall(),
      E2eCallFlagErrors.cardInvalid({ key: "fixture-card" }),
      E2eCallFlagErrors.cardScenarioWithoutCard(),
    ]).toEqual([
      { code: "CARD_WITHOUT_CALL", message: "--call-card configures the call leg, so it needs --call" },
      {
        code: "CARD_INVALID",
        key: "fixture-card",
        message:
          "--call-card must be all, or card keys exactly as the console names them, comma-separated, each <kind>:<id> " +
          "(ask, hand, draft, post, review, import, pr, act or align, then up to 160 letters, digits, '.', '_' or " +
          "'-'); refused \"fixture-card\"",
      },
      {
        code: "CARD_SCENARIO_WITHOUT_CARD",
        message:
          "--only card-read and card-read-typed need --call-card <kind>:<id>[,<kind>:<id>...] or --call-card all",
      },
    ]);
  });

  it("names a malformed evidence line by its one-based number", () => {
    expect(E2eCallEvidenceErrors.malformedLine({ line: "{oops", lineIndex: 4, log: "desktop-events.jsonl" })).toEqual({
      code: "MALFORMED_LINE",
      lineIndex: 4,
      message: "desktop-events.jsonl line 5 is not one it writes: {oops",
    });
  });
});

describe("E2eStepBlocks — the line a blocked step's report row carries", () => {
  it("names the sidebar link a page step could not find", () => {
    expect(E2eStepBlocks.noSidebarLink({ path: "/fleet" })).toEqual({
      code: "NO_SIDEBAR_LINK",
      message: "the sidebar has no link to /fleet",
      path: "/fleet",
    });
  });

  it("names the page that never showed and the move that should have shown it", () => {
    expect(E2eStepBlocks.pageNeverShown({ after: "the docs link", path: "/viewer" })).toEqual({
      code: "PAGE_NEVER_SHOWN",
      message: "no page showed /viewer after the docs link",
      path: "/viewer",
    });
  });

  it("blocks a Queue that showed neither a card nor its measured-zero line, never calling it empty", () => {
    expect(E2eStepBlocks.noQueueCard()).toEqual({
      code: "NO_QUEUE_CARD",
      message: "the Queue showed no card to open, and no measured-zero line to say it was empty",
    });
  });

  it("blocks a Queue whose measured-zero line was gone by the photograph, naming the re-take", () => {
    expect(E2eStepBlocks.queueEmptyLost()).toEqual({
      code: "QUEUE_EMPTY_LOST",
      message:
        "the Queue's measured-zero line was gone by the time the step was photographed, so the photograph does not " +
        "show it empty — a register began reading again or a card arrived; re-take the step with --only queue-card",
    });
  });

  it("blocks a proven-empty Queue whose photograph could not be taken, since the verdict stands on it", () => {
    expect(E2eStepBlocks.queueEmptyUnphotographed()).toEqual({
      code: "QUEUE_EMPTY_UNPHOTOGRAPHED",
      message:
        "the Queue showed its measured-zero line but the step's photograph could not be taken, and a not-applicable " +
        "step stands on its photograph — check the --out folder is writable and re-take the step with --only queue-card",
    });
  });

  it("blocks the pinned-tab step when no page drew the tab strip, since it judges from the strip", () => {
    expect(E2eStepBlocks.noTabStrip()).toEqual({
      code: "NO_TAB_STRIP",
      message: "no page of the instance drew the tab strip, so which tab was in front could not be read",
    });
  });

  it("names the move that broke the owner's one-Queue-tab steer and every way it broke it", () => {
    const breaks = [
      "the voice's card did not take the owner over to the pinned Queue tab",
      "the pinned tab is not on k",
    ];
    expect(E2eStepBlocks.queueNotPinned({ breaks, move: "card" })).toEqual({
      breaks,
      code: "QUEUE_NOT_PINNED",
      message:
        "the card move broke the owner's one-Queue-tab steer: the voice's card did not take the owner over to the " +
        "pinned Queue tab; the pinned tab is not on k",
    });
  });

  it("names every way the + after the last tab failed to open the page chosen off its menu", () => {
    const breaks = ["pressing + popped no menu"];
    expect(E2eStepBlocks.newTabBroken({ breaks })).toEqual({
      breaks,
      code: "NEW_TAB_BROKEN",
      message: "the + after the last tab did not open the page chosen off its menu: pressing + popped no menu",
    });
  });

  it("says a proven-empty Queue left the card step nothing to open, as a not-applicable outcome", () => {
    expect(E2eStepNotApplicables.queueEmpty()).toEqual({
      code: "QUEUE_EMPTY",
      message: "the Queue was empty: every register read and none holds a card, so there was no card to open",
    });
  });

  it("names a published page step reached with no fixture page written", () => {
    expect(E2eStepBlocks.pageFixtureMissing()).toEqual({
      code: "PAGE_FIXTURE_MISSING",
      message:
        "the walk reached the published page step with no fixture page written for it, so it had nothing to open",
    });
  });

  it("names the point a controls report covered that the voice's fixture clips away", () => {
    expect(E2eStepBlocks.controlsUnclipped({ x: 68, y: 2 })).toEqual({
      code: "CONTROLS_UNCLIPPED",
      message:
        "the voice reported a control box over (68, 2), where its fixture's scroller clips every row away — main " +
        "takes the owner's clicks there, so whatever sits under it on the owner's screen stops answering",
      x: 68,
      y: 2,
    });
  });

  it("names the drawn point no reported control box covers", () => {
    expect(E2eStepBlocks.controlsUndrawn({ x: 180, y: 932 })).toEqual({
      code: "CONTROLS_UNDRAWN",
      message:
        "no control box the voice reported covers (180, 932), which its fixture draws — a press there would pass " +
        "through to whatever is under the window",
      x: 180,
      y: 932,
    });
  });

  it("says the check judged nothing when a real control sat on its empty point", () => {
    expect(E2eStepBlocks.controlsProbeOnControl().code).toBe("CONTROLS_PROBE_ON_CONTROL");
    expect(E2eStepBlocks.controlsProbeOnControl().message).toContain("could judge nothing");
  });

  it("says the page did not measure, rather than blaming it, when no fresh report arrived", () => {
    const block = E2eStepBlocks.controlsUnreported({ ms: 5000 });
    expect(block.code).toBe("CONTROLS_UNREPORTED");
    expect(block.message).toContain("within 5000ms");
    expect(block.message).toContain("not that it measured wrong");
  });

  it("carries a thrown Error's own message, and a thrown non-Error as text", () => {
    expect(E2eStepBlocks.actionThrew({ cause: new Error("Target page has been closed") }).message).toBe(
      "Target page has been closed",
    );
    expect(E2eStepBlocks.actionThrew({ cause: "socket hang up" })).toEqual({
      code: "ACTION_THREW",
      message: "socket hang up",
    });
  });
});
