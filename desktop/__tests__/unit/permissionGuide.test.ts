/**
 * The permissions guide: where each permission stands, when the guide raises itself, the exact System Settings page
 * each switch is on, the links it acts on, the reopen it offers, and a script-free page with the animated walkthrough.
 */
import { describe, expect, it } from "vitest";

import { type InputControlView, inputControlView } from "../../src/inputControlConsent";
import {
  GUIDE_REOPEN_ARGUMENT,
  type GuideRow,
  guideLinkOf,
  guideMenuLabel,
  guidePosition,
  guideRaisesAtLaunch,
  missingPermissions,
  type PermissionId,
  type PermissionStatuses,
  permissionStanding,
  reopenArguments,
  settingsUrlOf,
} from "../../src/permissionGuide";
import { guideUrl } from "../../src/permissionGuidePage";
import { guideView } from "../../src/permissionGuideView";

/** The document inside the guide's data URL. */
const documentOf = ({ url }: { url: string }): string =>
  decodeURIComponent(url.slice("data:text/html;charset=utf-8,".length));

const FRESH_MAC = { microphone: "not-determined", screen: "not-determined", systemAudio: "not-determined" } as const;
const ALL_REFUSED = { microphone: "denied", screen: "denied", systemAudio: "denied" } as const;
const SCREEN_REFUSED = { microphone: "granted", screen: "denied", systemAudio: "granted" } as const;
const SYSTEM_AUDIO_REFUSED = { microphone: "granted", screen: "granted", systemAudio: "denied" } as const;
const ALL_ON = { microphone: "granted", screen: "granted", systemAudio: "granted" } as const;

/** Mouse and keyboard control already trusted, so the optional step draws no step of its own. */
const INPUT_CONTROL_ON: InputControlView = { standing: "granted", step: undefined };

/**
 * The guide for these statuses, in the installed app with no call up, nothing visited or asked, nothing failed, and
 * mouse and keyboard control already on unless a test says otherwise.
 */
const viewOf = ({
  statuses,
  settingsVisited = [],
  promptsRaised = [],
  callLive = false,
  appName = "Slopweaver",
  inputControl = INPUT_CONTROL_ON,
  problem,
}: {
  statuses: PermissionStatuses;
  settingsVisited?: readonly PermissionId[];
  promptsRaised?: readonly PermissionId[];
  callLive?: boolean;
  appName?: string;
  inputControl?: InputControlView;
  problem?: string;
}): ReturnType<typeof guideView> =>
  guideView({ appName, callLive, inputControl, problem, promptsRaised, settingsVisited, statuses });

/** The optional step as offered before the owner has answered. */
const OFFERED = inputControlView({ appName: "Slopweaver", consent: undefined, review: false, trusted: false });

/** The guide's document for one view. */
const htmlOf = ({
  view,
  title = "Set up permissions",
}: {
  view: ReturnType<typeof guideView>;
  title?: string;
}): string => documentOf({ url: guideUrl({ title, view }) });

describe("permissionStanding", () => {
  it("asks macOS for a permission never asked, deep-links a refused one, and leaves a managed one to its manager", () => {
    expect(permissionStanding({ status: "granted" })).toBe("granted");
    expect(permissionStanding({ status: "not-determined" })).toBe("ask");
    expect(permissionStanding({ status: "denied" })).toBe("settings");
    expect(permissionStanding({ status: "unknown" })).toBe("settings");
    expect(permissionStanding({ status: "restricted" })).toBe("managed");
  });
});

describe("missingPermissions", () => {
  it("lists every permission not granted, in the order a call meets them", () => {
    expect(missingPermissions({ statuses: FRESH_MAC })).toEqual(["microphone", "systemAudio", "screen"]);
    expect(missingPermissions({ statuses: SCREEN_REFUSED })).toEqual(["screen"]);
    expect(missingPermissions({ statuses: SYSTEM_AUDIO_REFUSED })).toEqual(["systemAudio"]);
    expect(
      missingPermissions({ statuses: { microphone: "unknown", screen: "granted", systemAudio: "granted" } }),
    ).toEqual(["microphone"]);
    expect(missingPermissions({ statuses: ALL_ON })).toEqual([]);
  });

  it("puts System Audio Recording before a Screen Recording you may leave for later", () => {
    const step = viewOf({
      statuses: { microphone: "granted", screen: "not-determined", systemAudio: "not-determined" },
    }).step!;
    expect(step.permission).toBe("systemAudio");
  });
});

