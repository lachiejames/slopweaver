/**
 * Which unlanded branches declare a credential this checkout's register does not — the attribution the
 * `secrets-registry` gate prints beside a stray store file.
 *
 * The store is shared by every checkout on the machine and the register is per checkout, so a file written by
 * `secrets set` from a branch that legitimately carries its row reads as undeclared from every other checkout.
 * Measured: a branch's `store-url` refused every push on the machine, and the refusal told each
 * bystander to add a row for a credential it knew nothing about, or to delete a peer's working file.
 *
 * ## Why the pickaxe only nominates, and the branch TIP decides
 *
 * `git log -S` returns every commit that changes how often the string occurs — the commit that REMOVES a row
 * as well as the one that adds it, and a commit that merely mentions it in prose. Both reproduce in a throwaway repository, so containment
 * alone would name a branch that added the row and later dropped it. A branch is named only when the register
 * at its current tip still carries the exact row.
 *
 * ## Validate the exact string you print
 *
 * Attribution broke the same way three times: a ref was validated by its tip SHA and then
 * printed under a name that pointed at a different ref — `origin/peer` folded into `peer`, a trailing U+00A0
 * trimmed, an invalid byte decoded to U+FFFD. So a ref is read
 * as its FULL name and validated with `git show <that exact string>:<register>`, and that same string is
 * returned. Whatever git or decoding does to a name, the ref printed is the ref checked.
 *
 * ## Residue, stated rather than discovered
 *
 * - The pickaxe can miss an introduction whose commit leaves the string's total count unchanged, so an empty
 *   answer means "no branch found", never "no branch declares it" — the gate keeps its old remedy then.
 * - A stale remote-tracking ref is local evidence, not proof the remote branch still exists.
 * - A ref whose name git cannot hand back intact (invalid UTF-8 bytes, say) is validated as the string it
 *   decodes to, so it can only be under-reported, never attributed to a different branch.
 * - A row landed and later retired on our history is excluded only through its own commits; a peer branch cut
 *   before the retirement whose tip still carries the row is named.
 *
 * None of these can turn the gate clean: attribution only changes a message, and every fault answers none.
 */
import { execFileSync } from "node:child_process";

import { gitEnv } from "../lib/gitRepo.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** The register's composition root, which also held every row on a branch cut before the category files. */
export const REGISTRY_PATH = "src/secrets/registry.ts";

/**
 * Every path a row may stand in, as git pathspecs: the composition root, and the category directory whose
 * files hold the rows. A directory rather than a list of files, so a new category file is searched without
 * anyone adding it here.
 */
const REGISTER_HISTORY_PATHS = [REGISTRY_PATH, "src/secrets/credentials"] as const;

/**
 * Whether a register's text declares `name` as a row — the exact `name: "<name>",` field line the register
 * writes for every entry, so prose, a longer name sharing the prefix, or another field never counts.
 *
 * @param content the register source at some revision
 * @param name the credential file name
 * @returns true when a row declares exactly that name
 */
export function declaresName({ content, name }: { content: string; name: string }): boolean {
  const row = `name: "${name}",`;
  return content.split("\n").some((line) => line.trim() === row);
}

/**
 * The branches, local and remote-tracking, whose register tip declares `name` — in the composition root or
 * any file under the category directory ({@link REGISTER_HISTORY_PATHS}) — while this checkout's history
 * never introduced it. Every git fault answers none, which only drops the attribution from the message.
 *
 * MEASURED over 1,776 refs: the pickaxe took 0.27s and containment 0.09s. Reproduce:
 * `time git log --all --format=%H -S 'name: "store-url"' -- src/secrets/registry.ts src/secrets/credentials`.
 *
 * @param name the undeclared store file
 * @param root the checkout whose HEAD decides what counts as landed
 * @returns each declaring ref's full name (`refs/heads/peer`, `refs/remotes/origin/peer`), sorted and deduplicated
 */
export function unlandedBranchesDeclaring({ name, root }: { name: string; root: string }): readonly string[] {
  const git = ({ args }: { args: readonly string[] }): string =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      env: gitEnv(),
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
  // Never trimmed: see "Validate the exact string you print" above. Git ends every line with a bare `\n`.
  const lines = ({ text }: { text: string }): readonly string[] => text.split("\n").filter((line) => line.length > 0);
  try {
    const head = git({ args: ["rev-parse", "HEAD"] }).trim();
    const commits = lines({
      text: git({
        args: ["log", "--all", `^${head}`, "--format=%H", "-S", `name: "${name}"`, "--", ...REGISTER_HISTORY_PATHS],
      }),
    });
    const refs = new Set<string>();
    for (const sha of commits) {
      const listed = git({
        args: ["for-each-ref", `--contains=${sha}`, "--format=%(symref)\t%(refname)", "refs/heads", "refs/remotes"],
      });
      for (const [symref, ref] of lines({ text: listed }).map((line) => line.split("\t"))) {
        if (symref === "" && ref !== undefined && ref.length > 0) {
          refs.add(ref);
        }
      }
    }
    const declaresAt = ({ ref, path }: { ref: string; path: string }): boolean => {
      try {
        return declaresName({ content: git({ args: ["show", `${ref}:${path}`] }), name });
      } catch {
        return false;
      }
    };
    const declaring = [...refs].filter((ref) => {
      try {
        // NUL-separated, because a plain listing C-quotes a non-ASCII name and `git show` finds no such path.
        const paths = git({ args: ["ls-tree", "-r", "-z", "--name-only", ref, ...REGISTER_HISTORY_PATHS] })
          .split("\0")
          .filter((path) => path.length > 0);
        return paths.some((path) => declaresAt({ path, ref }));
      } catch {
        return false;
      }
    });
    return declaring.toSorted();
  } catch {
    return [];
  }
}
