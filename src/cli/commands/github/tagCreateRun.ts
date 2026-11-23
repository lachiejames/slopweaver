/** Effectful shell for the governed remote tag create. */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { githubToken, slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubRefsApi, makeGithubRefsApi } from "../../../outbound/github/refs.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { githubVerbErrorLines } from "./errors.js";
import { type GithubRefsError, GithubRefsErrors } from "./refsErrors.js";
import { GITHUB_TAG_USAGE } from "./refsUsage.js";
import {
  type GithubTagArgs,
  parseGithubTagArgs,
  planTagCreate,
  type TagPlan,
  tagCreateDoorRequest,
} from "./tagCreateCore.js";

const VERB_ARG_OFFSET = 4;

/** Said beside an end state an errored write cannot attribute. */
const UNCLEAR_WRITER = "; this run's write answered an error, so this run or another writer made it";

/** Injectable edges for a no-network unit test. */
export interface GithubTagDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubRefsApi;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Read the tag and the commit from the live remote and decide.
 *
 * @param api the ref surface
 * @param args the parsed request
 * @returns the plan, or the provider failure
 */
async function readAndPlan({ api, args }: { api: GithubRefsApi; args: GithubTagArgs }): Promise<Result<TagPlan>> {
  const address = { owner: args.owner, repo: args.repo };
  const [existing, onRemote] = await Promise.all([
    api.tagCommit({ ...address, tag: args.tag }),
    api.commitExists({ ...address, sha: args.sha }),
  ]);
  if (existing.isErr()) {
    return err([existing.error.message]);
  }
  if (onRemote.isErr()) {
    return err([onRemote.error.message]);
  }
  return ok(
    planTagCreate({ commitOnRemote: onRemote.value, existingCommit: existing.value, sha: args.sha, tag: args.tag }),
  );
}

/**
 * The tag's commit after a write, or the read's failure. GitHub answers 404 for a ref the caller can no longer
 * see, so "absent" counts only if the repository still reads AFTER the tag read: access lost before then fails it.
 */
async function tagStateAfter({
  api,
  args,
}: {
  api: GithubRefsApi;
  args: GithubTagArgs;
}): Promise<Result<string | undefined, string>> {
  const address = { owner: args.owner, repo: args.repo };
  const tag = await api.tagCommit({ ...address, tag: args.tag });
  if (tag.isErr()) {
    return err(tag.error.message);
  }
  const repository = await api.defaultBranch(address);
  if (repository.isErr()) {
    return err(repository.error.message);
  }
  return ok(tag.value);
}

/** A settled create: the outcome word, and the write's own error when it answered one but the tag is there. */
interface TagOutcome {
  readonly outcome: "created" | "already there:" | "there now:";
  /** Kept whole because it can name an orphaned annotation object, which nothing else reports. */
  readonly writeError: string | undefined;
  /** The annotation object this run created, named on success too: a ref swapped after the read-back would orphan it. */
  readonly annotation: string | undefined;
}

/**
 * Settle a create that answered an error: a failed write may still have landed with its answer lost, so what is
 * there is READ, never assumed. The tag at the commit is success whose author is unknown; anything else fails.
 */
async function settleErroredCreate({
  api,
  args,
  cause,
}: {
  api: GithubRefsApi;
  args: GithubTagArgs;
  cause: string;
}): Promise<Result<TagOutcome, GithubRefsError>> {
  const landed = await tagStateAfter({ api, args });
  if (landed.isOk() && landed.value === args.sha) {
    // The end state holds, but an errored write cannot say WHOSE write made it: this run, or another writer.
    return ok({ annotation: undefined, outcome: "there now:", writeError: cause });
  }
  let state: string;
  if (landed.isErr()) {
    state = `reading it back failed too (${landed.error}), so GitHub may or may not have made tag ${args.tag} at ${args.sha}`;
  } else if (landed.value === undefined) {
    state = `tag ${args.tag} reads back absent`;
  } else {
    state = `tag ${args.tag} reads back at ${landed.value}`;
  }
  return err(GithubRefsErrors.providerFailed({ cause: `${cause}; ${state}`, kept: undefined, step: "tagging" }));
}

/**
 * Re-read the tag, create it once when it is still absent, and confirm it reads back at the commit — one
 * door-recorded action. A tag that appeared at the SAME commit since the preflight is success, not a
 * collision; one at another commit is refused. Never a second POST.
 */
