/**
 * `slopweaver browser aim|act` — the effectful shell of the interaction lane; `open` is `./openTab.ts`, `read` is
 * `./readRun.ts`, `close` is `./closeRun.ts`, and `sessions` is `./sessionsRun.ts`, because it reads the machine
 * as well as the records.
 *
 * Every decision is in `./actionCore.ts`, `src/browser/action.ts` and `src/browser/actionExecutor.ts`; the
 * plumbing that reaches a live session and takes one look at its page is `./sessionShell.ts`, shared with
 * `./scrollRun.ts`. This file mints the private workspace the terminal client runs in, writes the session
 * record, and prints.
 *
 * ## Why this is the door rather than a bypass of one
 *
 * Doctrine rule 3 in its own words: *a `slopweaver` verb that drives a browser IS the door.* The route into the owner's Chrome is
 * this verb, not the Claude-in-Chrome extension, which was policed from outside by a
 * `PreToolUse` hook. That hook refuses every one of those calls categorically, so the policing has to
 * move INSIDE the verb — which is where `executeBrowserAction` puts it, between reading the live page and
 * telling the browser to act on it.
 */
import { join } from "node:path";

import { resolveBrowserPagePolicy } from "../../../admit/browserPagePolicy.js";
import { DEFAULT_GATES } from "../../../admit/door.js";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { executeBrowserAction } from "../../../browser/actionExecutor.js";
import { type AimMark, type AimShotResult, planAimShot } from "../../../browser/aimShot.js";
import { photographTheAim } from "../../../browser/aimShotRun.js";
import type { InteractionSession, PageObservation } from "../../../browser/interactionSession.js";
import type { RecordedProfilePort } from "../../../browser/recordedProfile.js";
import type { TerminalClientDeps } from "../../../browser/terminalClient.js";
import { datadogSiteRefusalFor } from "../../../datadog/source.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { sleepSync } from "../../../lib/sleepSync.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type BrowserActOptions, type BrowserAimOptions, renderAim, resolveAimMark } from "./actionCore.js";
import { renderReceipt } from "./actionReceipt.js";
import { actionRequest, actLedgerArtifact } from "./actionRequest.js";
import { actOutputRefusal, citationProblems } from "./actPreflight.js";
import { attributeAim } from "./aimDocument.js";
import { claimLiveSession, fileLook, keptAliveDeps } from "./sessionHold.js";
import { fail, observe, pageWaiver, sessionClientDeps } from "./sessionShell.js";

/** What every session verb here is handed beside its own flags: the home, and the recorded-profile door. */
interface VerbHome {
  readonly home: string;
  readonly profiles: RecordedProfilePort;
}

/**
 * Run `browser aim`: show an element on the page, photograph it there, and act on nothing.
 *
 * Option C in its SPLIT form — a split `browser aim` / `browser act` —
 * for when a session judges an interaction worth looking at before it fires. The fused form
 * is what `act` does on its own; this is the same three client commands with nothing after them.
 *
 * **Not door-routed, and that is the same judgement `browser read` is given.** It performs no write: the
 * client's highlight overlay is `pointer-events: none`, so no event reaches the page (`src/browser/aimShot.ts`
 * carries the citation). A ledger row per look would bury the real writes among them.
 *
 * @param options the validated invocation
 * @param home the state home the session record lives under
 * @param profiles the door the recorded work profile is read through
 * @returns the process exit code
 */
