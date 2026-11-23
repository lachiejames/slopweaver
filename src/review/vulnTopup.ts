/**
 * WHICH alerts the next batch of vulnerability-fix pull requests should come from.
 *
 * A scheduled row raises "more from the Dependabot alerts as they merge", on whatever cadence, cap and
 * merge-release threshold its installation sets — `./vulnTopupGate.ts` decides WHETHER a batch goes up. This
 * module is the selection half, and it is pure — it takes the roster, the open alerts and the capacity, and
 * answers which alerts a session should go and fix. It never fixes anything: which RUNG of the ladder each one takes is judgement
 * (`skills/vulnerability-fix/SKILL.md`), and the whole design of that skill is that a verb does not choose
 * the fix.
 *
 * ## Four rules, and each is arithmetic rather than judgement
 *
 * **Never batch what is ruled not a bump.** A package the installation's not-a-bump rulings cover
 * (`../live/vuln/notABumpStore.ts`) is dropped before ranking hands out slots, and the next-ranked alert takes its
 * place. Whether a package IS one stays judgement — a seat makes it and records it — but reading the record is not.
 *
 * **One package per pull request.** The skill says so — "a reviewer approves one dependency's risk at a
 * time" — so the batch carries at most one alert per package, the worst of that package's alerts.
 *
 * **Never re-raise what is already open.** A package named by an open roster pull request is excluded, or
 * the scheduled row would raise a second pull request for the same bump on every firing until the first one
 * merged.
 *
 * **Worst first, and the tie broken by alert number.** The same order `github vuln list` prints, so the
 * batch a session is handed is the top of the list it would have read itself.
 */
import { type NotABumpRuling, packageIsNotABump } from "../live/vuln/notABumpStore.js";
import type { DependabotAlert } from "../outbound/github/dependabot.js";
import type { TopupCapacity, VulnRosterEntry } from "./vulnRoster.js";

/** All that "an open pull request names this package" reads: a title. A roster entry is one. */
export interface TitledPr {
  readonly title: string;
}

/** One package the next batch should raise a pull request for, and the alert that decides it. */
export interface VulnTopupCandidate {
  readonly packageName: string;
  readonly alertNumber: number;
  readonly cvssScore: number;
  readonly ghsaId: string;
  readonly htmlUrl: string;
  /** GitHub's own registry name for the package, when the alert carried one. */
  readonly ecosystem: string | undefined;
  /** The manifest the fix has to edit, or reach through a parent, when the alert named one. */
  readonly manifestPath: string | undefined;
  readonly severity: string | undefined;
  /** The version that first carries the fix, when the advisory names one. */
  readonly firstPatchedVersion: string | undefined;
}

/** The next batch, the alerts that backfill a slot its seat skips, and the packages a ruling kept out of both. */
export interface VulnTopupPlan {
  /** Every eligible candidate when uncapped, else at most the room left — worst CVSS first, one per package. */
  readonly batch: readonly VulnTopupCandidate[];
  /**
   * Under a cap, the next as many candidates in the same order: what a seat raises in place of a batch member no
   * bump can fix, so one hard member never leaves its slot empty or parks the batch on the owner: a hard member is skipped, never allowed to hold the whole batch. Empty when uncapped: every candidate is batched.
   */
  readonly reserve: readonly VulnTopupCandidate[];
  /** Every package a not-a-bump ruling kept out, once each, in rank order — named in the brief, never silent. */
  readonly ruledOut: readonly string[];
}

/**
 * Plan the next batch, and its backfill.
 *
 * A package a not-a-bump ruling covers is dropped before anything else, so the slot it would have taken goes to the
 * next-ranked alert — the case: a package ranked second whose seat
 * parked the whole batch on a question the owner had already answered.
 *
 * Uncapped, every eligible candidate is the batch and nothing is held in reserve — the candidate universe is a
 * complete open-alert read, so "all" is finite. Capped, the batch is the room left and the reserve the same size.
 *
 * @param alerts every OPEN Dependabot alert on the repository
 * @param entries the roster's open pull requests, so their packages are not raised twice
 * @param capacity no cap, or the row's cap and the room left under it
 * @param notABump every ruling the installation holds; only this repository's apply
 * @param repo `owner/name` the alerts are in, which a ruling must name to apply
 * @returns the batch, its reserve and what was ruled out
 */
