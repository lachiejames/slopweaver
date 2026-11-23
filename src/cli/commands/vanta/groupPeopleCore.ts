/**
 * The PURE core of `slopweaver write vanta group-people`: flag parsing, plan assembly, the execution record
 * both renderers read, and the exit code it earns. No fs, no clock, no network — {@link ./groupPeopleRun}
 * does the credential resolution, the door routing and the two HTTP legs.
 *
 * ## Why the verb takes person IDS and refuses an email address
 *
 * The card a human reads names people; the wire names ids. Resolving one into the other inside a WRITE
 * verb would mean either trusting a stored atlas generation that may be hours old, or adding a live people
 * walk before the door — and either way an address that matched two rows, or resolved differently after the
 * approval was taken, would move somebody nobody approved. So the mapping happens where it is visible, in
 * the read that composed the proposal (`slopweaver atlas vanta read --kind person`), and this verb refuses
 * a value carrying an `@` by name rather than sending it and letting Vanta answer `ERROR`.
 *
 * ## Why this file parses `--add`/`--remove` itself
 *
 * `parseFlagTail` is built on `node:util`'s `parseArgs` without `multiple`, so `--add a --add b` silently
 * keeps only `b`; and `collectRepeated` (`cli/optionParsers.ts`) silently DROPS an occurrence whose value is
 * missing or looks like another flag. On a verb that changes what a person is obliged to do, either one is a
 * scope change nobody sees: the operator names four people, three are sent, and the run reports success. So
 * {@link readDirectedIds} walks the tail once, keeps every occurrence in the order written, and makes a
 * valueless occurrence a REFUSAL rather than a silence.
 */
import {
  VANTA_GROUP_MEMBERSHIP_BATCH_MAX,
  type VantaGroupMembershipUpdate,
} from "../../../atlas/vanta/groupApiSchemas.js";
import type {
  VantaGroupDirection,
  VantaGroupLegSummary,
  VantaGroupMembershipPlan,
} from "../../../atlas/vanta/groupWriteClient.js";
import type { VantaResolvedWriteRequest } from "../../../atlas/vanta/writePreview.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlagTail } from "../../optionParsers.js";
import type { VantaCredentialFlags } from "./vulnerabilityCore.js";

/**
 * A validated `write vanta group-people` invocation, minus the plan itself.
 *
 * @internal
 */
export interface VantaGroupPeopleOptions extends VantaCredentialFlags {
  readonly home: string;
  readonly json: boolean;
  readonly dryRun: boolean;
  /** The digest passed to `--approve`, or `null` when the caller approved nothing — the door decides. */
  readonly approve: string | null;
}

/**
 * Every flag this verb accepts. Exported so `vantaVerbFlagTruth.test.ts` can probe the REAL parser with
 * each one rather than comparing two declarations.
 *
 * @internal
 */
export const VANTA_GROUP_PEOPLE_FLAG_NAMES: readonly string[] = [
  "--add",
  "--approve",
  "--client-id-file",
  "--client-secret-file",
  "--dry-run",
  "--group",
  "--home",
  "--json",
  "--remove",
];

/** The one copy. The manifest row names the platform's verbs; each verb's own usage lives with the verb. */
export const VANTA_GROUP_PEOPLE_USAGE =
  "usage: slopweaver write vanta group-people --group <group-id>\n" +
  "       [--add <person-id>]... [--remove <person-id>]...\n" +
  "       [--approve <digest>] [--dry-run] [--json] [--home <dir>]\n" +
  "       [--client-id-file <path> --client-secret-file <path>]\n" +
  "  Moves people into and out of ONE Vanta group. A group is what Vanta hangs policy-acceptance\n" +
  "  obligations off, so this mints or retires real tasks against real people and is visible to\n" +
  "  everyone reading the workspace. It does NOT change which documents a group assigns — the\n" +
  "  reviewed Manage API contract has no operation that does\n" +
  "  --group      the group's Vanta id, from `slopweaver atlas vanta read --kind group`\n" +
  "  --add        a person id to put INTO the group; repeat the flag, or separate ids with commas\n" +
  "  --remove     a person id to take OUT of the group; same spelling\n" +
  "  --approve    the digest printed by --dry-run, which covers this exact plan. Without it the door\n" +
  "               HOLDS and nothing is sent; the refusal is recorded, and the digest is in it\n" +
  "  --dry-run    resolve and print the exact requests, send nothing, touch no ledger\n" +
  "  Person ids, never email addresses — `atlas vanta read --kind person` maps one to the other\n" +
  "  The two legs are separate calls and are NOT a transaction: additions go first, and a leg that\n" +
  "  fails stops the run with the later leg unsent and said so\n" +
  "  Run --dry-run first: it prints the bytes, not a description of them";

