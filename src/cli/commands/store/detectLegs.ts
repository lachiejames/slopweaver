/**
 * The three legs of a detective wave that are NOT the corpus, and the one call that runs all three.
 *
 * ## Why they left `detect.ts`
 *
 * That file is the verb — argv, the connection's lifetime, the briefs, the report — and each of these is a
 * SOURCE with its own failure mode, its own honesty clause and its own reason for existing. A third one
 * arriving (the atlases) pushed the file past its `file-size-ratchet` floor and
 * `detectWithStore` past `max-function-lines`, and the seam the gates found is the real one: a leg answers
 * "what does this source say about these keywords", and the verb answers "what does the wave do with that".
 *
 * ## The property all three share, which is the actual contract
 *
 * **A leg that could not be consulted returns a NOTE, never an error.** A wave is never failed by a source
 * that was unreachable, unbuilt or never synced — it is planned without that source, and the reader is told
 * in one line which source is missing and what would fill it. That is why every one of them returns
 * `{ leads, note }` rather than a `Result`, and it is the first thing to preserve when a fourth arrives.
 */
import { type CensusAge, censusAge } from "../../../datadog/detective/censusAge.js";
import { probeCatalogue } from "../../../datadog/detective/gate.js";
import { readCatalogue } from "../../../datadog/detective/store.js";
import { atlasLeads } from "../../../detective/atlasLead.js";
import { datadogLeads } from "../../../detective/datadogLead.js";
import type { Lead } from "../../../detective/fanout.js";
import { hexLeads } from "../../../detective/hexLead.js";
import { readHexSubjects } from "../../../detective/hexSubjects.js";
import { censusStaleAfterMs } from "../../../route/censusReadings.js";
import { type AtlasProbeExecute, runAtlasProbe } from "../../../store/atlas/probeRun.js";
import { DEFAULT_ATLAS_PROBE_CELLS } from "../atlas/probeCore.js";

/**
 * Probe the question's keywords against the LOCAL Datadog census.
 *
 * Touches no network and opens no Datadog client: the census is a file, and that is the whole point — a
 * question about a person or a decision costs nothing to rule Datadog out of. An absent catalogue is not an
 * error either; it yields no leads and one line saying why, so a wave on an install that has never built one
 * behaves exactly as it did before this existed.
 *
 * The census's AGE rides every answer, leads or none: a stale census misses every shape
 * newer than its build, and a miss is exactly where it would otherwise speak with full confidence.
 *
 * @param terms the question's keywords
 * @param home the state home the census lives under
 * @param nowMs the instant the census age is judged at
 * @returns the Datadog leads, the census age line, and one line for a reader whenever there are no leads
 */
function datadogGate({ terms, home, nowMs }: { terms: readonly string[]; home: string; nowMs: number }): {
  leads: readonly Lead[];
  age: CensusAge | null;
  note: string | null;
} {
  const catalogue = readCatalogue({ home });
  if (catalogue.isErr()) {
    return { age: null, leads: [], note: `Datadog was not consulted: ${catalogue.error.message}` };
  }
  const verdict = probeCatalogue({ catalogue: catalogue.value, keywords: terms });
  const leads = datadogLeads({ verdict });
  return {
    age: censusAge({ manifest: catalogue.value.manifest, nowMs, staleAfterMs: censusStaleAfterMs() }),
    leads,
    note:
      leads.length === 0
        ? `Datadog has nothing to say about these keywords — the census's ${String(catalogue.value.rows.length)} row(s) match none of them, so no detective was sent there`
        : null,
  };
}

/**
 * Probe the question's keywords against the LOCAL Hex atlas.
 *
 * The same shape as {@link datadogGate} and for the same reason, sharpened: a Hex read reaches customer
 * data behind Hex's own masking, so a question that names no project, no queried table and no data
 * connection must never spend a detective there. An atlas that has never had its workspace kinds filled
 * yields no leads and one line saying what would fill them.
 *
 * @param terms the question's keywords
 * @param home the state home the Hex atlas lives under
 * @returns the Hex leads, and one line for a reader whenever there are none
 */