export async function runBrowserAim({
  options,
  home,
  profiles,
}: VerbHome & { options: BrowserAimOptions }): Promise<number> {
  const nowIso = new Date().toISOString();
  const live = claimLiveSession({ home, nowIso, sessionId: options.sessionId });
  if (live.isErr()) {
    return fail({ problems: [live.error.message] });
  }
  const { session } = live.value;
  const deps = (await sessionClientDeps({ home, profiles, session })).map((resolved) =>
    keptAliveDeps({ deps: resolved, home, sessionId: session.id }),
  );
  if (deps.isErr()) {
    return fail({ problems: deps.error });
  }
  // The page is read first for the same reason the executor reads one: the posture printed beside the
  // picture has to be about the page the browser is ON, never about a URL anybody typed or remembered.
  const look = observe({ deps: deps.value, nowIso });
  if (look.isErr()) {
    return fail({ problems: [look.error.message] });
  }
  // `aim` gates its mark on the LIVE page it just read, a strictly better position than `act`'s, which gates on
  // the read the caller cited because it decides before its own admission reads one. Two gates, not made alike.
  const marked = resolveAimMark({
    focus: options.focus,
    policy: resolveBrowserPagePolicy({ url: look.value.url }),
    waived: pageWaiver({ home, nowIso, url: look.value.url }) !== undefined,
  });
  const shot = takeTheAimShot({ deps: deps.value, home, mark: marked.mark, nowIso, options, session });
  const freshRead = `take a fresh \`browser read --session ${session.id}\` before citing anything`;
  if (shot.isErr()) {
    const unfiled = `no aim look was filed, and its scroll or focus may have changed the page — ${freshRead}`;
    return fail({ problems: [shot.error.message, unfiled] });
  }
  const after = lookAfterTheAim({ deps: deps.value, freshRead, home, session });
  if (after.isErr()) {
    return fail({ problems: after.error });
  }
  return printAim({
    ...after.value,
    before: look.value,
    focusSkipped: marked.skipped,
    json: options.json,
    shot: shot.value,
  });
}

/**
 * Look at the page again once the aim's pictures are taken, and file THAT look as the session's latest.
 *
 * The first look gated the mark; this one is what the next `act` cites. Framing the target scrolls the page and
 * a focus is a real page event, so the look taken before them may already be stale by the time the pictures
 * exist — and a session told to "cite this one" must be handed the page as the aim left it.
 *
 * @param deps the client and the session it runs under
 * @param session the live session the look is filed under
 * @param freshRead the clause telling the caller to take a fresh read, for a refusal
 * @param home the state home the session record lives under
 * @returns the filed look and its outline, or every line of the refusal
 */
function lookAfterTheAim({
  deps,
  session,
  freshRead,
  home,
}: {
  deps: TerminalClientDeps;
  session: InteractionSession;
  freshRead: string;
  home: string;
}): Result<{ observation: PageObservation; elements: readonly string[] }> {
  const nowIso = new Date().toISOString();
  const observation = observe({ deps, nowIso });
  if (observation.isErr()) {
    const unfiled = `no aim look was filed: the look after its pictures failed, and its scroll or focus may have changed the page — ${freshRead}`;
    return err([observation.error.message, unfiled]);
  }
  const notFiled = `the aim's pictures were taken, but its look was not filed: the session's latest look is unchanged — ${freshRead}`;
  const filed = fileLook({ home, notFiled, nowIso, observation: observation.value, session });
  if (filed.isErr()) {
    return err(filed.error);
  }
  return ok({ elements: filed.value, observation: observation.value });
}

/**
 * Print what an aim saw: the JSON document, or the aim's lines followed by its outline.
 *
 * The pictures and the posture belong to the page the client named while it took them — the first look's page
 * only when no reply named one; the observation and outline are the look taken after them. Both URLs are
 * printed, in text and `--json`, and `renderAim` names a page that moved in between.
 *
 * @param shot the pictures and what the page said, with the page the client answered them on
 * @param before the look that gated the mark, whose page stands in when no shot reply named one
 * @param observation the look taken after the pictures, filed as the session's latest
 * @param elements the outline of that look, already proven readable and filed
 * @param focusSkipped the line explaining a `--focus` that was asked for and not taken, or `null`
 * @returns the process exit code
 */
