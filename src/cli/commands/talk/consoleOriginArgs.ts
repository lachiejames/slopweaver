/**
 * The three flags a console server passes `talk transcript` and `talk relay` to say where it is serving from —
 * `--console-root`, `--console-port`, `--console-default-port` — and their pure parser. All three or none: a console
 * passes the whole group, and a hand-run verb passes none (`./consoleOrigin.ts` says what each case means). Beside
 * them, the two recording verbs `talk transcript` and `talk call-thread-append` alone take `--console-instance e2e` for
 * a batch the desktop test instance's call posted.
 */
import { isAbsolute } from "node:path";

import { err, ok, type Result } from "../../../lib/result.js";
import { stringOf } from "./flagValues.js";

/** The string flags of the group, for a verb's `FlagSpec`. */
export const CONSOLE_ORIGIN_FLAGS = ["console-root", "console-port", "console-default-port"] as const;

/**
 * The one flag the recording verbs `talk transcript` and `talk call-thread-append` alone take beside the group:
 * `--console-instance e2e`, which the console server adds when the desktop TEST instance's call posted the batch.
 * Never `talk relay`'s or `talk wake-chair`'s, so either refuses it as an unknown flag: a test instance relays nothing
 * and wakes nobody.
 */
export const CONSOLE_INSTANCE_FLAG = "console-instance";

/** Where a console server says it is serving from: the checkout it serves, the port it answered on, and its default. */
export interface ConsoleOriginArgs {
  readonly checkoutRoot: string;
  readonly port: number;
  readonly defaultPort: number;
  /** `e2e` when the desktop test instance posted it (`--console-instance`); absent for every other caller. */
  readonly instance?: "e2e";
}

/**
 * A port flag's value as a TCP port, or `undefined` when it is not one.
 *
 * @param value the flag's text
 * @returns the port
 */
function portOf({ value }: { value: string }): number | undefined {
  if (!/^[0-9]{1,5}$/u.test(value)) {
    return undefined;
  }
  const port = Number(value);
  if (port < 1 || port > 65_535) {
    return undefined;
  }
  return port;
}

/**
 * A port flag's port, noting a value that is not one.
 *
 * @param flag the flag, as a problem names it
 * @param value its text, absent when it was not passed
 * @param problems where a bad value is noted
 * @returns the port, or `undefined` when absent or bad
 */
function portFlag({
  flag,
  value,
  problems,
}: {
  flag: string;
  value: string | undefined;
  problems: string[];
}): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = portOf({ value });
  if (parsed === undefined) {
    problems.push(`${flag} must be a port from 1 to 65535, not ${value}`);
  }
  return parsed;
}

/**
 * The console-origin group out of a verb's parsed flags, noting every problem with a partial or bad group.
 *
 * @param values the verb's parsed flags
 * @param problems where each problem is noted
 * @returns the origin, or `undefined` when no flag of the group was passed or the group is bad
 */
export function consoleOriginOf({
  values,
  problems,
}: {
  values: Readonly<Record<string, string | boolean>>;
  problems: string[];
}): ConsoleOriginArgs | undefined {
  const parsed = parseConsoleOriginArgs({
    defaultPort: stringOf({ value: values["console-default-port"] }),
    port: stringOf({ value: values["console-port"] }),
    root: stringOf({ value: values["console-root"] }),
  });
  if (parsed.isErr()) {
    problems.push(...parsed.error);
    return undefined;
  }
  return parsed.value;
}

/**
 * The console-origin group and `--console-instance` out of a recording verb's parsed flags, noting every problem.
 *
 * @param values the verb's parsed flags
 * @param problems where each problem is noted
 * @returns the origin, marked when the instance flag was passed, or `undefined` when no flag of the group was
 *   passed or a flag is bad
 */
