/**
 * The landings half of the voice's context pack: first-parent commits on the base ref over the last day.
 * One read-only `git log` against the checkout `talk code` already resolves, with a constant argv shape and
 * no write on any path — the same class as `./checkout.ts`'s own git reads.
 */
import { execFileSync } from "node:child_process";

import { gitEnv } from "#lib/gitRepo.js";
import { err, ok, type Result } from "#lib/result.js";

import type { PackLanding } from "./contextPack.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/**
 * Read `git log --format=%H%x09%cI%x09%s` output into landings, skipping any line that is not that shape.
 *
 * @param text the command's stdout
 * @returns the landings, in the order git printed them (newest first)
 */
export function landingsOfGitLog({ text }: { text: string }): readonly PackLanding[] {
  const out: PackLanding[] = [];
  for (const line of text.split("\n")) {
    const [sha, atIso, ...subject] = line.split("\t");
    if (sha === undefined || atIso === undefined || subject.length === 0 || !/^[0-9a-f]{7,64}$/u.test(sha)) {
      continue;
    }
    out.push({ atIso, sha: sha.slice(0, 9), subject: subject.join("\t") });
  }
  return out;
}

/**
 * The first-parent commits on `base` since an instant, read from the checkout at `root`.
 *
 * @param root the checkout to read, as `resolveTalkCheckout` returned it
 * @param base the ref whose first-parent line is walked
 * @param sinceIso the oldest commit instant to include
 * @returns the landings, or the one-line reason git could not answer
 */
export function readLandingsSince({
  root,
  base,
  sinceIso,
}: {
  root: string;
  base: string;
  sinceIso: string;
}): Result<readonly PackLanding[]> {
  try {
    const text = execFileSync(
      "git",
      ["-C", root, "log", "--first-parent", `--since=${sinceIso}`, "--format=%H%x09%cI%x09%s", base],
      {
        encoding: "utf8",
        env: gitEnv(),
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        killSignal: "SIGKILL",
        timeout: GIT_READ_TIMEOUT_MS,
      },
    );
    return ok(landingsOfGitLog({ text }));
  } catch (cause) {
    return err([`git log ${base} failed: ${String(cause).split("\n")[0]!}`]);
  }
}
