/**
 * The post-ingest DERIVE lane of `refresh` — rule 4 of the freshness contract, "couple refresh → derive by
 * default", made real.
 *
 * It runs the same pipeline `slopweaver derive` runs, in-process, over the home that was just ingested into.
 * That is deliberate rather than a shortcut: shelling out would start a second process to do something this
 * one can do, and re-implementing the steps would be a second derive that drifts from the first.
 *
 * Nothing here is model or network work. Derive is local and deterministic, which is exactly why the contract
 * puts it on the automatic side of the line rather than behind a refusal.
 *
 * ## It is skipped when nothing it reads has moved
 *
 * Derive loads EVERY source's bronze, whichever source this refresh fetched, so a refresh of a source that
 * wrote nothing paid for the whole corpus anyway — the 7,933 MiB measured on a zero-transcript fathom run, and
 * the four-gigabyte deaths (`../../../silver/derive/currency.ts` § `silverCurrency` carries both).
 * When every input is unchanged since the stamp, the rebuild would be byte-identical, so the lane says so and
 * loads nothing. Coupling still holds: silver is current either way, and `slopweaver derive` rebuilds regardless.
 */
import { safeFs, safeFsAsync } from "#lib/safeBoundary.js";
import { type SilverCurrency, silverCurrency } from "../../../silver/derive/currency.js";
import type { ArtefactWitness } from "../../../silver/derive/freshness.js";
import { runDerivePipeline, silverArtefactPaths, writeSilverArtifacts } from "../../../silver/derive/pipeline.js";
import { observeCorpus, readArtefactWitness } from "../../../silver/derive/stamp.js";
import { type IdentityRosterPort, identityRosterPort } from "../../../silver/identityRoster.js";
import { loadDerivedRoster } from "../../../silver/loadDerivedRoster.js";
import type { RefreshSummaryLine } from "./core.js";
import type { RefreshDeps } from "./deps.js";
import type { RefreshLegFailures } from "./failureClosingLine.js";
import { emitSummaryLine } from "./summary.js";

/** The prefix every derive line carries on screen, which a failure's reason drops so the closing line says it once. */
const DERIVE_PREFIX = "derive: ";

/** The reason a failed derive stands on when it printed no error line of its own. */
const UNSTATED_DERIVE_REASON = "failed without an error-level diagnostic";

/**
 * Derive silver from what was just ingested, unless the caller opted out, and say why when it failed.
 *
 * Coupled into `refresh` rather than left to the operator because the alternative is what was measured: `refresh`
 * and `derive` are separate verbs with no coupling, so bronze could move while the identity roster stayed on
 * an earlier day, and every consumer of the roster silently used a two-day-old team.
 *
 * A derive FAILURE is not warning-only the way the hydration lanes are: silver that did not rebuild is silver
 * that no longer matches bronze, so it fails the verb. Skipping it is fine; failing at it quietly is not. The
 * production seam also skips by itself when nothing derive reads has moved ({@link productionDerive} says why),
 * which leaves silver exactly as current as a rebuild would.
 *
 * @param derive the derive seam; absent in a test deck written before the contract, which skips the lane
 * @param home the Slopweaver home
 * @param noDerive whether `--no-derive` was passed
 * @param numbersOnly whether output is being withheld
 * @param sink the refresh logger the derive lines go to
 * @returns the failures, none when silver is current (derived, or deliberately skipped)
 */
export async function runRefreshDeriveStep({
  derive,
  home,
  noDerive,
  numbersOnly,
  sink,
}: {
  readonly derive: RefreshDeps["derive"];
  readonly home: string;
  readonly noDerive: boolean;
  readonly numbersOnly: boolean;
  readonly sink: RefreshDeps["logger"];
}): Promise<RefreshLegFailures> {
  if (derive === undefined) {
    return { failures: [] };
  }
  if (noDerive) {
    emitSummaryLine({
      level: "warn",
      sink,
      text: "--no-derive: silver was NOT rebuilt, so the identity roster is now behind bronze — run `slopweaver derive`",
    });
    return { failures: [] };
  }
  // A seam that throws is a failed derive like any other, so it reaches the closing line instead of escaping it.
  const attempted = await safeFsAsync({ execute: () => derive({ home }), operation: "derive" });
  if (attempted.isErr()) {
    if (!numbersOnly) {
      emitSummaryLine({ level: "error", sink, text: `${DERIVE_PREFIX}${attempted.error.message}` });
    }
    return { failures: [{ reason: attempted.error.message, source: null }] };
  }
  const result = attempted.value;
  if (!numbersOnly) {
    for (const line of result.lines) {
      emitSummaryLine({ level: line.level, sink, text: line.text });
    }
  }
  if (result.ok) {
    return { failures: [] };
  }
  const reasons = result.lines
    .filter((line) => line.level === "error")
    .map((line) => (line.text.startsWith(DERIVE_PREFIX) ? line.text.slice(DERIVE_PREFIX.length) : line.text));
  if (reasons.length === 0) {
    return { failures: [{ reason: UNSTATED_DERIVE_REASON, source: null }] };
  }
  return { failures: reasons.map((reason) => ({ reason, source: null })) };
}