export function consoleOriginWithInstanceOf({
  values,
  problems,
}: {
  values: Readonly<Record<string, string | boolean>>;
  problems: string[];
}): ConsoleOriginArgs | undefined {
  const before = problems.length;
  const origin = consoleOriginOf({ problems, values });
  if (problems.length > before) {
    return undefined;
  }
  const instance = parseConsoleInstance({
    hasOrigin: origin !== undefined,
    instance: stringOf({ value: values[CONSOLE_INSTANCE_FLAG] }),
  });
  if (instance.isErr()) {
    problems.push(instance.error.message);
    return undefined;
  }
  if (origin === undefined || instance.value === undefined) {
    return origin;
  }
  return { ...origin, instance: instance.value };
}

/** `--console-instance` named a value other than `e2e`. */
export interface ConsoleInstanceUnknownError {
  readonly code: "CONSOLE_INSTANCE_UNKNOWN";
  readonly message: string;
  readonly instance: string;
}

/** `--console-instance` was passed without the console-origin group it qualifies. */
export interface ConsoleInstanceWithoutOriginError {
  readonly code: "CONSOLE_INSTANCE_WITHOUT_ORIGIN";
  readonly message: string;
}

/** Why `--console-instance` was refused. */
export type ConsoleInstanceError = ConsoleInstanceUnknownError | ConsoleInstanceWithoutOriginError;

/** The factory for every {@link ConsoleInstanceError}. */
export const ConsoleInstanceErrors = {
  unknown: ({ instance }: { instance: string }): ConsoleInstanceUnknownError => ({
    code: "CONSOLE_INSTANCE_UNKNOWN",
    instance,
    message: `--console-instance must be e2e, not ${instance}`,
  }),
  withoutOrigin: (): ConsoleInstanceWithoutOriginError => ({
    code: "CONSOLE_INSTANCE_WITHOUT_ORIGIN",
    message:
      "--console-instance is passed only beside --console-root, --console-port and --console-default-port: it marks a batch a console server placed",
  }),
} as const;

/**
 * Parse `--console-instance`: exactly `e2e`, and only beside a whole console-origin group — it names who posted a
 * batch the server already placed, so it is never a substitute for the server's own origin.
 *
 * @param instance the flag's text, absent when it was not passed
 * @param hasOrigin whether a whole, valid console-origin group was passed
 * @returns the instance, `undefined` when the flag was not passed, or why it was refused
 */
export function parseConsoleInstance({
  instance,
  hasOrigin,
}: {
  instance: string | undefined;
  hasOrigin: boolean;
}): Result<"e2e" | undefined, ConsoleInstanceError> {
  if (instance === undefined) {
    return ok(undefined);
  }
  if (instance !== "e2e") {
    return err(ConsoleInstanceErrors.unknown({ instance }));
  }
  if (!hasOrigin) {
    return err(ConsoleInstanceErrors.withoutOrigin());
  }
  return ok("e2e");
}

/**
 * Parse the console-origin group out of a verb's parsed string flags.
 *
 * @param root `--console-root`, the serving checkout
 * @param port `--console-port`, the port the console server listens on
 * @param defaultPort `--console-default-port`, the console's configured port
 * @returns the origin, `undefined` when no flag of the group was passed, or every problem with a partial or bad group
 */
export function parseConsoleOriginArgs({
  root,
  port,
  defaultPort,
}: {
  root: string | undefined;
  port: string | undefined;
  defaultPort: string | undefined;
}): Result<ConsoleOriginArgs | undefined> {
  if (root === undefined && port === undefined && defaultPort === undefined) {
    return ok(undefined);
  }
  const problems: string[] = [];
  for (const [flag, value] of [
    ["--console-root", root],
    ["--console-port", port],
    ["--console-default-port", defaultPort],
  ] as const) {
    if (value === undefined) {
      problems.push(`${flag} is missing: the console-origin flags are passed together or not at all`);
    }
  }
  if (root !== undefined && !isAbsolute(root)) {
    problems.push(`--console-root must be an absolute path, not ${root}`);
  }
  const parsedPort = portFlag({ flag: "--console-port", problems, value: port });
  const parsedDefault = portFlag({ flag: "--console-default-port", problems, value: defaultPort });
  if (root === undefined || parsedPort === undefined || parsedDefault === undefined || problems.length > 0) {
    return err(problems);
  }
  return ok({ checkoutRoot: root, defaultPort: parsedDefault, port: parsedPort });
}