describe("guideRaisesAtLaunch", () => {
  /** Whether the guide raises for this launch, one the guide's own Reopen did not start unless said. */
  const raises = ({
    missing,
    dismissed = [],
    packaged = true,
    reopened = false,
  }: {
    missing: readonly PermissionId[];
    dismissed?: readonly PermissionId[];
    packaged?: boolean;
    reopened?: boolean;
  }): boolean => guideRaisesAtLaunch({ dismissed, missing, packaged, reopened });

  it("raises the installed app on a fresh Mac", () => {
    expect(raises({ missing: ["microphone", "screen"] })).toBe(true);
  });

  it("never raises a dev build, nor with everything on", () => {
    expect(raises({ missing: ["microphone"], packaged: false })).toBe(false);
    expect(raises({ missing: [] })).toBe(false);
  });

  it("stays down for what you said Not now to, and raises again for a permission newly off", () => {
    expect(raises({ dismissed: ["microphone", "screen"], missing: ["screen"] })).toBe(false);
    expect(raises({ dismissed: ["microphone"], missing: ["microphone", "screen"] })).toBe(true);
  });

  it("always raises on a run its own Reopen started, to confirm what macOS applied", () => {
    expect(raises({ missing: [], reopened: true })).toBe(true);
    expect(raises({ missing: ["screen"], packaged: false, reopened: true })).toBe(true);
    expect(raises({ dismissed: ["screen"], missing: ["screen"], reopened: true })).toBe(true);
  });
});

describe("guideMenuLabel", () => {
  it("names what is off, and offers nothing once all is on", () => {
    expect(guideMenuLabel({ missing: ["microphone", "systemAudio", "screen"] })).toBe(
      "Turn on Microphone, System Audio Recording and Screen Recording…",
    );
    expect(guideMenuLabel({ missing: ["microphone", "screen"] })).toBe("Turn on Microphone and Screen Recording…");
    expect(guideMenuLabel({ missing: ["screen"] })).toBe("Turn on Screen Recording…");
    expect(guideMenuLabel({ missing: [] })).toBe(undefined);
  });
});

describe("settingsUrlOf", () => {
  it("opens the exact Privacy & Security page each switch is on", () => {
    expect(settingsUrlOf({ permission: "microphone" })).toBe(
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone",
    );
    expect(settingsUrlOf({ permission: "screen" })).toBe(
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
    );
    // System Audio Recording Only is a list on Screen Recording's own page; macOS names no page of its own.
    expect(settingsUrlOf({ permission: "systemAudio" })).toBe(
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
    );
  });
});

