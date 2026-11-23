/**
 * Pure argument handling for `slopweaver linear query` — the local-first Linear facet query.
 *
 * Every closed-set flag is validated against its own union HERE, before a byte of corpus is read, and a bad
 * value becomes a refusal that names what the flag accepts. That is the schema enforcement the shape asks
 * for: a mistyped `--state-type strted` must not come back as "no matches", because a reader cannot tell
 * that apart from an honest empty answer.
 */
import {
  LINEAR_PRIORITIES,
  LINEAR_QUERY_KINDS,
  LINEAR_STATE_TYPES,
  type LinearQueryFilter,
  type LinearQueryKind,
  type LinearStateType,
} from "../../../corpus/linear/query.js";
import { type LinearQueryError, LinearQueryErrors } from "../../../corpus/linear/queryErrors.js";
import { err, ok, type Result, unwrap } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";

// The owner crosswalk lives in its own module; the query verb reaches it through this core.
export { resolveOwnerLinearHandle } from "./ownerHandle.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/** The literal `--assignee` value that means "resolve the owner's own Linear handle". */
export const OWNER_ASSIGNEE_TOKEN = "me";

const QUERY_FLAGS: FlagSpec = {
  boolean: ["json", "no-verify"],
  string: [
    "assignee",
    "corpus",
    "cycle",
    "home",
    "kind",
    "label",
    "limit",
    "priority",
    "project",
    "state",
    "state-type",
    "team",
    "text",
    "updated-since",
  ],
};

/** Every accepted flag, derived from the exact spec passed to the parser. */
export const LINEAR_QUERY_FLAG_NAMES: readonly string[] = [
  "--assignee",
  "--corpus",
  "--cycle",
  "--home",
  "--json",
  "--kind",
  "--label",
  "--limit",
  "--no-verify",
  "--priority",
  "--project",
  "--state",
  "--state-type",
  "--team",
  "--text",
  "--updated-since",
];

/** A parsed, credential-free `linear query` invocation. */
export interface LinearQueryOptions {
  /** The filter, with `assignee` still possibly the literal {@link OWNER_ASSIGNEE_TOKEN}. */
  readonly filter: LinearQueryFilter;
  readonly home: string | undefined;
  readonly corpus: string | undefined;
  readonly limit: number;
  readonly verify: boolean;
  readonly json: boolean;
}

/**
 * The usage text for `slopweaver linear query`.
 *
 * @returns exact command help, including only flags its parser accepts
 */
export function linearQueryUsage(): string {
  return [
    "usage: slopweaver linear query [--kind issue|project] [facets] [--limit <1..100>] [--no-verify] [--json]",
    "  Answers a FACET question from the local corpus first, then verifies the page it cites against live Linear",
    "  --kind            issue (default) or project",
    "  --assignee        the assignee's Linear handle, or `me` for the owner's (a project's LEAD)",
    "  --state           the workflow state by name, whole and case-insensitive (e.g. 'In Review')",
    "  --state-type      one of: " + LINEAR_STATE_TYPES.join(" | "),
    "  --team            the team key (the `ENG` in `ENG-42`)",
    "  --project         the project name, whole and case-insensitive",
    "  --cycle           the cycle number",
    "  --label           comma-separated labels; a match carries EVERY one",
    "  --priority        one of: " + LINEAR_PRIORITIES.join(" | ") + " (0 none, 1 urgent, 4 low)",
    "  --updated-since   an ISO date, or `<n>d` for the last n days",
    "  --text            a substring of the title or body — the one loose facet",
    "  --limit           how many rows the page holds (default 10, maximum 100)",
    "  --no-verify       skip the live verification and say so, rather than implying the citations were checked",
    "  --json            emit one machine-readable document",
    "  --corpus          scan this bronze directory instead of the state home's Linear bronze",
    "  --home            resolve the corpus and the credential from this Slopweaver state home",
  ].join("\n");
}

/** Validate one closed-set string flag against its union. Pure. */
function closedSet<TValue extends string>({
  flag,
  value,
  accepted,
}: {
  flag: string;
  value: string;
  accepted: readonly TValue[];
}): Result<TValue, LinearQueryError> {
  const match = accepted.find((candidate) => candidate === value);
  return match === undefined ? err(LinearQueryErrors.unknownFilterValue({ accepted, flag, value })) : ok(match);
}

