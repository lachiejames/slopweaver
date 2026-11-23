/**
 * Every job in `ci.yml` is either behind the required `build` check or on a reviewed list saying why it is not.
 *
 * ## The hole this closes
 *
 * `ci-offload-contract` proves `build` succeeding implies every REGISTERED worker succeeded, and that `build.needs`
 * equals the registered workers exactly. It never enumerated `jobs`, so a job added to `ci.yml` and to no register
 * was invisible to it: that job could go red while the required `build` stayed green and the pull request merged.
 * That is the class `site` was (it stood outside `build` while a red console merged, closed for that one job);
 * nothing stopped the next one.
 *
 * ## The property
 *
 * For every key of `jobs`, one explanation applies: it is the aggregator (`OFFLOAD_JOB`), it is listed in the file's own
 * `build.needs` (read here rather than inferred from the worker register, so a registered worker that fell out of the
 * list is caught too), or it is named in {@link UNAGGREGATED_JOBS} with a reason. A new job therefore fails the gate
 * until someone either registers its command in `OFFLOADED_COMMANDS` (so it joins `build`) or writes down, in review,
 * why it must not. That a `needs` entry is a REGISTERED worker, and reaches the verdict expression, is
 * `aggregatorFindings`' half.
 *
 * ## What it does not prove
 *
 * The reasons are reviewed claims, not machine-proved facts: this does not read branch protection (`slopweaver github
 * required-contexts` does), nor that `ci-timing` still needs `build`. And it classifies job IDs in `ci.yml` only: a second
 * workflow file, or a `name:` override colliding with a required context, is a separate property.
 *
 * Pure: it judges the file's text and touches nothing.
 */
import { isAlias, isMap, isScalar, isSeq, parseDocument, type YAMLMap } from "yaml";
import { OFFLOAD_JOB } from "./ciOffloadCommands.js";
import type { OffloadFinding } from "./ciWorkflowRead.js";

/**
 * The jobs deliberately outside `build.needs`, each with the reason its failing must not redden `build`.
 *
 * `integration` is a merge-time signal by another route and `ci-timing` is a report with no verdict, which are the
 * only legitimate reasons to be here: a job whose red should stop a landing belongs behind `build`, not on this list.
 *
 * @internal
 */
export const UNAGGREGATED_JOBS: readonly { readonly job: string; readonly why: string }[] = [
  {
    job: "integration",
    why: "its own required context beside `build` (main requires `build` and `integration`), so a red one blocks the queue directly",
  },
  {
    job: "ci-timing",
    why: "reports the completed run's job times (it needs `build`) and never reddens on a timing, so there is no verdict for `build` to carry",
  },
];

/** GitHub's job id syntax: a letter or `_`, then letters, digits, `-` or `_`. */
const JOB_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Every key under `jobs` is a plain YAML string shaped like a GitHub job id, read from the document rather than the
 * parsed object.
 *
 * `parse` turns a job map into a JavaScript object, whose keys are strings: YAML's numeric `1:` and string `"1":`
 * are two jobs to GitHub and one property here, the second silently replacing the first, so a job could sit outside
 * `build.needs` under a key the coverage check never saw. The merge key `<<` is the same shape (a plain string here,
 * a splice of another map to a merge-aware parser). Refusing a key that is not a string, or not a job id, closes both.
 * GitHub itself rejects such a job id, so no real workflow loses anything.
 *
 * @param jobs the `jobs` map node, keys still typed
 * @returns one finding per key under `jobs` that is not a job id
 */
function jobKeyFindings({ jobs }: { jobs: YAMLMap }): readonly OffloadFinding[] {
  return jobs.items
    .filter((pair) => !isScalar(pair.key) || typeof pair.key.value !== "string" || !JOB_ID.test(pair.key.value))
    .map((pair) => ({
      line: `a key under \`jobs\` is not a plain job id (${isScalar(pair.key) ? String(pair.key.value) : "a collection"}), so GitHub's job and this gate's reading of it can differ`,
    }));
}

