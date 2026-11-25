/**
 * `slopweaver <noun> <verb>` CLI logic. Kept in a MODULE (not the entry file) so the whole dispatch spine
 * is importable + testable; `cli/index.ts` is the tiny top-level entry that just runs `runCliProcess`. No
 * `isDirectInvocation` guard anywhere — the entry file IS the invocation.
 *
 * Thin dispatcher: resolve the noun/verb route against the registry, answer `--help` from the verb's
 * metadata without loading its module, then hand off to the verb's run function (fetched lazily).
 */
import { builtRootOf, runsFromSource } from "../builtCli/guard.js";
import { guardInvocation, type InvocationGuard, productionWaitSeams } from "../builtCli/invocationGuard.js";
import { restartOnFreshBuild } from "../builtCli/restart.js";
import { productionSourceLaunch, restartOnSource } from "../builtCli/sourceRestart.js";
import { slopweaverHome } from "../config.js";
import { drainStdio } from "../lib/drainStdio.js";
import { errorMessage } from "../lib/errorMessage.js";
import { logger } from "../lib/logger.js";
import { settlePendingEffects } from "../lib/pendingEffects.js";
import { exitWhenThreadPoolQuiet } from "../lib/threadPoolExit.js";
import { closeTypeScript } from "../lib/tsLifecycle.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../supervisor/session.js";
import { EXIT_USAGE } from "./exitCodes.js";
import { surfaceFailureHint } from "./failureHint.js";
import { canonicalArgv } from "./nounAliases.js";
import { NOUN_GROUPS, NOUN_SUMMARIES } from "./nounGroups.js";
import { isNoun, renderNounUsage, resolveNoun } from "./router.js";
import { refuseOnStandingRuling } from "./rulingGateDoor.js";
import { maybeRemindGovernedVerb } from "./skillReminderEffects.js";
import { maybeWarnStaleSeat } from "./staleSeatEffects.js";
import { staleSeatNoticesPort } from "./staleSeatNotices.js";
import { renderVerbHelp, wantsHelp } from "./verbHelp.js";

/**
 * Resolve + run one CLI invocation to an exit code. Pure of process concerns (no exit, no argv default) —
 * `runCliProcess` owns those.
 *
 * @param typed the full process argv ([node, cli, noun, verb, …]), its noun possibly an old name
 * @returns the process exit code
 */
export async function main(typed: readonly string[]): Promise<number> {
  // An old noun is resolved once, here, so every reader below sees the current name (`./nounAliases.ts`).
  const argv = canonicalArgv({ argv: typed });
  const nounRoute = resolveNoun({ argv, groups: NOUN_GROUPS });
  if (nounRoute) {
    // The owner's own recorded word, ahead of the verb it rules on — before `--help` is answered and before the
    // module is loaded, so no route reaches its handler around it. `./rulingGateDoor.ts` carries the rest;
    // `--help` is never gated, and an unreadable projection fails open.
    const gateExit = refuseOnStandingRuling({ argv, noun: nounRoute.noun, verb: nounRoute.verb });
    if (gateExit !== undefined) {
      return gateExit;
    }
    // `--help`/`-h` is answered here, before the handler runs: a verb's usage rides on the registry
    // entry, so we print it WITHOUT loading the module. Help is not an error -> stdout, exit 0.
    if (wantsHelp({ argv })) {
      logger.out({ line: renderVerbHelp({ meta: nounRoute.entry.meta }) });
      return 0;
    }
    // BEFORE the verb runs, and before its module is even loaded: a seat runs its OWN worktree's code
    // against a state home every other seat also writes, so a verb whose own modules moved upstream
    // answers from a repository that no longer exists (`./staleSeat.ts` carries the measurement).
    // Advisory only, exactly like the reminder below it — it never touches the exit code.
    await maybeWarnStaleSeat({
      home: slopweaverHome(),
      notices: staleSeatNoticesPort(),
      noun: nounRoute.noun,
      sessionId: process.env[CLAUDE_CODE_SESSION_ID_ENV],
      verb: nounRoute.verb,
    });
    const run = await nounRoute.entry.load();
    // Class 2 of the sanctioned-verb-guard ruling: a governed verb has a real door already (it IS the
    // sanctioned path), but its actual contract lives in an owning skill a cold call never loads. This is
    // advisory only — it never affects the exit code below, by design (see `skillReminder.ts`'s header).
    maybeRemindGovernedVerb({
      home: slopweaverHome(),
      noun: nounRoute.noun,
      sessionId: process.env[CLAUDE_CODE_SESSION_ID_ENV],
      verb: nounRoute.verb,
    });
    return run(argv);
  }
  if (isNoun({ argv, groups: NOUN_GROUPS })) {
    const only = argv[2];
    logger.error({ msg: `usage: slopweaver ${only} <verb>` });
    logger.error({
      msg: renderNounUsage({
        groups: NOUN_GROUPS,
        ...(only !== undefined ? { only } : {}),
        summaries: NOUN_SUMMARIES,
      }),
    });
    return EXIT_USAGE;
  }
  printUsage();
  return EXIT_USAGE;
}