function hexGate({ terms, home }: { terms: readonly string[]; home: string }): {
  leads: readonly Lead[];
  note: string | null;
} {
  const read = readHexSubjects({ home });
  if (read.unreadable !== null) {
    return { leads: [], note: `Hex was not consulted: ${read.unreadable}` };
  }
  if (read.subjects.length === 0) {
    return {
      leads: [],
      note: "Hex was not consulted: the atlas holds no workspace projects or connections — `slopweaver atlas hex sync` fills them once a Hex API token exists",
    };
  }
  const leads = hexLeads({ keywords: terms, subjects: read.subjects });
  return {
    leads,
    note:
      leads.length === 0
        ? `Hex has nothing to say about these keywords — none of the atlas's ${String(read.subjects.length)} project(s) and connection(s) match, so no detective was sent there`
        : null,
  };
}

/**
 * Probe the question's keywords against the ATLAS tables in the store.
 *
 * The atlases are really the best data sources there are, so keeping them from the detectives would waste them. Until
 * this, `store probe`'s SQL read `content` and nothing else while hundreds of thousands of atlas entity rows sat in five
 * tables nothing read back.
 *
 * The same shape as {@link datadogGate} and {@link hexGate}, with one difference that matters: this one
 * shares the connection the caller already opened, because the atlas tables are in the same database the
 * probe just ran against. So its failure mode is the store's own typed error rather than an unreadable
 * file, and like both siblings it degrades to a NOTE — a wave is never failed by a leg that could not be
 * consulted.
 *
 * @param terms the question's keywords
 * @param reader the open store connection
 * @returns the atlas leads, and one line for a reader whenever there are none
 */
async function atlasGate({
  terms,
  execute,
}: {
  terms: readonly string[];
  execute: AtlasProbeExecute;
}): Promise<{ leads: readonly Lead[]; note: string | null }> {
  const report = await runAtlasProbe({
    execute,
    plan: { cells: DEFAULT_ATLAS_PROBE_CELLS, platform: null, terms },
  });
  if (report.isErr()) {
    return { leads: [], note: `the atlases were not consulted: ${report.error.message}` };
  }
  if (report.value.atlasEntities === 0) {
    return {
      leads: [],
      note: "the atlases were not consulted: the store holds no atlas entity rows — `slopweaver store import-atlas` lands them",
    };
  }
  const leads = atlasLeads({ report: report.value });
  return {
    leads,
    note:
      leads.length === 0
        ? `the atlases have nothing to say about these keywords — none of the ${String(report.value.atlasEntities)} stored entity row(s) or platform names match, so no detective was sent to one`
        : null,
  };
}
/** What every leg outside the corpus contributed to one wave. */
export interface OutsideLegs {
  readonly datadog: { leads: readonly Lead[]; age: CensusAge | null; note: string | null };
  readonly hex: { leads: readonly Lead[]; note: string | null };
  readonly atlas: { leads: readonly Lead[]; note: string | null };
  /** Every leg's leads, in one list, for `planWave`'s `extra`. */
  readonly leads: readonly Lead[];
}

/**
 * Consult every source outside the corpus for one question.
 *
 * One call rather than three at the call site so a fourth leg is added HERE — where the shared contract in
 * this module's header is written down — instead of in the verb, where the three calls would drift apart.
 *
 * @param terms the question's keywords
 * @param nowMs the instant the Datadog census's age is judged at
 * @param home the state home the Datadog census and the Hex atlas live under
 * @param execute what the atlas leg runs its statements through
 * @returns each leg's own answer, plus every lead in one list
 */
export async function outsideLegs({
  terms,
  nowMs,
  home,
  execute,
}: {
  terms: readonly string[];
  nowMs: number;
  home: string;
  execute: AtlasProbeExecute;
}): Promise<OutsideLegs> {
  const datadog = datadogGate({ home, nowMs, terms });
  const hex = hexGate({ home, terms });
  const atlas = await atlasGate({ execute, terms });
  return { atlas, datadog, hex, leads: [...datadog.leads, ...hex.leads, ...atlas.leads] };
}
