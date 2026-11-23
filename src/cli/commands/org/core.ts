/**
 * The pure half of `slopweaver org set|show`: the flags each takes, read into the record the store validates.
 *
 * `org set` writes the WHOLE row every time, never a patch: every field is stated on every write, so a row can never
 * hold a field nobody wrote. An organisation without Google Workspace, Slack, Linear or Vanta says so with the
 * matching `--without-…` switch rather than by leaving the flag out, which is refused — absence and a statement of
 * absence never read alike. Slack is one entry point, never a requirement, so `--without-slack` stores zero hosts.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type OrganisationRecord, parseOrganisationRecord } from "../../../organisation/core.js";
import { type FlagSpec, parseFlags, repeatedFlagValues } from "../../parseFlags.js";

/** `org show`'s flags. */
const SHOW_SPEC = { boolean: ["json"], string: ["home"] } as const satisfies FlagSpec;

/** `org set`'s flags. */
const SET_SPEC = {
  boolean: ["json", "without-google", "without-slack", "without-linear", "without-vanta"],
  repeatable: ["slack-host", "repository", "dependency-bot"],
  string: [
    "home",
    "display-name",
    "github-owner",
    "google-domain",
    "slack-host",
    "linear-workspace",
    "vanta-workspace",
    "repository",
    "dependency-bot",
  ],
} as const satisfies FlagSpec;

/** What `org show` was asked for. */
export interface OrgShowArgs {
  readonly home: string | undefined;
  readonly json: boolean;
}

/** What `org set` was asked to write. */
export interface OrgSetArgs extends OrgShowArgs {
  readonly record: OrganisationRecord;
}

/**
 * Read `org show`'s argv tail. Pure.
 *
 * @param rest the argv after `org show`
 * @returns the options, or every reason they were refused
 */
export function orgShowArgs({ rest }: { rest: readonly string[] }): Result<OrgShowArgs> {
  const parsed = parseFlags({ args: rest, spec: SHOW_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const home = parsed.value.values["home"];
  return ok({ home: typeof home === "string" ? home : undefined, json: parsed.value.values["json"] === true });
}

/**
 * One optional field, stated as a value or as its absence and never both, never neither.
 *
 * @param values the parsed flag values
 * @param flag the value flag
 * @param without the switch stating the organisation has none
 * @param problems where a refusal is collected
 * @returns the value, `null` for a stated absence, or `undefined` when refused
 */
function statedOrNone({
  values,
  flag,
  without,
  problems,
}: {
  values: Readonly<Record<string, string | boolean>>;
  flag: string;
  without: string;
  problems: string[];
}): string | null | undefined {
  const value = values[flag];
  const none = values[without] === true;
  if (typeof value === "string" && none) {
    problems.push(`--${flag} and --${without} contradict each other: pass one`);
    return undefined;
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }
  if (none) {
    return null;
  }
  problems.push(`pass --${flag} <value>, or --${without} when the organisation has none`);
  return undefined;
}

/**
 * The Slack hosts, stated as one or more `--slack-host` or as `--without-slack`, never both and never neither.
 *
 * @param values the parsed flag values
 * @param hosts every `--slack-host` passed, lowercased
 * @param problems where a refusal is collected
 * @returns the hosts, an empty list for a stated absence, or `undefined` when refused
 */
function slackHostsOrNone({
  values,
  hosts,
  problems,
}: {
  values: Readonly<Record<string, string | boolean>>;
  hosts: readonly string[];
  problems: string[];
}): readonly string[] | undefined {
  const none = values["without-slack"] === true;
  if (hosts.length > 0 && none) {
    problems.push("--slack-host and --without-slack contradict each other: pass one");
    return undefined;
  }
  if (hosts.length > 0 || none) {
    return hosts;
  }
  problems.push("pass --slack-host <host> (repeatable), or --without-slack when the organisation has none");
  return undefined;
}

/**
 * One required scalar flag, or a refusal naming it.
 *
 * @returns the value, or `undefined` when it was not passed
 */
function required({
  values,
  flag,
  problems,
}: {
  values: Readonly<Record<string, string | boolean>>;
  flag: string;
  problems: string[];
}): string | undefined {
  const value = values[flag];
  if (typeof value !== "string") {
    problems.push(`--${flag} is required: org set writes the whole organisation every time`);
    return undefined;
  }
  return value;
}

/**
 * Read `org set`'s argv tail into the record the store takes, every problem named at once. Pure.
 *
 * @param rest the argv after `org set`
 * @returns the options with a validated record, or every reason they were refused
 */
export function orgSetArgs({ rest }: { rest: readonly string[] }): Result<OrgSetArgs> {
  const parsed = parseFlags({ args: rest, spec: SET_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const displayName = required({ flag: "display-name", problems, values });
  const githubOwner = required({ flag: "github-owner", problems, values });
  const googleDomain = statedOrNone({ flag: "google-domain", problems, values, without: "without-google" });
  const lowered = ({ name }: { name: string }): readonly string[] =>
    repeatedFlagValues({ name, rest }).map((one) => one.trim().toLowerCase());
  const slackHosts = slackHostsOrNone({ hosts: lowered({ name: "slack-host" }), problems, values });
  const linearWorkspace = statedOrNone({ flag: "linear-workspace", problems, values, without: "without-linear" });
  const vantaWorkspace = statedOrNone({ flag: "vanta-workspace", problems, values, without: "without-vanta" });
  if (problems.length > 0) {
    return err(problems);
  }
  const record = parseOrganisationRecord({
    value: {
      dependencyBots: lowered({ name: "dependency-bot" }),
      displayName,
      githubOwner: githubOwner!.trim().toLowerCase(),
      googleDomain,
      linearWorkspace,
      repositories: lowered({ name: "repository" }),
      slackHosts,
      vantaWorkspace,
    },
  });
  if (record.isErr()) {
    return err([record.error.message]);
  }
  const home = values["home"];
  return ok({
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    record: record.value,
  });
}