describe("guideLinkOf", () => {
  it("reads each link", () => {
    expect(guideLinkOf({ url: "slopweaver-guide://ask/microphone" })).toEqual({
      kind: "ask",
      permission: "microphone",
    });
    expect(guideLinkOf({ url: "slopweaver-guide://settings/screen" })).toEqual({
      kind: "settings",
      permission: "screen",
    });
    expect(guideLinkOf({ url: "slopweaver-guide://ask/systemAudio" })).toEqual({
      kind: "ask",
      permission: "systemAudio",
    });
    expect(guideLinkOf({ url: "slopweaver-guide://settings/systemAudio" })).toEqual({
      kind: "settings",
      permission: "systemAudio",
    });
    expect(guideLinkOf({ url: "slopweaver-guide://reopen" })).toEqual({ kind: "reopen" });
    expect(guideLinkOf({ url: "slopweaver-guide://recheck" })).toEqual({ kind: "recheck" });
    expect(guideLinkOf({ url: "slopweaver-guide://dismiss" })).toEqual({ kind: "dismiss" });
  });

  it("refuses anything else", () => {
    expect(guideLinkOf({ url: "slopweaver-guide://ask/camera" })).toBe(undefined);
    expect(guideLinkOf({ url: "slopweaver-guide://ask/systemaudio" })).toBe(undefined);
    expect(guideLinkOf({ url: "slopweaver-guide://settings/screens" })).toBe(undefined);
    expect(guideLinkOf({ url: "slopweaver-guide://ask/toString" })).toBe(undefined);
    expect(guideLinkOf({ url: "slopweaver-guide://reopen/screen" })).toBe(undefined);
    expect(guideLinkOf({ url: "slopweaver-guide://settings" })).toBe(undefined);
    expect(guideLinkOf({ url: "slopweaver-guide://recheck?x=1" })).toBe(undefined);
    expect(guideLinkOf({ url: "slopweaver-guide://ask/microphone#x" })).toBe(undefined);
    expect(guideLinkOf({ url: "slopweaver-shell://retry/3" })).toBe(undefined);
    expect(
      guideLinkOf({ url: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone" }),
    ).toBe(undefined);
  });
});

describe("guideView", () => {
  it("walks a fresh Mac to the microphone first, by macOS's own prompt", () => {
    const view = viewOf({ statuses: FRESH_MAC });
    expect(view.headline).toBe("Turn on Microphone, System Audio Recording and Screen Recording for Slopweaver");
    expect(view.rows.map((row) => row.standing)).toEqual(["ask", "ask", "ask"]);
    const step = view.step!;
    expect(step.permission).toBe("microphone");
    expect(step.button).toEqual({ label: "Allow Microphone", link: { kind: "ask", permission: "microphone" } });
    expect(step.how).toEqual(["Press Allow Microphone below.", "macOS asks once: choose Allow."]);
    expect(step.reopen).toBe("none");
  });

  it("walks a fresh Screen Recording through macOS's prompt, its switch and its Quit & Reopen", () => {
    const step = viewOf({
      statuses: { microphone: "granted", screen: "not-determined", systemAudio: "granted" },
    }).step!;
    expect(step.button).toEqual({ label: "Allow Screen Recording", link: { kind: "ask", permission: "screen" } });
    expect(step.how).toEqual([
      "Press Allow Screen Recording below.",
      "macOS asks once: choose Open System Settings.",
      "Turn on Slopweaver's switch.",
      "When macOS asks, press Quit & Reopen.",
    ]);
  });

  it("deep-links a refused Screen Recording, and offers no reopen before its page was opened", () => {
    const view = viewOf({ statuses: SCREEN_REFUSED });
    expect(view.headline).toBe("Turn on Screen Recording for Slopweaver");
    const step = view.step!;
    expect(step.permission).toBe("screen");
    expect(step.paneTitle).toBe("Screen & System Audio Recording");
    expect(step.button).toEqual({
      label: "Open Screen Recording settings",
      link: { kind: "settings", permission: "screen" },
    });
    expect(step.reopen).toBe("none");
  });

  it("offers the reopen once a still-refused permission's page was opened — microphone or screen", () => {
    expect(viewOf({ settingsVisited: ["screen"], statuses: SCREEN_REFUSED }).step!.reopen).toBe("offer");
    expect(viewOf({ settingsVisited: ["microphone"], statuses: ALL_REFUSED }).step!.reopen).toBe("offer");
    expect(viewOf({ settingsVisited: ["screen"], statuses: ALL_REFUSED }).step!.reopen).toBe("none");
  });

  it("holds the reopen while a call is up, since quitting would end it", () => {
    expect(viewOf({ callLive: true, settingsVisited: ["screen"], statuses: SCREEN_REFUSED }).step!.reopen).toBe(
      "after-call",
    );
  });

  it("offers no button for a permission a management profile decides", () => {
    const step = viewOf({ statuses: { microphone: "restricted", screen: "granted", systemAudio: "granted" } }).step!;
    expect(step.standing).toBe("managed");
    expect(step.button).toBe(undefined);
  });

  it("says you are set once every permission is on", () => {
    const view = viewOf({ statuses: ALL_ON });
    expect(view.step).toBe(undefined);
    expect(view.headline).toBe(
      "You're set: the voice can hear you, keep talking when you switch headphones, and see your screen.",
    );
  });

  it("asks System Audio Recording by macOS's own prompt, with no Quit & Reopen", () => {
    const step = viewOf({
      statuses: { microphone: "granted", screen: "granted", systemAudio: "not-determined" },
    }).step!;
    expect(step.permission).toBe("systemAudio");
    expect(step.label).toBe("System Audio Recording");
    expect(step.button).toEqual({
      label: "Allow System Audio Recording",
      link: { kind: "ask", permission: "systemAudio" },
    });
    expect(step.how).toEqual(["Press Allow System Audio Recording below.", "macOS asks once: choose Allow."]);
  });

  it("never offers Allow twice: a prompt this run raised, still unanswered, sends you to Settings instead", () => {
    const step = viewOf({
      promptsRaised: ["systemAudio"],
      statuses: { microphone: "granted", screen: "granted", systemAudio: "not-determined" },
    }).step!;
    expect(step.standing).toBe("settings");
    expect(step.button).toEqual({
      label: "Open System Audio Recording settings",
      link: { kind: "settings", permission: "systemAudio" },
    });
    expect(step.reopen).toBe("none");
  });

  it("leaves a raised prompt that macOS answered to the answer", () => {
    const step = viewOf({ promptsRaised: ["systemAudio"], statuses: SYSTEM_AUDIO_REFUSED }).step!;
    expect(step.standing).toBe("settings");
    expect(viewOf({ promptsRaised: ["systemAudio"], statuses: ALL_ON }).step).toBe(undefined);
  });

  it("deep-links a refused System Audio Recording to its list on Screen Recording's page, and never offers a reopen", () => {
    const view = viewOf({ settingsVisited: ["systemAudio"], statuses: SYSTEM_AUDIO_REFUSED });
    expect(view.headline).toBe("Turn on System Audio Recording for Slopweaver");
    expect(view.rows.find((row) => row.permission === "systemAudio")!.why).toBe(
      "So the voice's audio keeps playing when you switch headphones or speakers. Nothing else is recorded.",
    );
    const step = view.step!;
    expect(step.paneTitle).toBe("Screen & System Audio Recording");
    expect(step.button).toEqual({
      label: "Open System Audio Recording settings",
      link: { kind: "settings", permission: "systemAudio" },
    });
    expect(step.how).toEqual([
      "Press Open System Audio Recording settings below: it opens the exact page.",
      'Scroll to the "System Audio Recording Only" list and find Slopweaver there (not there? press + under it and choose it in Applications).',
      "Turn its switch on. This window ticks it off once macOS has it.",
    ]);
    expect(step.reopen).toBe("none");
  });

  it("walks a System Audio Recording the helper could not read to its Settings page, with the reason", () => {
    const view = viewOf({
      problem: "System Audio Recording could not be read: the helper did not answer in 3s",
      statuses: { microphone: "granted", screen: "granted", systemAudio: "unknown" },
    });
    expect(view.step!.standing).toBe("settings");
    expect(view.problem).toBe("System Audio Recording could not be read: the helper did not answer in 3s");
  });

  it("names a dev build's row as macOS lists it", () => {
    expect(viewOf({ appName: "Electron", statuses: ALL_REFUSED }).step!.how[1]).toBe("Find Electron in the list.");
  });
});

describe("guideUrl", () => {
  it("draws a script-free page under a policy that allows none", () => {
    const html = htmlOf({ view: viewOf({ statuses: ALL_REFUSED }) });
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
    expect(html.includes("<script")).toBe(false);
    expect(html.includes("javascript:")).toBe(false);
  });

  it("draws the animated System Settings for the step, its button and its links", () => {
    const html = htmlOf({ view: viewOf({ statuses: ALL_REFUSED }) });
    expect(html).toContain('<div class="sim mic" aria-hidden="true">');
    expect(html).toContain('<p class="ptitle">Microphone</p>');
    expect(html).toContain('<span class="tog target">');
    expect(html).toContain("@keyframes hand{");
    expect(html).toContain('<a class="act" href="slopweaver-guide://settings/microphone">Open Microphone settings</a>');
    expect(html).toContain('<ol class="how"><li>Press Open Microphone settings below: it opens the exact page.</li>');
    expect(html).toContain('<a href="slopweaver-guide://recheck">Check again</a>');
    expect(html).toContain('<a href="slopweaver-guide://dismiss">Not now</a>');
    expect(html).toContain("@media (prefers-reduced-motion:reduce){.sim *{animation:none!important}}");
  });

  it("adds macOS's Quit & Reopen sheet for Screen Recording, and the reopen link once its page was opened", () => {
    const before = htmlOf({ view: viewOf({ statuses: SCREEN_REFUSED }) });
    expect(before).toContain('<div class="sim scr" aria-hidden="true">');
    expect(before).toContain('<div class="sheet">');
    expect(before.includes("slopweaver-guide://reopen")).toBe(false);
    const after = htmlOf({ view: viewOf({ settingsVisited: ["screen"], statuses: SCREEN_REFUSED }) });
    expect(after).toContain('<a href="slopweaver-guide://reopen">Reopen Slopweaver</a>');
    const inCall = htmlOf({ view: viewOf({ callLive: true, settingsVisited: ["screen"], statuses: SCREEN_REFUSED }) });
    expect(inCall.includes("slopweaver-guide://reopen")).toBe(false);
    expect(inCall).toContain("Reopen Slopweaver after your call: quitting now would end it.");
  });

  it("draws System Audio Recording's switch on Screen Recording's page, with no Quit & Reopen sheet", () => {
    const html = htmlOf({ view: viewOf({ statuses: SYSTEM_AUDIO_REFUSED }) });
    expect(html).toContain('<div class="sim sys" aria-hidden="true">');
    expect(html).toContain('<p class="ptitle">Screen &amp; System Audio Recording</p>');
    expect(html).toContain(
      '<a class="act" href="slopweaver-guide://settings/systemAudio">Open System Audio Recording settings</a>',
    );
    expect(html.includes('<div class="sheet">')).toBe(false);
    expect(html).toContain(".sys .tog.target{animation:flip 7s infinite}");
  });

  it("shows why the last press did nothing", () => {
    const html = htmlOf({ view: viewOf({ problem: "System Settings did not open: nope", statuses: ALL_REFUSED }) });
    expect(html).toContain('<p class="problem">System Settings did not open: nope</p>');
  });

  it("escapes every value it draws", () => {
    const html = htmlOf({
      title: "<t>",
      view: viewOf({ appName: '<img src="x">', problem: "<b>", statuses: ALL_REFUSED }),
    });
    expect(html.includes('<img src="x">')).toBe(false);
    expect(html).toContain("&lt;img src=&quot;x&quot;&gt;");
    expect(html).toContain("<title>&lt;t&gt;</title>");
    expect(html).toContain('<p class="problem">&lt;b&gt;</p>');
  });

  it("escapes a row's class too, whatever reaches it", () => {
    const view = viewOf({ statuses: ALL_REFUSED });
    const row = { label: "Microphone", permission: "microphone", standing: 'x" data-forged="1', why: "w" } as const;
    const forged = { ...view, rows: [row as unknown as GuideRow] };
    const html = htmlOf({ view: forged });
    expect(html.includes('data-forged="1"')).toBe(false);
    expect(html).toContain('<li class="x&quot; data-forged=&quot;1">');
  });

  it("offers Close rather than Not now once you are set, and draws no walkthrough", () => {
    const html = htmlOf({ view: viewOf({ statuses: ALL_ON }) });
    expect(html).toContain('<a href="slopweaver-guide://dismiss">Close</a>');
    expect(html.includes('class="sim')).toBe(false);
  });

  it("draws mouse and keyboard control as an optional row, whatever else is off", () => {
    const html = htmlOf({ view: viewOf({ inputControl: OFFERED, statuses: ALL_REFUSED }) });
    expect(html).toContain(
      '<li class="optional"><span class="dot"></span><span><b>Mouse &amp; keyboard control</b> <span class="tag">Optional</span>',
    );
    expect(html).toContain("Voice calls do not need it.");
  });

  it("holds the optional step back while a voice permission is off", () => {
    const html = htmlOf({ view: viewOf({ inputControl: OFFERED, statuses: ALL_REFUSED }) });
    expect(html.includes("slopweaver-guide://input-control/accept")).toBe(false);
    expect(html).toContain('<a href="slopweaver-guide://dismiss">Not now</a>');
  });

  it("offers the optional step once every voice permission is on, its Not now its own answer", () => {
    const html = htmlOf({ view: viewOf({ inputControl: OFFERED, statuses: ALL_ON }) });
    expect(html).toContain('<p class="step">Mouse &amp; keyboard control (optional)</p>');
    expect(html).toContain(
      '<a class="act" href="slopweaver-guide://input-control/accept">Turn on mouse &amp; keyboard control</a>',
    );
    expect(html).toContain('<a href="slopweaver-guide://input-control/decline">Not now</a>');
    expect(html.includes("slopweaver-guide://dismiss")).toBe(false);
  });

  it("walks an accepted but untrusted step to its Settings page, closed with Close", () => {
    const accepted = inputControlView({ appName: "Slopweaver", consent: "accepted", review: false, trusted: false });
    const html = htmlOf({ view: viewOf({ inputControl: accepted, statuses: ALL_ON }) });
    expect(html).toContain(
      '<a class="act" href="slopweaver-guide://input-control/settings">Open Accessibility settings</a>',
    );
    expect(html).toContain('<a href="slopweaver-guide://dismiss">Close</a>');
  });
});

describe("mouse and keyboard control never nags as a voice permission", () => {
  it("is never missing, so it neither raises the guide nor names itself in the menu", () => {
    expect(missingPermissions({ statuses: ALL_ON })).toEqual([]);
    expect(guideRaisesAtLaunch({ dismissed: [], missing: [], packaged: true, reopened: false })).toBe(false);
    expect(guideMenuLabel({ missing: missingPermissions({ statuses: ALL_ON }) })).toBe(undefined);
  });

  it("leaves the headline to the voice permissions, offered or not", () => {
    expect(viewOf({ inputControl: OFFERED, statuses: ALL_ON }).headline).toBe(
      "You're set: the voice can hear you, keep talking when you switch headphones, and see your screen.",
    );
    expect(viewOf({ inputControl: OFFERED, statuses: SCREEN_REFUSED }).headline).toBe(
      "Turn on Screen Recording for Slopweaver",
    );
  });

  it("reads its three links exactly, and nothing near them", () => {
    expect(guideLinkOf({ url: "slopweaver-guide://input-control/accept" })).toEqual({ kind: "input-control-accept" });
    expect(guideLinkOf({ url: "slopweaver-guide://input-control/decline" })).toEqual({ kind: "input-control-decline" });
    expect(guideLinkOf({ url: "slopweaver-guide://input-control/settings" })).toEqual({
      kind: "input-control-settings",
    });
    expect(guideLinkOf({ url: "slopweaver-guide://input-control/grant" })).toBe(undefined);
    expect(guideLinkOf({ url: "slopweaver-guide://input-control/accept?x=1" })).toBe(undefined);
    expect(guideLinkOf({ url: "slopweaver-guide://input-control/accept#x" })).toBe(undefined);
    expect(guideLinkOf({ url: "slopweaver-guide://input-control" })).toBe(undefined);
  });
});

describe("reopenArguments", () => {
  it("relaunches with this run's own arguments and the marker, added exactly once", () => {
    expect(reopenArguments({ argv: ["/Applications/Slopweaver.app/Contents/MacOS/Slopweaver"] })).toEqual([
      GUIDE_REOPEN_ARGUMENT,
    ]);
    expect(reopenArguments({ argv: ["electron", ".", "--checkout", "/c/s", GUIDE_REOPEN_ARGUMENT] })).toEqual([
      ".",
      "--checkout",
      "/c/s",
      GUIDE_REOPEN_ARGUMENT,
    ]);
  });
});

describe("guidePosition", () => {
  it("sits at the top-right of the work area, beside System Settings", () => {
    expect(guidePosition({ workArea: { height: 1000, width: 1600, x: 0, y: 25 } })).toEqual({ x: 1164, y: 41 });
  });
});
