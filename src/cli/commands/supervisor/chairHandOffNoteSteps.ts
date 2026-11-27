/**
 * The note half of `supervisor hand-off` (`./chairHandOffRun.ts`): ask the outgoing chair for its note with a `later`
 * message (delivered once its turn ends), then wait up to its deadline and record which settled it — the note's text,
 * recorded by `hand-off note`, or that none arrived. Both settle under the journal's lock, so the first one wins.
 */
import { boundedReason } from "../../../fleet/recoveryCheck.js";
import { err, type Result } from "../../../lib/result.js";
import type { HarnessTarget } from "../../../sessionHarness/sessionHarness.js";
import { appPinLabel } from "../../../supervisor/appPin.js";
import {
  type ChairHandOffEvent,
  type ChairHandOffStarted,
  nextStep,
  noteRequestText,
} from "../../../supervisor/chairHandOff.js";
import { appendEpisodeEventIf, episodeNotePath, readEpisode } from "../../../supervisor/chairHandOffStore.js";
import { withoutAddresses } from "../../../supervisor/chairWatch.js";
import { EXIT_DEFERRED, EXIT_ERROR } from "../../exitCodes.js";
import { type Ctx, journal, say } from "./chairHandOffContext.js";

/** The longest one sleep of the note wait, so a note that arrives is seen within this. */
const NOTE_POLL_MS = 5_000;

/** Refuse a `note-missing` once the note is settled either way: only an episode still waiting takes one. */
function stillAwaiting({ events }: { events: readonly ChairHandOffEvent[] }): string | undefined {
  if (nextStep({ events }).kind === "await-note") {
    return undefined;
  }
  return "the note is already settled";
}

/**
 * When the note wait ends: the instant it was asked, plus the episode's wait.
 *
 * @param atIso when the note was asked for
 * @param waitSeconds how long the episode waits for it
 * @returns the deadline as an ISO instant
 */
export function noteDeadlineIso({ atIso, waitSeconds }: { atIso: string; waitSeconds: number }): string {
  return new Date(Date.parse(atIso) + waitSeconds * 1_000).toISOString();
}

/** Send the note request. */
async function sendRequest({
  ctx,
  notePath,
  started,
  target,
}: {
  ctx: Ctx;
  notePath: string;
  started: ChairHandOffStarted;
  target: HarnessTarget;
}): Promise<Result<unknown, { readonly message: string }>> {
  const { namedHome } = ctx.options;
  const text = noteRequestText({
    episodeId: ctx.episodeId,
    homeFlag: namedHome === undefined ? "" : ` --home ${namedHome}`,
    notePath,
    reasons: started.reasons,
    waitSeconds: started.noteWaitSeconds,
  });
  return ctx.harness.message({ delivery: "later", target, text });
}

/**
 * Ask the outgoing chair for its note: journalled first, so a resumed run never asks twice.
 *
 * @param started the episode's opening event, carrying the reasons and the wait
 * @returns the exit code to stop with, or undefined to continue
 */
export async function askNote({
  ctx,
  started,
}: {
  ctx: Ctx;
  started: ChairHandOffStarted;
}): Promise<number | undefined> {
  const { home } = ctx.options;
  const notePath = episodeNotePath({ episodeId: ctx.episodeId, home });
  const atIso = ctx.deps.nowIso();
  const deadlineIso = noteDeadlineIso({ atIso, waitSeconds: started.noteWaitSeconds });
  if (!journal({ ctx, event: { atIso, deadlineIso, kind: "note-asked", notePath } })) {
    return EXIT_ERROR;
  }
  const label = appPinLabel({ appSessionId: ctx.predecessor });
  const target = await ctx.harness.resolve({ handle: label });
  let sent: Result<unknown, { readonly message: string }> = err(target.isErr() ? target.error : { message: "" });
  if (target.isOk()) {
    sent = await sendRequest({ ctx, notePath, started, target: target.value });
  }
  if (sent.isErr()) {
    const why = boundedReason({
      text: `the note request did not reach ${label}: ${withoutAddresses({ text: sent.error.message })}`,
    });
    appendEpisodeEventIf({
      episodeId: ctx.episodeId,
      event: { atIso: ctx.deps.nowIso(), kind: "note-missing", why },
      home,
      nowIso: ctx.deps.nowIso(),
      refusal: stillAwaiting,
    });
    say({ ctx, line: `${why}; the successor rebuilds from files` });
    return undefined;
  }
  say({
    ctx,
    line: `asked ${label} for its note, delivered once its turn ends; waiting up to ${String(started.noteWaitSeconds)}s`,
  });
  return undefined;
}

/** Record that no note arrived by its deadline; `retry` when the note verb settled it first, so the wait re-reads. */
function recordMissing({
  ctx,
  deadlineIso,
  nowIso,
}: {
  ctx: Ctx;
  deadlineIso: string;
  nowIso: string;
}): { readonly exit: number | undefined } | "retry" {
  const missing = appendEpisodeEventIf({
    episodeId: ctx.episodeId,
    event: { atIso: nowIso, kind: "note-missing", why: `no note by its deadline ${deadlineIso}` },
    home: ctx.options.home,
    nowIso,
    refusal: stillAwaiting,
  });
  if (missing.isOk()) {
    say({ ctx, line: `no note arrived by ${deadlineIso}; the successor rebuilds the picture from files` });
    return { exit: undefined };
  }
  if (missing.error.code === "NOTE_REFUSED") {
    return "retry";
  }
  say({ ctx, line: `refused: ${missing.error.message}` });
  return { exit: missing.error.code === "LOCK_HELD" ? EXIT_DEFERRED : EXIT_ERROR };
}

/**
 * Wait for the note until its deadline, then record that none arrived — unless the note verb settled it first.
 *
 * @param deadlineIso when the wait ends, as `note-asked` journalled it
 * @returns the exit code to stop with, or undefined once the note is settled
 */
export async function awaitNote({ ctx, deadlineIso }: { ctx: Ctx; deadlineIso: string }): Promise<number | undefined> {
  const deadline = Date.parse(deadlineIso);
  for (;;) {
    const events = readEpisode({ episodeId: ctx.episodeId, home: ctx.options.home });
    if (events.isErr()) {
      say({ ctx, line: `refused: ${events.error.message}` });
      return EXIT_ERROR;
    }
    if (nextStep({ events: events.value }).kind !== "await-note") {
      say({ ctx, line: "the outgoing chair's note arrived" });
      return undefined;
    }
    const nowIso = ctx.deps.nowIso();
    const remaining = deadline - Date.parse(nowIso);
    if (remaining > 0) {
      await ctx.deps.sleep({ ms: Math.min(NOTE_POLL_MS, remaining) });
      continue;
    }
    const settled = recordMissing({ ctx, deadlineIso, nowIso });
    if (settled !== "retry") {
      return settled.exit;
    }
  }
}