/**
 * {@link productionDerive} bound to the store's own identity roster — the seam `refresh` wires in production.
 *
 * @param home the Slopweaver home
 * @returns whether silver is now current, and the lines to report
 */
export async function liveRefreshDerive({ home }: { home: string }): ReturnType<typeof productionDerive> {
  return productionDerive({ home, identityRoster: identityRosterPort() });
}

/**
 * Derive silver from the home `refresh` just wrote, reporting what it did as summary lines — or skip it,
 * loading no corpus, when silver already reflects every input.
 *
 * The store roster is read ONCE here and that one snapshot serves both the currency judgement and the
 * rebuild, so the revision the stamp witnesses is the revision the rebuild resolved people with. A store that
 * cannot answer fails the lane: silver judged against no roster is silver nobody can trust.
 *
 * @param home the Slopweaver home
 * @param identityRoster the door the store's identity roster is read through
 * @returns whether silver is now current, and the lines to report
 */
export async function productionDerive({
  home,
  identityRoster,
}: {
  home: string;
  identityRoster: IdentityRosterPort;
}): Promise<{
  ok: boolean;
  lines: readonly RefreshSummaryLine[];
}> {
  const roster = await identityRoster.read({ home });
  if (roster.isErr()) {
    return { lines: [{ level: "error", text: `derive: ${roster.error.message}` }], ok: false };
  }
  const currency = readSilverCurrency({ home, rosterRevision: roster.value.revision });
  if (currency.kind === "current") {
    return {
      lines: [
        {
          level: "out",
          text:
            `derive: skipped — nothing derive reads has moved since silver was derived ${currency.derivedAtIso}, ` +
            "so no corpus was loaded (`slopweaver derive` rebuilds it regardless)",
        },
      ],
      ok: true,
    };
  }
  const why: RefreshSummaryLine = { level: "out", text: `derive: rebuilding — ${currency.why}` };
  const result = runDerivePipeline({ home, roster: roster.value });
  if (result.isErr()) {
    return {
      lines: [why, ...result.error.map((text) => ({ level: "error" as const, text: `derive: ${text}` }))],
      ok: false,
    };
  }
  // A failed write is a derive failure like any other, so it reaches the closing line instead of escaping it as a throw.
  const written = safeFs({
    execute: () => writeSilverArtifacts({ derivedAtIso: new Date().toISOString(), home, result: result.value }),
    operation: "writeSilverArtifacts",
  });
  if (written.isErr()) {
    return { lines: [why, { level: "error", text: `derive: ${written.error.message}` }], ok: false };
  }
  const stampPath = written.value;
  return {
    lines: [
      why,
      {
        level: "out",
        text:
          `derive: rebuilt silver from ${String(result.value.records.length)} record(s) and ` +
          `${String(result.value.memberRows.length)} member row(s) — stamped ${stampPath}`,
      },
    ],
    ok: true,
  };
}

/**
 * Read what {@link silverCurrency} judges: the roster's own verdict, the stamp and observation behind it, the
 * corpus tree the reader would walk, which artefacts are missing, and each content artefact's size and mtime to
 * pair with what the stamped derive wrote. One observation serves both halves, so they cannot disagree.
 */
function readSilverCurrency({ home, rosterRevision }: { home: string; rosterRevision: number | null }): SilverCurrency {
  const loaded = loadDerivedRoster({ home, rosterRevision });
  const onDisk: Record<string, ArtefactWitness> = {};
  const missingArtefacts: string[] = [];
  for (const [name, path] of Object.entries(silverArtefactPaths({ home }))) {
    const witness = readArtefactWitness({ path });
    if (witness === undefined) {
      missingArtefacts.push(path);
    } else if (name !== "stamp") {
      onDisk[path] = witness;
    }
  }
  return silverCurrency({
    freshness: loaded.freshness,
    missingArtefacts,
    observed: { ...loaded.observed, corpus: observeCorpus({ home }) },
    onDisk,
    stamp: loaded.stamp,
  });
}
