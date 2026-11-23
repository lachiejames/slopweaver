/**
 * The old-history push guard: once the state home binds a repository to a fresh root
 * (`./pushRootRegistry.ts`), a push to that repository may send only commits whose history has exactly that one
 * root. A repository whose history was re-cut keeps its `owner/name`, so every older checkout's `origin` still
 * points at it, and one push of a branch carrying the old history would publish that history.
 *
 * **The criterion is the SET of parentless ancestors, never "the root is an ancestor".** A merge joining the old
 * history to the fresh root descends from the root and still carries everything the re-cut left out, so a
 * pushed commit passes only when `git rev-list --max-parents=0` names the recorded root and nothing else. A
 * shallow clone reports its boundary as parentless, so it refuses there too, naming the shallow history as why.
 *
 * Three seams call it, because none of them alone sees every push:
 *   - `./githubPush.ts`'s `pushAndVerify`, the one chokepoint for `github push`, `stack push|adopt`, the stack
 *     step executor and a worktree salvage — which disables hooks, so the hook alone would miss it;
 *   - `github stack submit`'s admission, before its dry-run stop, so a preview discloses the refusal and no
 *     safe prefix of a stack is sent before an unsafe head;
 *   - the repository's `pre-push` hook (`./pushRootGuardCli.ts`), for a raw `git push` from any tool.
 * A client hook is not a boundary: `git push --no-verify`, a changed `core.hooksPath` or a removed hook skip it.
 * The verbs' own seams do not depend on the hook.
 *
 * What it judges is the push URL, `git remote get-url --push --all`, never the fetch URL: a configured
 * `pushurl` is where the objects actually go. A remote that is not shaped like `owner/name` (a local path) is not
 * a GitHub coordinate and is never matched; a proxy remote that forwards elsewhere cannot be seen through.
 */

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusalLines } from "../hatch/render.js";
import { githubRepoFromRemote } from "../lib/githubRemote.js";
import { err, ok, type Result } from "../lib/result.js";
import { type PushRootBinding, type PushRootRegistry, pushRootForRepository } from "./pushRootRegistry.js";
import { readPushRootState } from "./pushRootStore.js";

/** The caller's isolated Git reader: `cwd` alone selects the repository, and a failure throws. */
type ReadGit = (args: { cwd: string; args: readonly string[] }) => string;

/** Why a push may not go: the guard's one refusal, its four hatch lines included. */
export interface OldHistoryPushError {
  readonly code: "OLD_HISTORY_PUSH";
  readonly message: string;
  readonly lines: readonly string[];
}

/** What git writes for an absent object: a deletion's local sha in the pre-push stdin. */
const ZERO_SHA = "0".repeat(40);

/** The hatch every refusal here names. */
const HATCH_ID = "old-history-push";

/**
 * Whether the operator opened the old-history hatch for this one run.
 *
 * Spelled out rather than derived, because the `escape-hatch` gate joins a row to its reader by this literal.
 *
 * @param env the environment, read only for the hatch
 * @returns true when `SLOPWEAVER_ALLOW_OLD_HISTORY_PUSH=1` is set
 */
function oldHistoryPushHatchOpen({ env }: { env: Readonly<Record<string, string | undefined>> }): boolean {
  return env["SLOPWEAVER_ALLOW_OLD_HISTORY_PUSH"] === "1";
}

/**
 * The refusal, as lines: what this push saw, then the hatch's four lines.
 *
 * @param findings one line per thing that failed, printed above the hatch block
 * @param detail the short reason appended to the hatch's standing one
 * @returns the typed refusal
 */
function refusal({ findings, detail }: { findings: readonly string[]; detail: string }): OldHistoryPushError {
  const lines = [
    "nothing was sent:",
    ...findings.map((line) => `  ${line}`),
    ...hatchRefusalLines({ detail, hatch: hatchFor({ id: HATCH_ID }) }),
  ];
  return { code: "OLD_HISTORY_PUSH", lines, message: lines.join("\n") };
}

/**
 * The local sha of every ref line git feeds a `pre-push` hook: `<local ref> <local sha> <remote ref> <remote sha>`.
 * A line of any other shape is returned as unparseable, so the hook refuses rather than skips it.
 *
 * @param stdin what git wrote to the hook's stdin
 * @returns the local shas in order, or the first line that is not a ref line
 */
export function prePushLocalShas({ stdin }: { stdin: string }): Result<readonly string[], string> {
  const shas: string[] = [];
  for (const line of stdin.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const fields = line.trim().split(/\s+/);
    const localSha = fields[1];
    if (fields.length !== 4 || localSha === undefined || !/^[0-9a-fA-F]{40}$/.test(localSha)) {
      return err(line);
    }
    shas.push(localSha.toLowerCase());
  }
  return ok(shas);
}

/**
 * Every URL a push to `remote` sends to. A configured remote answers with its push URLs (`pushurl`, else `url`); a
 * name no remote carries is the URL itself, the way `git push <url>` reads it.
 *
 * @param readGit the isolated Git reader
 * @param repoRoot the repository pushing
 * @param remote the remote name, or a literal URL
 * @returns the push URLs, never empty
 */
export function pushUrlsOf({
  readGit,
  repoRoot,
  remote,
}: {
  readGit: ReadGit;
  repoRoot: string;
  remote: string;
}): readonly string[] {
  let text: string;
  try {
    text = readGit({ args: ["remote", "get-url", "--push", "--all", remote], cwd: repoRoot });
  } catch {
    return [remote];
  }
  const urls = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return urls.length === 0 ? [remote] : urls;
}

