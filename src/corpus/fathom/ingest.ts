/**
 * The `fathom` source's ingest job — resolve the key, crawl, project, commit — wrapped in the ONE
 * per-source seam ({@link ../ingestJob.SourceIngestJob}) so recorded calls flow through the same redact,
 * dedup and JSONL write, the same pooled watermark and the same run summary as every other source.
 * Deliberately not a second door into bronze: this lane and `fathom share` (`cli/commands/fathom/shareCore.ts`,
 * for a call somebody else recorded) both commit through the one bronze committer, and only this one moves
 * the fathom watermark.
 *
 * ## A missing key is a REFUSAL with the owner's next step in it, not a crash
 *
 * The key is minted by hand in Fathom's own settings and cannot be obtained by any process here — no OAuth
 * consent to drive, no cookie to read (the owner's Chrome holds none for `fathom.video`, measured:
 * 2,489 cookies in the profile and zero for that host). So an unconfigured lane fails with
 * {@link ./errors.FathomErrors.keyMissing}, whose message carries the URL to mint one at and the verb to
 * store it with. A lane that threw, or that reported zero meetings, would look identical to an account with
 * no recordings.
 */
import { fathomApiKey } from "../../config.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type FathomApi, makeFathomApi } from "../../live/fathom/api.js";
import { createBronzeCommitter } from "../corpusWriter.js";
import { type CoverageGap, coverageGap, type SourceIngestJob } from "../ingestJob.js";
import type { CorpusRecord, ExportWindow } from "../types.js";
import { FathomErrors } from "./errors.js";
import { crawlFathomMeetings, type FathomReadCap } from "./fetch.js";
import { projectFathomMeetings } from "./project.js";

/**
 * The read bound a `--sample`/`--fetch-cap` run puts on this lane, when either was given.
 *
 * Both flags collapse to one number here for the reason they do on the diary lane: a MEETING is this
 * source's container, so capping records per container and capping the fetch mean the same thing. The
 * tighter of the two wins, so passing both never widens either. Pure.
 *
 * @param sample the `--sample` cap, when set
 * @param fetchCap the `--fetch-cap` cap, when set
 * @returns the cap to apply, or undefined for an unbounded run
 *
 * @internal — exported so the tighter-of-two rule is testable without building a whole job.
 */
export function readCap({
  sample,
  fetchCap,
}: {
  sample: number | undefined;
  fetchCap: number | undefined;
}): FathomReadCap | undefined {
  const bounds = [sample, fetchCap].filter((value): value is number => value !== undefined);
  return bounds.length === 0 ? undefined : { maxMeetings: Math.min(...bounds) };
}

/**
 * Build the `fathom` ingest job.
 *
 * The API seam is injectable so the job's ordering — crawl, project, commit, and no cursor on a gap — is
 * testable without a Fathom account. In production it resolves the stored key, which is also where a
 * missing one is refused by name.
 *
 * @param home the Slopweaver home holding the key and the bronze store
 * @param window the planned export window, used as the `created_at` filter and to name the bronze file
 * @param api the Fathom seam; omitted in production, where the stored key resolves one
 * @param sample the `--sample` cap, which bounds this lane's own commit and HOLDS its cursor
 * @param fetchCap the `--fetch-cap` cap, same effect — see {@link readCap}
 * @returns the job, ready for {@link ../ingestSource.ingestSources}
 */
export function fathomIngestJob({
  home,
  window,
  api,
  sample,
  fetchCap,
}: {
  home: string;
  window: ExportWindow;
  api?: FathomApi;
  sample?: number;
  fetchCap?: number;
}): SourceIngestJob {
  const cap = readCap({ fetchCap, sample });
  return {
    label: "fathom (recorded calls)",
    run: () => runFathomIngest({ api, cap, home, window }),
    source: "fathom",
    window,
  };
}

/** What one fathom ingest pass reports back through the shared per-source seam. */
type FathomIngestOutcome = Result<{
  records: readonly CorpusRecord[];
  warnings: readonly string[];
  notes: readonly string[];
  gaps: readonly CoverageGap[];
  committedPerContainer?: number;
}>;

/**
 * One ingest pass: resolve the seam, crawl, project, commit.
 *
 * The commit happens HERE as well as through the shared bulk write, for the reason every long crawl does
 * it: a pass that only wrote at the end would lose everything to a restart. The shared write afterwards
 * dedups what this already flushed.
 *
 * @param home the Slopweaver home
 * @param window the planned export window
 * @param api the injected seam, or undefined to resolve the stored key
 * @param cap the read bound, when the run is capped
 * @returns the records, warnings, notes and gaps for the run summary
 */
async function runFathomIngest({
  home,
  window,
  api,
  cap,
}: {
  home: string;
  window: ExportWindow;
  api: FathomApi | undefined;
  cap: FathomReadCap | undefined;
}): Promise<FathomIngestOutcome> {
  const seam = api !== undefined ? ok(api) : resolveFathomApi({ home });
  if (seam.isErr()) {
    return err([seam.error.message]);
  }
  const crawled = await crawlFathomMeetings({
    api: seam.value,
    window,
    ...(cap !== undefined ? { cap } : {}),
  });
  if (crawled.isErr()) {
    return err([crawled.error.message]);
  }
  const projected = projectFathomMeetings({ meetings: crawled.value.meetings });
  const committer = createBronzeCommitter({ home, window });
  const committed = committer.commit({ records: projected.records });
  const notes = [
    `fathom: walked ${String(crawled.value.pages)} page(s) and stored ${String(projected.records.length)} ` +
      `transcript(s) of ${String(crawled.value.meetings.length)} meeting(s) seen`,
  ];
  if (committed.isErr()) {
    // The crawl succeeded and the write did not, so what was read is NOT on disk — reported as a gap so the
    // cursor stays put and the next pass asks the same question again.
    return ok({
      gaps: [...crawled.value.gaps, `fathom: the bronze write failed (${committed.error.join("; ")})`].map((message) =>
        coverageGap({ message }),
      ),
      notes,
      records: [],
      warnings: [...crawled.value.warnings, ...projected.warnings],
    });
  }
  return ok({
    committedPerContainer: committed.value.written,
    gaps: crawled.value.gaps.map((message) => coverageGap({ message })),
    notes,
    records: projected.records,
    warnings: [...crawled.value.warnings, ...projected.warnings],
  });
}

/**
 * The production seam: the stored key, or the refusal naming what the owner must do.
 *
 * @param home the Slopweaver home the key is read from
 * @returns the API seam, or why there is none
 */
function resolveFathomApi({ home }: { home: string }): Result<FathomApi, ReturnType<typeof FathomErrors.keyMissing>> {
  const apiKey = fathomApiKey({ home });
  return apiKey === undefined ? err(FathomErrors.keyMissing()) : ok(makeFathomApi({ apiKey }));
}