/** The flag naming each direction. Both are read in ONE pass — see `readDirectedIds` for why that matters. */
const ADD_FLAG = "--add";
const REMOVE_FLAG = "--remove";

/** Both directions' values, each in the order written, plus the tail with all of those tokens taken out. */
interface DirectedIds {
  readonly add: readonly string[];
  readonly remove: readonly string[];
  readonly rest: readonly string[];
  readonly problems: readonly string[];
}

/**
 * Read every occurrence of BOTH repeatable id flags off the raw tail in one walk, refusing an occurrence
 * that carries no value instead of dropping it.
 *
 * Each value is additionally split on commas, so a plan copied off a card in either spelling means the same
 * thing, and a blank between two commas is a refusal for the same reason a valueless flag is.
 *
 * **One walk is the correctness property, not a tidiness one.** This read one direction at a time and fed
 * the leftover tail to the next, which let the first pass REWRITE the second's neighbourhood: against
 * `--remove --add p1 p2`, stripping `--add p1` left `--remove p2`, so the "followed by another flag" check
 * ran against a tail the operator never wrote and the verb silently planned to remove p2. Reproduce the old
 * shape with `--group g1 --remove --add p1 p2`; the refusal below is what it must answer. Found by a Codex review
 * on property `no-silent-scope-change`.
 *
 * @param rest the raw argv tail
 * @returns each direction's ids in written order, the tail without them, and every malformed occurrence
 * @internal
 */
export function readDirectedIds({ rest }: { rest: readonly string[] }): DirectedIds {
  const add: string[] = [];
  const remove: string[] = [];
  const kept: string[] = [];
  const problems: string[] = [];
  const bucketFor = ({ name }: { name: string }): string[] => {
    if (name === ADD_FLAG) {
      return add;
    }
    return remove;
  };
  const take = ({ name, raw }: { name: string; raw: string }): void => {
    const parts = raw.split(",").map((part) => part.trim());
    if (parts.some((part) => part.length === 0)) {
      problems.push(
        `${name} was given "${raw}", which carries an empty id — write one id per flag, or comma-separate them with no gaps`,
      );
      return;
    }
    bucketFor({ name }).push(...parts);
  };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === undefined) {
      continue;
    }
    const named = [ADD_FLAG, REMOVE_FLAG].find((name) => token === name);
    if (named !== undefined) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("-")) {
        problems.push(`${named} was given with no value — every occurrence must name a person id`);
        continue;
      }
      take({ name: named, raw: value });
      index += 1;
      continue;
    }
    const inline = [ADD_FLAG, REMOVE_FLAG].find((name) => token.startsWith(`${name}=`));
    if (inline !== undefined) {
      take({ name: inline, raw: token.slice(inline.length + 1) });
      continue;
    }
    kept.push(token);
  }
  return { add, problems, remove, rest: kept };
}

/**
 * An absent optional flag as an explicit `null`, written out rather than spelled `?? null` — `??` is the
 * silent-fallback shape this repo's `no-silent-fallback` gate refuses, and the substitution is the point.
 */
function orNull({ value }: { value: string | undefined }): string | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/** Refuse the one wrong-shaped value a card invites: an email address where a person id belongs. */
function emailProblems({ name, ids }: { name: string; ids: readonly string[] }): readonly string[] {
  return ids
    .filter((id) => id.includes("@"))
    .map(
      (id) =>
        `${name} was given "${id}", which is an email address — this verb takes Vanta person ids; ` +
        "find one with `slopweaver atlas vanta read --kind person --query <name>`",
    );
}