function printAim({
  json,
  shot,
  before,
  elements,
  observation,
  focusSkipped,
}: {
  json: boolean;
  shot: AimShotResult;
  before: PageObservation;
  elements: readonly string[];
  observation: PageObservation;
  focusSkipped: string | null;
}): number {
  const { document, notes, pageLabel, policy } = attributeAim({ before, elements, observation, shot });
  const text = (): readonly string[] =>
    renderAim({ focusSkipped, notes, observation, policy, result: shot, url: pageLabel });
  for (const line of json ? [JSON.stringify(document, null, 2)] : [...text(), ...elements]) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * Frame, mark and photograph the element `browser aim` was pointed at.
 *
 * Split out so `runBrowserAim` reads as load, look, mark, print. The `mayFocusOn` predicate is the rail
 * asked one last time about whatever page the client turns out to be answering on: `aim` read the live page
 * a moment ago, and this covers a page that moved between that read and the mark.
 *
 * @param options the validated invocation
 * @param session the live session, whose workspace holds the pictures
 * @param mark how the target is marked, already gated against the page the read found
 * @param nowIso the instant the aim was taken, which names the pictures
 * @param deps the client and the session it runs under
 * @param home the state home a waiver is read from
 * @returns the pictures and what the page said, or the typed failure
 */
function takeTheAimShot({
  options,
  session,
  mark,
  nowIso,
  deps,
  home,
}: {
  options: BrowserAimOptions;
  session: InteractionSession;
  mark: AimMark;
  nowIso: string;
  deps: TerminalClientDeps;
  home: string;
}): ReturnType<typeof photographTheAim> {
  return photographTheAim({
    deps,
    mayFocusOn: (pageUrl) =>
      resolveBrowserPagePolicy({ url: pageUrl }).policy !== "refuse-every-write" ||
      pageWaiver({ home, nowIso, url: pageUrl }) !== undefined,
    plan: planAimShot({
      fullPage: options.fullPage,
      mark,
      ref: options.target,
      stem: join(session.workspace, `aim-${nowIso.replaceAll(":", "-")}`),
    }),
  });
}

/**
 * Run `browser act`: perform one interaction on the session's page and photograph the result.
 *
 * @param options the validated invocation
 * @param home the state home
 * @param profiles the door the recorded work profile is read through
 * @returns the process exit code
 */
export async function runBrowserAct({
  options,
  home,
  profiles,
}: VerbHome & { options: BrowserActOptions }): Promise<number> {
  const misplaced = actOutputRefusal({ cwd: process.cwd(), env: process.env, home, options });
  if (misplaced.length > 0) {
    return fail({ problems: misplaced });
  }
  const nowIso = new Date().toISOString();
  const live = claimLiveSession({ home, nowIso, sessionId: options.sessionId });
  if (live.isErr()) {
    return fail({ problems: [live.error.message] });
  }
  const { session, observation } = live.value;
  const citation = citationProblems({ observation, options });
  if (citation.length > 0) {
    return fail({ problems: citation });
  }
  const deps = (await sessionClientDeps({ home, profiles, session })).map((resolved) =>
    keptAliveDeps({ deps: resolved, home, sessionId: session.id }),
  );
  if (deps.isErr()) {
    return fail({ problems: deps.error });
  }
  // A waiver is looked up against the page the session last READ. A session that has never read one holds
  // no waiver by construction, and an action that could change the page has already been refused above for
  // citing no observation — so there is no page to name here and none is invented.
  const waiver = observation === null ? undefined : pageWaiver({ home, nowIso, url: observation.url });
  // The aim shot's mark is decided HERE, against the read this action cites, because the executor's own
  // admission is the last thing before the dispatch and must stay that way (its measured ordering rule). A
  // focus is a real page interaction, so it is never taken on a page the register refuses writes on unless a
  // waiver names that exact page — `resolveAimMark` carries the whole argument, and an uncited action (only
  // the read-only kinds, which take no aim shot at all) gets no focus rather than an unchecked one.
  const marked = aimMarkFor({ observation, options, waiver });
  // Through the door, because this is a write on a page signed in as the owner — the class rule 3 exists for, and
  // the one the door ledger held no row of. MEASURED: 191,753 ledger rows
  // and not one browser call, so a click taken under the owner's identity left no trace a later reader could find.
  // A read is not routed: `browser read` writes nothing, and routing one would bury the writes among them.
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: doorLedgerPort(),
    perform: () => runOneAction({ deps: deps.value, home, marked, nowIso, observation, options, session, waiver }),
    request: {
      action: { kind: "verb", noun: "browser", verb: "act" },
      artifact: actLedgerArtifact({ observation, options }),
      meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
    },
  });
  if (!routed.performed) {
    return fail({ problems: notPerformedLines({ command: "slopweaver browser act", through: routed }) });
  }
  return routed.result;
}

