/**
 * Why `slopweaver desktop e2e` could not walk at all. A step that ran and failed is not one of these: it is a row of
 * the report (`./e2eOutcome.ts`). Each `message` says what to do next, because a seat reads it and acts.
 */

/** One reason the walk never started, or stopped before its steps. */
export type DesktopE2eError =
  | { readonly code: "BUNDLE_MISSING"; readonly message: string; readonly path: string }
  | { readonly code: "UNSUPPORTED_BUILD"; readonly message: string; readonly path: string }
  | { readonly code: "UNSUPPORTED_MENU_BAR_BUILD"; readonly message: string; readonly path: string }
  | { readonly code: "CHECKOUT_UNRESOLVED"; readonly message: string }
  | { readonly code: "CALL_CONSOLE_NOT_HIS"; readonly message: string; readonly checkout: string }
  | { readonly code: "LAUNCH_FAILED"; readonly message: string; readonly path: string }
  | { readonly code: "CONSOLE_NEVER_SHOWN"; readonly message: string; readonly seconds: number }
  | { readonly code: "CONTEXT_NOT_CHOSEN"; readonly message: string; readonly detail: string }
  | { readonly code: "PAGE_FIXTURE_UNPLANNED"; readonly message: string; readonly slug: string }
  | { readonly code: "PAGE_FIXTURE_PUBLISH_FAILED"; readonly message: string; readonly slug: string }
  | { readonly code: "PAGE_FIXTURE_STORE_CLEANUP_FAILED"; readonly message: string; readonly slug: string };

/** The context a walk asked for could not be set, carrying the bare reason a caller that is not the walk reports. */
export type ContextNotChosenError = Extract<DesktopE2eError, { readonly code: "CONTEXT_NOT_CHOSEN" }>;

/** Build a {@link DesktopE2eError}. */
export const DesktopE2eErrors = {
  bundleMissing: ({ path }: { path: string }): DesktopE2eError => ({
    code: "BUNDLE_MISSING",
    message: `${path} is not an app bundle with Contents/Info.plist — pass --app <path to Slopweaver.app>`,
    path,
  }),
  callConsoleNotOwners: ({
    checkout,
    declared,
  }: {
    checkout: string;
    declared: readonly string[];
  }): DesktopE2eError => ({
    checkout,
    code: "CALL_CONSOLE_NOT_HIS",
    message:
      `--call places real calls on ${checkout}'s console, which is not one the owner's profile declares ` +
      `(${declared.length === 0 ? "none declared" : declared.join(", ")}): \`talk transcript\` ` +
      "refuses a console that is not the owner's writing the live talk store, so the call's transcript would never end and " +
      "the leg would STOP on it — nothing was launched; drop --checkout to run the call leg on the owner's console",
  }),
  checkoutUnresolved: ({ detail }: { detail: string }): DesktopE2eError => ({
    code: "CHECKOUT_UNRESOLVED",
    message: `no checkout for the test instance to read the console from: ${detail} — pass --checkout <dir>`,
  }),
  consoleNeverShown: ({ seconds }: { seconds: number }): DesktopE2eError => ({
    code: "CONSOLE_NEVER_SHOWN",
    message:
      `the test instance showed no Queue page within ${String(seconds)}s — it only reads the console, never starts ` +
      "it, so check `slopweaver checkout console` and read the screenshot of what it showed instead",
    seconds,
  }),
  contextNotChosen: ({ detail }: { detail: string }): ContextNotChosenError => ({
    code: "CONTEXT_NOT_CHOSEN",
    detail,
    message: `--context could not put the test instance's console in that context: ${detail} — nothing was walked`,
  }),
  launchFailed: ({ path, detail }: { path: string; detail: string }): DesktopE2eError => ({
    code: "LAUNCH_FAILED",
    message: `could not launch ${path} as a test instance: ${detail}`,
    path,
  }),
  pageFixturePublishFailed: ({ slug, detail }: { slug: string; detail: string }): DesktopE2eError => ({
    code: "PAGE_FIXTURE_PUBLISH_FAILED",
    message:
      `the walk could not publish its fixture page ${slug}: ${detail} — nothing was launched; check the store with ` +
      "`slopweaver store status` and its local stack with `yarn store:start`, or leave pages out with --only",
    slug,
  }),
  pageFixtureStoreCleanupFailed: ({ slug, detail }: { slug: string; detail: string }): DesktopE2eError => ({
    code: "PAGE_FIXTURE_STORE_CLEANUP_FAILED",
    message:
      `the walk could not take its fixture page ${slug} out of the store: ${detail} — it is the walk's own page and ` +
      "nothing of the owner's, so it is safe where it is, and `page find` lists it until its store rows are removed",
    slug,
  }),
  pageFixtureUnplanned: ({ slug }: { slug: string }): DesktopE2eError => ({
    code: "PAGE_FIXTURE_UNPLANNED",
    message: `${JSON.stringify(slug)} is not a valid page slug, so no fixture page was planned — nothing was launched`,
    slug,
  }),
  unsupportedBuild: ({ path }: { path: string }): DesktopE2eError => ({
    code: "UNSUPPORTED_BUILD",
    message:
      `${path} carries no SlopweaverDesktopE2EProtocol 2 in its Info.plist: a build from before the test switch ` +
      "would start as a full second copy of the owner's app, and one from before protocol 2 would record its calls as the owner's " +
      "words — nothing was launched; build or install a current one",
    path,
  }),
  unsupportedMenuBarBuild: ({ path }: { path: string }): DesktopE2eError => ({
    code: "UNSUPPORTED_MENU_BAR_BUILD",
    message:
      `${path} carries no SlopweaverDesktopE2EMenuBarProtocol 1 in its Info.plist, so it would draw no Slopweaver ` +
      "Test icon for --menu-bar — nothing was launched; build a current one, or drop --menu-bar",
    path,
  }),
} as const;