export function vulnTopupBatch({
  alerts,
  entries,
  capacity,
  notABump,
  repo,
}: {
  alerts: readonly DependabotAlert[];
  entries: readonly VulnRosterEntry[];
  capacity: TopupCapacity;
  notABump: readonly NotABumpRuling[];
  repo: string;
}): VulnTopupPlan {
  if (capacity.kind === "capped" && capacity.remaining <= 0) {
    return { batch: [], reserve: [], ruledOut: [] };
  }
  const bestByPackage = new Map<string, DependabotAlert>();
  const ruledOut = new Set<string>();
  for (const alert of ranked({ alerts })) {
    const name = alert.dependency.packageName;
    // An alert GitHub gave no package name for cannot become "raise a pull request for X", so it is skipped
    // rather than carried as a candidate nobody can act on. It still counts in the severity tally, which is
    // a count of alerts rather than of fixable ones.
    if (name === undefined) {
      continue;
    }
    if (packageIsNotABump({ packageName: name, repo, rulings: notABump })) {
      ruledOut.add(name);
      continue;
    }
    if (packageHasOpenPr({ entries, packageName: name }) || bestByPackage.has(name)) {
      continue;
    }
    bestByPackage.set(name, alert);
  }
  const eligible = [...bestByPackage.entries()].map(([packageName, alert]) => candidateOf({ alert, packageName }));
  if (capacity.kind === "uncapped") {
    return { batch: eligible, reserve: [], ruledOut: [...ruledOut] };
  }
  const { remaining } = capacity;
  return {
    batch: eligible.slice(0, remaining),
    reserve: eligible.slice(remaining, remaining * 2),
    ruledOut: [...ruledOut],
  };
}

/**
 * Whether an open roster pull request already names this package — the ONE reading of "this package has an
 * open pull request", shared by the batch planner and the merge-release gate so the two can never disagree
 * about whether a package is being handled.
 *
 * A title word equal to the name, OR the whole name standing in the title with no package-name character
 * either side of it. The second arm exists because the word split drops punctuation a registry allows:
 * `org.springframework:spring-webmvc` splits at the colon, so a word test alone reads its own open pull
 * request as absent — which re-raises it here and, in the gate, shrinks the raised count and releases the
 * next batch early. The boundary is what keeps it honest the other way: a bare
 * substring test read an open `lodash-es` pull request as covering `lodash`, inflating the gate's raised
 * count. A sentence's closing `.` or `:` straight after the name is not part of it
 * — `bump pkg-2. Please review` names `pkg-2` — while `lodash.merge` still names neither half.
 *
 * @param entries the pull requests to look in — the roster's open ones, or a general gate's merged ones
 * @param packageName the package as the Dependabot alert names it, or a Renovate update's subject
 * @returns true when some title names it
 */
export function packageHasOpenPr({
  entries,
  packageName,
}: {
  entries: readonly TitledPr[];
  packageName: string;
}): boolean {
  const needle = packageName.toLowerCase();
  return entries.some(
    (entry) =>
      packagesNamedBy({ entry }).includes(needle) || standsDelimited({ haystack: entry.title.toLowerCase(), needle }),
  );
}

/** Characters a package name can carry, so a match flanked by one is part of a longer name. */
const NAME_CHARACTER = /[a-z0-9@/._:-]/;

/** Name characters that also close a sentence, so one with nothing name-like after it ends the name. */
const CLOSING_PUNCTUATION = /[.:]/;

/** Whether `needle` occurs in `haystack` with no package-name character directly either side of it. */
function standsDelimited({ haystack, needle }: { haystack: string; needle: string }): boolean {
  if (needle.length === 0) {
    return false;
  }
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack.charAt(at - 1);
    if (!NAME_CHARACTER.test(before) && nameEndsAt({ at: at + needle.length, haystack })) {
      return true;
    }
  }
  return false;
}

/** Whether a name running up to `at` ends there: no name character follows, or only closing punctuation does. */
function nameEndsAt({ haystack, at }: { haystack: string; at: number }): boolean {
  const next = haystack.charAt(at);
  if (!NAME_CHARACTER.test(next)) {
    return true;
  }
  return CLOSING_PUNCTUATION.test(next) && !NAME_CHARACTER.test(haystack.charAt(at + 1));
}

