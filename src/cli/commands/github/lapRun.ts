/**
 * `slopweaver github lap` — the local CI lap that stands in for hosted Actions as a landing's evidence while
 * Actions is off. This file sequences the phases in `./lapPhases.ts` over the seams in `./lapDeps.ts`, built for
 * production in `./lapShell.ts`; every decision is `./lapCore.ts`'s or `./lapVerdict.ts`'s.
 *
 * Order, each step stopping the lap when it fails: refuse a runner off the designated lap seat (`./lapSeat.ts`,
 * every mode but `--dry-run`); take the machine's one lap lock in its `preflight` phase (every mode but
 * `--dry-run`), so a second lap refuses from here on and `github lap-seat show` names this one; read the pull
 * request and fetch its head and base; refuse before an hour of lanes on anything that would stop the landing
 * anyway — with `--land`, by running the landing itself as `github merge --admin --dry-run` at the head, in a fresh
 * tree; advance the lock to `running` on the head; post `pending` on both contexts, so an earlier green on the same commit stops being current; check the head out
 * detached and start a throwaway Postgres 17 (posting `error` if either will not); run every step in an
 * allowlisted environment, rewriting the receipt after each; post the verdicts and confirm them by read-back;
 * with `--land`, land under the hold; and release the lock whatever happened.
 */

import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { ok } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { runGithubLapBatch } from "./lapBatchRun.js";
import { type GithubLapArgs, lapPlan, parseGithubLapArgs } from "./lapCore.js";
import type { GithubLapDeps, LapExecution, LapLockHandle, LapSession } from "./lapDeps.js";
import { printLapPlan, underLapLock } from "./lapLanes.js";
import { diagnose, land, lapInside, preflight, preflightLanding } from "./lapPhases.js";
import { lapSeatRefusalDetail, lapSeatVerdict } from "./lapSeat.js";
import { productionGithubLapDeps } from "./lapShell.js";
import { lapStatuses } from "./lapStatuses.js";
import { post } from "./lapStatusPost.js";
import { GITHUB_LAP_USAGE } from "./lapUsage.js";
import { landOnlyFindings, landOnlyReceiptFindings } from "./lapVerdict.js";

/** Where a verb's own flags start in `argv`: node, the binary, the noun and the verb come first. */
const VERB_ARG_OFFSET = 4;

/** The state home: `--home` when given, else the resolved default. */
function stateHomeOf({ args, deps }: { args: GithubLapArgs; deps: GithubLapDeps }): string {
  if (args.home === undefined) {
    return deps.home();
  }
  return args.home;
}

/**
 * The lap-seat gate (`./lapSeat.ts`), before the token, the API or any read: whether this session may lap while a
 * chair's rota stands. A designation or its run that will not read refuses outright, hatch or not, since there is
 * no seat to name; an off-seat or unidentified caller, or any caller while the seat's run is closed, is refused
 * unless `off-seat-lap` is open. A dry run is never gated: it takes no lock and posts nothing.
 *
 * @returns whether the lap may go on; every refusal and note has been printed
 */
function onTheLapSeat({ args, deps, home }: { args: GithubLapArgs; deps: GithubLapDeps; home: string }): boolean {
  if (args.dryRun) {
    return true;
  }
  const facts = deps.lapSeatFacts({ home });
  if (facts.isErr()) {
    diagnose({ deps, lines: [`github lap: refused — ${facts.error.message}`] });
    return false;
  }
  const verdict = lapSeatVerdict({ facts: facts.value });
  if (verdict.kind === "proceed") {
    return true;
  }
  const detail = lapSeatRefusalDetail({ callerRun: facts.value.callerRun, verdict });
  if (deps.ambientEnv["SLOPWEAVER_ALLOW_OFF_SEAT_LAP"] === "1") {
    deps.out(`github lap: note — lapping off the seat, as the off-seat-lap hatch is open: ${detail}`);
    return true;
  }
  deps.writeDiagnostic(hatchRefusal({ detail, hatch: hatchFor({ id: "off-seat-lap" }) }));
  return false;
}

/** Everything after a passed preflight: the lanes, the verdict's post, and the landing. */
async function lapAndPost({ session, lock }: { session: LapSession; lock: LapLockHandle }): Promise<number> {
  const lap = await lapInside({ lock, session });
  if (lap.isErr()) {
    diagnose({ deps: session.deps, lines: lap.error.map((error) => `github lap: stopped — ${error.message}`) });
    return EXIT_ERROR;
  }
  const statuses = lapStatuses({ baseTip: session.refs.baseTip, outcomes: lap.value, plan: lapPlan() });
  const posted = await post({ session, statuses });
  if (!posted || statuses.some((status) => status.state !== "success")) {
    return EXIT_ERROR;
  }
  return session.args.land ? land({ session }) : EXIT_OK;
}

/**
 * Run one lap.
 *
 * @param rest argv after `github lap`
 * @param deps every process, file and network seam
 * @returns the process exit code: 0 only when every step was green and, with `--land`, the merge landed
 */
