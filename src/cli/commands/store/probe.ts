/**
 * `slopweaver store probe | groups | hits | peek | open | around` — the progressive-disclosure ladder.
 *
 * Three thin effectful shells here, the counting rungs; the reading rungs `peek`, `open` and `around` are
 * {@link ./probeDisclose}. Every parser and every rendered line is pure ({@link ./probeCore}), every
 * statement is pure ({@link ../../../store/probe/sql}), and what is left here is open → run → emit → close.
 *
 * ## What these verbs are FOR, which is not "a nicer search"
 *
 * Detectives get verbs instead of a database handle: hand-written queries on the fly miss records, while one
 * command can fan out the ten search queries with every combination of wildcards, and that is much easier for
 * an agent to run.
 *
 * The ladder is a reading ORDER, and each rung costs more than the one above it: counts, then where the
 * counts concentrate, then one page of records, then a window of one record, then the whole record, then
 * what was being said around it. A detective that starts at the bottom reads a million rows to find four.
 *
 * **No verb here defaults its database**, exactly as the rest of `store` does: every one refuses without
 * `SLOPWEAVER_STORE_URL`, because a tool that picks its own database is a tool that can run against the
 * wrong one.
 */

import { logger } from "../../../lib/logger.js";
import { runHits } from "../../../store/probe/hits.js";
import { runGroups, runProbe } from "../../../store/probe/run.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { storeTail } from "./core.js";
import { parseDatadogGroupsArgs, parseDatadogHitsArgs, parseDatadogProbeArgs, routesToDatadog } from "./datadogCore.js";
import { groupsOverDatadog, hitsOverDatadog, probeOverDatadog } from "./datadogRun.js";
import { parseGroupsArgs, parseHitsArgs, parseProbeArgs } from "./probeCore.js";
import { groupLines, hitLine, probeLines } from "./probeLines.js";
import { emit, openOrRefuse, wantedHelp } from "./probeShell.js";
import { GROUPS_USAGE, HITS_USAGE, PROBE_USAGE } from "./probeUsage.js";
import { refuseParsed as refuse } from "./shell.js";

/**
 * Fan every keyword across the seven shapes over the whole store, and report the counts.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreProbe(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (wantedHelp({ rest, usage: PROBE_USAGE })) {
    return EXIT_OK;
  }
  if (routesToDatadog({ rest })) {
    const asked = parseDatadogProbeArgs({ rest });
    return asked.isErr()
      ? refuse({ error: asked.error, usage: PROBE_USAGE })
      : probeOverDatadog({ json: asked.value.json, scope: asked.value.scope, terms: asked.value.terms });
  }
  const args = parseProbeArgs({ rest });
  if (args.isErr()) {
    return refuse({ error: args.error, usage: PROBE_USAGE });
  }
  const opened = await openOrRefuse();
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const report = await runProbe({
      plan: {
        enumerateAtOrBelow: args.value.enumerateAtOrBelow,
        ids: args.value.ids,
        includeBots: args.value.includeBots,
        source: args.value.source,
        subjects: args.value.subjects,
      },
      reader: opened.client,
    });
    if (report.isErr()) {
      logger.error({ msg: report.error.message });
      return EXIT_ERROR;
    }
    emit({ json: args.value.json, lines: probeLines({ report: report.value }), payload: report.value });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

/**
 * Split one shape's hits by container, author, source or kind — where the noise actually lives.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreGroups(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (wantedHelp({ rest, usage: GROUPS_USAGE })) {
    return EXIT_OK;
  }
  if (routesToDatadog({ rest })) {
    const asked = parseDatadogGroupsArgs({ rest });
    return asked.isErr() ? refuse({ error: asked.error, usage: GROUPS_USAGE }) : groupsOverDatadog({ ...asked.value });
  }
  const args = parseGroupsArgs({ rest });
  if (args.isErr()) {
    return refuse({ error: args.error, usage: GROUPS_USAGE });
  }
  const opened = await openOrRefuse();
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const groups = await runGroups({
      facet: args.value.facet,
      includeBots: args.value.includeBots,
      limit: args.value.limit,
      reader: opened.client,
      shape: args.value.shape,
      term: args.value.term,
    });
    if (groups.isErr()) {
      logger.error({ msg: groups.error.message });
      return EXIT_ERROR;
    }
    emit({
      json: args.value.json,
      lines: groupLines({ facet: args.value.facet, groups: groups.value, includeBots: args.value.includeBots }),
      payload: {
        facet: args.value.facet,
        groups: groups.value,
        includeBots: args.value.includeBots,
        shape: args.value.shape,
        term: args.value.term,
      },
    });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

/**
 * List one page of the records one shape selected, newest first.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreHits(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (wantedHelp({ rest, usage: HITS_USAGE })) {
    return EXIT_OK;
  }
  if (routesToDatadog({ rest })) {
    const asked = parseDatadogHitsArgs({ rest });
    return asked.isErr() ? refuse({ error: asked.error, usage: HITS_USAGE }) : hitsOverDatadog({ ...asked.value });
  }
  const args = parseHitsArgs({ rest });
  if (args.isErr()) {
    return refuse({ error: args.error, usage: HITS_USAGE });
  }
  const opened = await openOrRefuse();
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const hits = await runHits({
      includeBots: args.value.includeBots,
      limit: args.value.limit,
      offset: args.value.offset,
      reader: opened.client,
      shape: args.value.shape,
      source: args.value.source,
      term: args.value.term,
    });
    if (hits.isErr()) {
      logger.error({ msg: hits.error.message });
      return EXIT_ERROR;
    }
    emit({
      json: args.value.json,
      lines: [
        ...hits.value.map((hit) => hitLine({ hit })),
        `${String(hits.value.length)} record(s) from offset ${String(args.value.offset)}${args.value.includeBots ? "" : " — human authors only; --include-bots widens"}`,
      ],
      payload: hits.value,
    });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

export const storeProbeCommand = defineCommand({ run: runStoreProbe });
export const storeGroupsCommand = defineCommand({ run: runStoreGroups });
export const storeHitsCommand = defineCommand({ run: runStoreHits });
