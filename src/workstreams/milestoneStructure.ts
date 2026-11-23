/**
 * The STRUCTURE of a workstream's own milestones, whatever stores them: repeated ids, an edge naming itself or a
 * milestone the workstream lacks, a cycle, and which milestones lie upstream of one.
 *
 * Split out of `./milestoneGraph.ts` so the file register and the store tables (`./store/validation.ts`) judge a
 * graph by one set of rules rather than two copies that could disagree. It reads only each milestone's `id` and
 * `after`, which both shapes carry.
 *
 * Pure: no I/O, no clock.
 */

/** The two fields a structural check reads off a milestone. */
export interface MilestoneDependency {
  readonly id: string;
  /** The ids it comes after. */
  readonly after: readonly string[];
}

/**
 * Every structural problem with one workstream's milestones: a repeated id, an `after` naming itself or a milestone
 * the workstream lacks, and a cycle.
 *
 * @param owner the workstream's id, to name in each problem
 * @returns every problem, empty when the graph is coherent
 */
export function milestoneStructureProblems({
  owner,
  milestones,
}: {
  owner: string;
  milestones: readonly MilestoneDependency[];
}): readonly string[] {
  const declared = new Set(milestones.map((one) => one.id));
  const cycle = firstCycle({ milestones });
  return [
    ...repeatedIds({ milestones }).map((id) => `${owner} declares milestone ${id} twice`),
    ...milestones.flatMap((one) => edgeProblems({ declared, one, owner })),
    ...(cycle === undefined ? [] : [`${owner} milestones form a cycle: ${cycle.join(" → ")}`]),
  ];
}

/**
 * Every milestone upstream of one: those it comes after, and theirs, and so on. Edges naming an undeclared milestone
 * are skipped — {@link milestoneStructureProblems} reports them — and a cycle ends rather than recursing forever.
 *
 * @param milestoneId the milestone whose ancestors are wanted
 * @returns the ids of every transitive predecessor, never the milestone itself unless a cycle passes through it
 */
export function transitivePredecessorIds({
  milestoneId,
  milestones,
}: {
  milestoneId: string;
  milestones: readonly MilestoneDependency[];
}): ReadonlySet<string> {
  const byId = new Map(milestones.map((one) => [one.id, one]));
  const found = new Set<string>();
  const start = byId.get(milestoneId);
  if (start === undefined) {
    return found;
  }
  const pending = [...start.after];
  while (pending.length > 0) {
    const id = pending.pop()!;
    const one = byId.get(id);
    if (found.has(id) || one === undefined) {
      continue;
    }
    found.add(id);
    pending.push(...one.after);
  }
  return found;
}

/**
 * Each id declared more than once, once per repeat.
 *
 * @returns the repeated ids, in the order their repeats appear
 */
function repeatedIds({ milestones }: { milestones: readonly MilestoneDependency[] }): readonly string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const one of milestones) {
    if (seen.has(one.id)) {
      repeated.push(one.id);
    }
    seen.add(one.id);
  }
  return repeated;
}

/**
 * What is wrong with one milestone's `after` edges: one naming itself, or one naming a milestone not declared.
 *
 * @param declared every id the workstream declares
 * @returns one problem per bad edge
 */
function edgeProblems({
  declared,
  one,
  owner,
}: {
  declared: ReadonlySet<string>;
  one: MilestoneDependency;
  owner: string;
}): readonly string[] {
  return one.after.flatMap((before) => {
    if (before === one.id) {
      return [`${owner} milestone ${one.id} comes after itself`];
    }
    if (!declared.has(before)) {
      return [`${owner} milestone ${one.id} comes after ${before}, which ${owner} does not declare`];
    }
    return [];
  });
}

/**
 * The first cycle through `after` edges between declared milestones, a self-edge excluded (reported on its own).
 *
 * @returns the ids around the cycle, its first id repeated at the end, or `undefined` when there is none
 */
function firstCycle({ milestones }: { milestones: readonly MilestoneDependency[] }): readonly string[] | undefined {
  const byId = new Map(milestones.map((one) => [one.id, one]));
  const finished = new Set<string>();
  const onPath: string[] = [];
  const visit = ({ id }: { id: string }): readonly string[] | undefined => {
    const at = onPath.indexOf(id);
    if (at !== -1) {
      return [...onPath.slice(at), id];
    }
    const one = byId.get(id);
    if (finished.has(id) || one === undefined) {
      return undefined;
    }
    onPath.push(id);
    for (const before of one.after) {
      if (before === id) {
        continue;
      }
      const cycle = visit({ id: before });
      if (cycle !== undefined) {
        return cycle;
      }
    }
    onPath.pop();
    finished.add(id);
    return undefined;
  };
  for (const one of milestones) {
    const cycle = visit({ id: one.id });
    if (cycle !== undefined) {
      return cycle;
    }
  }
  return undefined;
}