/** A `desktop e2e` flag whose value the walk cannot use. Refused while the flags are read, before anything launches. */
export type DesktopE2eFlagError =
  | { readonly code: "SETTLE_CAP_INVALID"; readonly message: string; readonly text: string }
  | { readonly code: "CONTEXT_UNKNOWN"; readonly message: string; readonly text: string };

/** Build a {@link DesktopE2eFlagError}. */
export const DesktopE2eFlagErrors = {
  contextUnknown: ({ text, contexts }: { text: string; contexts: readonly string[] }): DesktopE2eFlagError => ({
    code: "CONTEXT_UNKNOWN",
    message: `--context must be one of ${contexts.join(", ")}, not "${text}"`,
    text,
  }),
  settleCapInvalid: ({ text, maxSeconds }: { text: string; maxSeconds: number }): DesktopE2eFlagError => ({
    code: "SETTLE_CAP_INVALID",
    message: `--settle-cap must be whole seconds from 1 to ${String(maxSeconds)}, not "${text}"`,
    text,
  }),
} as const;

/** Why one step's action could not be taken. The walk goes on: the step is photographed and judged a failure. */
export type E2eStepBlock =
  | { readonly code: "NO_SIDEBAR_LINK"; readonly message: string; readonly path: string }
  | { readonly code: "PAGE_NEVER_SHOWN"; readonly message: string; readonly path: string }
  | { readonly code: "NO_QUEUE_CARD"; readonly message: string }
  | { readonly code: "QUEUE_EMPTY_LOST"; readonly message: string }
  | { readonly code: "QUEUE_EMPTY_UNPHOTOGRAPHED"; readonly message: string }
  | { readonly code: "PAGE_FIXTURE_MISSING"; readonly message: string }
  | { readonly code: "ACTION_THREW"; readonly message: string }
  | { readonly code: "CONTROLS_UNCLIPPED"; readonly message: string; readonly x: number; readonly y: number }
  | { readonly code: "CONTROLS_UNDRAWN"; readonly message: string; readonly x: number; readonly y: number }
  | { readonly code: "CONTROLS_PROBE_ON_CONTROL"; readonly message: string }
  | { readonly code: "CONTROLS_UNREPORTED"; readonly message: string; readonly ms: number }
  | { readonly code: "NO_TAB_STRIP"; readonly message: string }
  | { readonly code: "QUEUE_NOT_PINNED"; readonly message: string; readonly breaks: readonly string[] }
  | { readonly code: "NEW_TAB_BROKEN"; readonly message: string; readonly breaks: readonly string[] }
  | { readonly code: "ORB_DRAG_BROKEN"; readonly message: string; readonly breaks: readonly string[] }
  | { readonly code: "NO_ORB"; readonly message: string }
  | { readonly code: "QUEUE_SCREEN_MOVED"; readonly message: string }
  | { readonly code: "QUEUE_SCREEN_NOT_HIS"; readonly message: string; readonly breaks: readonly string[] };

