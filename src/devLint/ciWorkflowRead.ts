/**
 * Reading a GitHub Actions workflow document, apart from judging one.
 *
 * Split out of `./ciOffloadContract.ts` when that file crossed its own size floor. The seam is
 * real rather than convenient: everything here answers "what does this document SAY", with no opinion about
 * what it ought to say, and it is shared by every contract gate over `ci.yml`. The judgement — which jobs
 * must exist, which keys are unsafe, which expression the aggregator must carry — stays with the gate that
 * holds that property.
 *
 * Every reader here is DEFENSIVE by the same rule, and it is the rule rather than a style: a shape this
 * module cannot read literally answers `undefined` rather than a guess. A gate then reports that as a
 * finding of its own. The alternative — filtering an unreadable member away and judging the rest — reads a
 * document nobody wrote, which is how a `shell:` template and two `actions/checkout` spellings each walked
 * past an earlier matcher.
 */
import { isRecord } from "../lib/parsers.js";

/** One broken part of a contract over the workflow, as `dev lint` prints it. */
export interface OffloadFinding {
  readonly line: string;
  /**
   * True when the gate could not EVALUATE the workflow at all — it did not parse, or it has no `jobs` map.
   * A fact about the input, not a contract judged and found broken, so it never earns the four-line policy
   * refusal. A workflow that HAS jobs but lacks one a contract needs is judged, not unevaluated: the work
   * really does run nowhere.
   */
  readonly unevaluated?: true;
}

/**
 * One job's map, read defensively.
 *
 * @param workflow the parsed workflow document
 * @param job the job id
 * @returns the job's map, or `undefined` when there is no such job
 */
export function jobOf({ workflow, job }: { workflow: unknown; job: string }): Record<string, unknown> | undefined {
  if (!isRecord(workflow) || !isRecord(workflow["jobs"])) {
    return undefined;
  }
  const entry = workflow["jobs"][job];
  return isRecord(entry) ? entry : undefined;
}

/**
 * A job's steps, REJECTING a malformed list rather than filtering its bad members away — a list with one
 * unreadable step is not a list the gate has read.
 *
 * @param job the job's map
 * @returns every step, or `undefined` when `steps` is absent, not a list, or holds a non-map
 */
export function stepsOf({ job }: { job: Record<string, unknown> }): readonly Record<string, unknown>[] | undefined {
  const steps = job["steps"];
  if (!Array.isArray(steps)) {
    return undefined;
  }
  const records = steps.filter((step: unknown): step is Record<string, unknown> => isRecord(step));
  return records.length === steps.length ? records : undefined;
}

/**
 * A step's `run:` block, trimmed.
 *
 * @param step one step's map
 * @returns the trimmed run text, or `undefined` for a `uses:` step
 */
export function runOf({ step }: { step: Record<string, unknown> }): string | undefined {
  const run = step["run"];
  return typeof run === "string" ? run.trim() : undefined;
}

/**
 * The unsafe keys a map carries.
 *
 * @param map a job or step map
 * @param keys the keys that are not allowed on it
 * @returns the keys present, in `keys` order
 */
export function presentKeys({
  map,
  keys,
}: {
  map: Record<string, unknown>;
  keys: readonly string[];
}): readonly string[] {
  return keys.filter((key) => key in map);
}

/**
 * The action a step uses, normalised the way GitHub resolves one.
 *
 * Owner and repository are case-insensitive and a trailing `/` before the `@` is an empty subpath, so
 * `Actions/checkout@v4` and `actions/checkout/@v4` are both `actions/checkout`. Two Codex review rounds
 * walked exactly those two spellings past a matcher that compared the string as written.
 *
 * @param step one step's map
 * @returns the owner/repo, lower-cased and without a version or subpath, or undefined for a `run:` step
 */
export function actionOf({ step }: { step: Record<string, unknown> }): string | undefined {
  const uses = step["uses"];
  if (typeof uses !== "string") {
    return undefined;
  }
  const [reference] = uses.toLowerCase().split("@");
  return reference === undefined ? undefined : reference.replace(/\/+$/, "");
}

/**
 * Whether a step is a checkout, whatever spelling it arrived in.
 *
 * Matched through {@link actionOf} rather than on the written string, which is what closed the review round
 * that slipped a second checkout of `main` past the gate by capitalising one letter.
 *
 * @param step one step's map
 * @returns true when the step uses actions/checkout, however it was spelled
 */
export function isCheckout({ step }: { step: Record<string, unknown> }): boolean {
  return actionOf({ step }) === "actions/checkout";
}
