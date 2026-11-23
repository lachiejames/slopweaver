/**
 * How the call leg drives and reads the voice window of a test instance: which calls its pages opened, its controls
 * and its transcript rows, over a {@link VoiceView} — Playwright's page, or after a renderer crash the window's own web
 * contents (`./e2eCallView.ts`). The instance-level acts — the heap, a renderer crash, finding the reloaded page — are
 * `./e2eCallInstance.ts`.
 *
 * The selectors are the console's own accessible names: Talk, mute and hang-up from `site/lib/messengerMode.ts` and
 * `site/lib/stageRail.ts` (mute exists only once the call has its live session, so it is the live signal), the rows
 * from `site/components/voice/StageHistory.tsx`, the typed box from `site/components/voice/MessengerComposer.tsx`, the
 * session details button from `site/lib/callTrays.ts`.
 */
import type { ElectronApplication, Page } from "playwright-core";

import { err, ok, type Result } from "#lib/result.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import { addOnce, type E2eRow, offerCallIdOf, transcriptCallIdOf } from "../../../desktop/e2eCallRows.js";
import { VOICE_ORB } from "../../../desktop/e2ePlan.js";
import type { OnCallHoldError } from "../../../desktop/onCallHold.js";
import type { VoiceView } from "./e2eCallView.js";
import { consolePathOfUrl, pause } from "./e2ePage.js";

/** The call card's Talk control. */
const TALK = 'button[aria-label="talk"]';
/** Mute, drawn only once the call has its live session. */
const LIVE = 'button[aria-label="mute"], button[aria-label="unmute"]';
/** Hang-up, drawn from the press on, connecting included. */
const HANG_UP = 'button[aria-label="hang up"]';
/**
 * The orb alone while a call is up: a click into another app folds the card to the orb without ending the call
 * (`site/components/voice/VoiceWidget.tsx`), and the orb's label then leads with the call's headline
 * (`messengerOrbLabel`, `site/lib/messengerMode.ts`). Measured: a fold 230s into `call-holds` read as a
 * drop while the transcript shows the owner speaking and the voice answering 25s later; reproduce by focusing another app
 * during `--call --only call-holds` and reading `talk calls`.
 */
const FOLDED_CALL = 'button[aria-label*=": open the voice"]';
/** The typed box, its send while a call is up, and its send with none (`site/lib/messengerMode.ts`). */
const MESSAGE = 'textarea[aria-label="message"]';
const SEND_TO_CALL = 'button[aria-label="send to the call"]';
const SEND_TYPED = 'button[aria-label="send"]';
/** The session details tray's button, closed and open, and its rows while one is running. */
const DETAILS = 'button[aria-label="session details"]';
const CLOSE_DETAILS = 'button[aria-label="close session details"]';
const SESSION = 'section[aria-label="what the voice did this call"]';

/** How often a wait looks. */
const POLL_MS = 500;

/** The calls one scenario's pages opened, filled by listeners as the requests pass. */
export interface CallTracker {
  readonly planCallIds: string[];
  readonly transcriptCallIds: string[];
  readonly pageErrors: string[];
}

/**
 * An empty tracker, which one scenario keeps across a relaunch.
 *
 * @returns the tracker
 */
export function newTracker(): CallTracker {
  return { pageErrors: [], planCallIds: [], transcriptCallIds: [] };
}

/**
 * Start recording into a tracker which calls every page of an instance opens, and what each page throws.
 *
 * @param app the instance
 * @param tracker what the listeners fill
 */
