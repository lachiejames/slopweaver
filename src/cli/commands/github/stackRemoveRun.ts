/**
 * `slopweaver github stack remove` — the effectful shell.
 *
 * The order matches every other governed stack write: parse → token → read the pull request and its full
 * native stack → authorise → decide → [dry-run stops here] → lock → door → re-derive the decision fresh →
 * unstack the whole native stack → re-form the remaining entries as a new stack, when two or more survive →
 * unregister the removed pull request locally → report.
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
  type GithubStackRemoveArgs,
  githubStackRemoveDecisionFor,
  githubStackRemoveDoorRequest,
  githubStackRemoveFreshnessFor,
  parseGithubStackRemoveArgs,
  type StackRemoveDecision,
  stackRemoveDescription,
} from "./stackRemoveCore.js";
import { ALLOW_FOREIGN_PR, authorisationFor } from "./updateCore.js";

const VERB_ARG_OFFSET = 5; // node, cli, "github", "stack", "remove"

/** The injectable edges — the write API, environment reader and output sink. */
export interface GithubStackRemoveDeps {
  /** The door ledger the write's decision is recorded through before anything is sent. */
  readonly doorLedger: DoorLedgerPort;
  readonly makeApi: (input: { readonly home: string; readonly token: string }) => GithubWriteApi;
  readonly env: (input: { readonly name: string }) => string | undefined;
  readonly now: () => Date;
  readonly out: (input: { readonly line: string }) => void;
  /** The GitHub token resolver (env, then the secrets file, then `gh auth token`), injectable so a test never shells the real `gh` CLI. */
  readonly token: (input: { readonly home: string }) => string | undefined;
}

/**
 * The production edges.
 *
 * @returns the real API factory, environment reader, clock and output sink
 */
function productionGithubStackRemoveDeps(): GithubStackRemoveDeps {
  return {
    doorLedger: doorLedgerPort(),
    env: ({ name }) => process.env[name],
    makeApi: ({ home, token }) => makeGithubWriteApi({ privacy: githubWritePrivacy({ home }), token }),
    now: () => new Date(),
    out: logger.out,
    token: ({ home }) => githubToken({ home }),
  };
}

/** The un-effectful entry numbers a decision's own stack spanned before removal — preview or fresh, alike. */
function entryNumbersOf({
  decision,
}: {
  decision: Extract<StackRemoveDecision, { kind: "proceed" }>;
}): readonly number[] {
  return [decision.removedNumber, ...decision.remainingNumbers];
}

/** Read the pull request, authorise the caller, read its native stack, and decide — before any write. */
async function resolveStackRemoveDecision({
  api,
  args,
  deps,
}: {
  api: GithubWriteApi;
  args: GithubStackRemoveArgs;
  deps: GithubStackRemoveDeps;
}): Promise<Result<Extract<StackRemoveDecision, { kind: "proceed" }>, number>> {
  const pr = await api.getPr({ number: args.prNumber, owner: args.owner, repo: args.repo });
  if (pr.isErr()) {
    deps.out({ line: `refused: could not read #${String(args.prNumber)}: ${pr.error.message}` });
    return err(EXIT_ERROR);
  }
  const identity = await api.authenticatedUserId();
  const authorised = authorisationFor({
    allowForeign: deps.env({ name: ALLOW_FOREIGN_PR }) === "1",
    authedUserId: identity.isOk() ? identity.value : undefined,
    prAuthorId: pr.value.authorId,
    purpose: "stack-remove",
  });
  if (authorised.kind === "refused") {
    deps.out({ line: `refused: ${authorised.reason}` });
    return err(EXIT_ERROR);
  }
  if (authorised.kind === "overridden") {
    deps.out({ line: authorised.notice });
  }
  if (pr.value.stack === undefined) {
    deps.out({
      line: `refused: #${String(pr.value.number)} is not a member of any native GitHub stack — nothing to remove`,
    });
    return err(EXIT_ERROR);
  }
  const stack = await api.getStack({ owner: args.owner, repo: args.repo, stackNumber: pr.value.stack.number });
  if (stack.isErr()) {
    deps.out({
      line: `refused: could not read native stack #${String(pr.value.stack.number)}: ${stack.error.message}`,
    });
    return err(EXIT_ERROR);
  }
  const decision = githubStackRemoveDecisionFor({ pr: pr.value, stack: stack.value });
  if (decision.kind === "refused") {
    deps.out({ line: `refused: ${decision.reason}` });
    return err(EXIT_ERROR);
  }
  return ok(decision);
}

/** What the whole write actually produced. */
type StackRemoveOutcome =
  | {
      readonly kind: "removed";
      readonly oldStackNumber: number;
      readonly recreated:
        | { readonly kind: "none" }
        | { readonly kind: "recreated"; readonly stackNumber: number }
        | { readonly kind: "recreate-failed"; readonly reason: string };
    }
  | { readonly kind: "failed" | "unconfirmed"; readonly reason: string };