function printUsage(): void {
  logger.error({
    msg: [
      "usage: slopweaver <noun> <verb> [--flags]",
      "",
      "noun groups:",
      renderNounUsage({ groups: NOUN_GROUPS, summaries: NOUN_SUMMARIES }),
    ].join("\n"),
  });
}

/**
 * The process shell: run `main`, normalise the code, surface a failure hint, drain stdout and stderr, and
 * exit. `argv`/`exit`/`drain` are injectable so this is testable without spawning; their defaults are the
 * real runtime values.
 *
 * Every exit waits on `drain` first. `process.exit` discards what a piped stream still has queued, and the
 * modules a verb calls write through that stream — `slopweaver dev gate | tail` lost its whole verdict to it
 * (`../lib/drainStdio.ts` carries the measurement).
 *
 * The order after the verb is fixed: pending effects settle, then every TypeScript client closes, then the
 * streams drain, then the process exits. Effects come first because one may still parse; the close sits HERE,
 * at the process boundary, and never in `main`, which other verbs call in-process (`../lib/tsLifecycle.ts`). The
 * staleness refusal closes too: it loads no verb, but a module imported before it may have registered a closer.
 * So does a RESTART, on a fresh build (`../builtCli/restart.ts`) or on the checkout's source
 * (`../builtCli/sourceRestart.ts`): it closes and drains like an exit, then replaces the process, and only an exec
 * that could not be attempted reaches `exit`, with 1.
 *
 * The exit itself first waits for the thread-pool requests in flight when it began to finish, because
 * `process.exit` JOINS libuv's pool and a request blocked without end there holds the process forever after its
 * last line is written — `github merge --admin --dry-run` sat ten minutes that way. `../lib/threadPoolExit.ts`
 * carries the measurement and what it does when one of those requests never finishes.
 *
 * @param argv the process argv (defaults to `process.argv`)
 * @param close closes every TypeScript client (defaults to {@link closeTypeScript})
 * @param drain waits until stdout and stderr have flushed (defaults to {@link drainStdio})
 * @param exit ends the process with the code (defaults to {@link exitWhenThreadPoolQuiet})
 * @param guard decides run, source, restart or refuse before any verb (defaults to the built-CLI staleness guard)
 * @param restart replaces the process with the fresh build, returning only why it could not
 * @param source replaces the process with the named checkout's source, returning only why it could not
 * @param run resolves and runs the invocation to an exit code (defaults to {@link main})
 */
