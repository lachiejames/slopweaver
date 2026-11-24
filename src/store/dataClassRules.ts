/**
 * The data-class rule sorter: what class an incoming record gets at intake, decided by rules alone. Pure; the
 * rules file is read by `./dataClassRulesFile.ts` and the sorter is called where a row is written.
 *
 * The owner ruled that rules do the sorting of incoming data and that an AI assessment is used for personal
 * material. So a rule ends in one of five actions: one of the four classes (`public`, `internal`, `personal`,
 * `restricted`), or `assess` (this is personal material, so an assessment decides). Bulk automated input such as
 * newsletters, receipts and automated senders is the owner's example of `internal` by rule; which senders those are is
 * the installation's to write. Nothing at intake waits on an assessment: an `assess` outcome is stored as `unknown`,
 * which fails closed, and the assessment itself is a port at the end of this module, answered from what the owner's
 * daily visible session recorded (`../talk/callAssessmentPort.ts`).
 *
 * ## Rules read facts, never content, and the first match wins
 *
 * A rule matches on a record's facts (which table, source, kind, visibility, container and author) by exact
 * value, every named field at once. The facts are a rule's INPUT: a container's or source's class is never a
 * record's by inheritance, which is the unit rule (`./dataClass.ts`). An installation's own rules come first and
 * the owner-agnostic defaults after, so an installation can override any default. A record no rule matches is
 * `unknown`. A rule can never ASSIGN `unknown`: only the absence of a match produces it, so a rules file cannot
 * hide a gap behind a rule that looks like a decision.
 *
 * ## The defaults classify nothing at all
 *
 * Code names no person, channel or organisation, so the only safe owner-agnostic rules are conservative ones:
 * private-lane material and the owner's own captured speech go to `assess`, and everything else stays `unknown`
 * until an installation's rules say otherwise. A public channel is not thereby `public`: a public source can
 * still carry something personal, and widening is the installation's decision, written in its own state.
 */
import { z } from "zod";

import { err, ok, type Result, type ResultAsync } from "#lib/result.js";

import type { DataClass } from "./dataClass.js";

/**
 * The classes a rule or an assessment can assign: every class but `unknown`, which only a missing decision produces.
 *
 * @internal — the rules file's schema reads it; a caller names a class through {@link AssignedDataClass}.
 */
export const ASSIGNABLE_DATA_CLASSES = [
  "public",
  "internal",
  "personal",
  "restricted",
] as const satisfies readonly DataClass[];

/**
 * One class a rule or an assessment can assign.
 *
 * @internal — the type of {@link DataClassRule}'s class actions and of a classified outcome.
 */
export type AssignedDataClass = (typeof ASSIGNABLE_DATA_CLASSES)[number];

/**
 * The tables a rule can sort rows for: the intake tables that carry a `data_class` column.
 *
 * @internal — the rules file's schema reads it; a caller names a table through {@link DataClassFacts}.
 */
export const DATA_CLASS_RULE_TABLES = ["content", "owner_capture", "owner_turn"] as const;

/**
 * One intake table a rule can sort rows for.
 *
 * @internal — the type of {@link DataClassFacts}' `table`.
 */
export type DataClassRuleTable = (typeof DATA_CLASS_RULE_TABLES)[number];

/** What a rule may read about a record at intake. A null field matches no rule that names it. */
export interface DataClassFacts {
  readonly table: DataClassRuleTable;
  /** The source as the store writes it: a corpus source, or the capturing app for `owner_capture`. */
  readonly source: string;
  readonly kind: string | null;
  /** The record's effective read scope, the always-private sources and kinds already folded in. */
  readonly visibility: "public" | "private";
  readonly container: string | null;
  /** The author's platform id or handle, as the record names it. */
  readonly author: string | null;
}

/**
 * The fields a rule may match on, each an exact list of accepted values.
 *
 * @internal — the key set of {@link DataClassRule}'s `match`.
 */
export const DATA_CLASS_MATCH_FIELDS = ["table", "source", "kind", "visibility", "container", "author"] as const;

/** One sorting rule. */
export interface DataClassRule {
  /** A stable id, unique across the installation's rules and the defaults, named on every outcome it decides. */
  readonly id: string;
  /** Every named field must hold one of its listed values. At least one field is named. */
  readonly match: { readonly [Field in (typeof DATA_CLASS_MATCH_FIELDS)[number]]?: readonly string[] | undefined };
  /** The class to assign, or `assess` for personal material an assessment decides. */
  readonly action: AssignedDataClass | "assess";
}

/**
 * The owner-agnostic defaults, read after an installation's own rules. They assign no class: each sends to assessment.
 */
export const DEFAULT_DATA_CLASS_RULES: readonly DataClassRule[] = [
  {
    action: "assess",
    id: "default:owner-captured-speech",
    match: { table: ["owner_capture", "owner_turn"] },
  },
  {
    action: "assess",
    id: "default:private-lane",
    match: { visibility: ["private"] },
  },
];

