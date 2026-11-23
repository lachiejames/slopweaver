/**
 * `slopweaver secrets set <name>` — the transcript-safe token capture. The value is NEVER a CLI argument,
 * never echoed, never printed back. When run in an interactive terminal it does a one-shot **no-echo
 * prompt** (the single sanctioned interactive read — it does not block a crawl); when stdin is piped (or
 * `--stdin` forces it) it reads the pipe, for scripted use. Either way the value lands `0600` under
 * `$SLOPWEAVER_HOME/secrets/` and touches nothing else.
 *
 * A thin effectful shell: arg parsing + the source decision ({@link secretSource}) + input normalisation
 * are pure; the tty read, the piped-stdin read, and the fs write are injected via {@link SecretsDeps}, so
 * the value-never-leaks contract is unit-tested with plain fakes.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { slopweaverHome } from "../../../config.js";
import type { Logger } from "../../../lib/logger.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseSecretName, type SecretName } from "../../../secrets/names.js";
import { promptSecretNoEcho } from "../../../secrets/prompt.js";
import {
  checkSecretValueShape,
  normaliseSecretInput,
  type SecretWriteResult,
  writeSecretFile,
} from "../../../secrets/store.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail } from "../../optionParsers.js";

const USAGE = "usage: slopweaver secrets set <name> [--stdin] [--home <dir>] [--json]";

/** The validated `secrets set` request. The token value is deliberately NOT here — it is captured, never argv. */
interface SecretsSetArgs {
  readonly name: SecretName;
  readonly home?: string;
  readonly json: boolean;
  /** Force reading from piped stdin (scripting) even on a TTY; otherwise the source is auto-detected. */
  readonly stdin: boolean;
}

/**
 * Parse `secrets set`'s tail: the leading `<name>` positional then flags. There is NO value flag by
 * design, so a token can never be passed on argv. Pure — a bad name / missing name / unknown flag / stray
 * positional is an error.
 *
 * @param rest the tail after `secrets set`
 * @returns the validated request, or the accumulated errors
 */
export function parseSecretsSetArgs({ rest }: { rest: readonly string[] }): Result<SecretsSetArgs> {
  const rawName = rest[0];
  if (rawName === undefined || rawName.startsWith("-")) {
    return err([`missing secret name`, USAGE]);
  }
  const name = parseSecretName({ value: rawName });
  if (name.isErr()) {
    return err([name.error.message, USAGE]);
  }
  const parsed = parseFlagTail({ rest: rest.slice(1), spec: { boolean: ["stdin", "json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err([...parsed.error, USAGE]);
  }
  const homeValue = parsed.value.values["home"];
  return ok({
    json: parsed.value.flags.has("json"),
    name: name.value,
    stdin: parsed.value.flags.has("stdin"),
    ...(homeValue !== undefined ? { home: homeValue } : {}),
  });
}

/**
 * Decide where the secret value comes from: a piped stdin read (when `--stdin` forces it, or stdin is NOT
 * an interactive TTY — i.e. a pipe/redirect), else an interactive no-echo prompt. Pure.
 *
 * @param forceStdin whether `--stdin` was passed
 * @param isTty whether stdin is an interactive terminal
 * @returns the capture source
 */
export function secretSource({ forceStdin, isTty }: { forceStdin: boolean; isTty: boolean }): "stdin" | "prompt" {
  return forceStdin || !isTty ? "stdin" : "prompt";
}

/** The injectable effectful seams the `secrets set` shell composes (fakes in tests, production below). */
export interface SecretsDeps {
  readonly home: () => string;
  readonly isTty: () => boolean;
  readonly readPipedStdin: () => Promise<string>;
  readonly promptNoEcho: (args: { prompt: string }) => Promise<string>;
  readonly writeSecret: typeof writeSecretFile;
  readonly logger: Pick<Logger, "out" | "error">;
}

/** Render the success line — name + path only, NEVER the value. `--json` emits a stable value-free shape. */
function reportWritten({
  result,
  json,
  sink,
}: {
  result: SecretWriteResult;
  json: boolean;
  sink: SecretsDeps["logger"];
}): void {
  if (json) {
    sink.out({ line: JSON.stringify({ name: result.name, ok: true, path: result.path }) });
    return;
  }
  sink.out({ line: `set ${result.name} (0600) → ${result.path}` });
}

/** Capture the raw value from the chosen source (a no-echo prompt, or piped stdin) — never argv. */
async function captureValue({
  source,
  name,
  deps,
}: {
  source: "stdin" | "prompt";
  name: SecretName;
  deps: SecretsDeps;
}): Promise<string> {
  if (source === "prompt") {
    return deps.promptNoEcho({ prompt: `Paste ${name} (input hidden): ` });
  }
  return deps.readPipedStdin();
}

/** The home the secret is written under: `--home` when given, else the ambient one the seam resolves. */
function secretsHome({ args, deps }: { args: SecretsSetArgs; deps: SecretsDeps }): string {
  const named = unsetFieldAsNull({ key: "home", record: args });
  if (named === null) {
    return deps.home();
  }
  return named;
}

/**
 * Run `secrets set` over injected dependencies — the testable shell. Captures the value from a no-echo
 * prompt (interactive) or piped stdin (never argv), normalises it, writes it `0600`, and reports success
 * without ever emitting the value.
 *
 * @param argv the full process argv (`secrets set` starts at index 2)
 * @param deps the effectful seams
 * @returns the process exit code
 */
export async function runSecretsSetWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: SecretsDeps;
}): Promise<number> {
  const tail = argv.slice(3);
  const rest = tail[0] === "set" ? tail.slice(1) : tail;
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseSecretsSetArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      deps.logger.error({ msg: e });
    });
    return EXIT_USAGE;
  }
  const source = secretSource({ forceStdin: parsed.value.stdin, isTty: deps.isTty() });
  const normalised = normaliseSecretInput({
    input: await captureValue({ deps, name: parsed.value.name, source }),
  }).andThen((value) => checkSecretValueShape({ name: parsed.value.name, value }));
  if (normalised.isErr()) {
    deps.logger.error({ msg: `secrets set: ${normalised.error.message}` });
    return EXIT_ERROR;
  }
  const home = secretsHome({ args: parsed.value, deps });
  const written = deps.writeSecret({ home, name: parsed.value.name, value: normalised.value });
  if (written.isErr()) {
    deps.logger.error({ msg: `secrets set: ${written.error.message}` });
    return EXIT_ERROR;
  }
  reportWritten({ json: parsed.value.json, result: written.value, sink: deps.logger });
  return EXIT_OK;
}

/** Production dependencies (real tty probe, no-echo prompt, piped-stdin read, fs writer). */
function productionSecretsDeps(): SecretsDeps {
  return {
    home: slopweaverHome,
    isTty: () => process.stdin.isTTY === true,
    logger,
    promptNoEcho: promptSecretNoEcho,
    readPipedStdin: readStdin,
    writeSecret: writeSecretFile,
  };
}

/**
 * Run the `secrets set` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSecretsSet(argv: readonly string[]): Promise<number> {
  return runSecretsSetWithDeps({ argv, deps: productionSecretsDeps() });
}

export const secretsSetCommand = defineCommand({ run: runSecretsSet });
