/**
 * The tick row's cross-field checks — what `./tickSchema.ts`'s parser applies after the shape has read, each one
 * catching a row that would still PARSE and then be silently wrong on the page. Why each is a refusal rather than a
 * warning is in that module's header; this is only where the checks live.
 *
 * Pure — no clock, no filesystem.
 */
import { REQUIRED_TICK_SOURCES, type SupervisorTickRow, type TickSourceKind } from "./tickTypes.js";

/**
 * Every source whose observation is missing from a row.
 *
 * @param sources the row's sources object
 * @returns one line naming every missing source, or none
 */
function missingSourceDefects({
  sources,
}: {
  sources: Readonly<Partial<Record<TickSourceKind, unknown>>>;
}): readonly string[] {
  const absent = REQUIRED_TICK_SOURCES.filter((kind) => sources[kind] === undefined);
  if (absent.length === 0) {
    return [];
  }
  return [
    `sources: ${absent.join(", ")} carr${absent.length === 1 ? "ies" : "y"} no observation. A step the tick ` +
      "did not run is recorded `unavailable` with a diagnostic — silence reads on the page as a clean result.",
  ];
}

/**
 * Every observation instant that falls outside the tick's own interval.
 *
 * @param row the row, already shape-valid
 * @returns one line per source read outside `[startedIso, finalisedIso]`
 */
function intervalDefects({ row }: { row: SupervisorTickRow }): readonly string[] {
  const started = Date.parse(row.startedIso);
  const finalised = Date.parse(row.finalisedIso);
  return REQUIRED_TICK_SOURCES.flatMap((kind) => {
    const observation = row.sources[kind];
    const observed = Date.parse(observation.observedAtIso);
    if (observed < started || observed > finalised) {
      return [
        `sources.${kind}.observedAtIso ${observation.observedAtIso} is outside the tick's own interval ` +
          `${row.startedIso} … ${row.finalisedIso} — an observation from another tick, not this one`,
      ];
    }
    return [];
  });
}

/**
 * Every id that appears twice inside one row.
 *
 * @param row the row, already shape-valid
 * @returns one line per duplicate, naming the field and the id
 */
function duplicateIdDefects({ row }: { row: SupervisorTickRow }): readonly string[] {
  const defects: string[] = [];
  const actionIds = new Set<string>();
  for (const action of row.actions) {
    if (actionIds.has(action.actionId)) {
      defects.push(
        `actions: two entries share actionId ${action.actionId} — a projection cannot prove it rendered both`,
      );
    }
    actionIds.add(action.actionId);
  }
  const judgementIds = new Set<string>();
  for (const judgement of row.judgements) {
    if (judgementIds.has(judgement.judgementId)) {
      defects.push(
        `judgements: two entries share judgementId ${judgement.judgementId} — a projection cannot prove it rendered both`,
      );
    }
    judgementIds.add(judgement.judgementId);
  }
  // Owner turns are deliberately NOT checked for a unique pointer. An action and a judgement are minted by
  // this code, so a shared id is our defect and refusing one catches it; a turn is decoded off a transcript
  // this code did not write, so a shared pointer is upstream — and refusing it would drop BOTH turns and
  // the whole tick with them. MEASURED: two
  // distinct turns carrying one pointer made the recorder exit 1 and append zero lines. A projection that
  // needs to count turns keys them by their position, never by the pointer.
  return defects;
}

/**
 * Every cross-field defect in a shape-valid row, except the `stats` check the parser makes beside its own counter:
 * a missing source, a negative interval, an observation outside the interval and a duplicated id.
 *
 * @param row the row, already shape-valid
 * @returns one line per defect, empty for a sound row
 */
export function tickRowDefects({ row }: { row: SupervisorTickRow }): readonly string[] {
  const defects = [...missingSourceDefects({ sources: row.sources })];
  if (Date.parse(row.finalisedIso) < Date.parse(row.startedIso)) {
    defects.push(`finalisedIso ${row.finalisedIso} is before startedIso ${row.startedIso}`);
  }
  defects.push(...intervalDefects({ row }));
  defects.push(...duplicateIdDefects({ row }));
  return defects;
}
