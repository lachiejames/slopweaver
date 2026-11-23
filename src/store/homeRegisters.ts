/**
 * The home registers: one row per kind of record the installation keeps under `$SLOPWEAVER_HOME`, the ONE
 * path each is measured at, and the store table it is imported into or the reason it is not.
 *
 * A declaration, so it cannot be complete — `./homeShare.ts` folds it into the page's report, carries the
 * residue no register claims, and says why each refusal in its header is there. This module holds the row
 * types and composes the rows, which live by category in `./homeRegisters/`: `coreRegisters.ts` (board, runs,
 * knowledge, identity, profile, plans), `runtimeRegisters.ts` (singletons, cmux, fleet, org health),
 * `judgementRegisters.ts` (landing and owner-judgement journals), `corpusRegisters.ts` (corpus, atlases, pages,
 * measurements, Datadog caches) and `declaredOnlyRegisters.ts` (trees too large to walk). A new row goes in its
 * category's file, and a category file nearing 300 code lines splits again.
 */
import { CORE_REGISTERS } from "./homeRegisters/coreRegisters.js";
import { CORPUS_REGISTERS } from "./homeRegisters/corpusRegisters.js";
import { DECLARED_ONLY_REGISTERS } from "./homeRegisters/declaredOnlyRegisters.js";
import { JUDGEMENT_REGISTERS } from "./homeRegisters/judgementRegisters.js";
import { RUNTIME_REGISTERS } from "./homeRegisters/runtimeRegisters.js";

/**
 * Which tier a home register belongs to, and therefore which denominator it counts against.
 *
 * `durable` is state the installation is expected to keep. `scratch` is the tier that is not migrated;
 * there is no retention policy, so nothing here is decided by age. `home reclaim` takes
 * junk out of ONE scratch register, `orchestration`, and only a finished pass's `<id>.scratch` workspace —
 * `../home/reclaim/roots.ts` carries why `supervisor-scratch` is not one of its roots.
 * It is NAMED so the page says the bound of what it measured, and
 * excluded from the durable share so that figure means something.
 *
 * @internal — reached as {@link HomeRegister.tier}.
 */
export type HomeTier = "durable" | "scratch";

/**
 * How a register's records are counted on disk.
 *
 * @internal — reached as {@link HomeRegister.shape}.
 */
export type HomeShape =
  /** One JSON object per line; the record count is the line count. */
  | "jsonl"
  /** A directory tree; the record count is every file beneath it, at any depth. */
  | "directory"
  /** A single file; the record count is one when it exists. */
  | "file";

/**
 * Whether a register can be measured inside a page's budget.
 *
 * `walk` reads every file under its path. `declared-only` names and classifies the register and takes no
 * size or count at all, because taking one costs more than the whole verb's budget.
 *
 * **This axis is independent of {@link HomeTier}, and conflating the two is the mistake this comment
 * exists to stop.** `orchestration` is `declared-only` AND durable AND mirrored — `store import-fleet`'s
 * `codex` leg projects `orchestration/<id>/record.json` into `codex_pass` — so "unmeasurable" says nothing
 * about whether a register matters or whether the store already holds it.
 *
 * @internal — reached as {@link HomeRegister.measure}.
 */
export type HomeMeasure = "walk" | "declared-only";

/**
 * Which `stateHomePaths()` field a register's path comes from.
 *
 * A KEY rather than a relative path, and that is the single-contract rule rather than a style choice:
 * `src/stateHome.ts` is the only module allowed to derive a home sub-path, and
 * `src/__tests__/unit/stateHome.guard.test.ts` fails the build on a home-path `join` anywhere else (it reads prose too, so this sentence cannot
 * spell one). So this
 * table names the field and the shell reads the absolute path out of the one contract.
 *
 * @internal — reached as {@link HomeRegister.pathKey}.
 */
export type HomeRegisterPathKey =
  | "handovers"
  | "runs"
  | "knowledgeLessonsJsonl"
  | "identityJson"
  | "profileJson"
  | "plansJson"
  | "codexSignInDir"
  | "cmuxSessionActivityJson"
  | "cmuxEventCursorJson"
  | "fleetConfigJson"
  | "fleetResumeJsonl"
  | "cmuxReviveJsonl"
  | "orgHealthIncidentsJson"
  | "orgHealthSightingsJson"
  | "orgHealthAcknowledgementsJsonl"
  | "gmailTriageRulesJson"
  | "browserJson"
  | "staleSeatNoticesJson"
  | "landingPressesJsonl"
  | "landingReadsJson"
  | "codexSupersessionsJsonl"
  | "knowledgeDomainsJson"
  | "ownerDirectivesJson"
  | "standingAsksJsonl"
  | "steerKindsJsonl"
  | "corpusBronze"
  | "atlasRoot"
  | "publishedPages"
  | "bakeoff"
  | "datadogShotsDir"
  | "evidenceDir"
  | "proofDir"
  | "datadogHits"
  | "datadogCatalogueRoot";

/** One kind of record the installation keeps under the home. */
export interface HomeRegister {
  /** What a reader calls it. */
  readonly kind: string;
  /** Which `stateHomePaths()` field holds its absolute path; absent on a `declared-only` register. */
  readonly pathKey: HomeRegisterPathKey | undefined;
  /** Whether its size is measured or only declared. */
  readonly measure: HomeMeasure;
  /** The path under `$SLOPWEAVER_HOME`, for display only — never joined onto a home. */
  readonly relativePath: string;
  readonly shape: HomeShape;
  readonly tier: HomeTier;
  /** The store table this register's records become, absent when nothing mirrors it. */
  readonly table: string | undefined;
  /**
   * Why nothing mirrors it, for a register with no table. Required by TYPE on that arm — a register
   * reported as unmirrored with no reason is a row a reader cannot weigh.
   */
  readonly unmirroredBecause: string | undefined;
  /**
   * Which of `table`'s rows are this register's, when several registers share one table. The four measurement
   * roots all project into `measurement_location`, and a whole-table count on each would report every root as
   * holding every other root's rows. Absent reads the whole table.
   */
  readonly rowFilter?: { readonly column: string; readonly value: string };
}

/**
 * Every record kind this module measures.
 *
 * Declared, and deliberately not globbed: the home holds 168 top-level entries and most are scratch,
 * backups or one-off artifacts. The rows here are the ones whose migration status is a real question.
 * The category arrays are spread in report order.
 */
export const HOME_REGISTERS: readonly HomeRegister[] = [
  ...CORE_REGISTERS,
  ...RUNTIME_REGISTERS,
  ...JUDGEMENT_REGISTERS,
  ...CORPUS_REGISTERS,
  ...DECLARED_ONLY_REGISTERS,
];
