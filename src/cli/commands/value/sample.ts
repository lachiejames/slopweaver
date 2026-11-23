/**
 * `slopweaver value sample` — draw this week's value sample, keep it, publish its page and place its one Queue card.
 *
 * ## Why it exists
 *
 * Whether the fleet's finished work gets used is a fact only the owner holds. Once a week this draws five asks that
 * ended, at random, with what each cost and what it produced, and asks the owner one word per ask: used, not used, or
 * not yet. The weekly `value-sample-weekly` row (`../../../live/automation/standingMeasurementRows.ts`) runs it.
 *
 * ## A re-run in the same week changes nothing the owner already sees
 *
 * The week's sample is kept (`../../../value/store.ts`) and a re-run reads it back rather than drawing again, so a
 * retried Monday firing republishes the same page and finds the card it already placed. A card the owner settled or
 * archived is never placed again, and once every ask is answered no card is placed at all.
 *
 * Exits `EXIT_EXPECTED_EMPTY` (3) when no ask ended in the window: the row ran and there was nothing to sample, so
 * it stamps. A board that will not scan, or a sample that will not read or write, exits 1.
 *
 * Effectful edge only: which asks are drawn and kept is `./sampleDraw.ts`; the draw, the cost join, the card and the
 * page are pure, under `../../../value/`.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { localDayKey } from "../../../briefing/localDay.js";
import { readExactDoc } from "../../../handover/store.js";
import { slopweaverHome } from "../../../homeDir.js";
import { productionPublishPage } from "../../../pages/productionPublish.js";
import type { PagePublisher } from "../../../pages/publish.js";
import { botSelfHandlesFromProfile } from "../../../profileStore.js";
import { parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogTextStrict } from "../../../sessions/sessionStore.js";
import { scanSpend } from "../../../sessions/spendStore.js";
import { valueSampleAsk, valueSampleAskArgv, valueSampleFragment, valueSampleSlug } from "../../../value/render.js";
import type { SeatSpawn } from "../../../value/sample.js";
import { sampleComplete, type ValueSample } from "../../../value/store.js";
import { sampleWeekOf } from "../../../value/week.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { teeLeg } from "../automation/collectLeg.js";
import { slugClaimant } from "../automation/fleetCeilingDelivery.js";
import { registerAskRow } from "../handover/askRowRun.js";
import { runHandoverArtifact } from "../handover/closeRun.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { productionFetchPrClosure } from "../sweep/endedRead.js";
import { readBoardAskRows } from "./boardRead.js";
import { flag, parseValueSampleArgs, SAMPLE_USAGE, VERB_ARG_OFFSET } from "./core.js";
import { type SampleDrawDeps, weekSample } from "./sampleDraw.js";

/** What the card step did. */
export type CardReceipt = "placed" | "existing" | "settled" | "not-needed";

/** Everything `value sample` touches outside itself, injected so a test drives the whole verb. */
export interface ValueSampleDeps extends SampleDrawDeps {
  readonly nowIso: () => string;
  readonly publish: PagePublisher;
  readonly placeCard: (args: {
    home: string;
    sample: ValueSample;
    day: string;
    pageUrl: string;
  }) => Promise<Result<CardReceipt>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `value sample` against injected seams.
 *
 * @param rest the argv tail after `value sample`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runValueSample({
  deps,
  rest,
}: {
  deps: ValueSampleDeps;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SAMPLE_USAGE);
    return EXIT_OK;
  }
  const parsed = parseValueSampleArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(SAMPLE_USAGE);
    return EXIT_USAGE;
  }
  let home = slopweaverHome();
  const named = flag({ name: "home", values: parsed.value.values });
  if (named !== undefined) {
    home = named;
  }
  const nowIso = deps.nowIso();
  const week = sampleWeekOf({ nowIso });
  if (week === undefined) {
    deps.writeDiagnostic(`value sample: the clock read ${nowIso}, which names no week`);
    return EXIT_ERROR;
  }
  const sampled = await weekSample({ deps, home, nowIso, week });
  if (sampled.isErr()) {
    deps.writeDiagnostic(`value sample: ${sampled.error.join("; ")}`);
    return EXIT_ERROR;
  }
  if (sampled.value === undefined) {
    deps.writeDiagnostic(`value sample: no ask ended filed or answered in the seven days before ${nowIso}`);
    return EXIT_EXPECTED_EMPTY;
  }
  const { kept, sample } = sampled.value;
  const slug = valueSampleSlug({ week });
  const published = await deps.publish({ fragment: valueSampleFragment({ sample }), home, nowIso, slug });
  if (published.isErr()) {
    deps.writeDiagnostic(`value sample: the page was not published: ${published.error.join("; ")}`);
    return EXIT_ERROR;
  }
  const pageUrl = published.value.url;
  const card = await deps.placeCard({ day: localDayKey({ iso: sample.drawnIso }), home, pageUrl, sample });
  if (card.isErr()) {
    deps.writeDiagnostic(`value sample: the card was not placed: ${card.error.join("; ")}`);
    return EXIT_ERROR;
  }
  const source = kept ? "kept from an earlier run this week" : "drawn now";
  deps.writeOut(`value sample: ${week}, ${String(sample.asks.length)} of ${String(sample.eligible)} asks, ${source}`);
  deps.writeOut(`  page ${pageUrl}`);
  deps.writeOut(`  card ${slug}: ${card.value}`);
  return EXIT_OK;
}