/** What the sorter decided for one record. */
export type DataClassOutcome =
  | { readonly kind: "classified"; readonly dataClass: AssignedDataClass; readonly ruleId: string }
  | { readonly kind: "needs-assessment"; readonly ruleId: string }
  | { readonly kind: "unknown"; readonly reason: "no-rule" };

/**
 * Whether one rule matches a record's facts: every field it names holds one of its listed values.
 *
 * @param rule the rule
 * @param facts the record's facts
 * @returns true when every named field matches
 */
function ruleMatches({ rule, facts }: { rule: DataClassRule; facts: DataClassFacts }): boolean {
  return DATA_CLASS_MATCH_FIELDS.every((field) => {
    const accepted = rule.match[field];
    if (accepted === undefined) {
      return true;
    }
    const value = facts[field];
    return value !== null && accepted.includes(value);
  });
}

/**
 * Sort one record: the first rule whose match holds decides, and no match is `unknown`.
 *
 * @param facts the record's facts
 * @param rules the composed rules, the installation's first — see {@link composeDataClassRules}
 * @returns the outcome, naming the rule that decided it
 */
export function sortDataClass({
  facts,
  rules,
}: {
  facts: DataClassFacts;
  rules: readonly DataClassRule[];
}): DataClassOutcome {
  const rule = rules.find((one) => ruleMatches({ facts, rule: one }));
  if (rule === undefined) {
    return { kind: "unknown", reason: "no-rule" };
  }
  if (rule.action === "assess") {
    return { kind: "needs-assessment", ruleId: rule.id };
  }
  return { dataClass: rule.action, kind: "classified", ruleId: rule.id };
}

/**
 * The class a row is written with for an outcome. Anything not positively classified is `unknown`, written
 * explicitly so a row intake reached is distinguishable from one written before classification existed.
 *
 * @param outcome the sorter's outcome
 * @returns the class to store
 */
export function storedDataClass({ outcome }: { outcome: DataClassOutcome }): DataClass {
  if (outcome.kind === "classified") {
    return outcome.dataClass;
  }
  return "unknown";
}