export function trackCalls({ app, tracker }: { app: ElectronApplication; tracker: CallTracker }): void {
  const context = app.context();
  context.on("request", (request) => {
    if (consolePathOfUrl({ url: request.url() }) === "/api/talk/transcript") {
      addOnce({ id: transcriptCallIdOf({ body: request.postData() }), into: tracker.transcriptCallIds });
    }
  });
  context.on("response", (response) => {
    if (consolePathOfUrl({ url: response.url() }) === "/api/talk/offer" && response.ok()) {
      void response
        .json()
        .then((body: unknown) => offerCallIdOf({ body }))
        .then((id) => {
          addOnce({ id, into: tracker.planCallIds });
          return id;
        })
        .catch(() => undefined);
    }
  });
  const watched = new WeakSet<Page>();
  const watchAll = (): void => {
    for (const page of context.pages().filter((one) => !watched.has(one))) {
      watched.add(page);
      page.on("pageerror", (error) => {
        tracker.pageErrors.push(`${page.url()}: ${error.message}`);
      });
    }
  };
  context.on("page", watchAll);
  watchAll();
}

/**
 * Wait until a test holds, up to a cap, timed by the monotonic clock: on the wall clock a forward adjustment ended the
 * wait with almost the whole cap unspent.
 *
 * @param capMs how long
 * @param test the look, true once it holds
 * @returns whether it held before the cap
 */
export async function until({ capMs, test }: { capMs: number; test: () => Promise<boolean> }): Promise<boolean> {
  const deadline = performance.now() + capMs;
  for (;;) {
    if (await test()) {
      return true;
    }
    if (performance.now() > deadline) {
      return false;
    }
    await pause({ ms: POLL_MS });
  }
}

/**
 * Whether the voice window has loaded and shows its controls: the typed box, the orb or Talk.
 *
 * @param view the voice window
 * @returns whether it does
 */
export async function voiceAnswers({ view }: { view: VoiceView }): Promise<boolean> {
  return (await view.ready()) && view.shows({ selector: `${MESSAGE}, ${VOICE_ORB}, ${TALK}` });
}

/**
 * Bring back the card a fold hid while a call is up, the press the owner would make on the orb, so the call's controls are
 * read rather than their absence. Not undone: a screen region the voice lifted, which keeps the orb alone until it
 * drops (`voiceWindowShown`, `site/lib/voiceWindow.ts`) — the voice lifts one only on the owner's ask, and no scenario's
 * prompt asks.
 *
 * @param view the voice window
 */
async function unfold({ view }: { view: VoiceView }): Promise<void> {
  if (await view.shows({ selector: FOLDED_CALL })) {
    await view.click({ selector: FOLDED_CALL });
    await until({ capMs: 3000, test: async () => view.shows({ selector: HANG_UP }) });
  }
}

/**
 * Whether the call is live: its mute control shows, once a fold is undone.
 *
 * @param view the voice window
 * @returns whether it is
 */
export async function isLive({ view }: { view: VoiceView }): Promise<boolean> {
  if (await view.shows({ selector: LIVE })) {
    return true;
  }
  await unfold({ view });
  return view.shows({ selector: LIVE });
}

/**
 * Whether a press is connecting: hang-up shows and mute does not yet.
 *
 * @param view the voice window
 * @returns whether it is
 */
export async function isConnecting({ view }: { view: VoiceView }): Promise<boolean> {
  await unfold({ view });
  return (await view.shows({ selector: HANG_UP })) && !(await isLive({ view }));
}

/**
 * Whether no call is up: neither hang-up nor mute shows, nor the orb a fold left with a call behind it.
 *
 * @param view the voice window
 * @returns whether it is idle
 */
export async function isIdle({ view }: { view: VoiceView }): Promise<boolean> {
  return !(await view.shows({ selector: `${HANG_UP}, ${LIVE}, ${FOLDED_CALL}` }));
}

/**
 * Press Talk, opening the call card from the orb first when it is closed.
 *
 * @param view the voice window
 * @param interrupted whether an interrupt has landed, asked right before the click: once it has, no call is placed
 * @param onCall whether the owner is on a call, asked right before the click, after the wait for Talk: a hold places no call
 * @param start starts the call some other way than the click, once Talk is enabled and every check above has passed —
 *   `launcher-voice`'s `slopweaver://voice`; absent, Talk is clicked
 * @returns nothing once pressed, or the hold, or that no enabled Talk control showed
 */