export async function runGithubLap({ rest, deps }: { rest: readonly string[]; deps: GithubLapDeps }): Promise<number> {
  const parsed = parseGithubLapArgs({ rest });
  if (parsed.isErr()) {
    diagnose({ deps, lines: [...parsed.error, GITHUB_LAP_USAGE] });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = stateHomeOf({ args, deps });
  if (!onTheLapSeat({ args, deps, home })) {
    return EXIT_ERROR;
  }
  if (args.dryRun) {
    return lapUnder({ args, deps, execution: { kind: "dry-run" }, home });
  }
  const machine = deps.acquireLock({
    home,
    lock: {
      phase: "preflight",
      pid: deps.pid,
      startedIso: deps.now().toISOString(),
      subject: preflightSubject({ args }),
    },
  });
  if (machine.isErr()) {
    diagnose({ deps, lines: [`github lap: refused — ${machine.error.message}`] });
    return EXIT_ERROR;
  }
  try {
    return await lapUnder({ args, deps, execution: { kind: "held", lock: machine.value.value }, home });
  } finally {
    await machine.value.dispose();
  }
}

/**
 * What the machine's lock names a lap by before its preflight has read a head: the repository and its number, or a
 * batch's numbers in landing order.
 *
 * @returns the preflight subject, `o/r#7` or `o/r#7,8,9`
 */
function preflightSubject({ args }: { args: GithubLapArgs }): string {
  const numbers = args.batch === undefined ? String(args.number) : args.batch.join(",");
  return `${args.owner}/${args.repo}#${numbers}`;
}

/**
 * Everything after the seat gate, under the machine's lock unless this is a dry run: the token, the preflight and
 * the landing check (the lock's `preflight` phase), then the lanes and the landing (its `running` phase).
 *
 * @param execution whether this invocation holds the machine, and the lock it holds
 * @returns the process exit code
 */
async function lapUnder({
  args,
  deps,
  home,
  execution,
}: {
  args: GithubLapArgs;
  deps: GithubLapDeps;
  home: string;
  execution: LapExecution;
}): Promise<number> {
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  if (args.batch !== undefined) {
    return runGithubLapBatch({ api, args, deps, execution, home, numbers: args.batch });
  }
  const ready = await preflight({ api, args, deps });
  if (ready.isErr()) {
    diagnose({ deps, lines: ready.error.map((error) => `github lap: refused — ${error.message}`) });
    return EXIT_ERROR;
  }
  for (const note of ready.value.notes) {
    deps.out(`github lap: note — ${note}`);
  }
  const session = { api, args, baseRef: ready.value.baseRef, deps, home, refs: ready.value.refs };
  if (args.land && !args.landOnly) {
    const landable = await preflightLanding({ session });
    if (landable.isErr()) {
      diagnose({ deps, lines: [`github lap: refused — ${landable.error.message}`] });
      return EXIT_ERROR;
    }
  }
  if (execution.kind === "dry-run") {
    printLapPlan({ out: deps.out });
    return EXIT_OK;
  }
  if (args.landOnly) {
    return landOnEarnedLap({ lock: execution.lock, session });
  }
  return lapAndPost({ lock: execution.lock, session });
}

/**
 * `--land-only`: land on the statuses a lap already posted on this head, running and posting nothing, only when
 * both are a lap's green over the base tip as just fetched AND this home keeps that lap's finished, all-green
 * receipt. The receipt is the proof: a status description is text any status poster can write.
 *
 * Read once, before the hold, never again: a receipt deleted between that read and the merge still lands. That
 * window is left open on purpose — deleting a receipt does not undo the lap it records, and a process able to
 * rewrite the state home can forge a receipt outright, which no reread closes. A signed receipt would.
 *
 * The status read, the receipt read and the merge all run under the machine's lap lock, as a lap and a batch's
 * landings do, so no lap on this machine posts over the head between the check and the merge.
 *
 * @param lock the lock this invocation took before its preflight, advanced here to `running`
 * @returns the landing's exit code, or an error exit naming each context that has not earned it
 */
async function landOnEarnedLap({ session, lock }: { session: LapSession; lock: LapLockHandle }): Promise<number> {
  const { args, deps, refs } = session;
  const startedIso = deps.now().toISOString();
  const subject = `${args.owner}/${args.repo}#${String(args.number)}@${refs.headSha} --land-only`;
  const run = await underLapLock({
    lock,
    run: async () => ok(await landOnEarnedLapInside({ session })),
    startedIso,
    subject,
  });
  if (run.isErr()) {
    diagnose({ deps, lines: run.error.map((error) => `github lap: not landing — ${error.message}`) });
    return EXIT_ERROR;
  }
  return run.value;
}

/** `--land-only`'s check and landing, which {@link landOnEarnedLap} runs under the lap lock. */
async function landOnEarnedLapInside({ session }: { session: LapSession }): Promise<number> {
  const { api, args, deps, refs } = session;
  const read = await api.statuses({ owner: args.owner, repo: args.repo, sha: refs.headSha });
  if (read.isErr()) {
    deps.writeDiagnostic(`github lap: not landing — the head's statuses could not be read: ${read.error.message}`);
    return EXIT_ERROR;
  }
  const findings = [
    ...landOnlyFindings({ baseTip: refs.baseTip, statuses: read.value }),
    ...landOnlyReceiptFindings({
      baseTip: refs.baseTip,
      headSha: refs.headSha,
      plan: lapPlan(),
      receipts: deps.readReceipts({ args, home: session.home }),
    }),
  ];
  if (findings.length > 0) {
    diagnose({ deps, lines: findings.map((finding) => `github lap: not landing on an earned lap — ${finding}`) });
    return EXIT_ERROR;
  }
  deps.out(
    `github lap: landing on the lap ${refs.headSha.slice(0, 10)} already earned over base ${refs.baseTip.slice(0, 10)}`,
  );
  return land({ session });
}

/** `slopweaver github lap`, over the production seams. */
export const githubLapCommand = defineCommand({
  run: (argv) => runGithubLap({ deps: productionGithubLapDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
