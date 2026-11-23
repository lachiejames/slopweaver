/**
 * The PURE core of `slopweaver cycle reconcile`: flag parsing and the one output-mode decision. No fs, no
 * clock, no console — the shell ({@link ./reconcileRun}) supplies the instant and does every read.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";

/**
 * Every flag this verb accepts, exported so `--help`'s advertised usage is checked against the parser
 * rather than against a hand-kept copy of it.
 */
export const CYCLE_RECONCILE_FLAG_NAMES: readonly string[] = [
  "--json",
  "--form",
  "--verify",
  "--post",
  "--dry-run",
  "--write",
  "--home",
  "--now",
];

/**
 * What the caller asked for. Exactly one output mode is ever active.
 *
 * @internal — the shape {@link parseReconcileOptions} returns; no caller outside this noun names it.
 */
export interface ReconcileOptions {
  readonly home: string;
  /** The instant the pass is judged against — `--now` for a replay, else the shell's real clock. */
  readonly nowIso?: string;
  /** Emit the machine report on stdout. */
  readonly json: boolean;
  /** Emit the Slack digest form on stdout, ready to pipe into `slopweaver slack post --form -`. */
  readonly form: boolean;
  /** Say what would be posted, and post nothing. */
  readonly post: boolean;
  readonly dryRun: boolean;
  /** Read live, through the door, the pull requests the local corpus cannot resolve. */
  readonly verify: boolean;
  /**
   * Also publish the `--json` report to `$SLOPWEAVER_HOME/live/hygiene/cycle-reconcile.json`, whatever
   * stdout carries. A LOCAL document only: nothing reaches Linear, GitHub or Slack.
   */
  readonly write: boolean;
}

/**
 * Parse the verb tail.
 *
 * `--post` without `--dry-run` is a usage error rather than a send. That is deliberate and is the rail in
 * the parser rather than in a doc: this verb composes, and the SENDING lives behind
 * `slopweaver slack post`, which is the one door with the preview, the voice rules and the duplicate gate
 * already on it. A second send path here would be a second door.
 *
 * `--write` is independent of the output mode on purpose: it publishes the report's canonical JSON whether
 * stdout carries the human lines, the form or that same JSON.
 *
 * @param rest the argv tail
 * @param defaultHome the home to read when `--home` is absent
 * @returns the validated options, or every rejection as its own line
 */
export function parseReconcileOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<ReconcileOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json", "form", "post", "dry-run", "verify", "write"], value: ["home", "now"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const json = flags.has("json");
  const form = flags.has("form");
  const post = flags.has("post");
  const dryRun = flags.has("dry-run");
  const errors: string[] = [];
  if (json && form) {
    errors.push("--json and --form are different output modes; pass one");
  }
  if (post && !dryRun) {
    errors.push(
      "--post needs --dry-run here: this verb composes but never sends. Pipe the form into the one door instead: `slopweaver cycle reconcile --form | slopweaver slack post --as bot --channel <id> --form -`",
    );
  }
  if (errors.length > 0) {
    return err(errors);
  }
  const nowIso = values["now"];
  return ok({
    dryRun,
    form,
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json,
    post,
    verify: flags.has("verify"),
    write: flags.has("write"),
    ...(nowIso === undefined ? {} : { nowIso }),
  });
}
