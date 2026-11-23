/**
 * The injectable edges of the supervisor-scratch verbs, with the three helpers that read nothing else.
 *
 * Split out of {@link ./scratchRun.js} (the file-size ratchet): that module now states what each verb does with
 * a directory, and this one states what the verbs may reach OUTSIDE the filesystem — a child process, the
 * clock, the readings ledger and the store's autonomy ledger — and the one production wiring of them.
 */
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";
import type { Result } from "#lib/result.js";

import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import { type BuiltState, builtRootOfBin } from "../../../builtCli/builtState.js";
import { readBuiltState, waitForBuiltTree } from "../../../builtCli/builtStateRead.js";
import type { RebuildWaitOutcome } from "../../../builtCli/consoleRebuildWait.js";
import { resolveRepository } from "../../../config.js";
import { recordReading } from "../../../readings/store.js";
import type { ChildOutcome } from "../../../supervisor/scratch/childOutcome.js";
import type { ScratchError } from "../../../supervisor/scratch/errors.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { runChildToFiles } from "./scratchChild.js";

/**
 * Everything the three verbs reach outside the filesystem, injected so a test drives them whole.
 *
 * @internal — read by this module, `scratchRun.ts`, `scratchLedger.ts` and their own tests.
 */
export interface ScratchDeps {
  /**
   * Run one `slopweaver` child with its stdout and stderr streamed to two files, killed once it overruns
   * `timeoutMs`, and say how it ended.
   */
  readonly runChild: (args: {
    bin: string;
    argv: readonly string[];
    stdoutPath: string;
    stderrPath: string;
    timeoutMs: number;
  }) => Promise<ChildOutcome>;
  /** Where the built tree a `slopweaver` binary runs stands against its source, now. */
  readonly readBuild: (args: { bin: string }) => BuiltState;
  /** Wait, bounded, for a fresh build to replace the stale manifest `judgedText` beside that binary. */
  readonly waitForBuild: (args: { bin: string; judgedText: string }) => Promise<RebuildWaitOutcome>;
  /** The current instant, as ISO. */
  readonly now: () => string;
  /** The `slopweaver` binary a child is launched from when `--bin` is absent. */
  readonly defaultBin: () => string;
  /** The `owner/name` a bare reference belongs to when `--repo` is absent. */
  readonly defaultRepo: () => Result<string>;
  /**
   * Append one completed JSON reading to the readings ledger. Answers the ledger's own refusal message on
   * failure, and the row's id when it was written.
   */
  readonly recordReading: (args: {
    home: string | undefined;
    by: string;
    producer: string;
    document: string;
    observedAtIso: string;
  }) => Result<string, string>;
  /** The store's autonomy ledger, which `refresh-run` copies into the scratch directory with references qualified. */
  readonly autonomy: AutonomyLedgerPort;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Print a refusal and pick its exit code: a usage mistake is 2, everything else 1.
 *
 * @param verb the verb name, for the prefix
 * @param error the failure
 * @param usage the verb's usage text, printed after a usage mistake
 * @param deps the injected seams
 * @returns the exit code
 */
export function refuse({
  verb,
  error,
  usage,
  deps,
}: {
  verb: string;
  error: ScratchError;
  usage: string;
  deps: ScratchDeps;
}): number {
  deps.writeDiagnostic(`supervisor ${verb}: ${error.message}`);
  if (error.code === "USAGE") {
    deps.writeDiagnostic(usage);
    return EXIT_USAGE;
  }
  return EXIT_ERROR;
}

/**
 * The binary a child launches from: the one `--bin` named, and this build's own when it named none.
 *
 * @param bin the binary `--bin` named, when one was
 * @param deps the injected seams
 * @returns the binary path
 */
export function chosenBin({ bin, deps }: { bin: string | undefined; deps: ScratchDeps }): string {
  if (bin === undefined) {
    return deps.defaultBin();
  }
  return bin;
}

/**
 * The real seams, shared by `supervisor tick` which runs the same capture and refresh.
 *
 * @returns the production dependencies
 */
export function productionScratchDeps(): ScratchDeps {
  return {
    autonomy: autonomyLedgerPort(),
    defaultBin: () => join(installedTreeRoot({ importMetaUrl: import.meta.url }), "bin", "slopweaver"),
    defaultRepo: () => resolveRepository().map((repository) => `${repository.owner}/${repository.repo}`),
    now: () => new Date().toISOString(),
    readBuild: ({ bin }) => readBuiltState({ builtRoot: builtRootOfBin({ bin }) }),
    recordReading: ({ home, by, producer, document, observedAtIso }) =>
      recordReading({
        by,
        document,
        nowIso: new Date().toISOString(),
        observedAtIso,
        producer,
        ...(home === undefined ? {} : { home }),
      })
        .map((receipt) => receipt.record.readingId)
        .mapErr((failure) => failure.message),
    runChild: runChildToFiles,
    waitForBuild: ({ bin, judgedText }) => waitForBuiltTree({ builtRoot: builtRootOfBin({ bin }), judgedText }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}