/** `--kind`, validated against its closed set; a query that names no kind asks for issues. Pure. */
function parseKind({ raw }: { raw: string | undefined }): Result<LinearQueryKind, LinearQueryError> {
  if (raw === undefined) {
    return ok("issue");
  }
  return closedSet({ accepted: LINEAR_QUERY_KINDS, flag: "--kind", value: raw });
}

/** Parse the result-page cap, refusing an unbounded page. Pure. */
function parseLimit({ value }: { value: string | undefined }): Result<number, LinearQueryError> {
  if (value === undefined) {
    return ok(DEFAULT_LIMIT);
  }
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 && limit <= MAX_LIMIT
    ? ok(limit)
    : err(
        LinearQueryErrors.unknownFilterValue({
          accepted: [`an integer from 1 to ${String(MAX_LIMIT)}`],
          flag: "--limit",
          value,
        }),
      );
}

/** Parse `--cycle` / `--priority`, both whole numbers with their own accepted range. Pure. */
function parseWholeNumber({
  flag,
  value,
  accepted,
}: {
  flag: string;
  value: string;
  accepted: readonly number[] | undefined;
}): Result<number, LinearQueryError> {
  const parsed = Number(value);
  const inRange = Number.isInteger(parsed) && parsed >= 0 && (accepted === undefined || accepted.includes(parsed));
  return inRange
    ? ok(parsed)
    : err(
        LinearQueryErrors.unknownFilterValue({
          accepted: acceptedWholeNumbers({ accepted }),
          flag,
          value,
        }),
      );
}

/** What a whole-number refusal says the flag accepts: its own closed range, or — with none — any whole number. */
function acceptedWholeNumbers({ accepted }: { accepted: readonly number[] | undefined }): readonly string[] {
  if (accepted === undefined || accepted.length === 0) {
    return ["a whole number"];
  }
  return accepted.map(String);
}

/** The `<n>d` relative form, in days, or undefined when the value is not that shape. Pure. */
const RELATIVE_DAYS = /^(\d+)d$/u;

/**
 * Resolve `--updated-since` to an absolute ISO instant.
 *
 * `<n>d` is relative to the injected clock rather than to `Date.now()`, so the parser stays pure and a test
 * can pin the boundary exactly.
 *
 * @param value the flag's raw value
 * @param nowMs the clock the relative form is measured back from
 * @returns the absolute ISO instant, or a refusal naming both accepted forms
 */
export function parseUpdatedSince({
  value,
  nowMs,
}: {
  value: string;
  nowMs: number;
}): Result<string, LinearQueryError> {
  const relative = RELATIVE_DAYS.exec(value);
  if (relative !== null) {
    const days = Number(relative[1]);
    return ok(new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString());
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed)
    ? err(
        LinearQueryErrors.unknownFilterValue({
          accepted: ["an ISO date such as 2026-09-01", "a relative window such as 14d"],
          flag: "--updated-since",
          value,
        }),
      )
    : ok(new Date(parsed).toISOString());
}

/** The comma-separated `--label` list, trimmed and emptied of blanks. Pure. */
function parseLabels({ value }: { value: string }): readonly string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** A string flag's value, or undefined when it was not given. Pure. */
function stringFlag({
  values,
  key,
}: {
  values: Readonly<Record<string, string | boolean>>;
  key: string;
}): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Run one optional flag through its own validator, so an absent flag costs the caller no branch.
 *
 * @param raw the flag's value, or undefined when it was not given
 * @param resolve the validator for that flag
 * @returns the resolved value, `undefined` when the flag was absent, or the validator's refusal
 */
function optionalFacet<TValue>({
  raw,
  resolve,
}: {
  raw: string | undefined;
  resolve: (args: { value: string }) => Result<TValue, LinearQueryError>;
}): Result<TValue | undefined, LinearQueryError> {
  return raw === undefined ? ok(undefined) : resolve({ value: raw });
}

/** Every validated facet, resolved together so the parser reads as a list rather than as a branch ladder. */
interface ValidatedFacets {
  readonly kind: LinearQueryKind;
  readonly stateType: LinearStateType | undefined;
  readonly priority: number | undefined;
  readonly cycle: number | undefined;
  readonly updatedSinceIso: string | undefined;
  readonly limit: number;
}

/**
 * Validate every closed-set and numeric flag in one pass.
 *
 * Each validator runs and the FIRST refusal is returned, rather than short-circuiting at each step: the
 * six checks are independent, so writing them as one list keeps the ladder out of the caller.
 *
 * @param values the tokenised flag values
 * @param nowMs the clock a relative `--updated-since` window is measured back from
 * @returns every validated facet, or the first refusal
 */
