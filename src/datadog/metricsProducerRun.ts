/**
 * The ONE place a declared metrics producer is launched (`./metricsProducer.ts` carries the contract): a bounded,
 * blocking `execFileSync` of the profile's command in the profile's checkout, never through a shell.
 *
 * ## Why blocking
 *
 * `execFileSync`, not `execFile`: the no-headless gate (`devLint/noHeadless.ts`, NH001) bans the async launchers
 * because a child that can outlive its parent is the shape rule 2 forbids, and a synchronous one cannot. The
 * calling tick holds for the run, which `live/automation/definitionShape.ts` already accepts for a `run-here` kind.
 *
 * ## What the child gets, and does not — least privilege, not a sandbox
 *
 * A clean environment: `PATH`, `HOME`, `TMPDIR` and the caller gate homes from the parent when present, the
 * selected `SLOPWEAVER_HOME`, and exactly the secrets the declaration maps, none onto either of the last two, each a name the credential register declares and each read from
 * `$SLOPWEAVER_HOME/secrets/<name>`. Nothing else the
 * parent holds is inherited, so a producer that needs a credential says so in the profile, where it can be read.
 * The values travel in the child's environment, never its argv, and are never logged. This bounds what is HANDED
 * to the producer; it does not confine it — the command runs as the owner's own user, which is why the profile
 * that names it is an executable trust root.
 */
import { execFileSync } from "node:child_process";

import { isRecord } from "#lib/parsers.js";

import { CALLER_GATE_HOMES_ENV } from "../cli/callerGateHomesEnv.js";
import { tokenFromEnvOrHomeFile } from "../config.js";
import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import type { MetricsProducerConfig } from "../profileProviders.js";
import { SECRET_NAMES } from "../secrets/registry.js";
import { type MetricsProducerError, MetricsProducerErrors, producerArgs } from "./metricsProducer.js";

/**
 * How long one producer run may take before it is killed — a product safety ceiling, not a measurement of any
 * producer: a run past it is treated as hung, and a producer slower than this splits its work across days.
 */
const PRODUCER_TIMEOUT_MS = 10 * 60 * 1000;

/** The stdout one run may write before it is killed — a ceiling that keeps a runaway logger out of the tick's memory. */
const PRODUCER_MAX_STDOUT_BYTES = 64 * 1024 * 1024;

/** How many stderr lines a failed run keeps for its report. */
const STDERR_TAIL_LINES = 20;

/**
 * The store names a producer may be handed: the credential register's settable ones, the same set `secrets set`
 * writes, so a declared secret is always one the owner can actually store.
 */
const SETTABLE_SECRET_NAMES: ReadonlySet<string> = new Set(SECRET_NAMES);

/**
 * The parent variables a child inherits: enough to find an executable and a temp directory, plus the caller gate
 * homes a `run-due --home` tick hands down, so a ruling in the home it switched away from still judges a slopweaver
 * the producer spawns. That one can only ADD refusals, so it hands the child no capability.
 */
const INHERITED_ENV = ["PATH", "HOME", "TMPDIR", CALLER_GATE_HOMES_ENV] as const;

/**
 * The variables the launcher sets to pin the child to the selected home and its gates. A secret mapped onto one
 * would overwrite that pin with a stored value, moving a `run-due --home` tick's producer to another home.
 */
const RESERVED_ENV: ReadonlySet<string> = new Set(["SLOPWEAVER_HOME", CALLER_GATE_HOMES_ENV]);

/**
 * Run one command to completion, blocking, and return its stdout — throwing exactly as `execFileSync` does when the
 * child cannot launch, is killed, or exits non-zero. A test stands in for it and reads the exact command it got.
 */
export type ProducerCommand = (input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}) => string;

/** The real runner. The `timeout` is literal at the call so the sync-child-timeout gate, which reads syntax, sees it. */
const blockingRun: ProducerCommand = ({ command, args, cwd, env }) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: PRODUCER_MAX_STDOUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: PRODUCER_TIMEOUT_MS,
  });

/** Reads one secret by store name, `undefined` when the store holds none. A test hands in a plain fake. */
export type ProducerSecretReader = (input: {
  readonly secretName: string;
  readonly home: string;
}) => string | undefined;