export async function pressTalk({
  interrupted,
  onCall,
  start,
  view,
}: {
  interrupted: () => boolean;
  onCall: () => OnCallHoldError | undefined;
  start?: () => Promise<void>;
  view: VoiceView;
}): Promise<Result<void, E2eCallError | OnCallHoldError>> {
  if (!(await view.shows({ selector: TALK })) && (await view.shows({ selector: VOICE_ORB }))) {
    await view.click({ selector: VOICE_ORB });
  }
  const ready = await until({ capMs: 15_000, test: async () => view.enabled({ selector: TALK }) });
  if (interrupted()) {
    return err(E2eCallErrors.interrupted());
  }
  // Read here rather than before the wait above: Talk can take 15 seconds to enable (Codex oncall-r4).
  const held = onCall();
  if (held !== undefined) {
    return err(held);
  }
  if (ready && start !== undefined) {
    await start();
    return ok(undefined);
  }
  if (!ready || !(await view.click({ selector: TALK }))) {
    return err(E2eCallErrors.controlMissing({ control: "talk" }));
  }
  return ok(undefined);
}

/**
 * Hang up the call, when its control shows.
 *
 * @param view the voice window
 * @returns whether a hang-up was pressed
 */
export async function hangUp({ view }: { view: VoiceView }): Promise<boolean> {
  await unfold({ view });
  return (await view.shows({ selector: HANG_UP })) && view.click({ selector: HANG_UP });
}

/**
 * The live call's final rows, in order.
 *
 * @param view the voice window
 * @returns the rows, none on a page that cannot be read
 */
export async function liveRows({ view }: { view: VoiceView }): Promise<readonly E2eRow[]> {
  return view.rows();
}

/**
 * The live rows standing at go-live, from ONE read taken straight after it, cut off at the cap. A failed read is never
 * taken as none, which would count every row standing at go-live as new, and never
 * read again, since a later read would take rows landing after go-live as standing.
 * The snapshot reads every live row, so a row already on screen but still being heard is seen: it would settle later
 * and read as new, so a baseline holding one is none at all.
 *
 * @param view the voice window
 * @param capMs the most the read may take
 * @returns the settled rows, `undefined` when that read failed, did not finish by the cap, or saw a row still being heard
 */
export async function goLiveBaseline({
  view,
  capMs,
}: {
  view: VoiceView;
  capMs: number;
}): Promise<readonly E2eRow[] | undefined> {
  const seen: { rows?: readonly E2eRow[] } = {};
  const deadline = performance.now() + capMs;
  await withinCap({
    capMs,
    run: async () => {
      const read = await view.readLive();
      // A read returning past the cap is unseen, even one that beat the cap's timer.
      if (read?.unsettled === 0 && performance.now() < deadline) {
        seen.rows = read.rows;
      }
    },
  });
  return seen.rows;
}

/**
 * Run a wait, cut off at the cap however long one read inside it hangs: `until` checks its cap only between reads, so
 * a page read that never resolves would hold it forever. A wait that throws ends here.
 *
 * @param capMs the most it runs
 * @param run the wait
 */