/**
 * The package names one open pull request already covers, lower-cased for comparison.
 *
 * Read off the TITLE, because the title is the only thing about an open pull request this layer has and
 * because the convention states the package in it. It is a word split rather than a parse: a title reading
 * "bump the lodash-es catalog entry" yields the word `lodash-es`, which covers `lodash-es` and not `lodash`,
 * without a grammar for pull-request titles. A name carrying a character the split drops is
 * {@link packageHasOpenPr}'s second arm. Every word is kept, however short: dropping two-letter ones lost
 * `ms`, a real npm package, so its own open pull request read as absent and the gate released early. A package named like a title's glue word (`to`, `fix`) is over-read instead — the
 * safe direction, since the gate then idles and the planner skips rather than raising twice.
 *
 * @param entry the open roster pull request
 * @returns the lower-cased words its title carries, for a containment test
 */
function packagesNamedBy({ entry }: { entry: TitledPr }): readonly string[] {
  return entry.title
    .toLowerCase()
    .split(/[^a-z0-9@/._-]+/)
    .filter((word) => word.length > 0);
}

/** Worst CVSS first, ties broken by alert number so two reads of the same world agree. */
function ranked({ alerts }: { alerts: readonly DependabotAlert[] }): readonly DependabotAlert[] {
  return alerts.toSorted(
    (left, right) => right.advisory.cvssScore - left.advisory.cvssScore || left.number - right.number,
  );
}

/** One alert reduced to what a session needs to start on it without re-reading the list. */
function candidateOf({ alert, packageName }: { alert: DependabotAlert; packageName: string }): VulnTopupCandidate {
  const patched = alert.vulnerableRange.firstPatchedVersion;
  return {
    alertNumber: alert.number,
    cvssScore: alert.advisory.cvssScore,
    ecosystem: alert.dependency.ecosystem,
    firstPatchedVersion: patched === undefined || patched.length === 0 ? undefined : patched,
    ghsaId: alert.advisory.ghsaId,
    htmlUrl: alert.htmlUrl,
    manifestPath: alert.dependency.manifestPath,
    packageName,
    severity: alert.advisory.severity,
  };
}

/** The three facts that decide whether one board row is still being worked, and the ask it was opened on. */
export interface TopupRowState {
  readonly slug: string;
  /**
   * The row was read from `handovers/archive/`, so it is closed work: never in flight, but still a previous
   * generation the merge-release gate reads. Absent on a live row.
   */
  readonly archived?: true;
  /**
   * The row's `summary:` — for a top-up generation, the whole brief `topupAsk` wrote, batch lines included.
   * The merge-release gate reads the previous generation's batch back off it (`./vulnTopupGate.ts`). Optional
   * because only the top-up's own reader needs it; the in-flight predicate never looks.
   */
  readonly summary?: string | undefined;
  /** `status:` — how a DOC row ends. `done`, `cancelled` and `rejected` are its terminal values. */
  readonly status: string;
  /** `settlement:` — how an ASK row ends, which is a different field and leaves `status` where it was. */
  readonly settlement: string | undefined;
  /**
   * Whether the row's RUN has no live worker behind it — its cycle has an ending, or its writer session is
   * provably dead.
   *
   * A different register from the two fields above, which is exactly why it has to be here. `status:` and
   * `settlement:` live in the doc; a run's ending lives in its journal, and `handover reap` writes
   * `orphaned` there without touching either field. So a generation whose session died reads as in flight
   * through both of the other two tests for ever, and running the reaper does not change that.
   *
   * `undefined` means the caller could not judge it — an unreadable journal, a Codex writer no open file
   * shows live — and is read as STILL IN FLIGHT. That asymmetry is `handover/reap.ts`'s own ("Why a `dead`
   * verdict is the ONLY thing reaped") and it is kept here for the same reason: an unreadable measurement
   * must not release a generation that is genuinely opening pull requests.
   */
  readonly workerGone: boolean | undefined;
  /**
   * The instant the generation's seat was PARKED with nothing to bring it back — no wake for `handover wake`
   * to judge and no question open on the owner — and no seat opened on it since. Absent on every other row.
   *
   * MEASURED: a top-up generation parked that way, its park released
   * the writer (`../handover/runRelease.ts`), `workerGone` read `undefined`, and every top-up answered idle for a
   * week while seven of its nine pull requests merged. A park is not a dead worker and not a live one: it is a
   * seat waiting to be reopened, which is what `vulnerability-fix topup` now does with it.
   */
  readonly parkedAtIso?: string;
  /**
   * The row was registered and no seat was ever dispatched on it: its journal holds neither a `dispatched` nor a
   * `started` line. `vulnerability-fix topup` registers and then spawns under one lock, so a top-up reading this under that
   * lock is reading a spawn the fleet backoff deferred (exit 4) or one that failed — never one still opening.
   * Read as in flight would idle every later top-up on a row nobody will ever seat, so it waits to
   * be reseated exactly as a park does. Absent on every other row.
   */
  readonly unseated?: true;
}

