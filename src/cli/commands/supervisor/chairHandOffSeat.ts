/**
 * The seating half of `supervisor hand-off` (`./chairHandOffRun.ts`), every step re-checked and journalled, after the
 * close (`./chairHandOffClose.ts`): reserve the successor slug, write its doc exclusively,
 * journal `successor-opening` and spawn, then record `successor-opened`. A run resumed after `successor-opening` with
 * no `successor-opened` RECONCILES FIRST, and spawns again only when neither the ledger nor the app names a session
 * for the slug; an app that cannot be asked spawns nothing (exit 4). A spawn that reports a failure is checked against
 * the app the same way before it is journalled as one.
 */

import { parseIsoMs } from "#lib/date.js";
import { boundedReason } from "../../../fleet/recoveryCheck.js";
import { nextSuccessorSlug, recoverySuccessorDoc } from "../../../fleet/recoverySuccessor.js";
import { createSuccessorDocAt, occupiedSuccessorSlugs } from "../../../fleet/recoverySuccessorStore.js";
import { LAUNCH_SETTLED_AFTER_MS } from "../../../sessionHarness/appLaunch.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { appPinLabel } from "../../../supervisor/appPin.js";
import type { ChairHandOffStarted } from "../../../supervisor/chairHandOff.js";
import { readEpisode } from "../../../supervisor/chairHandOffStore.js";
import { withoutAddresses } from "../../../supervisor/chairWatch.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type Ctx, journal, recheck, say, stop, VERB } from "./chairHandOffContext.js";
import { launchChairSuccessor } from "./chairSuccessorLaunch.js";

/** How many slugs one episode reserves before it stops: each lost only to a writer that took the number first. */
const MAX_SLUG_RESERVATIONS = 5;

/** The step a seating move takes: the shared context, the episode's opening event and the reserved slug. */
interface SeatStep {
  readonly ctx: Ctx;
  readonly started: ChairHandOffStarted;
  readonly slug: string;
}

/**
 * Reserve the next successor slug, never one this episode already lost.
 *
 * @returns the exit code to stop with, or undefined once a slug is reserved
 */
export function reserveSlug({ ctx }: { ctx: Ctx }): number | undefined {
  const events = readEpisode({ episodeId: ctx.episodeId, home: ctx.options.home });
  const reserved = events.isOk()
    ? events.value.filter((event) => event.kind === "slug-reserved").map((event) => event.slug)
    : [];
  if (reserved.length >= MAX_SLUG_RESERVATIONS) {
    return stop({
      ctx,
      exit: EXIT_ERROR,
      why: `refused: another writer took each of ${String(reserved.length)} successor numbers first; re-run to try again`,
    });
  }
  const slug = nextSuccessorSlug({ occupied: [...occupiedSuccessorSlugs({ home: ctx.options.home }), ...reserved] });
  if (!journal({ ctx, event: { atIso: ctx.deps.nowIso(), kind: "slug-reserved", slug } })) {
    return EXIT_ERROR;
  }
  say({ ctx, line: `reserved successor slug ${slug}` });
  return undefined;
}

/**
 * The reasons the successor doc carries: the watch's, then the owner's `--now` and `--plan` overrides, each named.
 *
 * @param started the episode's opening event
 * @returns the reasons, in that order
 */
export function successorDocReasons({ started }: { started: ChairHandOffStarted }): readonly string[] {
  const reasons = [...started.reasons];
  if (started.basis.kind === "now") {
    reasons.push(`the owner's --now: ${started.basis.reason}`);
  }
  if (started.planOverride !== undefined) {
    reasons.push(`successor plan ${started.planOverride.alias} by --plan: ${started.planOverride.reason}`);
  }
  return reasons;
}

/**
 * Write the successor doc at the reserved slug, exclusively.
 *
 * @returns the exit code to stop with, or undefined once the doc is written or the next slug reserved
 */