/** The rules file could not be read. */
export interface DataClassRulesUnreadableError {
  readonly code: "DATA_CLASS_RULES_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The rules file is not JSON. */
export interface DataClassRulesNotJsonError {
  readonly code: "DATA_CLASS_RULES_NOT_JSON";
  readonly message: string;
  readonly path: string;
}

/** The rules file is JSON but not a valid rule set. */
export interface DataClassRulesInvalidError {
  readonly code: "DATA_CLASS_RULES_INVALID";
  readonly message: string;
  readonly path: string;
  readonly issues: readonly string[];
}

/** Why an installation's rules could not be used. Every variant refuses the whole file: no rule of it applies. */
export type DataClassRulesError =
  DataClassRulesUnreadableError | DataClassRulesNotJsonError | DataClassRulesInvalidError;

/** The domain's error factories. */
export const DataClassRulesErrors = {
  invalid: ({ path, issues }: { path: string; issues: readonly string[] }): DataClassRulesInvalidError => ({
    code: "DATA_CLASS_RULES_INVALID",
    issues,
    message: `data-class rules at ${path} are not a valid rule set, so none of them applies: ${issues.join("; ")}`,
    path,
  }),
  notJson: ({ path, detail }: { path: string; detail: string }): DataClassRulesNotJsonError => ({
    code: "DATA_CLASS_RULES_NOT_JSON",
    message: `data-class rules at ${path} are not JSON (${detail}), so none of them applies`,
    path,
  }),
  unreadable: ({ path, detail }: { path: string; detail: string }): DataClassRulesUnreadableError => ({
    code: "DATA_CLASS_RULES_UNREADABLE",
    message: `data-class rules at ${path} exist but could not be read (${detail}), so none of them applies`,
    path,
  }),
} as const;

/** One accepted-values list: at least one non-empty string. */
const acceptedValues = z.array(z.string().min(1)).min(1);

/** The rules file's shape, version 1. Unknown keys anywhere are refused. */
const RULES_FILE_SCHEMA = z
  .object({
    rules: z.array(
      z
        .object({
          action: z.enum([...ASSIGNABLE_DATA_CLASSES, "assess"]),
          id: z.string().min(1),
          match: z
            .object({
              author: acceptedValues.optional(),
              container: acceptedValues.optional(),
              kind: acceptedValues.optional(),
              source: acceptedValues.optional(),
              table: z.array(z.enum(DATA_CLASS_RULE_TABLES)).min(1).optional(),
              visibility: z
                .array(z.enum(["public", "private"]))
                .min(1)
                .optional(),
            })
            .strict(),
        })
        .strict(),
    ),
    version: z.literal(1),
  })
  .strict();

/**
 * Parse an installation's rules file, refusing the whole file on any fault.
 *
 * A rule naming no field, or an id used twice or taken by a default, is refused as well as a shape fault, because
 * each would make the sorter's answer depend on something a reader of the file cannot see.
 *
 * @param value the parsed JSON
 * @param path where it was read, named in a refusal
 * @returns the installation's rules in file order, or why none of them applies
 */
export function parseDataClassRules({
  value,
  path,
}: {
  value: unknown;
  path: string;
}): Result<readonly DataClassRule[], DataClassRulesError> {
  const parsed = RULES_FILE_SCHEMA.safeParse(value);
  if (!parsed.success) {
    return err(
      DataClassRulesErrors.invalid({
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        path,
      }),
    );
  }
  const issues: string[] = [];
  const seen = new Set(DEFAULT_DATA_CLASS_RULES.map((rule) => rule.id));
  for (const rule of parsed.data.rules) {
    if (Object.keys(rule.match).length === 0) {
      issues.push(`rule ${rule.id} names no field to match, so it would match every record`);
    }
    if (seen.has(rule.id)) {
      issues.push(`rule id ${rule.id} is used twice or taken by a default`);
    }
    seen.add(rule.id);
  }
  if (issues.length > 0) {
    return err(DataClassRulesErrors.invalid({ issues, path }));
  }
  return ok(parsed.data.rules);
}

/**
 * The rules the sorter reads: the installation's own first, then the defaults.
 *
 * @param installation the installation's parsed rules, empty when it has no file
 * @returns the composed list, in match order
 */
export function composeDataClassRules({
  installation,
}: {
  installation: readonly DataClassRule[];
}): readonly DataClassRule[] {
  return [...installation, ...DEFAULT_DATA_CLASS_RULES];
}

/*
 * The AI assessment port.
 *
 * The owner ruled that personal material gets an AI assessment, and then ruled who runs it: ONE daily visible
 * session, on the plans already owned, with no new spend. So no model is called here or anywhere in this process.
 * The session reads the record's exact words, decides, and writes its verdict down; the implementation of this port
 * is a READER of those written verdicts (`../talk/callAssessmentPort.ts`, which reads the call's current words
 * itself and the register in `./recordedDataClassAssessment.ts`), and a record nobody has assessed reads
 * `undecided`, which fails closed. Rule 2 is why: judgement happens in a session the owner can see. This is the
 * INTAKE assessment (what class a record has), separate from the outbound privacy check's own assessment of text
 * about to leave.
 *
 * The first records it assesses are the owner's calls (`talk/calls/<callId>.jsonl`), which the store holds only as
 * whole authored files, never as a row with a `data_class` column — so the request names its SUBJECT rather than
 * claiming a table the record is not in. A stored row sent by a rule is the other subject; nothing assesses one yet.
 */

/**
 * What an assessment is about: a stored row a rule sent for assessment, or one of the owner's calls.
 *
 * @internal — the subject of {@link DataClassAssessmentRequest}.
 */
export type DataClassAssessmentSubject =
  | {
      readonly kind: "stored-row";
      readonly facts: DataClassFacts;
      /** The rule that sent it for assessment. */
      readonly ruleId: string;
    }
  | {
      readonly kind: "talk-call";
      /**
       * The call, and nothing about its words: the assessment reads the call's current passages itself, so a caller
       * can never name earlier words and borrow the class they were given.
       */
      readonly callId: string;
    };

/**
 * What an assessment is asked about one record.
 *
 * @internal — the input of {@link DataClassAssessment}.
 */
export interface DataClassAssessmentRequest {
  readonly subject: DataClassAssessmentSubject;
  readonly title: string | null;
  readonly body: string;
}

/**
 * What an assessment answers: a class with its reason, or that it could not decide.
 *
 * @internal — the output of {@link DataClassAssessment}.
 */
export type DataClassAssessmentVerdict =
  | { readonly kind: "classified"; readonly dataClass: AssignedDataClass; readonly reason: string }
  | { readonly kind: "undecided"; readonly reason: string };

/**
 * An assessment that did not complete.
 *
 * @internal — the failure of {@link DataClassAssessment}.
 */
export interface DataClassAssessmentFailedError {
  readonly code: "DATA_CLASS_ASSESSMENT_FAILED";
  readonly message: string;
}

/**
 * The port an assessment implements. An `undecided` verdict or a failure leaves the record `unknown`.
 *
 * @internal — implemented by `../talk/callAssessmentPort.ts`, over what the daily visible session recorded.
 */
export type DataClassAssessment = (input: {
  request: DataClassAssessmentRequest;
}) => ResultAsync<DataClassAssessmentVerdict, DataClassAssessmentFailedError>;