/**
 * How this action's aim shot marks its target, decided against the read the action cites.
 *
 * An action that cites no read gets a highlight and never a focus. That is not a fallback dressed up as one:
 * the only kinds that may go uncited are the ones that take no aim shot at all, so the arm is unreachable
 * from the verb and exists so that a caller building a request another way cannot reach a page's focus
 * handlers with nothing having judged the page.
 *
 * @param options the validated invocation
 * @param observation the session's latest look, or `null` when it has never read one
 * @param waiver the scoped waiver this session holds for that page, when it holds one
 * @returns the mark, and the line to print when a `--focus` was asked for and not taken
 * @internal
 */
export function aimMarkFor({
  options,
  observation,
  waiver,
}: {
  options: BrowserActOptions;
  observation: PageObservation | null;
  waiver: { readonly url: string; readonly reason: string; readonly expiresAtIso: string } | undefined;
}): { readonly mark: AimMark; readonly skipped: string | null } {
  if (observation === null) {
    return { mark: "highlight", skipped: null };
  }
  return resolveAimMark({
    focus: options.focus,
    policy: resolveBrowserPagePolicy({ url: observation.url }),
    waived: waiver !== undefined,
  });
}

/**
 * The refusal for a `navigate` whose destination is on the wrong Datadog site, judged before the client is
 * asked anything — the same rule `browser open` applies to the first page.
 *
 * @param options the validated invocation, whose `value` is a navigate's destination
 * @param home the state home the organisation's Datadog site is read from
 * @returns the refusal line, or `undefined` when this action is no navigate or its destination is allowed
 */
function navigateSiteRefusal({ options, home }: { options: BrowserActOptions; home: string }): string | undefined {
  if (options.kind !== "navigate" || options.value === undefined) {
    return undefined;
  }
  return datadogSiteRefusalFor({ command: "slopweaver browser act --do navigate", home, url: options.value });
}

/**
 * Perform one interaction and print what it did — the door's own `perform` thunk.
 *
 * @param options the validated invocation
 * @param session the live session
 * @param observation the session's latest look at the page
 * @param deps the client and the session it runs under
 * @param waiver the scoped waiver for this exact page, when there is one
 * @param nowIso the instant this action is judged at
 * @param home the state home the organisation's Datadog site is read from
 * @param marked how the aim shot marks its target, and what to say about a `--focus` that was not taken
 * @returns the process exit code
 */
function runOneAction({
  options,
  session,
  observation,
  deps,
  waiver,
  nowIso,
  home,
  marked,
}: {
  options: BrowserActOptions;
  session: InteractionSession;
  observation: PageObservation | null;
  deps: TerminalClientDeps;
  waiver: { readonly url: string; readonly reason: string; readonly expiresAtIso: string } | undefined;
  nowIso: string;
  home: string;
  marked: { readonly mark: AimMark; readonly skipped: string | null };
}): number {
  const wrongSite = navigateSiteRefusal({ home, options });
  if (wrongSite !== undefined) {
    logger.error({ msg: wrongSite });
    return EXIT_ERROR;
  }
  const receipt = executeBrowserAction({
    deps,
    now: () => new Date().toISOString(),
    request: actionRequest({ aimMark: marked.mark, nowIso, observation, options, session }),
    sleep: (ms) => {
      sleepSync({ ms });
    },
    waiver,
  });
  if (receipt.isErr()) {
    logger.error({ msg: receipt.error.message });
    return EXIT_ERROR;
  }
  // No record write follows: every client command the action ran touched the session first (`keptAliveDeps`), and
  // a write here, unlocked and stamped with the verb's load instant, could only overwrite a later command's touch
  // and hand a reap an idle verdict on a session still in use.
  if (options.json) {
    const freshLook = `slopweaver browser read --session ${session.id}`;
    logger.out({ line: JSON.stringify({ ...receipt.value, freshLook }, null, 2) });
  } else {
    for (const line of renderReceipt({ focusSkipped: marked.skipped, receipt: receipt.value, sessionId: session.id })) {
      logger.out({ line });
    }
  }
  return EXIT_OK;
}
