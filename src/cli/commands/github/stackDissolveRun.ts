/**
 * `slopweaver github stack dissolve` — the effectful shell.
 *
 * The order matches `stack remove`: parse → token → read the native stack → decide → [dry-run stops here]
 * → lock → door → re-read the stack fresh and refuse if it moved → unstack → unregister every entry locally
 * → report.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { githubToken } from "../../../config.js";
import type { GithubStack } from "../../../corpus/github/stack.js";
import { type GithubWriteApi, makeGithubWriteApi } from "../../../corpus/github/write.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { unregisterStackMember } from "../../../outbound/github/stackLedger.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import {
  type GithubStackDissolveArgs,
  githubStackDissolveDecisionFor,
  githubStackDissolveDoorRequest,
  githubStackDissolveFreshnessFor,
  parseGithubStackDissolveArgs,
  type StackDissolveDecision,
  stackDissolveDescription,
} from "./stackDissolveCore.js";

const VERB_ARG_OFFSET = 5; // node, cli, "github", "stack", "dissolve"

/** The injectable edges — the write API and output sink. No `env` dep: unlike `stack remove`, dissolve never
 * checks the authored-by-me gate (a stack can legitimately mix authors), so there is no override to read. */
export interface GithubStackDissolveDeps {
  /** The door ledger the write's decision is recorded through before anything is sent. */
  readonly doorLedger: DoorLedgerPort;
  readonly makeApi: (input: { readonly home: string; readonly token: string }) => GithubWriteApi;
  readonly now: () => Date;
  readonly out: (input: { readonly line: string }) => void;
  /** The GitHub token resolver (env, then the secrets file, then `gh auth token`), injectable so a test never shells the real `gh` CLI. */
  readonly token: (input: { readonly home: string }) => string | undefined;
}

/**
 * The production edges.
 *
 * @returns the real API factory, clock and output sink
 */
function productionGithubStackDissolveDeps(): GithubStackDissolveDeps {
  return {
    doorLedger: doorLedgerPort(),
    makeApi: ({ home, token }) => makeGithubWriteApi({ privacy: githubWritePrivacy({ home }), token }),
    now: () => new Date(),
    out: logger.out,
    token: ({ home }) => githubToken({ home }),
  };
}

/** Read the native stack and decide — before any write. */
async function resolveStackDissolveDecision({
  api,
  args,
  deps,
}: {
  api: GithubWriteApi;
  args: GithubStackDissolveArgs;
  deps: GithubStackDissolveDeps;
}): Promise<Result<Extract<StackDissolveDecision, { kind: "proceed" }>, number>> {
  const stack = await api.getStack({ owner: args.owner, repo: args.repo, stackNumber: args.stackNumber });
  if (stack.isErr()) {
    deps.out({ line: `refused: could not read native stack #${String(args.stackNumber)}: ${stack.error.message}` });
    return err(EXIT_ERROR);
  }
  const decision = githubStackDissolveDecisionFor({ stack: stack.value });
  if (decision.kind === "refused") {
    deps.out({ line: `refused: ${decision.reason}` });
    return err(EXIT_ERROR);
  }
  return ok(decision);
}

/** What the whole write actually produced. */
type StackDissolveOutcome =
  | { readonly kind: "dissolved"; readonly stackNumber: number }
  | { readonly kind: "partial"; readonly stackNumber: number; readonly survivorNumbers: readonly number[] }
  | { readonly kind: "failed"; readonly reason: string };

/** Unstack the stack and unregister every entry it actually removed — the write, already inside the door. */
async function performStackDissolve({
  api,
  owner,
  repo,
  decision,
  home,
}: {
  api: GithubWriteApi;
  owner: string;
  repo: string;
  decision: Extract<StackDissolveDecision, { kind: "proceed" }>;
  home: string;
}): Promise<StackDissolveOutcome> {
  const unstacked = await api.unstack({ owner, repo, stackNumber: decision.stackNumber });
  if (unstacked.isErr()) {
    return { kind: "failed", reason: unstacked.error.message };
  }
  const survivors: GithubStack | undefined = unstacked.value;
  const survivorNumbers = new Set(survivors === undefined ? [] : survivors.entries.map((entry) => entry.number));
  for (const number of decision.entryNumbers) {
    if (!survivorNumbers.has(number)) {
      unregisterStackMember({ home, number, owner, repo });
    }
  }
  return survivors === undefined
    ? { kind: "dissolved", stackNumber: decision.stackNumber }
    : { kind: "partial", stackNumber: decision.stackNumber, survivorNumbers: [...survivorNumbers] };
}

