/**
 * Whether Slack is connected at all, for the one surface whose failure reason cannot say so itself: a Slack thread the
 * local corpus does not hold (`../components/console/SlackThread.tsx`). Pure.
 *
 * The corpus answers "the store holds no Slack message …" whether or not Slack is connected, so the thread panel asks
 * `slopweaver connect slack --check --json` instead — the door's own preflight, value-free — and reads ONLY its
 * `tokenPresent`. Not the secrets store: the runtime also takes `SLACK_BOT_TOKEN`/`SLACK_USER_TOKEN` from the
 * environment the console's children inherit, which the store cannot see. And not the preflight's `ok`: a token
 * present with a scope missing or a 401 is CONNECTED-but-broken, and keeps the read's own explanation: missing messages and permission failures have their own explanations and never look like a
 * disconnected account.
 *
 * The preflight exits 3 when a check fails — a missing token included — so a non-zero exit carrying the report on
 * stdout is still an answer. Anything else (no JSON, the wrong source, no `tokenPresent`) is unmeasured, and the
 * panel keeps the triangle: disconnection was not proved.
 */
import { isBag } from "./bag";

/** The literal argv the route launches. */
export const SLACK_CONNECTION_ARGV: readonly string[] = ["connect", "slack", "--check", "--json"];

/** The preflight's exit code when it ran and a check failed — `src/cli/commands/connect/run.ts`. */
const CHECK_FAILED_EXIT = 3;

/** What the route answers. */
export type SlackConnectionResult =
  | { readonly ok: true; readonly observedAtIso: string; readonly tokenPresent: boolean }
  | { readonly ok: false; readonly observedAtIso: string; readonly notMeasured: string };

/**
 * `tokenPresent` off the preflight's report, refusing any report that is not Slack's.
 *
 * @param payload the parsed stdout
 * @returns whether a Slack token is present, or `undefined` when the payload is not the report
 */
export function slackTokenPresentOf({ payload }: { payload: unknown }): boolean | undefined {
  if (!isBag(payload) || payload["source"] !== "slack") {
    return undefined;
  }
  const present = payload["tokenPresent"];
  if (typeof present !== "boolean") {
    return undefined;
  }
  return present;
}

/**
 * Fold one preflight run into the route's answer: a report on exit 0 or 3 is an answer, anything else is not.
 *
 * @param exitCode the child's exit code, `undefined` when it timed out or never launched
 * @param out what it printed on stdout
 * @param why the spawn's own reason, used when the run gave no report
 * @param observedAtIso when the route asked
 * @returns the route's answer
 */
export function slackConnectionResultOf({
  exitCode,
  out,
  why,
  observedAtIso,
}: {
  exitCode: number | undefined;
  out: string;
  why: string;
  observedAtIso: string;
}): SlackConnectionResult {
  if (exitCode !== 0 && exitCode !== CHECK_FAILED_EXIT) {
    return { notMeasured: why, observedAtIso, ok: false };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(out);
  } catch {
    return {
      notMeasured: "slopweaver connect slack --check printed something that is not JSON",
      observedAtIso,
      ok: false,
    };
  }
  const tokenPresent = slackTokenPresentOf({ payload });
  if (tokenPresent === undefined) {
    return { notMeasured: "slopweaver connect slack --check printed no Slack tokenPresent", observedAtIso, ok: false };
  }
  return { observedAtIso, ok: true, tokenPresent };
}
