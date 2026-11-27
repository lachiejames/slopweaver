/**
 * `slopweaver supervisor hand-off hold|release --reason "<why>"` — the owner's override on automatic chair hand-off.
 * A hold stops the control plane handing the chair off while it stands, and `supervisor chair-watch` reports what
 * it holds back; a release lifts it. Both append one line to the hold journal
 * (`../../../supervisor/chairHandOffHold.ts`), the latest line deciding.
 *
 * These two bodies are registered under the `hand-off` verb by its own manifest entry; this file owns only the
 * parse, the append and the one line printed.
 */
import { logger } from "../../../lib/logger.js";
import { type ChairHandOffHoldKind, recordChairHandOffHold } from "../../../supervisor/chairHandOffHold.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagTailSpec, parseFlagTail, resolveHome } from "../../optionParsers.js";

/** `supervisor hand-off hold`'s usage. */
const HAND_OFF_HOLD_USAGE =
  'usage: slopweaver supervisor hand-off hold --reason "<why>" [--home <dir>]\n' +
  "\n" +
  "Holds automatic chair hand-off until a release: `supervisor chair-watch` reports HELD with what the hold\n" +
  "holds back, and the control plane hands nothing off while it stands. The reason is required and recorded.";

/** `supervisor hand-off release`'s usage. */
const HAND_OFF_RELEASE_USAGE =
  'usage: slopweaver supervisor hand-off release --reason "<why>" [--home <dir>]\n' +
  "\n" +
  "Lifts the owner's hold on automatic chair hand-off; the next `supervisor chair-watch` pass judges as usual.";

/** The flags both verbs take. */
const HOLD_FLAG_SPEC = { value: ["reason", "home"] } as const satisfies FlagTailSpec;

/** What the hold and release verbs touch outside themselves. */
export interface ChairHandOffHoldRunDeps {
  readonly nowIso: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Parse, append and report one hold or release.
 *
 * @param rest the flag tail after `hand-off hold|release`
 * @param kind which way this moves the hold
 * @param deps the clock and the two output channels
 * @returns the exit code: usage on a bad or missing `--reason`, error when the journal was not written
 */
function runHoldLine({
  deps,
  kind,
  rest,
}: {
  deps: ChairHandOffHoldRunDeps;
  kind: ChairHandOffHoldKind;
  rest: readonly string[];
}): number {
  const verb = `supervisor hand-off ${kind}`;
  const usage = kind === "hold" ? HAND_OFF_HOLD_USAGE : HAND_OFF_RELEASE_USAGE;
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(usage);
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: HOLD_FLAG_SPEC });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      deps.writeDiagnostic(`${verb}: ${message}`);
    });
    deps.writeDiagnostic(usage);
    return EXIT_USAGE;
  }
  const reason = parsed.value.values["reason"];
  if (reason === undefined) {
    deps.writeDiagnostic(`${verb}: --reason "<why>" is required`);
    deps.writeDiagnostic(usage);
    return EXIT_USAGE;
  }
  const recorded = recordChairHandOffHold({
    home: resolveHome({ named: parsed.value.values["home"] }),
    kind,
    nowIso: deps.nowIso(),
    reason,
  });
  if (recorded.isErr()) {
    deps.writeDiagnostic(`${verb}: ${recorded.error.message}`);
    return recorded.error.code === "HOLD_REASON_EMPTY" ? EXIT_USAGE : EXIT_ERROR;
  }
  const moved =
    kind === "hold" ? "automatic chair hand-off is HELD" : "the hold on automatic chair hand-off is released";
  deps.writeOut(`${verb}: ${moved} at ${recorded.value.atIso} — ${recorded.value.reason}`);
  return EXIT_OK;
}

/**
 * `supervisor hand-off hold --reason "<why>"`.
 *
 * @param rest the flag tail after `hand-off hold`
 * @param deps the clock and the two output channels
 * @returns the process exit code
 */
export function runChairHandOffHold({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ChairHandOffHoldRunDeps;
}): number {
  return runHoldLine({ deps, kind: "hold", rest });
}

/**
 * `supervisor hand-off release --reason "<why>"`.
 *
 * @param rest the flag tail after `hand-off release`
 * @param deps the clock and the two output channels
 * @returns the process exit code
 */
export function runChairHandOffRelease({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ChairHandOffHoldRunDeps;
}): number {
  return runHoldLine({ deps, kind: "release", rest });
}

/**
 * The real clock, stdout and stderr.
 *
 * @returns the production dependencies for {@link runChairHandOffHold} and {@link runChairHandOffRelease}
 */
export function productionChairHandOffHoldDeps(): ChairHandOffHoldRunDeps {
  return {
    nowIso: () => new Date().toISOString(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}