/**
 * Parse the tail of `write vanta group-people` into the options and the plan it describes.
 *
 * The plan is returned unchecked against Vanta's own batch rules — `checkVantaGroupMembershipPlan` applies
 * those, so the rule lives beside the endpoint it came from rather than in two places.
 *
 * @param rest the argv tail after the verb
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options and the plan, or every rejection
 */
export function parseVantaGroupPeopleOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<{ readonly base: VantaGroupPeopleOptions; readonly plan: VantaGroupMembershipPlan }> {
  const directed = readDirectedIds({ rest });
  const parsed = parseFlagTail({
    rest: directed.rest,
    spec: {
      boolean: ["json", "dry-run"],
      value: ["home", "group", "approve", "client-id-file", "client-secret-file"],
    },
  });
  if (parsed.isErr()) {
    return err([...directed.problems, ...parsed.error]);
  }
  const { values, flags } = parsed.value;
  const group = values["group"];

  const problems: string[] = [
    ...directed.problems,
    ...emailProblems({ ids: directed.add, name: ADD_FLAG }),
    ...emailProblems({ ids: directed.remove, name: REMOVE_FLAG }),
  ];
  if (group === undefined || group.trim() === "") {
    problems.push("--group is required — name the group by its Vanta id");
  }
  if (problems.length > 0) {
    return err(problems);
  }
  // A destructured default, not `home ?? defaultHome`: `no-silent-fallback` refuses the `??` spelling and
  // `oxlint`'s prefer-nullish-coalescing refuses the ternary, so this is the one form both gates accept.
  const { home = defaultHome } = values;
  return ok({
    base: {
      approve: orNull({ value: values["approve"] }),
      clientIdFile: orNull({ value: values["client-id-file"] }),
      clientSecretFile: orNull({ value: values["client-secret-file"] }),
      dryRun: flags.has("dry-run"),
      home,
      json: flags.has("json"),
    },
    plan: {
      add: directed.add.map((id): VantaGroupMembershipUpdate => ({ id })),
      // Proven present above — a missing or blank `--group` is its own refusal, so an honest assertion
      // beats a silent "" default the next reader would have to discount.
      groupId: group!,
      remove: directed.remove.map((id): VantaGroupMembershipUpdate => ({ id })),
    },
  });
}

/** One resolved leg of a plan: the direction, the people it carries, and the request it would send. */
export interface VantaGroupResolvedLeg {
  readonly direction: VantaGroupDirection;
  readonly updates: readonly VantaGroupMembershipUpdate[];
  readonly request: VantaResolvedWriteRequest;
}

/**
 * What one leg of a plan actually did. Three states, because "it failed" and "it never ran" and "we do not
 * know what it did" are three different things to tell an auditor, and collapsing them into a boolean is
 * how a run comes to claim nothing changed after a timeout.
 *
 * This is an execution RECORD, not a result type: it is what the verb prints and what `--json` carries.
 */
export type VantaGroupLegOutcome =
  | { readonly state: "completed"; readonly summary: VantaGroupLegSummary }
  | {
      readonly state: "unconfirmed";
      readonly direction: VantaGroupDirection;
      readonly requestedIds: readonly string[];
      readonly problems: readonly string[];
    }
  | {
      readonly state: "not-attempted";
      readonly direction: VantaGroupDirection;
      readonly requestedIds: readonly string[];
      readonly because: string;
    };

/** Every leg of one plan, in the order they were to be sent. */
export interface VantaGroupPeopleReport {
  readonly groupId: string;
  readonly outcomes: readonly VantaGroupLegOutcome[];
}

/** How a direction reads in a line a human will quote back. */
function directionWords({ direction }: { direction: VantaGroupDirection }): string {
  return direction === "add" ? "INTO the group" : "OUT OF the group";
}