/**
 * What one pushed commit fails, judged against a binding: nothing when its history has exactly the bound root.
 *
 * @param readGit the isolated Git reader
 * @param repoRoot the repository pushing
 * @param sha the commit the push would send
 * @param binding the target repository's binding
 * @returns the finding line, or undefined when the commit carries only the fresh history
 */
function ancestryFinding({
  readGit,
  repoRoot,
  sha,
  binding,
}: {
  readGit: ReadGit;
  repoRoot: string;
  sha: string;
  binding: PushRootBinding;
}): string | undefined {
  let roots: readonly string[];
  try {
    // `--no-replace-objects`: a `refs/replace` entry would have git walk a substitute history while the push
    // sends the original objects. `^{commit}` peels an annotated tag; a tag to a tree or blob fails here.
    roots = readGit({
      args: ["--no-replace-objects", "rev-list", "--max-parents=0", `${sha}^{commit}`],
      cwd: repoRoot,
    })
      .split("\n")
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0);
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    return `${sha.slice(0, 12)}: its history could not be read (${why}), so it is not proved to descend from ${binding.rootSha.slice(0, 12)}`;
  }
  if (roots.length === 1 && roots[0] === binding.rootSha) {
    return undefined;
  }
  const shallow = isShallow({ readGit, repoRoot });
  const named = roots.length === 0 ? "no root" : roots.map((root) => root.slice(0, 12)).join(", ");
  const suffix = shallow ? "; this clone is shallow, so fetch the full history (git fetch --unshallow) and retry" : "";
  return `${sha.slice(0, 12)}: its history's roots are ${named}, not only ${binding.rootSha.slice(0, 12)}${suffix}`;
}

/** Whether the repository is a shallow clone, whose boundary commits read as parentless. */
function isShallow({ readGit, repoRoot }: { readGit: ReadGit; repoRoot: string }): boolean {
  try {
    return readGit({ args: ["rev-parse", "--is-shallow-repository"], cwd: repoRoot }).trim() === "true";
  } catch {
    return false;
  }
}

/**
 * The bindings the push's URLs name, one per repository whatever the URL's case or spelling.
 *
 * @param pushUrls every URL the push sends to
 * @param registry the push-root register
 * @returns each bound target once, in URL order
 */
function boundTargets({
  pushUrls,
  registry,
}: {
  pushUrls: readonly string[];
  registry: PushRootRegistry;
}): readonly PushRootBinding[] {
  const bindings = new Map<string, PushRootBinding>();
  for (const url of pushUrls) {
    const repository = githubRepoFromRemote({ url });
    if (repository === undefined) {
      continue;
    }
    const binding = pushRootForRepository({ registry, repository });
    if (binding !== undefined) {
      bindings.set(binding.repository.toLowerCase(), binding);
    }
  }
  return [...bindings.values()];
}

/**
 * Every pushed commit that fails a bound target, as one line per pair. A forty-zero deletion sends nothing, so it
 * is skipped.
 *
 * @param bindings the bound targets
 * @param localShas every commit the push would send
 * @param readGit the isolated Git reader
 * @param repoRoot the repository pushing
 * @returns the finding lines, empty when every commit carries only the fresh history
 */
function historyFindings({
  bindings,
  localShas,
  readGit,
  repoRoot,
}: {
  bindings: readonly PushRootBinding[];
  localShas: readonly string[];
  readGit: ReadGit;
  repoRoot: string;
}): readonly string[] {
  const shas = [...new Set(localShas.map((sha) => sha.toLowerCase()))].filter((sha) => sha !== ZERO_SHA);
  const findings: string[] = [];
  for (const binding of bindings) {
    for (const sha of shas) {
      const finding = ancestryFinding({ binding, readGit, repoRoot, sha });
      if (finding !== undefined) {
        findings.push(`${binding.repository} ← ${finding}`);
      }
    }
  }
  return findings;
}

/**
 * Refuse a push that would send old history into a re-cut repository.
 *
 * No register in the home means nothing is guarded and no Git object is read. A register that is present and
 * unreadable refuses every push, whatever the target, because reading it as empty would wave through exactly
 * what it exists to stop. Every commit is judged before the verdict, so one refusal names all of them.
 *
 * @param home the state home the register lives in
 * @param readGit the isolated Git reader
 * @param repoRoot the repository pushing
 * @param pushUrls every URL the push sends to ({@link pushUrlsOf}), asked for only once a register is present, so an
 *   unguarded install pays no remote read
 * @param localShas every commit the push would send; a forty-zero deletion is skipped
 * @param env the environment, read only for the hatch
 * @returns nothing when the push may go, or the refusal
 */
export function refuseOldHistoryPush({
  home,
  readGit,
  repoRoot,
  pushUrls,
  localShas,
  env,
}: {
  home: string;
  readGit: ReadGit;
  repoRoot: string;
  pushUrls: () => readonly string[];
  localShas: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
}): Result<void, OldHistoryPushError> {
  if (oldHistoryPushHatchOpen({ env })) {
    return ok(undefined);
  }
  const state = readPushRootState({ home });
  if (state.isErr()) {
    return err(refusal({ detail: "the push-root register is unreadable", findings: [state.error.message] }));
  }
  if (state.value.kind === "absent") {
    return ok(undefined);
  }
  const bindings = boundTargets({ pushUrls: pushUrls(), registry: state.value.registry });
  if (bindings.length === 0) {
    return ok(undefined);
  }
  const findings = historyFindings({ bindings, localShas, readGit, repoRoot });
  if (findings.length === 0) {
    return ok(undefined);
  }
  const targets = bindings.map((binding) => binding.repository).join(", ");
  return err(refusal({ detail: `${targets} accepts only its recorded root`, findings }));
}