async function createAndConfirm({
  api,
  args,
}: {
  api: GithubRefsApi;
  args: GithubTagArgs;
}): Promise<Result<TagOutcome, GithubRefsError>> {
  const address = { owner: args.owner, repo: args.repo };
  const fresh = await api.tagCommit({ ...address, tag: args.tag });
  if (fresh.isErr()) {
    return err(GithubRefsErrors.providerFailed({ cause: fresh.error.message, kept: undefined, step: "re-read" }));
  }
  if (fresh.value === args.sha) {
    return ok({ annotation: undefined, outcome: "already there:", writeError: undefined });
  }
  if (fresh.value !== undefined) {
    const what = `tag ${args.tag} appeared at ${fresh.value}`;
    return err(GithubRefsErrors.stateChanged({ kept: undefined, what }));
  }
  const created = await api.createTag({ ...address, message: args.message, sha: args.sha, tag: args.tag });
  if (created.isErr()) {
    return settleErroredCreate({ api, args, cause: created.error.message });
  }
  // The annotation object this run made is named on every failure below: nothing else points at it if the ref is gone.
  const annotation = created.value === undefined ? "" : ` (annotation object ${created.value} was created)`;
  const after = await tagStateAfter({ api, args });
  if (after.isErr()) {
    return err(
      GithubRefsErrors.providerFailed({
        cause: after.error,
        kept: { tag: args.tag, tip: args.sha },
        step: `the read-back after GitHub accepted the tag${annotation}`,
      }),
    );
  }
  if (after.value !== args.sha) {
    const readBack = after.value === undefined ? "absent" : `at ${after.value}`;
    const ref = `tag ${args.tag}${annotation}`;
    return err(GithubRefsErrors.unconfirmed({ expected: args.sha, kept: undefined, readBack, ref }));
  }
  return ok({ annotation: created.value, outcome: "created", writeError: undefined });
}

/** Print one outcome in the selected mode. */
function report({
  annotation,
  args,
  deps,
  outcome,
}: {
  annotation: string | undefined;
  args: GithubTagArgs;
  deps: GithubTagDeps;
  outcome: string;
}): void {
  if (args.json) {
    const repo = `${args.owner}/${args.repo}`;
    deps.out(JSON.stringify({ annotation, outcome, repo, sha: args.sha, tag: args.tag }, undefined, 2));
    return;
  }
  const unclear = outcome === "there now:" ? UNCLEAR_WRITER : "";
  const object = annotation === undefined ? "" : ` (annotation object ${annotation})`;
  deps.out(`${outcome} ${args.owner}/${args.repo} tag ${args.tag} at ${args.sha}${object}${unclear}`);
}

/**
 * Parse the request and resolve its credential into a ref client, or print why not.
 *
 * @returns the parsed request, its home and client, or the exit code already reported
 */
function openTagRequest({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubTagDeps;
}): Result<{ args: GithubTagArgs; home: string; api: GithubRefsApi }, number> {
  const parsed = parseGithubTagArgs({ argv: rest });
  if (parsed.isErr()) {
    for (const problem of githubVerbErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(GITHUB_TAG_USAGE);
    return err(EXIT_USAGE);
  }
  const args = parsed.value;
  const { home = deps.home() } = args;
  const token = deps.token({ home });
  if (token === undefined) {
    deps.writeDiagnostic("no GitHub token configured; run `slopweaver connect github`");
    return err(EXIT_ERROR);
  }
  return ok({ api: deps.makeApi({ home, token }), args, home });
}

/**
 * Run the tag create.
 *
 * @param rest argv after `github tag`
 * @param deps credential, client and output seams
 * @returns the process exit code
 */
export async function runGithubTag({ rest, deps }: { rest: readonly string[]; deps: GithubTagDeps }): Promise<number> {
  const opened = openTagRequest({ deps, rest });
  if (opened.isErr()) {
    return opened.error;
  }
  const { api, args, home } = opened.value;
  const plan = await readAndPlan({ api, args });
  if (plan.isErr()) {
    plan.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    return EXIT_ERROR;
  }
  if (plan.value.kind === "refuse") {
    deps.writeDiagnostic(`refused: ${plan.value.reason}`);
    return EXIT_ERROR;
  }
  if (plan.value.kind === "present") {
    report({ annotation: undefined, args, deps, outcome: "already there:" });
    return EXIT_OK;
  }
  if (args.dryRun) {
    report({ annotation: undefined, args, deps, outcome: "would create" });
    return EXIT_OK;
  }
  const through = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => createAndConfirm({ api, args }),
    request: tagCreateDoorRequest({ args, home }),
  });
  if (!through.performed) {
    for (const line of notPerformedLines({ command: "slopweaver github tag create", through })) {
      deps.writeDiagnostic(line);
    }
    return EXIT_ERROR;
  }
  if (through.result.isErr()) {
    deps.writeDiagnostic(through.result.error.message);
    return EXIT_ERROR;
  }
  const { annotation, outcome, writeError } = through.result.value;
  if (writeError !== undefined) {
    deps.writeDiagnostic(`this run's write answered: ${writeError}`);
  }
  report({ annotation, args, deps, outcome });
  return EXIT_OK;
}

/**
 * Production GitHub and output seams.
 *
 * @returns credential, ref-client and output edges for the tag command
 */
export function productionGithubTagDeps(): GithubTagDeps {
  return {
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    makeApi: ({ home, token }) => makeGithubRefsApi({ privacy: githubWritePrivacy({ home }), token }),
    out: (line) => {
      logger.out({ line });
    },
    token: ({ home }) => githubToken({ home }),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver github tag`. */
export const githubTagCommand = defineCommand({
  run: (argv) => runGithubTag({ deps: productionGithubTagDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