/**
 * One generation waiting to be reopened on its own slug: parked with nothing to bring it back, and when — or
 * registered with no seat ever dispatched on it.
 */
export type ParkedTopupRow =
  { readonly slug: string; readonly parkedAtIso: string } | { readonly slug: string; readonly unseated: true };

/** Which of one repository's top-up generations are still being worked, which wait to be reseated, and which were let go. */
export interface TopupInFlight {
  /** The slugs genuinely still being worked, in board order. */
  readonly inFlight: readonly string[];
  /**
   * The open generations parked with no wake and no open question, or registered with no seat ever dispatched,
   * in board order — the top-up reseats these.
   */
  readonly parked: readonly ParkedTopupRow[];
  /** The slugs an open row still names but whose worker is gone, in board order — say these out loud. */
  readonly released: readonly string[];
}

/**
 * Whether a board row means a top-up generation is still in flight.
 *
 * Reads BOTH doc endings, and that is half the point. MEASURED: a stranded generation was settled
 * `declined`, and the next top-up still answered `idle — a top-up generation is already in flight`, because
 * `handover settle` records a `settlement:` and leaves `status: ready` exactly where it was. A guard that
 * reads only one of the two ends a recipe permanently the first time a generation is settled rather than
 * marked done.
 *
 * The third test is the other half. A top-up generation's holder session died with the journal ending at
 * `launched`, and both doc fields stayed exactly where they were — so `vulnfix-digest-acme-admin` deferred
 * every slot from then on and the channel went silent for two days. A row whose worker is gone is not a
 * generation in flight; it is a lie on the board, and waiting on one is the permanent stall `AGENTS.md`
 * rule 6 names.
 *
 * Releasing it is safe for the reason the deferral itself gives: what it guards is a set ABOUT TO CHANGE
 * under the post, and a dead session opens nothing further. Every pull request it did open before dying is
 * already in the roster, because the roster is read live.
 *
 * A PARKED generation is the fourth reading, split out of the in-flight list rather than left in it (`parkedAtIso`):
 * its seat is closed and nothing will reopen it, so idling on it is the same permanent
 * stall, while releasing it would raise a second generation beside one that still has pull requests to finish.
 *
 * @param prefix the slug prefix every generation of one repository's top-up shares
 * @param rows every row on the board
 * @returns the slugs still being worked, the parked ones waiting to be reseated, and the open ones whose worker
 *   is gone
 */
export function topupRowsInFlight({ prefix, rows }: { prefix: string; rows: readonly TopupRowState[] }): TopupInFlight {
  const terminalStatus = new Set(["done", "cancelled", "rejected"]);
  const open = rows.filter(
    (row) =>
      row.archived !== true &&
      row.slug.startsWith(prefix) &&
      row.settlement === undefined &&
      !terminalStatus.has(row.status),
  );
  const held = open.filter((row) => row.workerGone !== true);
  return {
    inFlight: held.filter((row) => row.parkedAtIso === undefined && row.unseated !== true).map((row) => row.slug),
    parked: held.flatMap((row): ParkedTopupRow[] => {
      if (row.parkedAtIso !== undefined) {
        return [{ parkedAtIso: row.parkedAtIso, slug: row.slug }];
      }
      if (row.unseated === true) {
        return [{ slug: row.slug, unseated: true }];
      }
      return [];
    }),
    released: open.filter((row) => row.workerGone === true).map((row) => row.slug),
  };
}
