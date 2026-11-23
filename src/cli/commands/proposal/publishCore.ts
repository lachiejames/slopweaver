/**
 * The PURE core of `proposal intake`, `proposal publish` and `proposal teaser`.
 *
 * `publish` is a COMPOSITION rather than a second writer: it lints the bytes, then hands them to the door of
 * the install's destination — the `notion page` core for a Notion page, the `page publish` core for a local
 * page, the `linear document` command for a Linear document. Each provider has one write path in this
 * program, and a proposal is one caller of it.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { ProposalAddress, ProposalProvider } from "../../../outbound/proposal/address.js";
import {
  PROPOSAL_DESTINATION_SET_HINT,
  type ProposalDestination,
  proposalDestinationProvider,
} from "../../../outbound/proposal/destination.js";
import type { ProposalIntake } from "../../../outbound/proposal/intake.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type ProposalError, ProposalErrors } from "./errors.js";

/** A parsed `proposal intake` invocation. */
export interface ProposalIntakeArgs {
  readonly brief: string;
  readonly id: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `proposal publish` invocation. */
export interface ProposalPublishArgs {
  readonly path: string;
  readonly title: string | undefined;
  readonly icon: string | undefined;
  /** The intake this proposal belongs to; its record remembers which page to re-publish over. */
  readonly intakeId: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A parsed `proposal teaser` invocation. */
export interface ProposalTeaserArgs {
  readonly formSource: string;
  readonly pageUrl: string | undefined;
  readonly intakeId: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** The flags `proposal intake` accepts. */
const PROPOSAL_INTAKE_FLAGS: FlagSpec = { boolean: ["json"], string: ["brief", "id", "home"] };

/** The flags `proposal publish` accepts. */
const PROPOSAL_PUBLISH_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["title", "icon", "intake", "home"],
};

/** The flags `proposal teaser` accepts. */
const PROPOSAL_TEASER_FLAGS: FlagSpec = { boolean: ["json"], string: ["form", "page", "intake", "home"] };

/** Every `proposal intake` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_INTAKE_FLAG_NAMES: readonly string[] = flagNames({ spec: PROPOSAL_INTAKE_FLAGS });

/** Every `proposal publish` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_PUBLISH_FLAG_NAMES: readonly string[] = flagNames({ spec: PROPOSAL_PUBLISH_FLAGS });

/** Every `proposal teaser` flag, WITH the `--`, for the help-truth ratchet. */
export const PROPOSAL_TEASER_FLAG_NAMES: readonly string[] = flagNames({ spec: PROPOSAL_TEASER_FLAGS });

/** Every declared flag name of a spec, prefixed. */
function flagNames({ spec }: { spec: FlagSpec }): readonly string[] {
  return [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`);
}

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

/**
 * Parse `proposal intake --brief "<text>"`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalIntakeArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<ProposalIntakeArgs, ProposalError> {
  const parsed = parseFlags({ args: rest, spec: PROPOSAL_INTAKE_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const brief = text({ name: "brief", values });
  if (brief === undefined || brief.trim().length === 0) {
    return err(ProposalErrors.intakeBriefRequired());
  }
  return ok({
    brief: brief.trim(),
    home: text({ name: "home", values }),
    id: text({ name: "id", values }),
    json: values["json"] === true,
  });
}

/**
 * Whether an argv still carries the retired `--parent`, in either spelling.
 *
 * Checked BEFORE the generic flag parse, so the refusal names where a destination now lives rather than
 * reading as an unknown flag. A parent on the command line would be a second authority beside the install's
 * stored destination, and two authorities is exactly how a proposal lands somewhere nobody chose.
 */
function carriesRetiredParent({ args }: { args: readonly string[] }): boolean {
  return args.some((arg) => arg === "--parent" || arg.startsWith("--parent="));
}

/**
 * Parse `proposal publish <path> [--intake <id>]`. The destination is the install's, read from the store.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalPublishArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<ProposalPublishArgs, ProposalError> {
  const [path, ...flags] = rest;
  if (path === undefined || path.startsWith("-")) {
    return err(
      ProposalErrors.usage({
        usage: "usage: slopweaver proposal publish <path-to-draft.md> [--intake <id>] [...]",
      }),
    );
  }
  if (carriesRetiredParent({ args: flags })) {
    return err(ProposalErrors.publishParentRetired({ hint: PROPOSAL_DESTINATION_SET_HINT }));
  }
  const parsed = parseFlags({ args: flags, spec: PROPOSAL_PUBLISH_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  return ok({
    dryRun: values["dry-run"] === true,
    home: text({ name: "home", values }),
    icon: text({ name: "icon", values }),
    intakeId: text({ name: "intake", values }),
    json: values["json"] === true,
    path,
    title: text({ name: "title", values }),
  });
}

/**
 * Parse `proposal teaser --form <json|-> [--page <url>] [--intake <id>]`.
 *
 * @param rest the verb's arguments
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseProposalTeaserArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<ProposalTeaserArgs, ProposalError> {
  const parsed = parseFlags({ args: rest, spec: PROPOSAL_TEASER_FLAGS });
  if (parsed.isErr()) {
    return err(ProposalErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const formSource = text({ name: "form", values });
  if (formSource === undefined) {
    return err(ProposalErrors.teaserFormRequired());
  }
  const pageUrl = text({ name: "page", values });
  const intakeId = text({ name: "intake", values });
  if (pageUrl === undefined && intakeId === undefined) {
    return err(ProposalErrors.teaserTargetRequired());
  }
  return ok({ formSource, home: text({ name: "home", values }), intakeId, json: values["json"] === true, pageUrl });
}

/**
 * Where a proposal publish is going, once the intake and the install's destination have been reconciled: a new
 * artifact at the configured destination, or the one this intake already published.
 */
export type PublishTarget =
  | { readonly kind: "create"; readonly destination: ProposalDestination }
  | { readonly kind: "update"; readonly address: ProposalAddress; readonly destination: ProposalDestination };

/**
 * The provider a publish writes to: the configured destination's on a create, the recorded address's on an
 * update. `publishTarget` has already refused an update whose provider differs from the install's.
 *
 * @param target the reconciled publish target
 * @returns the provider whose door performs the write
 */
export function publishTargetProvider({ target }: { target: PublishTarget }): ProposalProvider {
  if (target.kind === "update") {
    return target.address.provider;
  }
  return proposalDestinationProvider({ destination: target.destination });
}

/**
 * The `notion page` subcommand and the flag naming where it writes: `create --parent <page>` for a new page,
 * `update --page <id>` for the one this intake published.
 *
 * Only ever reached for a Notion target. A create whose destination is not a Notion page reaching here is a
 * dispatch defect, and it throws rather than sending the provider an empty parent.
 *
 * @param target the reconciled publish target, on the Notion provider
 * @returns the subcommand, its locating flag, and that flag's value
 */
export function notionPageLocator({ target }: { target: PublishTarget }): {
  readonly verb: "create" | "update";
  readonly flag: "--parent" | "--page";
  readonly value: string;
} {
  if (target.kind === "update") {
    return { flag: "--page", value: target.address.id, verb: "update" };
  }
  if (target.destination.kind !== "notion-page") {
    throw new Error(`a ${target.destination.kind} destination was dispatched to the Notion door`);
  }
  return { flag: "--parent", value: target.destination.parent, verb: "create" };
}

/**
 * Refuse a publish whose destination needs a title the invocation did not give.
 *
 * The rendered proposal deliberately carries no title line (a Notion page takes it as a property instead), so
 * a destination that has no title property of its own can only take one from `--title`. Inventing one, such as
 * "untitled", would publish a page nobody can tell apart from the next.
 *
 * @param destination the install's stored destination
 * @returns nothing when the publish can go ahead, else `PUBLISH_TITLE_REQUIRED`
 */
export function requirePublishTitle({
  destination,
  title,
}: {
  destination: ProposalDestination;
  title: string | undefined;
}): Result<void, ProposalError> {
  // A blank `--title=` is no title: the page would open on an empty heading.
  const untitled = title === undefined || title.trim().length === 0;
  if (destination.kind !== "notion-page" && untitled) {
    return err(ProposalErrors.publishTitleRequired({ destinationKind: destination.kind }));
  }
  return ok(undefined);
}

/**
 * Decide whether a publish creates an artifact or replaces the one this intake already published.
 *
 * The intake's own record is what settles it. A provider assigns ids, so nothing about the DOCUMENT can say
 * whether it has been published before — only the local record can, which is why `--intake` is how a
 * re-publish keeps its URL rather than creating a second copy under the same title. A first publish goes
 * wherever the install's stored destination says.
 *
 * Two records cannot be reconciled and are refused rather than guessed at: an address on a provider other
 * than the one the install now publishes to (creating there would strand the first copy as a stale second
 * one), and a legacy record holding only a page URL (enough to link, not enough to update in place).
 *
 * @param intake the intake this publish belongs to, if any; its recorded address is what a re-publish updates
 * @param destination the install's stored destination, which a first publish is created under
 * @returns the resolved target, or the refusal naming why the record and the destination disagree
 */
export function publishTarget({
  intake,
  destination,
}: {
  intake: Pick<ProposalIntake, "address" | "id" | "linkOnlyPageUrl"> | undefined;
  destination: ProposalDestination;
}): Result<PublishTarget, ProposalError> {
  if (intake === undefined) {
    return ok({ destination, kind: "create" });
  }
  const { address } = intake;
  if (address !== undefined) {
    const configured = proposalDestinationProvider({ destination });
    if (address.provider !== configured) {
      return err(ProposalErrors.republishProviderMismatch({ configured, published: address.provider }));
    }
    return ok({ address, destination, kind: "update" });
  }
  if (intake.linkOnlyPageUrl !== undefined) {
    return err(ProposalErrors.republishAddressIncomplete({ intakeId: intake.id }));
  }
  return ok({ destination, kind: "create" });
}