/**
 * The aggregator's `needs` as a list of job ids, read from the typed document.
 *
 * @param jobs the `jobs` map node
 * @returns the ids, or `undefined` when `build` is not a map, its `needs` is not a plain list, or an entry is not a plain string
 */
function needsOf({ jobs }: { jobs: YAMLMap }): readonly string[] | undefined {
  const aggregator = jobs.get(OFFLOAD_JOB, true);
  const list = isMap(aggregator) ? aggregator.get("needs", true) : undefined;
  if (!isSeq(list)) {
    return undefined;
  }
  const ids = list.items.flatMap((item) => (isScalar(item) && typeof item.value === "string" ? [item.value] : []));
  return ids.length === list.items.length ? ids : undefined;
}

/**
 * Judge that every job in the workflow is the aggregator, in its `needs`, or a reasoned exclusion.
 *
 * Findings come in a fixed order — uncovered jobs in file order, then stale exclusions, then contradictions — so an
 * exact assertion is stable.
 *
 * It takes the file's TEXT rather than a parsed object: a parsed object has already folded YAML's numeric `1:` and
 * string `"1":` keys onto one property, which is the collapse {@link jobKeyFindings} refuses, so the key check and the
 * classification must read the same document.
 *
 * @param text the workflow file's contents
 * @returns one finding per job key that is not a job id, uncovered job, stale exclusion or exclusion that is also in `needs`, or
 *   a single finding when `build.needs` is not a readable list; empty means covered
 */
export function jobCoverageFindings({ text }: { text: string }): readonly OffloadFinding[] {
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    return [{ line: "the workflow does not parse as YAML, so its jobs cannot be classified", unevaluated: true }];
  }
  // Everything below reads the typed document, never `toJS`, which folds every key onto a string property: a `jobs`
  // reached any way but a plain map (an explicit `!!merge`, say) is not classified, so it fails closed as unevaluated.
  const node = document.get("jobs", true);
  // `jobs: *anchor` is the whole map by reference, so its keys are the aliased map's.
  const jobs = isAlias(node) ? node.resolve(document) : node;
  if (!isMap(jobs)) {
    return [{ line: "the workflow has no plain `jobs` map to classify", unevaluated: true }];
  }
  const keys = jobKeyFindings({ jobs });
  if (keys.length > 0) {
    return keys;
  }
  const present = jobs.items.flatMap((pair) => (isScalar(pair.key) ? [String(pair.key.value)] : []));
  const needsList = needsOf({ jobs });
  if (needsList === undefined) {
    // Nothing can be shown to sit behind a list that is not there, so this is a finding rather than a clean answer.
    return [
      {
        line: `\`jobs.${OFFLOAD_JOB}.needs\` is missing or is not a list of job ids, so no job can be shown to sit behind it`,
      },
    ];
  }
  const needs = new Set<unknown>(needsList);
  const excluded = new Set(UNAGGREGATED_JOBS.map((entry) => entry.job));
  const uncovered = present
    .filter((job) => job !== OFFLOAD_JOB && !needs.has(job) && !excluded.has(job))
    .map((job) => ({
      line: `\`jobs.${job}\` is outside \`jobs.${OFFLOAD_JOB}.needs\` and on no exclusion list, so it can go red while the required \`${OFFLOAD_JOB}\` check stays green`,
    }));
  const stale = UNAGGREGATED_JOBS.filter((entry) => !present.includes(entry.job)).map((entry) => ({
    line: `the exclusion for \`jobs.${entry.job}\` names a job that is not in the workflow, so it would pre-approve a future job of that name`,
  }));
  const contradictions = UNAGGREGATED_JOBS.filter((entry) => needs.has(entry.job) || entry.job === OFFLOAD_JOB).map(
    (entry) => ({
      line: `\`jobs.${entry.job}\` is on the exclusion list and is also the aggregator or in \`jobs.${OFFLOAD_JOB}.needs\` — it cannot be both`,
    }),
  );
  return [...uncovered, ...stale, ...contradictions];
}
