/**
 * The effectful edge of {@link BoardReferences}: each distinct `repo:` path's `origin` remote, and the install's
 * Linear workspace — read once per `handover list --json` / `handover row --json`, so the projection in
 * `./listJson.ts` stays pure.
 *
 * `originRepositoryOf` rather than `resolveRepository`: the question is which repository a declared PATH is,
 * not whether a verb may take the working directory as its subject. One `git remote get-url` per distinct
 * path — MEASURED, 11 distinct paths across 2,659 docs on this machine; reproduce with
 * `slopweaver handover list --json | jq -r '.rows[].repo // empty' | sort -u | wc -l`.
 */
import { originRepositoryOf, type Repository } from "../../../config.js";
import type { Result } from "../../../lib/result.js";
import { linearReferenceFacts } from "../../linearReferenceFacts.js";
import { recordReferenceFacts } from "../../recordReferenceFacts.js";
import type { BoardReferences } from "./listJson.js";
import type { Deadline } from "./probeSweep.js";

/**
 * How long every path's origin read together may take before the rest are skipped. One read is bounded at 3s
 * (`src/config.ts`), and eleven stalled paths in a row would outlast the console's 90s deadline for the whole
 * `handover list --json` (`SLOW_TIMEOUT_MS`, `site/lib/liveVerbs.ts`) and lose every card. The last read may start just inside it, so the worst case is this plus one read's bound. `handover list`
 * takes them FIRST, before its journal reads and probe sweep, so work that spends the whole `--deadline` never costs a card its
 * repository; they also stop at that deadline, so the verb's worst case stays the deadline plus one read
 * plus the ~12s the rest of it measured.
 */
export const ORIGIN_READS_BUDGET_MS = 20_000;

/**
 * Each distinct path's repository as `owner/repo`, asking `resolve` once per path until
 * {@link ORIGIN_READS_BUDGET_MS} has gone. A path it cannot resolve — not a checkout, no `origin`, not GitHub — or
 * one it never reached is simply absent, so a card resolves nothing against it.
 *
 * @param paths the docs' `repo:` paths, repeats allowed
 * @param resolve reads one path's `origin` — `originRepositoryOf` in production, a plain function in a test
 * @param now the clock, in milliseconds — `Date.now` in production, a plain function in a test
 * @param deadline the whole command's, which ends the reads early when it has gone
 * @returns path to `owner/repo`
 */
export function repositorySlugs({
  paths,
  resolve,
  now,
  deadline,
}: {
  paths: readonly string[];
  resolve: (args: { cwd: string }) => Result<Repository>;
  now: () => number;
  deadline?: Deadline | undefined;
}): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const started = now();
  for (const path of new Set(paths)) {
    if (now() - started >= ORIGIN_READS_BUDGET_MS || deadline?.expired() === true) {
      break;
    }
    const repository = resolve({ cwd: path });
    if (repository.isOk()) {
      out.set(path, `${repository.value.owner}/${repository.value.repo}`);
    }
  }
  return out;
}

/**
 * What the board's cards resolve a bare reference against, read off disk and git.
 *
 * @param home the state home the Linear directory, the Datadog census and the Vanta atlas are read from
 * @param paths every doc's `repo:` path
 * @param deadline the command's own, shared with the probe sweep after it
 * @param ownerNames the names only the owner answers to, read by the async verb shell (`boardOwnerNames`)
 * @returns the references
 */
export function boardReferences({
  home,
  paths,
  deadline,
  ownerNames,
}: {
  home: string;
  paths: readonly string[];
  deadline?: Deadline | undefined;
  ownerNames: ReadonlySet<string>;
}): BoardReferences {
  return {
    linear: linearReferenceFacts({ home }),
    ownerNames,
    // The Vanta tenant slug may come from the environment; this is the effectful edge, so it reads it here.
    records: recordReferenceFacts({ env: process.env, home }),
    repoSlugs: repositorySlugs({ deadline, now: Date.now, paths, resolve: originRepositoryOf }),
  };
}