/** Re-read the stack fresh, inside the door, and refuse if its own entries have moved. */
async function reconfirmAndPerform({
  api,
  args,
  previewed,
  home,
}: {
  api: GithubWriteApi;
  args: GithubStackDissolveArgs;
  previewed: Extract<StackDissolveDecision, { kind: "proceed" }>;
  home: string;
}): Promise<StackDissolveOutcome> {
  const stack = await api.getStack({ owner: args.owner, repo: args.repo, stackNumber: args.stackNumber });
  if (stack.isErr()) {
    return {
      kind: "failed",
      reason: `could not re-read native stack #${String(args.stackNumber)}: ${stack.error.message}`,
    };
  }
  const fresh = githubStackDissolveDecisionFor({ stack: stack.value });
  if (fresh.kind === "refused") {
    return { kind: "failed", reason: fresh.reason };
  }
  const freshness = githubStackDissolveFreshnessFor({ current: fresh.entryNumbers, previewed: previewed.entryNumbers });
  if (!freshness.fresh) {
    return { kind: "failed", reason: freshness.reason };
  }
  return performStackDissolve({ api, decision: fresh, home, owner: args.owner, repo: args.repo });
}

/** Lines describing the outcome, for the report. */
function outcomeLines({ outcome }: { outcome: StackDissolveOutcome }): readonly string[] {
  if (outcome.kind === "failed") {
    return [`failed: ${outcome.reason}`];
  }
  if (outcome.kind === "dissolved") {
    return [`dissolved — native stack #${String(outcome.stackNumber)} no longer exists`];
  }
  const survivors = outcome.survivorNumbers.map((number) => `#${String(number)}`).join(", ");
  return [
    `dissolved — every unmerged entry left native stack #${String(outcome.stackNumber)}, but it survives ` +
      `with the locked or already-merged ${survivors}`,
  ];
}

/**
 * Run one governed stack dissolve.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, "github", "stack" and "dissolve"
 * @param deps injectable API and output edges
 * @returns the process exit code
 */
export async function runGithubStackDissolve({
  argv,
  deps = productionGithubStackDissolveDeps(),
}: {
  argv: readonly string[];
  deps?: GithubStackDissolveDeps;
}): Promise<number> {
  const parsed = parseGithubStackDissolveArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of parsed.error) deps.out({ line });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  const token = deps.token({ home });
  if (token === undefined) {
    deps.out({ line: "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)" });
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  const resolved = await resolveStackDissolveDecision({ api, args, deps });
  if (!resolved.isOk()) {
    return resolved.error;
  }
  const decision = resolved.value;
  deps.out({ line: `would ${stackDissolveDescription({ decision })}` });
  if (args.dryRun) {
    deps.out({ line: "dry run: a token was resolved and the stack was READ; no door record, no network write." });
    return EXIT_OK;
  }
  // Lower-cased: GitHub owner/repo names are case-insensitive, but the lock hashes this key verbatim, so a
  // differently-cased `--repo` for the SAME repository would otherwise contend on a different lock entirely.
  const lockKey = `${args.owner}/${args.repo}`.toLowerCase();
  const lock = acquireOperationLock({ home, key: lockKey, nowIso: deps.now().toISOString() });
  if (!lock.isOk()) {
    deps.out({ line: `refused: another stack operation is in progress on ${lockKey} (${lock.error})` });
    return EXIT_ERROR;
  }
  try {
    const routed = await throughDoor({
      gates: DEFAULT_GATES,
      home,
      ledger: deps.doorLedger,
      perform: () => reconfirmAndPerform({ api, args, home, previewed: decision }),
      request: githubStackDissolveDoorRequest({ decision, home, owner: args.owner, repo: args.repo }),
    });
    if (!routed.performed) {
      for (const line of notPerformedLines({ command: "slopweaver github stack dissolve", through: routed })) {
        deps.out({ line });
      }
      return EXIT_ERROR;
    }
    for (const line of outcomeLines({ outcome: routed.result })) {
      deps.out({ line });
    }
    return routed.result.kind === "failed" ? EXIT_ERROR : EXIT_OK;
  } finally {
    lock.value.release();
  }
}
