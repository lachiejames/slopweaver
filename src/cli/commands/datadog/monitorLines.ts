/**
 * Every line `slopweaver datadog monitor` prints about a monitor, a change or an approval. Pure: the shell in
 * `monitorRun.ts` decides when, this file decides what.
 */
import type { MonitorFieldChange, MonitorSnapshot } from "../../../datadog/monitorWrite.js";

/** A wire value as one or more display lines: a string line by line, anything else as compact JSON. */
function valueLines({ value }: { value: unknown }): readonly string[] {
  if (value === undefined) {
    return ["(unset)"];
  }
  return typeof value === "string" ? value.split("\n") : [JSON.stringify(value)];
}

/**
 * The before/after of every changed field, `-` for what Datadog holds now and `+` for what it would hold.
 *
 * @param changes the plan's changes, in order
 * @returns the diff lines
 */
export function monitorDiffLines({ changes }: { changes: readonly MonitorFieldChange[] }): readonly string[] {
  return changes.flatMap((change) => [
    `  ${change.field}`,
    ...valueLines({ value: change.before }).map((line) => `    - ${line}`),
    ...valueLines({ value: change.after }).map((line) => `    + ${line}`),
  ]);
}

/** Who Datadog says created the monitor: the email, else the handle, else that it recorded neither. */
function creatorOf({ monitor }: { monitor: MonitorSnapshot }): string {
  const email = monitor.creator?.email;
  if (typeof email === "string" && email !== "") {
    return email;
  }
  const handle = monitor.creator?.handle;
  if (typeof handle === "string" && handle !== "") {
    return handle;
  }
  return "not recorded";
}

/**
 * One monitor's identifying line: id, name, type, state, creator, modified and tags.
 *
 * @param monitor the monitor as read
 * @returns the line
 */
export function monitorHeadline({ monitor }: { monitor: MonitorSnapshot }): string {
  const state = typeof monitor.overall_state === "string" ? `state ${monitor.overall_state}` : "state unknown";
  return (
    `monitor ${String(monitor.id)} "${monitor.name}" (${monitor.type}, ${state}, ` +
    `creator ${creatorOf({ monitor })}, modified ${monitor.modified}) tags [${monitor.tags.join(", ")}]`
  );
}

/**
 * Everything `show` prints about one monitor.
 *
 * @param monitor the monitor as read
 * @returns the lines
 */
export function monitorShowLines({ monitor }: { monitor: MonitorSnapshot }): readonly string[] {
  return [
    monitorHeadline({ monitor }),
    "  query",
    `    ${monitor.query}`,
    "  message",
    ...monitor.message.split("\n").map((line) => `    ${line}`),
    "  options",
    `    ${JSON.stringify(monitor.options)}`,
  ];
}

/**
 * The invocation as a command line a shell reads back unchanged: each token single-quoted unless it is plainly
 * safe, so a query's braces, spaces and `!` survive being pasted.
 *
 * @param tokens the argv tail after `monitor`
 * @returns the whole `slopweaver datadog monitor …` command
 */
export function monitorCommandLine({ tokens }: { tokens: readonly string[] }): string {
  const quoted = tokens.map((token) =>
    /^[\w./:,=@+-]+$/u.test(token) ? token : `'${token.replaceAll("'", "'\\''")}'`,
  );
  return ["slopweaver datadog monitor", ...quoted].join(" ");
}

/**
 * The closing lines of a preview: the digest, and the exact way to apply it.
 *
 * @param digest the approval digest
 * @param command the command that was run, without `--approve`
 * @returns the lines
 */
export function approvalLines({ digest, command }: { digest: string; command: string }): readonly string[] {
  return [`approve: ${digest}`, `not sent — to apply exactly this, re-run: ${command} --approve ${digest}`];
}