/**
 * The human lines for a dry run — each leg's resolved request, byte for byte, and the digest that approves
 * exactly this plan and no other.
 *
 * The digest is printed here rather than only in the door's refusal because the dry run is the preview an
 * operator is told to run first: the thing they checked and the thing they then approve are the same screen.
 *
 * @param groupId the group both legs address
 * @param legs every leg that would be sent, in the order it would be sent
 * @param digest what `--approve` must carry for this exact plan
 * @returns the lines, in display order
 */
export function renderVantaGroupPeopleDryRun({
  groupId,
  legs,
  digest,
}: {
  groupId: string;
  legs: readonly VantaGroupResolvedLeg[];
  digest: string;
}): readonly string[] {
  const moved = legs.reduce((total, leg) => total + leg.updates.length, 0);
  return [
    `vanta group-people --dry-run: ${String(moved)} membership change(s) to group ${groupId} across ` +
      `${String(legs.length)} call(s), nothing was sent ` +
      `(Vanta's own batch maximum is ${String(VANTA_GROUP_MEMBERSHIP_BATCH_MAX)} per call)`,
    ...legs.flatMap((leg) => [
      "",
      `${directionWords({ direction: leg.direction })}: ${String(leg.updates.length)} person(s)`,
      ...leg.updates.map((update) => `  ${update.id}`),
      "",
      `${leg.request.method} ${leg.request.path}`,
      ...Object.entries(leg.request.headers).map(([key, value]) => `  ${key}: ${value}`),
      ...(leg.request.body.kind === "json" ? ["", leg.request.body.json] : []),
    ]),
    "",
    `to send exactly this plan: --approve ${digest}`,
    "  the digest covers the group, both directions and every person id in the order shown; change any of " +
      "them and it stops matching",
  ];
}

/** One leg's outcome lines, whichever of the three states it is in. */
function outcomeLines({ outcome }: { outcome: VantaGroupLegOutcome }): readonly string[] {
  if (outcome.state === "not-attempted") {
    return [
      `  ${directionWords({ direction: outcome.direction })}: NOT ATTEMPTED (${String(outcome.requestedIds.length)} person(s))`,
      `    ${outcome.because}`,
      ...outcome.requestedIds.map((id) => `    unsent ${id}`),
    ];
  }
  if (outcome.state === "unconfirmed") {
    return [
      `  ${directionWords({ direction: outcome.direction })}: UNCONFIRMED (${String(outcome.requestedIds.length)} person(s))`,
      "    the call was sent and its outcome could not be read — this is not the same as nothing happening",
      ...outcome.problems.map((problem) => `    ${problem}`),
      ...outcome.requestedIds.map((id) => `    unknown ${id}`),
    ];
  }
  const { summary } = outcome;
  return [
    `  ${directionWords({ direction: summary.direction })}: ${String(summary.succeeded.length)}/${String(summary.attempted)}`,
    ...summary.succeeded.map((id) => `    ok ${id}`),
    ...summary.failed.map((entry) => `    REFUSED ${entry.id}: ${entry.message}`),
  ];
}

/**
 * The human lines for a plan that really ran, counting BOTH arms of every leg — a 200 means the batch was
 * accepted, never that every person in it was.
 *
 * @param report what each leg did
 * @returns the lines, in display order
 */
export function renderVantaGroupPeopleOutcome({ report }: { report: VantaGroupPeopleReport }): readonly string[] {
  return [
    `vanta group-people: group ${report.groupId}`,
    ...report.outcomes.flatMap((outcome) => outcomeLines({ outcome })),
  ];
}

/**
 * The exit code a finished plan earns: anything short of every leg completing with every person succeeding
 * is a failure, and an unconfirmed or unsent leg is one of those things.
 *
 * @param report what each leg did
 * @param exitOk the code for a wholly successful plan
 * @param exitError the code for any shortfall
 * @returns the exit code
 */
export function exitCodeForVantaGroupPeople({
  report,
  exitOk,
  exitError,
}: {
  report: VantaGroupPeopleReport;
  exitOk: number;
  exitError: number;
}): number {
  const whole = report.outcomes.every(
    (outcome) => outcome.state === "completed" && outcome.summary.succeeded.length === outcome.summary.attempted,
  );
  return whole ? exitOk : exitError;
}