/** The real reader: the secrets store file only — never an environment variable of the parent's. */
const storeSecret: ProducerSecretReader = ({ secretName, home }) =>
  tokenFromEnvOrHomeFile({ envNames: [], home, secretName });

/**
 * The environment one producer run receives: the inherited baseline, the home, and its declared secrets alone.
 *
 * @param producer the producer's name, for a refusal
 * @param config the declaration whose `secrets` map is projected
 * @param home the selected state home, handed on and read for each secret
 * @param parentEnv the environment the baseline is copied from
 * @param readSecret how one secret is read — the store unless a test stands in
 * @returns the child's environment, or the first declared secret mapped onto a reserved variable, unnamed by the
 *   register or absent from the store
 */
export function producerEnvironment({
  producer,
  config,
  home,
  parentEnv,
  readSecret = storeSecret,
}: {
  readonly producer: string;
  readonly config: MetricsProducerConfig;
  readonly home: string;
  readonly parentEnv: NodeJS.ProcessEnv;
  readonly readSecret?: ProducerSecretReader;
}): Result<NodeJS.ProcessEnv, MetricsProducerError> {
  // A null prototype: Node's spawn copies INHERITED enumerable keys into the child's environment too, so an
  // ordinary object would hand on anything a polluted `Object.prototype` carried. Measured in review.
  // The prototype is stripped in place, so no `any` from `Object.create` is ever asserted to a type.
  const env: NodeJS.ProcessEnv = { SLOPWEAVER_HOME: home };
  Object.setPrototypeOf(env, null);
  for (const name of INHERITED_ENV) {
    const value = parentEnv[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  for (const [envName, secretName] of Object.entries(config.secrets)) {
    if (RESERVED_ENV.has(envName)) {
      return err(MetricsProducerErrors.secretReservedName({ envName, producer }));
    }
    if (!SETTABLE_SECRET_NAMES.has(secretName)) {
      return err(MetricsProducerErrors.secretUnregistered({ producer, secretName }));
    }
    const value = readSecret({ home, secretName });
    if (value === undefined) {
      return err(MetricsProducerErrors.secretAbsent({ producer, secretName }));
    }
    env[envName] = value;
  }
  return ok(env);
}

/** Split a captured stream into lines, dropping the empty trailing one a final newline leaves. */
function linesOf({ text }: { readonly text: string }): readonly string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

/** How a thrown `execFileSync` error ended, in words, and its stderr tail — never asserting a shape onto it. */
function failureOf({ error }: { readonly error: unknown }): {
  readonly ending: string;
  readonly stderrTail: readonly string[];
} {
  const thrown = isRecord(error) ? error : {};
  const status = thrown["status"];
  const signal = thrown["signal"];
  const stderr = thrown["stderr"];
  const stderrTail = linesOf({ text: typeof stderr === "string" ? stderr : "" }).slice(-STDERR_TAIL_LINES);
  if (typeof signal === "string") {
    return { ending: `was killed by ${signal} (it timed out, or was interrupted)`, stderrTail };
  }
  if (typeof status === "number") {
    return { ending: `exited ${String(status)}`, stderrTail };
  }
  return { ending: `could not launch — ${errorMessage({ error })}`, stderrTail };
}

/**
 * Run one declared producer for one UTC day and hand back its stdout.
 *
 * @param producer the producer's name, for a refusal
 * @param config the declaration: the checkout it runs in and the command it runs
 * @param day the UTC day, `YYYY-MM-DD`, appended as `--day`
 * @param env the child's whole environment, from {@link producerEnvironment}
 * @param runCommand the blocking runner — `execFileSync` unless a test stands in
 * @returns the stdout of a run that exited 0, or how it ended otherwise, never throwing
 */
export function runMetricsProducer({
  producer,
  config,
  day,
  env,
  runCommand = blockingRun,
}: {
  readonly producer: string;
  readonly config: MetricsProducerConfig;
  readonly day: string;
  readonly env: NodeJS.ProcessEnv;
  readonly runCommand?: ProducerCommand;
}): Result<string, MetricsProducerError> {
  try {
    return ok(
      runCommand({ args: producerArgs({ config, day }), command: config.command[0]!, cwd: config.checkout, env }),
    );
  } catch (error: unknown) {
    const { ending, stderrTail } = failureOf({ error });
    return err(MetricsProducerErrors.runFailed({ ending, producer, stderrTail }));
  }
}