function validateFacets({
  values,
  nowMs,
}: {
  values: Readonly<Record<string, string | boolean>>;
  nowMs: number;
}): Result<ValidatedFacets, LinearQueryError> {
  const kind = parseKind({ raw: stringFlag({ key: "kind", values }) });
  const stateType = optionalFacet({
    raw: stringFlag({ key: "state-type", values }),
    resolve: ({ value }) => closedSet({ accepted: LINEAR_STATE_TYPES, flag: "--state-type", value }),
  });
  const priority = optionalFacet({
    raw: stringFlag({ key: "priority", values }),
    resolve: ({ value }) => parseWholeNumber({ accepted: LINEAR_PRIORITIES, flag: "--priority", value }),
  });
  const cycle = optionalFacet({
    raw: stringFlag({ key: "cycle", values }),
    resolve: ({ value }) => parseWholeNumber({ accepted: undefined, flag: "--cycle", value }),
  });
  const since = optionalFacet({
    raw: stringFlag({ key: "updated-since", values }),
    resolve: ({ value }) => parseUpdatedSince({ nowMs, value }),
  });
  const limit = parseLimit({ value: stringFlag({ key: "limit", values }) });
  const checked: readonly Result<unknown, LinearQueryError>[] = [kind, stateType, priority, cycle, since, limit];
  for (const result of checked) {
    if (result.isErr()) {
      return err(result.error);
    }
  }
  return ok({
    cycle: unwrap(cycle),
    kind: unwrap(kind),
    limit: unwrap(limit),
    priority: unwrap(priority),
    stateType: unwrap(stateType),
    updatedSinceIso: unwrap(since),
  });
}

/**
 * Assemble the filter from the validated facets and the free-text flags.
 *
 * @param values the tokenised flag values, for the open-set facets that need no validation
 * @param facets everything the closed-set and numeric validators produced
 * @returns the filter, carrying only the facets the caller actually constrained
 */
function buildFilter({
  values,
  facets,
}: {
  values: Readonly<Record<string, string | boolean>>;
  facets: ValidatedFacets;
}): LinearQueryFilter {
  const assignee = stringFlag({ key: "assignee", values });
  const state = stringFlag({ key: "state", values });
  const team = stringFlag({ key: "team", values });
  const project = stringFlag({ key: "project", values });
  const text = stringFlag({ key: "text", values });
  const rawLabels = stringFlag({ key: "label", values });
  const labels = rawLabels === undefined ? [] : parseLabels({ value: rawLabels });
  return {
    kind: facets.kind,
    ...(assignee !== undefined ? { assignee } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(facets.stateType !== undefined ? { stateType: facets.stateType } : {}),
    ...(team !== undefined ? { team } : {}),
    ...(project !== undefined ? { project } : {}),
    ...(facets.cycle !== undefined ? { cycle: facets.cycle } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(facets.priority !== undefined ? { priority: facets.priority } : {}),
    ...(facets.updatedSinceIso !== undefined ? { updatedSinceIso: facets.updatedSinceIso } : {}),
    ...(text !== undefined ? { text } : {}),
  };
}

/**
 * Parse one `linear query` invocation before any corpus, credential or network is touched.
 *
 * @param rest the argv tail after `linear query`
 * @param nowMs the clock a relative `--updated-since` window is measured back from
 * @returns the resolved options, or the first typed refusal
 */
export function parseLinearQueryArgs({
  rest,
  nowMs,
}: {
  rest: readonly string[];
  nowMs: number;
}): Result<LinearQueryOptions, LinearQueryError> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: QUERY_FLAGS });
  if (parsed.isErr()) {
    return err(LinearQueryErrors.invalidInvocation({ accepted: LINEAR_QUERY_FLAG_NAMES, problems: parsed.error }));
  }
  const values = parsed.value.values;
  const facets = validateFacets({ nowMs, values });
  if (facets.isErr()) {
    return err(facets.error);
  }
  return ok({
    corpus: stringFlag({ key: "corpus", values }),
    filter: buildFilter({ facets: facets.value, values }),
    home: stringFlag({ key: "home", values }),
    json: values["json"] === true,
    limit: facets.value.limit,
    verify: values["no-verify"] !== true,
  });
}