/** Build an {@link E2eStepBlock}. */
export const E2eStepBlocks = {
  actionThrew: ({ cause }: { cause: unknown }): E2eStepBlock => ({
    code: "ACTION_THREW",
    message: cause instanceof Error ? cause.message : String(cause),
  }),
  controlsProbeOnControl: (): E2eStepBlock => ({
    code: "CONTROLS_PROBE_ON_CONTROL",
    message:
      "the voice page draws one of its own controls where the clipping fixture's empty point sits, so the check " +
      "could judge nothing — read the step's screenshot for what is drawn at the top left",
  }),
  controlsUnclipped: ({ x, y }: { x: number; y: number }): E2eStepBlock => ({
    code: "CONTROLS_UNCLIPPED",
    message:
      `the voice reported a control box over (${String(x)}, ${String(y)}), where its fixture's scroller clips every ` +
      "row away — main takes the owner's clicks there, so whatever sits under it on the owner's screen stops answering",
    x,
    y,
  }),
  controlsUndrawn: ({ x, y }: { x: number; y: number }): E2eStepBlock => ({
    code: "CONTROLS_UNDRAWN",
    message:
      `no control box the voice reported covers (${String(x)}, ${String(y)}), which its fixture draws — a press ` +
      "there would pass through to whatever is under the window",
    x,
    y,
  }),
  controlsUnreported: ({ ms }: { ms: number }): E2eStepBlock => ({
    code: "CONTROLS_UNREPORTED",
    message:
      `the voice sent main no control report measured after its fixture went in, within ${String(ms)}ms — nothing ` +
      "was judged, so this says the page did not measure, not that it measured wrong",
    ms,
  }),
  newTabBroken: ({ breaks }: { breaks: readonly string[] }): E2eStepBlock => ({
    breaks,
    code: "NEW_TAB_BROKEN",
    message: `the + after the last tab did not open the page chosen off its menu: ${breaks.join("; ")}`,
  }),
  noOrb: (): E2eStepBlock => ({
    code: "NO_ORB",
    message:
      "the voice window drew no orb to drag, or none the instance could place on the screen — read the step's screenshot",
  }),
  noQueueCard: (): E2eStepBlock => ({
    code: "NO_QUEUE_CARD",
    message: "the Queue showed no card to open, and no measured-zero line to say it was empty",
  }),
  noSidebarLink: ({ path }: { path: string }): E2eStepBlock => ({
    code: "NO_SIDEBAR_LINK",
    message: `the sidebar has no link to ${path}`,
    path,
  }),
  noTabStrip: (): E2eStepBlock => ({
    code: "NO_TAB_STRIP",
    message: "no page of the instance drew the tab strip, so which tab was in front could not be read",
  }),
  orbDragBroken: ({ breaks }: { breaks: readonly string[] }): E2eStepBlock => ({
    breaks,
    code: "ORB_DRAG_BROKEN",
    message: `dragging the orb broke:${breaks.join("; ")}`,
  }),
  pageFixtureMissing: (): E2eStepBlock => ({
    code: "PAGE_FIXTURE_MISSING",
    message: "the walk reached the published page step with no fixture page written for it, so it had nothing to open",
  }),
  pageNeverShown: ({ path, after }: { path: string; after: string }): E2eStepBlock => ({
    code: "PAGE_NEVER_SHOWN",
    message: `no page showed ${path} after ${after}`,
    path,
  }),
  queueEmptyLost: (): E2eStepBlock => ({
    code: "QUEUE_EMPTY_LOST",
    message:
      "the Queue's measured-zero line was gone by the time the step was photographed, so the photograph does not " +
      "show it empty — a register began reading again or a card arrived; re-take the step with --only queue-card",
  }),
  queueEmptyUnphotographed: (): E2eStepBlock => ({
    code: "QUEUE_EMPTY_UNPHOTOGRAPHED",
    message:
      "the Queue showed its measured-zero line but the step's photograph could not be taken, and a not-applicable " +
      "step stands on its photograph — check the --out folder is writable and re-take the step with --only queue-card",
  }),
  queueNotPinned: ({ move, breaks }: { move: string; breaks: readonly string[] }): E2eStepBlock => ({
    breaks,
    code: "QUEUE_NOT_PINNED",
    message: `the ${move} move broke the owner's one-Queue-tab steer: ${breaks.join("; ")}`,
  }),
  queueScreenMoved: ({ before, after }: { before: number; after: number }): E2eStepBlock => ({
    code: "QUEUE_SCREEN_MOVED",
    message:
      `the Queue redrew while the voice's window asked for it (${String(before)} card(s) before, ${String(after)} ` +
      "after), so the answer cannot be judged against one screen — re-take the step with --only queue-screen-reading",
  }),
  queueScreenNotOwners: ({ breaks }: { breaks: readonly string[] }): E2eStepBlock => ({
    breaks,
    code: "QUEUE_SCREEN_NOT_HIS",
    message: `the voice's window was not handed the Queue on screen: ${breaks.join("; ")}`,
  }),
} as const;

/**
 * Why one step had nothing to act on, in a state that is legitimate rather than broken. Never a block: a block is a
 * failure, and this is a step that did not run, which the report counts apart from both a pass and a failure.
 */
export type E2eStepNotApplicable = { readonly code: "QUEUE_EMPTY"; readonly message: string };

/** Build an {@link E2eStepNotApplicable}. */
export const E2eStepNotApplicables = {
  queueEmpty: (): E2eStepNotApplicable => ({
    code: "QUEUE_EMPTY",
    message: "the Queue was empty: every register read and none holds a card, so there was no card to open",
  }),
} as const;