export function writeDoc({ ctx, started, slug }: SeatStep): number | undefined {
  const { home } = ctx.options;
  const repo = ctx.deps.repo({ home });
  if (repo.isErr()) {
    return stop({ ctx, exit: EXIT_ERROR, why: `refused: no main checkout to seat the successor in (${repo.error})` });
  }
  const events = readEpisode({ episodeId: ctx.episodeId, home });
  const note = events.isOk() ? events.value.find((event) => event.kind === "note-arrived") : undefined;
  const text = recoverySuccessorDoc({
    handOff: {
      episodeId: ctx.episodeId,
      note: note?.kind === "note-arrived" ? note.note : undefined,
      noteWaitSeconds: started.noteWaitSeconds,
      reasons: successorDocReasons({ started }),
    },
    handoversDir: stateHomePaths({ home }).handovers,
    predecessor: { label: appPinLabel({ appSessionId: ctx.predecessor }), slug: started.predecessorSlug },
    repo: repo.value,
    slug,
    writtenAtIso: ctx.deps.nowIso(),
  });
  const created = createSuccessorDocAt({ home, slug, text });
  if (created.isErr()) {
    return stop({
      ctx,
      exit: EXIT_ERROR,
      why: `refused: the successor doc would not write (${created.error.message})`,
    });
  }
  if (created.value.kind === "taken" && !created.value.existing.includes(`(\`${ctx.episodeId}\`)`)) {
    say({ ctx, line: `another writer took ${slug} first; reserving the next number` });
    return reserveSlug({ ctx });
  }
  journal({ ctx, event: { atIso: ctx.deps.nowIso(), kind: "doc-written", path: created.value.path, slug } });
  const carried =
    note === undefined ? ", with no note: it rebuilds from files" : ", carrying the outgoing chair's note";
  say({ ctx, line: `wrote the successor doc ${created.value.path}${carried}` });
  return undefined;
}

/** What the app says runs under a successor slug: one session, none, or it could not be asked. */
type AppSeat =
  | { readonly kind: "running"; readonly sessionId: string }
  | { readonly kind: "none" }
  | { readonly kind: "unasked"; readonly why: string };

/**
 * Ask the app whether a session launched from the slug is running — the ledger row a spawn writes can be missing
 * after a crash between the app opening the session and the row landing, so its absence proves nothing opened.
 *
 * @param slug the successor slug, which the app reports as each session's ledger key
 * @returns the newest reachable session under the slug, none, or why the app could not be asked
 */
async function appSeatOf({ ctx, slug }: { ctx: Ctx; slug: string }): Promise<AppSeat> {
  const listed = await ctx.harness.list();
  if (listed.isErr()) {
    return { kind: "unasked", why: listed.error.message };
  }
  const running = listed.value.findLast((one) => one.description === slug);
  if (running === undefined) {
    return { kind: "none" };
  }
  return { kind: "running", sessionId: running.id };
}

/**
 * When the app is certain to be done with the episode's last launch from this slug, while that is still ahead. A
 * launch request outlives a client that crashed mid-request, so until then a session list naming nothing under the
 * slug proves nothing; past it, the app has registered that launch's session or ended it unsettled.
 */
function launchSettlesAtIso({ ctx, slug }: { ctx: Ctx; slug: string }): string | undefined {
  const events = readEpisode({ episodeId: ctx.episodeId, home: ctx.options.home });
  if (events.isErr()) {
    return undefined;
  }
  const opening = events.value.findLast((event) => event.kind === "successor-opening" && event.slug === slug);
  const openedMs = opening === undefined ? undefined : parseIsoMs({ tsIso: opening.atIso });
  const nowMs = parseIsoMs({ tsIso: ctx.deps.nowIso() });
  if (openedMs === undefined || nowMs === undefined || nowMs >= openedMs + LAUNCH_SETTLED_AFTER_MS) {
    return undefined;
  }
  return new Date(openedMs + LAUNCH_SETTLED_AFTER_MS).toISOString();
}

/** Journal and print the successor the app already runs from the slug: nothing more is spawned. */
function seatedFromApp({ ctx, slug, sessionId, before }: SeatStep & { sessionId: string; before: string }): number {
  journal({ ctx, event: { atIso: ctx.deps.nowIso(), kind: "successor-opened", sessionId, slug } });
  say({
    ctx,
    line: `reconciled: ${before}, but the app runs the successor app:${sessionId} from ${slug}; nothing more spawned`,
  });
  return EXIT_OK;
}

