/**
 * The one shell both Slack corpus snapshots run through — `slack owed` and `slack awaiting`.
 *
 * Straight-line: help before any I/O, parse, fix one instant, build the verb's document, persist it only under
 * `--write`, render it, and exit 1 whenever the read is not complete — an unavailable or incomplete read is never
 * an empty success. Each verb supplies only what is its own: the usage, and how to read and render its document.
 * Neither drafts, posts or sends; there is no Slack client, model or outbound module on this path.
 */

import { slopweaverHome } from "../../../homeDir.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseSlackSnapshotOptions } from "./snapshotOptions.js";

/** The injected edges: the two write channels, the clock, and the default home. */
export interface SlackSnapshotDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The instant used when `--now` is absent. */
  readonly clockIso: () => string;
  /** The home used when `--home` is absent. */
  readonly defaultHome: () => string;
}

/** One verb's document, read and ready to print or persist. */
export interface SlackSnapshot {
  /** Whether the read saw everything it set out to — anything else exits 1. */
  readonly complete: boolean;
  /** The `--json` rendering, which is also the persisted bytes. */
  readonly json: string;
  /** The human rendering. */
  readonly text: readonly string[];
  /** Persist the document, answering the path written or why it was not. */
  readonly write: () => Result<{ readonly path: string }, IngestError>;
}

/**
 * Run one snapshot verb against injected edges.
 *
 * @param rest the argv tail after `slack <verb>`
 * @param deps the injected write channels, clock and default home
 * @param verb the verb's own name, prefixed to every diagnostic
 * @param usage the verb's usage text
 * @param snapshot reads the corpus at one instant and builds the verb's document
 * @returns the process exit code
 */
export function runSlackSnapshot({
  rest,
  deps,
  verb,
  usage,
  snapshot,
}: {
  rest: readonly string[];
  deps: SlackSnapshotDeps;
  verb: string;
  usage: string;
  snapshot: (args: { readonly home: string; readonly nowIso: string }) => SlackSnapshot;
}): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(usage);
    return EXIT_OK;
  }
  const options = parseSlackSnapshotOptions({ defaultHome: deps.defaultHome(), rest });
  if (options.isErr()) {
    options.error.forEach((problem) => {
      deps.writeDiagnostic(`${verb}: ${problem}`);
    });
    deps.writeDiagnostic(usage);
    return EXIT_USAGE;
  }
  // A destructured default: the clock is read only when `--now` was not passed.
  const { home, json, write, nowIso = deps.clockIso() } = options.value;
  const document = snapshot({ home, nowIso });
  let writtenPath: string | undefined;
  if (write) {
    const written = document.write();
    if (written.isErr()) {
      deps.writeDiagnostic(`${verb}: could not write the document, the previous one stands: ${written.error.message}`);
      return EXIT_ERROR;
    }
    writtenPath = written.value.path;
  }
  if (json) {
    deps.writeOut(document.json);
  } else {
    document.text.forEach((line) => {
      deps.writeOut(line);
    });
    if (writtenPath !== undefined) {
      deps.writeOut(`written: ${writtenPath}`);
    }
  }
  return document.complete ? EXIT_OK : EXIT_ERROR;
}

/**
 * The production edges.
 *
 * @returns the process streams, the wall clock and the installed home, swapped for plain fakes under test
 */
export function productionSlackSnapshotDeps(): SlackSnapshotDeps {
  return {
    clockIso: () => new Date().toISOString(),
    defaultHome: () => slopweaverHome(),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}
