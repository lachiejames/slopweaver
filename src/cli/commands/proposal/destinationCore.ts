/**
 * The PURE core of `proposal destination set|show` — argv in, a validated destination or a typed refusal out.
 *
 * A destination built from flags goes through the SAME strict schema `destination.json` is read with
 * (`../../../outbound/proposal/destination.js`), so nothing `set` writes could fail to read back.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import {
  LINEAR_TARGET_KINDS,
  PROPOSAL_DESTINATION_KINDS,
  PROPOSAL_DESTINATION_SCHEMA_VERSION,
  type ProposalDestination,
  proposalDestinationSchema,
} from "../../../outbound/proposal/destination.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type ProposalError, ProposalErrors } from "./errors.js";

/** The usage line every malformed `proposal destination` invocation prints. */
const PROPOSAL_DESTINATION_USAGE_LINE =
  "usage: slopweaver proposal destination set notion-page --parent <page-id-or-url> | set local-page | " +
  "set linear-document --target-kind <project|initiative|issue|team> --target-id <id> | show [--json] [--home <dir>]";

/** A parsed `proposal destination` invocation. */
export type ProposalDestinationArgs =
  | { readonly action: "show"; readonly json: boolean; readonly home: string | undefined }
  | {
      readonly action: "set";
      readonly destination: ProposalDestination;
      readonly json: boolean;
      readonly home: string | undefined;
    };

/** The flags `proposal destination` accepts, across both actions. */
const PROPOSAL_DESTINATION_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["parent", "target-kind", "target-id", "home"],
};

/** Every `proposal destination` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_DESTINATION_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: PROPOSAL_DESTINATION_FLAGS }),
  ...booleanFlagsOf({ spec: PROPOSAL_DESTINATION_FLAGS }),
].map((name) => `--${name}`);

/** Read a declared string flag, or nothing. */
function text({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  return typeof values[name] === "string" ? values[name] : undefined;
}

/** The `notion-page` destination a `set notion-page` invocation names, validated by the stored schema. */
function notionPageDestination({ parent }: { parent: string | undefined }): Result<ProposalDestination, ProposalError> {
  if (parent === undefined) {
    return err(
      ProposalErrors.destinationFieldInvalid({
        flag: "parent",
        why:
          "<page-id-or-url> is required: Notion refuses workspace-parented page creation from an internal " +
          "integration, so every proposal is created under this page and inherits its permissions",
      }),
    );
  }
  const parsed = proposalDestinationSchema.safeParse({
    kind: "notion-page",
    parent,
    schemaVersion: PROPOSAL_DESTINATION_SCHEMA_VERSION,
  });
  if (!parsed.success) {
    return err(
      ProposalErrors.destinationFieldInvalid({
        flag: "parent",
        why: parsed.error.issues.map((issue) => issue.message).join("; "),
      }),
    );
  }
  return ok(parsed.data);
}

/**
 * Parse `proposal destination set <kind> [...]` or `proposal destination show`.
 *
 * @param rest the verb's arguments, after `proposal destination`
 * @returns the parsed invocation, or the operator-facing refusal
 */
export function parseProposalDestinationArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<ProposalDestinationArgs, ProposalError> {
  const [action, ...afterAction] = rest;
  if (action !== "set" && action !== "show") {
    return err(ProposalErrors.usage({ usage: PROPOSAL_DESTINATION_USAGE_LINE }));
  }
  const [kind, ...afterKind] = afterAction;
  const flagArgs = action === "set" ? afterKind : afterAction;
  if (action === "set" && (kind === undefined || kind.startsWith("-"))) {
    return err(ProposalErrors.usage({ usage: PROPOSAL_DESTINATION_USAGE_LINE }));
  }
  const parsed = parseFlags({ args: flagArgs, spec: PROPOSAL_DESTINATION_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const home = text({ name: "home", values });
  const json = values["json"] === true;
  if (action === "show") {
    const given = KIND_FLAGS.find((flag) => text({ name: flag, values }) !== undefined);
    if (given !== undefined) {
      return err(ProposalErrors.destinationFieldInvalid({ flag: given, why: "is a `set` flag; `show` only reads" }));
    }
    return ok({ action, home, json });
  }
  return destinationOfKind({ kind, values }).map((destination) => ({ action, destination, home, json }));
}

/** Every kind-specific flag, each owned by exactly one destination kind. */
const KIND_FLAGS = ["parent", "target-kind", "target-id"] as const;

/** Which kind owns each kind-specific flag, so a flag given to the wrong kind is refused by name. */
const FLAG_OWNER: Readonly<Record<(typeof KIND_FLAGS)[number], ProposalDestination["kind"]>> = {
  parent: "notion-page",
  "target-id": "linear-document",
  "target-kind": "linear-document",
};

/** How a refusal names each kind in prose: "--parent is a notion-page flag; a local page has none". */
const KIND_NOUN: Readonly<Record<ProposalDestination["kind"], string>> = {
  "linear-document": "a Linear document",
  "local-page": "a local page",
  "notion-page": "a Notion page",
};

/** The destination `set <kind>` names, from its kind and its own flags; another kind's flag is refused. */
function destinationOfKind({
  kind,
  values,
}: {
  kind: string | undefined;
  values: Readonly<Record<string, string | boolean>>;
}): Result<ProposalDestination, ProposalError> {
  const known = PROPOSAL_DESTINATION_KINDS.find((candidate) => candidate === kind);
  if (known === undefined) {
    return err(ProposalErrors.destinationKindUnknown({ kind: String(kind), known: PROPOSAL_DESTINATION_KINDS }));
  }
  const foreign = KIND_FLAGS.find((flag) => FLAG_OWNER[flag] !== known && text({ name: flag, values }) !== undefined);
  if (foreign !== undefined) {
    return err(
      ProposalErrors.destinationFieldInvalid({
        flag: foreign,
        why: `is a ${FLAG_OWNER[foreign]} flag; ${KIND_NOUN[known]} has none`,
      }),
    );
  }
  switch (known) {
    case "notion-page":
      return notionPageDestination({ parent: text({ name: "parent", values }) });
    case "local-page":
      return ok({ kind: "local-page", schemaVersion: PROPOSAL_DESTINATION_SCHEMA_VERSION });
    case "linear-document":
      return linearDocumentDestination({
        targetId: text({ name: "target-id", values }),
        targetKind: text({ name: "target-kind", values }),
      });
  }
}

/** The `linear-document` destination a `set linear-document` invocation names, validated by the stored schema. */
function linearDocumentDestination({
  targetKind,
  targetId,
}: {
  targetKind: string | undefined;
  targetId: string | undefined;
}): Result<ProposalDestination, ProposalError> {
  if (targetKind === undefined || targetId === undefined) {
    const missing = targetKind === undefined ? "target-kind" : "target-id";
    return err(
      ProposalErrors.destinationFieldInvalid({
        flag: missing,
        why: `is required: every proposal is created as a document under one Linear ${LINEAR_TARGET_KINDS.join("|")}`,
      }),
    );
  }
  const parsed = proposalDestinationSchema.safeParse({
    kind: "linear-document",
    schemaVersion: PROPOSAL_DESTINATION_SCHEMA_VERSION,
    target: { id: targetId, kind: targetKind },
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const flag = issue.path.includes("kind") ? "target-kind" : "target-id";
    return err(ProposalErrors.destinationFieldInvalid({ flag, why: issue.message }));
  }
  return ok(parsed.data);
}