/** Spawn the successor and record what it opened. */
async function launch({ ctx, started, slug }: SeatStep): Promise<number> {
  const opened = await launchChairSuccessor({
    alias: started.alias,
    home: ctx.options.home,
    runSpawn: ctx.deps.spawn,
    slug,
    vendor: started.vendor,
  });
  if (opened.isErr()) {
    const why = boundedReason({ text: withoutAddresses({ text: opened.error.reason }) });
    const app = await appSeatOf({ ctx, slug });
    if (app.kind === "running") {
      return seatedFromApp({
        before: `the spawn reported no successor (${why})`,
        ctx,
        sessionId: app.sessionId,
        slug,
        started,
      });
    }
    if (app.kind === "unasked") {
      return stop({
        ctx,
        exit: EXIT_DEFERRED,
        why: `not yet: the spawn reported no successor (${why}) and the app could not be asked whether one opened (${app.why}); nothing more was spawned — re-run \`slopweaver ${VERB}\` once the app answers: it reconciles first`,
      });
    }
    journal({ ctx, event: { atIso: ctx.deps.nowIso(), kind: "failed", resumable: true, why } });
    say({
      ctx,
      line: `the successor did not open (${why}); re-run \`slopweaver ${VERB}\`: it reconciles first and seats once`,
    });
    return EXIT_ERROR;
  }
  journal({
    ctx,
    event: { atIso: ctx.deps.nowIso(), kind: "successor-opened", sessionId: opened.value.sessionId, slug },
  });
  say({
    ctx,
    line: `seated the successor app:${opened.value.sessionId} from ${slug} on plan ${started.alias}; it takes the pin with \`cmux takeover\``,
  });
  return EXIT_OK;
}

/**
 * Open the successor: re-checked, journalled before the spawn so a crash mid-spawn reconciles.
 *
 * @returns the exit code
 */
export async function openSuccessor({ ctx, started, slug }: SeatStep): Promise<number> {
  const refused = recheck({ before: "seating the successor", ctx, started });
  if (refused !== undefined) {
    return stop({ ctx, exit: refused.exit, why: refused.line });
  }
  if (!journal({ ctx, event: { atIso: ctx.deps.nowIso(), kind: "successor-opening", slug } })) {
    return EXIT_ERROR;
  }
  say({ ctx, line: `opening the successor from ${slug} on plan ${started.alias} (${started.vendor})` });
  return launch({ ctx, slug, started });
}

/**
 * A spawn may already have run: find its ledger row, then ask the app, before spawning again. A ledger with no row
 * is not proof that nothing opened, so a successor the app runs under the slug is recorded instead of a second one
 * spawned, and an app that cannot be asked stops the run deferred with nothing spawned.
 *
 * @returns the exit code
 */
export async function reconcile({ ctx, started, slug }: SeatStep): Promise<number> {
  const rows = foldSessions(parseSessionLog({ text: readSessionLogText({ home: ctx.options.home }) }));
  const row = rows.findLast((one) => one.slug === slug && one.harness === "app" && one.status === "open");
  if (row?.sessionId !== undefined) {
    journal({ ctx, event: { atIso: ctx.deps.nowIso(), kind: "successor-opened", sessionId: row.sessionId, slug } });
    say({ ctx, line: `reconciled: the successor app:${row.sessionId} already opened from ${slug}; nothing spawned` });
    return EXIT_OK;
  }
  const app = await appSeatOf({ ctx, slug });
  if (app.kind === "running") {
    return seatedFromApp({
      before: `the ledger names no session from ${slug}`,
      ctx,
      sessionId: app.sessionId,
      slug,
      started,
    });
  }
  if (app.kind === "unasked") {
    return stop({
      ctx,
      exit: EXIT_DEFERRED,
      why: `not yet: the ledger names no session from ${slug} and the app could not be asked whether the earlier spawn opened one (${app.why}); nothing was spawned — re-run \`slopweaver ${VERB}\` once the app answers`,
    });
  }
  const settling = launchSettlesAtIso({ ctx, slug });
  if (settling !== undefined) {
    return stop({
      ctx,
      exit: EXIT_DEFERRED,
      why: `not yet: the earlier launch from ${slug} may still be in flight in the app until ${settling}, and the app lists no session from it so far; nothing was spawned — re-run \`slopweaver ${VERB}\` after then`,
    });
  }
  const refused = recheck({ before: "seating the successor again", ctx, started });
  if (refused !== undefined) {
    return stop({ ctx, exit: refused.exit, why: refused.line });
  }
  say({
    ctx,
    line: `reconciled: neither the ledger nor the app names a session from ${slug}, so the earlier spawn did not open one; seating it now`,
  });
  return launch({ ctx, slug, started });
}
