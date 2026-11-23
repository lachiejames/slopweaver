/**
 * One monitor's open hand-step cards folded against what it reads now: which subjects arrived, which
 * departed, which came back beside a leftover card, and every open card grouped by the subject it is an
 * occurrence of. Pure — `./pass.ts` does every write this decides.
 */
import { type ArrivalDecision, foldArrivals } from "./arrival.js";
import { handStepId, MONITOR_STEP_PREFIX, type MonitorDefinition, occurrenceBase } from "./registry.js";
import type { ClearReading, FiringReading, MonitorReading, MonitorSubject, SteeredReading } from "./types.js";

/** The subjects a firing reading carries, and nothing for the other two states. */
function subjectsOf({ reading }: { reading: MonitorReading }): readonly MonitorSubject[] {
  if (reading.state === "firing") {
    return reading.subjects;
  }
  return [];
}

/**
 * The step ids currently open for one monitor.
 *
 * Matched by the monitor's own `mon-<prefix>-` opening rather than by recomputing every possible subject key:
 * a subject that has DEPARTED cannot be enumerated from what the monitor can see now, which is exactly the
 * set this function has to return for the settle half to work at all.
 *
 * @param openIds every open hand-step id in the register
 * @param prefix the monitor's short token
 * @returns the ids this monitor owns
 */
export function openIdsForMonitor({
  openIds,
  prefix,
}: {
  openIds: readonly string[];
  prefix: string;
}): ReadonlySet<string> {
  return new Set(openIds.filter((id) => id.startsWith(`${MONITOR_STEP_PREFIX}${prefix}-`)));
}

/**
 * Every open id grouped under the base id it was posted as an occurrence of.
 *
 * @param ids one monitor's open step ids
 * @returns base id → every open occurrence of it
 */
function openGroupsByBase({ ids }: { ids: Iterable<string> }): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const base = occurrenceBase({ id });
    const group = groups.get(base);
    if (group === undefined) {
      groups.set(base, [id]);
    } else {
      group.push(id);
    }
  }
  return groups;
}

/**
 * One monitor's open cards folded against its reading: which subjects arrived, which departed, and which
 * came back while a later subject's card was still open, stand on a card that disagrees with them about
 * carrying a decision, or declare a `recut` delivery over their own open card — news its standing note does not
 * yet say (`./fleetHealthDelta.ts`). Each of those is re-posted as a fresh occurrence and its old card superseded.
 *
 * @param openIds every open hand-step id, of every monitor
 * @param openWithDecision the open ids whose recorded step carries a decision
 * @returns the fold, the open cards grouped by base, and the returned bases
 */
export function foldOpenCards({
  definition,
  openIds,
  openWithDecision,
  reading,
}: {
  definition: MonitorDefinition;
  openIds: readonly string[];
  openWithDecision: ReadonlySet<string>;
  reading: FiringReading | ClearReading | SteeredReading;
}): { folded: ArrivalDecision; openByBase: Map<string, string[]>; returned: ReadonlySet<string> } {
  // Matched by BASE id, so a subject's second card (`<base>.2`) is still that subject's card — and grouped,
  // because two passes racing can each post one.
  const monitorIds = [...openIdsForMonitor({ openIds, prefix: definition.prefix })];
  const openByBase = openGroupsByBase({ ids: monitorIds });
  const stepIdOf = ({ subject }: { subject: MonitorSubject }): string =>
    handStepId({ prefix: definition.prefix, subject });
  const current = subjectsOf({ reading });
  const returned = new Set([
    ...returnedBases({
      current: new Set(current.map((subject) => stepIdOf({ subject }))),
      definition,
      ids: monitorIds,
    }),
    ...undecidedBases({ current, openByBase, openWithDecision, stepIdOf }),
    ...current
      .filter((subject) => subject.delivery?.kind === "recut" && openByBase.has(stepIdOf({ subject })))
      .map((subject) => stepIdOf({ subject })),
  ]);
  const folded = foldArrivals({
    current,
    openStepIds: new Set([...openByBase.keys()].filter((base) => !returned.has(base))),
    stepIdOf,
  });
  // A reading that could not enumerate its subjects at all — `claude-plan-unusable` over a register that does not
  // read — departs nothing: a card missing from it was never observed clearing, and the subject it DID read is not
  // their replacement.
  if (reading.state === "firing" && reading.preservesDepartures === true) {
    return { folded: { ...folded, departed: [] }, openByBase, returned };
  }
  return { folded, openByBase, returned };
}

/**
 * The current subjects whose open card disagrees with them about CARRYING a decision, in either direction —
 * re-posted rather than left standing, exactly as a returned set is, so the old card settles as superseded.
 *
 * A card is recorded once and never rewritten, so a card posted before its monitor carried a decision would
 * otherwise stay open for as long as the set stays stopped, drawn with no problem, options or stakes — a useless
 * card, kept alive by the fix for it. The other direction
 * is the same defect reversed: a `recipe-stopped` card still asking restart, repair or retire after the owner's ruling
 * took that choice away would stand for as long as its set did. Presence, never equality: a
 * decision's own text moves with every missed slot, and comparing it would re-post every pass.
 *
 * @param current the subjects the reading carries
 * @param openByBase this monitor's open cards, grouped by base id
 * @param openWithDecision the open ids whose recorded step carries a decision
 * @param stepIdOf the base id a subject posts under
 * @returns the bases to re-post
 */
function undecidedBases({
  current,
  openByBase,
  openWithDecision,
  stepIdOf,
}: {
  current: readonly MonitorSubject[];
  openByBase: ReadonlyMap<string, readonly string[]>;
  openWithDecision: ReadonlySet<string>;
  stepIdOf: (options: { subject: MonitorSubject }) => string;
}): readonly string[] {
  return current
    .filter((subject) => {
      const open = openByBase.get(stepIdOf({ subject }));
      if (open === undefined) {
        return false;
      }
      const wants = subject.decision !== undefined;
      return open.some((id) => openWithDecision.has(id) !== wants);
    })
    .map((subject) => stepIdOf({ subject }));
}

/**
 * The current subjects of a floating WHOLE-SET monitor that stand beside an open card for some OTHER subject.
 *
 * A per-subject monitor is excluded: its other open cards are other subjects' — one plan recovered while another
 * stays faulted — and reading the still-faulted one as returned would supersede a card its fault still backs and float
 * its note again. A departed subject's card there settles through the ordinary fold.
 *
 * A whole-set floating monitor has one subject, the set, so any other open card is a set whose replacement never
 * settled it — the register lock was held, say. Seeing its own old card still open, the pass would read a set
 * that came back as one that never left, and raise no note though it changed twice.
 * Which card is older cannot decide it: `--now` may record instants out of order. So a
 * current subject beside a leftover always posts a fresh occurrence, which raises the note, and its old cards
 * settle as superseded once that post is recorded. The cost is one extra note after a settlement failed;
 * a failure that persists posts nothing, because the post takes the same register lock the settlement did.
 *
 * @param current the base id of every subject the reading carries
 * @param ids this monitor's open step ids
 * @returns the bases to re-post rather than treat as present
 */
function returnedBases({
  current,
  definition,
  ids,
}: {
  current: ReadonlySet<string>;
  definition: MonitorDefinition;
  ids: readonly string[];
}): ReadonlySet<string> {
  const bases = new Set(ids.map((id) => occurrenceBase({ id })));
  const leftover = [...bases].some((base) => !current.has(base));
  if (definition.floats !== true || definition.perSubject === true || !leftover) {
    return new Set();
  }
  return new Set([...bases].filter((base) => current.has(base)));
}
