/**
 * `slopweaver supervisor tick-draft` — assemble one tick's draft from the documents it already redirected.
 *
 * The edge only: it reads files, parses them, and writes one. Every decision is pure —
 * `./tickDraftCore.ts` parses the flags and proves the draft, and `../../../supervisor/tickDraftSources.ts`
 * turns each producer's document into its observation. Every document is read before anything is judged, so
 * one run names every unreadable file at once, and nothing is written unless the whole draft passed.
 */
import { readFileSync } from "node:fs";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { JSON_REFUSE_BYTES, safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import {
  type CapturedDocument,
  DRAFTED_SOURCE_KINDS,
  DRAFTED_SOURCES,
  type DraftedSourceKind,
} from "../../../supervisor/tickDraftSources.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { type SupervisorError, SupervisorErrors, supervisorErrorLines } from "./errors.js";
import {
  assembleSupervisorTickDraft,
  parseSupervisorTickDraftArgs,
  SUPERVISOR_TICK_DRAFT_USAGE,
  type SupervisorTickDraftArgs,
  tickDraftSummaryLine,
} from "./tickDraftCore.js";

/**
 * Everything the verb touches outside itself, injected so a test drives the whole thing.
 *
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export interface SupervisorTickDraftDeps {
  /** Reads one file, or throws. */
  readonly readFile: (args: { path: string }) => string;
  /** Replaces one file atomically, or throws. */
  readonly writeFile: (args: { path: string; text: string }) => void;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Read and parse one JSON file.
 *
 * @param path the file
 * @param label the flag it arrived on, for the refusal
 * @param deps the injected seams
 * @returns the parsed JSON, or why it could not be read
 */
function readJson({
  path,
  label,
  deps,
}: {
  path: string;
  label: string;
  deps: SupervisorTickDraftDeps;
}): Result<unknown, SupervisorError> {
  try {
    return ok(safeJsonParse({ label: `${label} ${path}`, text: deps.readFile({ path }) }));
  } catch (error: unknown) {
    return err(SupervisorErrors.documentUnreadable({ cause: error, label: `${label} ${path}` }));
  }
}

/**
 * Read each source document the invocation supplied, keeping every failure rather than stopping at one.
 *
 * @param args the parsed invocation
 * @param deps the injected seams
 * @returns the documents read, and one line per document that could not be
 */
function readSourceDocuments({ args, deps }: { args: SupervisorTickDraftArgs; deps: SupervisorTickDraftDeps }): {
  captures: Partial<Record<DraftedSourceKind, CapturedDocument>>;
  failures: readonly string[];
} {
  const failures: string[] = [];
  const captures: Partial<Record<DraftedSourceKind, CapturedDocument>> = {};
  for (const kind of DRAFTED_SOURCE_KINDS) {
    const path = args.sourcePaths[kind];
    if (path === undefined) {
      continue;
    }
    const document = readJson({ deps, label: `--${DRAFTED_SOURCES[kind].flag}`, path });
    if (document.isErr()) {
      for (const line of supervisorErrorLines({ error: document.error })) {
        failures.push(line);
      }
    } else {
      captures[kind] = { document: document.value, path };
    }
  }
  return { captures, failures };
}

/**
 * Read every document the invocation names, reporting every one that could not be read.
 *
 * @param args the parsed invocation
 * @param deps the injected seams
 * @returns the source documents and the two envelope documents, or every read failure
 */
function readInputs({
  args,
  deps,
}: {
  args: SupervisorTickDraftArgs;
  deps: SupervisorTickDraftDeps;
}): Result<{ captures: Partial<Record<DraftedSourceKind, CapturedDocument>>; actions: unknown; judgements: unknown }> {
  const { captures, failures } = readSourceDocuments({ args, deps });
  const actions = readJson({ deps, label: "--actions", path: args.actionsPath });
  const judgements = readJson({ deps, label: "--judgements", path: args.judgementsPath });
  if (actions.isErr() || judgements.isErr() || failures.length > 0) {
    return err([
      ...failures,
      ...(actions.isErr() ? supervisorErrorLines({ error: actions.error }) : []),
      ...(judgements.isErr() ? supervisorErrorLines({ error: judgements.error }) : []),
    ]);
  }
  return ok({ actions: actions.value, captures, judgements: judgements.value });
}

/**
 * Print one refusal's lines, prefixed the way every other line of this verb is.
 *
 * @param lines the refusal
 * @param deps the injected seams
 */
function refuse({ lines, deps }: { lines: readonly string[]; deps: SupervisorTickDraftDeps }): void {
  for (const line of lines) {
    deps.writeDiagnostic(`supervisor tick-draft: ${line}`);
  }
}

/**
 * The bytes to write for a serialised draft — the JSON plus its trailing newline, refused when that newline
 * would push the file past what `safeJsonParse` will read back.
 *
 * A one-character overshoot is the whole point: `safeJsonStringify` refuses a payload over
 * {@link JSON_REFUSE_BYTES}, so a draft serialised at exactly the cap passes here and then `tick-record`
 * REFUSES the file this verb just called valid, because the newline made it one character too long. A Codex
 * review pass built exactly that draft (property `r3-draft-accepted-by-record`). Refusing here keeps the
 * verb's promise: a draft it writes is a draft tick-record can read.
 *
 * @param text the serialised draft
 * @param cap the largest file `safeJsonParse` will read back; the parameter exists so a test can drive it
 * @returns the bytes to write, or why the draft cannot be written as a file
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export function draftFileText({
  text,
  cap = JSON_REFUSE_BYTES,
}: {
  text: string;
  cap?: number;
}): Result<string, SupervisorError> {
  const file = `${text}\n`;
  if (file.length > cap) {
    return err(SupervisorErrors.draftOverReadLimit({ cap, length: text.length }));
  }
  return ok(file);
}

/**
 * Run `supervisor tick-draft` against injected seams.
 *
 * @param rest the argv tail after `supervisor tick-draft`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 * @internal — read by this module and its own tests; nothing outside the tick ledger names it.
 */
export function runSupervisorTickDraft({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SupervisorTickDraftDeps;
}): number {
  const args = parseSupervisorTickDraftArgs({ rest });
  if (args.isErr()) {
    refuse({ deps, lines: args.error });
    deps.writeDiagnostic(SUPERVISOR_TICK_DRAFT_USAGE);
    return EXIT_USAGE;
  }
  const inputs = readInputs({ args: args.value, deps });
  if (inputs.isErr()) {
    refuse({ deps, lines: inputs.error });
    return EXIT_ERROR;
  }
  const assembled = assembleSupervisorTickDraft({ args: args.value, ...inputs.value });
  if (assembled.isErr()) {
    refuse({ deps, lines: supervisorErrorLines({ error: assembled.error }) });
    return EXIT_ERROR;
  }
  const text = safeJsonStringify({ label: "the tick draft", space: 1, value: assembled.value.document });
  if (args.value.out === "-") {
    deps.writeOut(text);
    return EXIT_OK;
  }
  const file = draftFileText({ text });
  if (file.isErr()) {
    refuse({ deps, lines: supervisorErrorLines({ error: file.error }) });
    return EXIT_ERROR;
  }
  try {
    deps.writeFile({ path: args.value.out, text: file.value });
  } catch (error: unknown) {
    refuse({ deps, lines: [`--out ${args.value.out}: ${error instanceof Error ? error.message : "unknown error"}`] });
    return EXIT_ERROR;
  }
  if (args.value.json) {
    deps.writeOut(
      JSON.stringify({
        out: args.value.out,
        tickId: args.value.tickId,
        validatedAtIso: assembled.value.validatedAtIso,
      }),
    );
    return EXIT_OK;
  }
  deps.writeOut(tickDraftSummaryLine({ assembled: assembled.value, out: args.value.out }));
  return EXIT_OK;
}

/**
 * The real seams: the filesystem and the two output channels.
 *
 * @returns the production dependencies for {@link runSupervisorTickDraft}
 */
function productionDeps(): SupervisorTickDraftDeps {
  return {
    readFile: ({ path }) => readFileSync(path, "utf8"),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeFile: ({ path, text }) => {
      writeFileAtomic({ contents: text, path });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver supervisor tick-draft`. */
export const supervisorTickDraftCommand = defineCommand({
  run: (argv) => runSupervisorTickDraft({ deps: productionDeps(), rest: verbTail({ argv, verbs: ["tick-draft"] }) }),
});
