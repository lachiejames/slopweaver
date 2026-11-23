/**
 * The PURE human report `store detect` prints for a planned wave, split out of `./detect.ts` along the
 * rendering boundary: that file decides the wave and writes its briefs, and this one only says it.
 *
 * The discovery lead is bound to no keyword and no source, and its line says so — `(discovery)` and
 * `(any source)` are what those two absences MEAN for a lead, named where the lead is rendered.
 */

import type { Lead, Wave } from "../../../detective/fanout.js";
import { type NameFinding, nameFindingLines } from "../../../detective/nameProbe.js";

/** One detective's assignment, as the wave writes it down. */
export interface DetectAssignment {
  readonly brief: string;
  readonly report: string;
  readonly lead: Lead;
}

/** Which keyword put a lead on the board — `(discovery)` for the lead bound to none. */
function keywordWord({ lead }: { lead: Lead }): string {
  const keyword = lead.keyword;
  if (keyword === null) {
    return "(discovery)";
  }
  return keyword;
}

/** Which source a lead's records are in — `(any source)` for the lead bound to none. */
function sourceWord({ lead }: { lead: Lead }): string {
  const source = lead.source;
  if (source === null) {
    return "(any source)";
  }
  return source;
}

/**
 * The human report a planned wave prints.
 *
 * @param briefs where each detective's brief and report live
 * @param question the question the whole wave is answering
 * @param wave the leads, the deferrals and the cells too wide to be either
 * @param datadogAge how old the census the Datadog leads came from is, or nothing when there is no census
 * @param datadogNote why Datadog contributed no lead, or nothing when it did
 * @param hexNote why Hex contributed no lead, or nothing when it did
 * @param atlasNote why the atlases contributed no lead, or nothing when they did
 * @param finding what the pre-planning name step came to, or nothing when it did not run
 * @param nameSkipped why the name step did not run despite being asked for
 * @param outNote why the wave's directory is somewhere `turn freeze` will not look, or nothing
 * @returns the lines
 */
export function waveLines({
  outNote,
  briefs,
  question,
  wave,
  datadogAge,
  datadogNote,
  hexNote,
  atlasNote,
  finding,
  nameSkipped,
}: {
  briefs: readonly DetectAssignment[];
  question: string;
  wave: Wave;
  datadogAge: string | null;
  datadogNote: string | null;
  hexNote: string | null;
  atlasNote: string | null;
  finding: NameFinding | null;
  nameSkipped: string | null;
  outNote: string | null;
}): readonly string[] {
  const deferred =
    wave.deferred.length === 0
      ? []
      : [`${String(wave.deferred.length)} lead(s) deferred past the ceiling — carried, not dropped`];
  const name = nameFindingLines({ finding });
  return [
    `${String(wave.detectives)} detective(s) for "${question}"`,
    "",
    ...(nameSkipped === null ? [] : [nameSkipped, ""]),
    ...(name.length === 0 ? [] : [...name, ""]),
    ...briefs.map((each, index) =>
      [
        `${String(index + 1).padStart(3)}. ${keywordWord({ lead: each.lead })} / ${sourceWord({ lead: each.lead })} — ${each.lead.why}`,
        `     brief: ${each.brief}`,
        `     report: ${each.report}`,
      ].join("\n"),
    ),
    "",
    ...(wave.tooWide.length === 0 ? [] : ["too wide to be a lead without splitting first:"]),
    ...wave.tooWide.map((lead) => `   - ${lead.why}`),
    ...deferred,
    ...(datadogAge === null ? [] : [datadogAge]),
    ...(datadogNote === null ? [] : [datadogNote]),
    ...(hexNote === null ? [] : [hexNote]),
    ...(atlasNote === null ? [] : [atlasNote]),
    ...(outNote === null ? [] : [outNote]),
    "",
    "Spawn one sub-agent per brief, model haiku, IN PROCESS. Never let one spawn another.",
  ];
}