export async function withinCap({ capMs, run }: { capMs: number; run: () => Promise<void> }): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, capMs);
  });
  try {
    await Promise.race([run().catch(() => undefined), capped]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Type into the live call and send it.
 *
 * @param view the voice window
 * @param text what to type
 * @returns nothing once sent and the box cleared, else that a control was missing
 */
export async function typeIntoCall({
  view,
  text,
}: {
  view: VoiceView;
  text: string;
}): Promise<Result<void, E2eCallError>> {
  return (await typeAndSend({ send: { control: "send to the call", selector: SEND_TO_CALL }, text, view })).map(
    () => undefined,
  );
}

/**
 * Type into the box with no call up and send it, which opens a typed conversation (`site/components/voice/useTypedTalk.ts`):
 * the surface a measured call's Queue search ran on.
 *
 * @param view the voice window
 * @param text what to type
 * @param clear read once more after typing and before the press; a problem it names empties the box unsent
 * @returns when that last read began, else that a control was missing or the read was not clear
 */
export async function typeToVoice({
  view,
  text,
  clear,
}: {
  view: VoiceView;
  text: string;
  clear: () => Promise<string | undefined>;
}): Promise<Result<{ readonly clearReadMs: number }, E2eCallError>> {
  return typeAndSend({ clear, send: { control: "send", selector: SEND_TYPED }, text, view });
}

/**
 * Fill the box, press one send control once it is enabled, and wait for the box to clear.
 *
 * @param send the control to press, by selector and by the name a failure gives it
 * @param clear when given, read just before the press; a problem it names empties the box unsent
 * @returns when that last read began (the fill's instant with none given), else that a control was missing or the
 * read was not clear
 */
async function typeAndSend({
  view,
  text,
  send,
  clear,
}: {
  view: VoiceView;
  text: string;
  send: { readonly selector: string; readonly control: string };
  clear?: () => Promise<string | undefined>;
}): Promise<Result<{ readonly clearReadMs: number }, E2eCallError>> {
  if (!(await view.shows({ selector: MESSAGE })) || !(await view.fill({ selector: MESSAGE, text }))) {
    return err(E2eCallErrors.controlMissing({ control: "message" }));
  }
  if (!(await until({ capMs: 5000, test: async () => view.enabled({ selector: send.selector }) }))) {
    return err(E2eCallErrors.controlMissing({ control: send.control }));
  }
  // Typing takes seconds, so what was clear before it is read again with nothing left between the read and the press.
  const clearReadMs = Date.now();
  const problem = clear === undefined ? undefined : await clear();
  if (problem !== undefined) {
    await view.fill({ selector: MESSAGE, text: "" });
    return err(E2eCallErrors.sendNotClear({ detail: problem }));
  }
  await view.click({ selector: send.selector });
  const cleared = await until({
    capMs: 15_000,
    test: async () => (await view.value({ selector: MESSAGE })) === "",
  });
  return cleared ? ok({ clearReadMs }) : err(E2eCallErrors.controlMissing({ control: "a cleared message box" }));
}

/**
 * Open the session details tray, which takes the transcript's place in the call card while it is open.
 *
 * @param view the voice window
 * @returns nothing once open, else that its button was missing
 */
export async function openSessionDetails({ view }: { view: VoiceView }): Promise<Result<void, E2eCallError>> {
  await unfold({ view });
  if (!(await view.shows({ selector: DETAILS }))) {
    return err(E2eCallErrors.controlMissing({ control: "session details" }));
  }
  await view.click({ selector: DETAILS });
  const open = await until({ capMs: 5000, test: async () => view.shows({ selector: SESSION }) });
  return open ? ok(undefined) : err(E2eCallErrors.controlMissing({ control: "the session details tray" }));
}

/**
 * Close the session details tray, so the transcript shows again (`site/components/voice/CallTrayBody.tsx`: a tray
 * replaces the card's messenger while it is open). A fold during a long task hides the card, so it is undone first,
 * and a tray the unfold did not bring back is already closed. Measured: `long-task-mid-call` blocked on a
 * folded card; reproduce by focusing another app during
 * `--call --only long-task-mid-call`.
 *
 * @param view the voice window
 * @returns nothing once closed, else that its button was missing
 */
export async function closeSessionDetails({ view }: { view: VoiceView }): Promise<Result<void, E2eCallError>> {
  await unfold({ view });
  if (!(await view.shows({ selector: SESSION }))) {
    return ok(undefined);
  }
  if (!(await view.click({ selector: CLOSE_DETAILS }))) {
    return err(E2eCallErrors.controlMissing({ control: "close session details" }));
  }
  const closed = await until({ capMs: 5000, test: async () => !(await view.shows({ selector: SESSION })) });
  return closed ? ok(undefined) : err(E2eCallErrors.controlMissing({ control: "a closed session details tray" }));
}

/**
 * How many of the tray's work rows are running now.
 *
 * @param view the voice window
 * @returns the count, zero on a page that cannot be read
 */
export async function runningWork({ view }: { view: VoiceView }): Promise<number> {
  return view.count({ selector: `${SESSION} [data-stale]`, text: "Running" });
}