/**
 * Place the week's card once, attaching the page to a card placed now — the fleet-ceiling card's read-before-create
 * (`../automation/fleetCeilingDelivery.ts`). A complete sample places none.
 *
 * @param home the state home the card is written under
 * @param sample the week's sample
 * @param day the local day it was drawn
 * @param pageUrl the page the card links to
 * @returns what was done, or why the card could not be placed
 */
export async function placeValueSampleCard({
  day,
  home,
  pageUrl,
  sample,
}: {
  day: string;
  home: string;
  pageUrl: string;
  sample: ValueSample;
}): Promise<Result<CardReceipt>> {
  if (sampleComplete({ sample })) {
    return ok("not-needed");
  }
  const handoverDir = resolveHandoverDir({ dir: undefined, home });
  const ask = valueSampleAsk({ day, sample });
  const standing = readExactDoc({ handoverDir, slug: ask.slug });
  if (standing.isErr()) {
    return err([standing.error.message]);
  }
  if (standing.value !== undefined) {
    const settled = standing.value.archived || standing.value.doc.settlement !== undefined;
    return ok(settled ? "settled" : "existing");
  }
  const claimed = slugClaimant({ handoverDir, slug: ask.slug });
  if (claimed.isErr()) {
    return err([claimed.error.message]);
  }
  if (claimed.value !== undefined) {
    return ok(claimed.value);
  }
  const registered = await teeLeg({
    run: () => registerAskRow({ argv: valueSampleAskArgv({ ask, home }), origin: "automation", out: logger.out }),
  });
  if (registered.value !== EXIT_OK) {
    return err([`handover register exited ${String(registered.value)}: ${registered.text}`]);
  }
  const attached = await teeLeg({
    run: () =>
      runHandoverArtifact(["node", "slopweaver", "handover", "artifact", ask.slug, "--url", pageUrl, "--home", home]),
  });
  if (attached.value !== EXIT_OK) {
    return err([`handover artifact exited ${String(attached.value)}: ${attached.text}`]);
  }
  return ok("placed");
}

/** Every seat the session ledger recorded with a slug. */
function readLedgerSpawns({ home }: { home: string }): Result<readonly SeatSpawn[]> {
  let text: string;
  try {
    text = readSessionLogTextStrict({ home });
  } catch (cause) {
    return err([cause instanceof Error ? cause.message : String(cause)]);
  }
  return ok(
    parseSessionLog({ text }).events.flatMap((event) => {
      if (event.kind !== "spawned" || event.slug === undefined) {
        return [];
      }
      return [{ cwd: event.cwd, slug: event.slug }];
    }),
  );
}

/**
 * The real seams.
 *
 * @param projectsDir the transcript corpus to walk
 * @returns the production dependencies for {@link runValueSample}
 */
export function productionValueSampleDeps({ projectsDir }: { projectsDir: string }): ValueSampleDeps {
  return {
    // Built at each read rather than up front, so a run with nothing to sample never reads the GitHub token.
    fetchPr: (ref) => productionFetchPrClosure({ home: slopweaverHome() })(ref),
    nowIso: () => new Date().toISOString(),
    placeCard: placeValueSampleCard,
    publish: productionPublishPage,
    readRows: readBoardAskRows,
    readSpawns: readLedgerSpawns,
    readTranscripts: ({ home, sinceMs }) => {
      const scanned = scanSpend({
        botHandles: botSelfHandlesFromProfile({ home, reader: "value sample" }),
        projectsDir,
        sinceMs,
      });
      if (scanned.isErr()) {
        return err([scanned.error.message]);
      }
      scanned.value.problems.forEach((problem) => {
        logger.error({ msg: `value sample: ${problem} — a cost may be short` });
      });
      return ok(scanned.value.transcripts);
    },
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** The transcript corpus named by `--projects-dir`, else the live one. */
function projectsDirOf({ rest }: { rest: readonly string[] }): string {
  const parsed = parseValueSampleArgs({ rest });
  if (parsed.isOk()) {
    const named = flag({ name: "projects-dir", values: parsed.value.values });
    if (named !== undefined) {
      return named;
    }
  }
  return join(homedir(), ".claude", "projects");
}

/** `slopweaver value sample`. */
export const valueSampleCommand = defineCommand({
  run: (argv) => {
    const rest = argv.slice(VERB_ARG_OFFSET);
    return runValueSample({ deps: productionValueSampleDeps({ projectsDir: projectsDirOf({ rest }) }), rest });
  },
});