/** Unstack the whole native stack, then re-form the remaining entries — the write, already inside the door. */
async function performStackRemove({
  api,
  owner,
  repo,
  decision,
  home,
}: {
  api: GithubWriteApi;
  owner: string;
  repo: string;
  decision: Extract<StackRemoveDecision, { kind: "proceed" }>;
  home: string;
}): Promise<StackRemoveOutcome> {
  const unstacked = await api.unstack({ owner, repo, stackNumber: decision.stackNumber });
  if (unstacked.isErr()) {
    return { kind: "failed", reason: unstacked.error.message };
  }
  if (unstacked.value !== undefined) {
    const survivors: GithubStack = unstacked.value;
    return {
      kind: "unconfirmed",
      reason:
        `unstack left ${String(survivors.entries.length)} ${survivors.entries.length === 1 ? "entry" : "entries"} in ` +
        `place (locked or already merged) instead of fully dissolving stack #${String(decision.stackNumber)}`,
    };
  }
  unregisterStackMember({ home, number: decision.removedNumber, owner, repo });
  if (decision.remainingNumbers.length < 2) {
    return { kind: "removed", oldStackNumber: decision.stackNumber, recreated: { kind: "none" } };
  }
  const [first, second, ...rest] = decision.remainingNumbers;
  const recreated = await api.createStack({ owner, pullRequests: [first!, second!, ...rest], repo });
  if (recreated.isErr()) {
    return {
      kind: "removed",
      oldStackNumber: decision.stackNumber,
      recreated: { kind: "recreate-failed", reason: recreated.error.message },
    };
  }
  return {
    kind: "removed",
    oldStackNumber: decision.stackNumber,
    recreated: { kind: "recreated", stackNumber: recreated.value.number },
  };
}

/** Re-derive the decision fresh, inside the door, and refuse if the stack's own entries have moved. */
async function reconfirmAndPerform({
  api,
  args,
  previewed,
  home,
}: {
  api: GithubWriteApi;
  args: GithubStackRemoveArgs;
  previewed: Extract<StackRemoveDecision, { kind: "proceed" }>;
  home: string;
}): Promise<StackRemoveOutcome> {
  const current = await api.getPr({ number: args.prNumber, owner: args.owner, repo: args.repo });
  if (current.isErr()) {
    return {
      kind: "failed",
      reason: `could not re-read #${String(args.prNumber)} before writing: ${current.error.message}`,
    };
  }
  if (current.value.stack === undefined) {
    return {
      kind: "failed",
      reason: `#${String(current.value.number)} is no longer a member of any native GitHub stack`,
    };
  }
  const stack = await api.getStack({ owner: args.owner, repo: args.repo, stackNumber: current.value.stack.number });
  if (stack.isErr()) {
    return {
      kind: "failed",
      reason: `could not re-read native stack #${String(current.value.stack.number)}: ${stack.error.message}`,
    };
  }
  const fresh = githubStackRemoveDecisionFor({ pr: current.value, stack: stack.value });
  if (fresh.kind === "refused") {
    return { kind: "failed", reason: fresh.reason };
  }
  const freshness = githubStackRemoveFreshnessFor({
    current: entryNumbersOf({ decision: fresh }),
    previewed: entryNumbersOf({ decision: previewed }),
  });
  if (!freshness.fresh) {
    return { kind: "failed", reason: freshness.reason };
  }
  return performStackRemove({ api, decision: fresh, home, owner: args.owner, repo: args.repo });
}

/** Lines describing the outcome, for the report. */
function outcomeLines({ outcome }: { outcome: StackRemoveOutcome }): readonly string[] {
  if (outcome.kind !== "removed") {
    return [`${outcome.kind}: ${outcome.reason}`];
  }
  if (outcome.recreated.kind === "none") {
    return [`removed — native stack #${String(outcome.oldStackNumber)} is now dissolved`];
  }
  if (outcome.recreated.kind === "recreated") {
    return [
      `removed — native stack #${String(outcome.oldStackNumber)} dissolved, remaining entries re-formed as ` +
        `stack #${String(outcome.recreated.stackNumber)}`,
    ];
  }
  return [
    `removed — native stack #${String(outcome.oldStackNumber)} dissolved, but re-forming the remaining entries ` +
      `into a new stack failed: ${outcome.recreated.reason}. Push or adopt them to re-stack manually`,
  ];
}

/**
 * Run one governed stack remove.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, "github", "stack" and "remove"
 * @param deps injectable API, environment and output edges
 * @returns the process exit code
 */
export async function runGithubStackRemove({
  argv,
  deps = productionGithubStackRemoveDeps(),
}: {
  argv: readonly string[];
  deps?: GithubStackRemoveDeps;
}): Promise<number> {
  const parsed = parseGithubStackRemoveArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
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
  const resolved = await resolveStackRemoveDecision({ api, args, deps });
  if (!resolved.isOk()) {
    return resolved.error;
  }
  const decision = resolved.value;
  deps.out({ line: `would ${stackRemoveDescription({ decision })}` });
  if (args.dryRun) {
    deps.out({
      line: "dry run: a token was resolved and the pull request and stack were READ; no door record, no network write.",
    });
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
    return await removeThroughDoor({ api, args, decision, deps, home });
  } finally {
    lock.value.release();
  }
}

/** Send the remove through the door, print what happened, and answer the exit code. */
async function removeThroughDoor({
  api,
  args,
  decision,
  deps,
  home,
}: {
  api: GithubWriteApi;
  args: GithubStackRemoveArgs;
  decision: Extract<StackRemoveDecision, { kind: "proceed" }>;
  deps: GithubStackRemoveDeps;
  home: string;
}): Promise<number> {
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => reconfirmAndPerform({ api, args, home, previewed: decision }),
    request: githubStackRemoveDoorRequest({ decision, home, owner: args.owner, repo: args.repo }),
  });
  if (!routed.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github stack remove", through: routed })) {
      deps.out({ line });
    }
    return EXIT_ERROR;
  }
  for (const line of outcomeLines({ outcome: routed.result })) {
    deps.out({ line });
  }
  return routed.result.kind === "removed" ? EXIT_OK : EXIT_ERROR;
}