export async function runCliProcess({
  argv = process.argv,
  close = closeTypeScript,
  drain = drainStdio,
  exit = (code) => exitWhenThreadPoolQuiet({ code }),
  guard = () => productionGuard({ argv }),
  restart = () => restartOnFreshBuild({ argv, env: process.env }),
  source = ({ root }) => restartOnSource({ argv, env: process.env, root }),
  run = main,
}: {
  argv?: readonly string[];
  close?: () => void;
  drain?: () => Promise<void>;
  exit?: (code: number) => void | Promise<void>;
  guard?: () => Promise<InvocationGuard>;
  restart?: () => string;
  source?: (options: { root: string }) => string;
  run?: (argv: readonly string[]) => Promise<number>;
} = {}): Promise<void> {
  let code = 1;
  let replacement: (() => string) | undefined;
  try {
    // The staleness guard, ahead of every verb: a built CLI that no longer describes its source never answers.
    // Running from source finds no manifest and this is a no-op. A stale build restarts on its checkout's source,
    // and a console child that meets a rebuild in flight waits it out and restarts on the fresh build — neither
    // dispatching a verb from this, the stale, process (`../builtCli/invocationGuard.ts`).
    const guarded = await guard();
    for (const line of guarded.lines) {
      logger.error({ msg: line });
    }
    if (guarded.disposition === "run") {
      code = await runCliInvocation({ argv, run });
    } else if (guarded.disposition === "restart") {
      replacement = restart;
    } else if (guarded.disposition === "source") {
      const root = guarded.source.root;
      replacement = () => source({ root });
    }
  } finally {
    close();
  }
  await drain();
  if (replacement !== undefined) {
    logger.error({ msg: replacement() });
    await drain();
  }
  await exit(code);
}

/**
 * The guard a real process runs: the built tree this module was loaded from, the real environment, the real clock,
 * and the real file system's answer on whether the stale manifest's checkout can run its own source.
 *
 * The argv is canonicalised first, so an old noun name is judged by the verb it now names.
 *
 * @param argv the process argv
 * @returns the invocation's disposition
 */
async function productionGuard({ argv }: { argv: readonly string[] }): Promise<InvocationGuard> {
  const builtRoot = builtRootOf({ moduleUrl: import.meta.url });
  return guardInvocation({
    announce: (line) => {
      logger.error({ msg: line });
    },
    argv: canonicalArgv({ argv }),
    builtRoot,
    env: process.env,
    fromSource: runsFromSource({ moduleUrl: import.meta.url }),
    sourceLaunch: productionSourceLaunch,
    waitSeams: productionWaitSeams({ builtRoot }),
  });
}

/**
 * Run the verb to a normalised exit code, surface a failure hint, and let its pending effects settle — what one
 * invocation is, whether it is the process's only one or one of several a `console batch` runs in this process.
 *
 * @param argv the process argv, handed to the verb and the failure hint
 * @param run resolves and runs the invocation to an exit code
 * @returns the verb's code, or 1 when it threw or answered anything but an integer from 0 to 255
 */
export async function runCliInvocation({
  argv,
  run,
}: {
  argv: readonly string[];
  run: (argv: readonly string[]) => Promise<number>;
}): Promise<number> {
  let code: number;
  try {
    const resolved = await run(argv);
    // SAFETY: normalise any code a process status cannot carry to a fault (1), so a failure can never be read as
    // success. A status is one byte: `node -e 'process.exit(256)'; echo $?` prints 0.
    const representable = typeof resolved === "number" && Number.isInteger(resolved) && resolved >= 0;
    code = representable && resolved <= 255 ? resolved : 1;
    // Inline surfacer: a one-line likely-cause + next-step AFTER the verb's output on a known failure.
    if (code !== 0) {
      surfaceFailureHint({ argv, code });
    }
  } catch (error: unknown) {
    logger.error({ msg: errorMessage({ error }) });
    surfaceFailureHint({ argv, code: 1, error });
    code = 1;
  }
  // A synchronous caller's async write (`../lib/pendingEffects.ts`) finishes before the exit can cut it off.
  await settlePendingEffects();
  return code;
}
