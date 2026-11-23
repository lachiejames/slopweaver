/**
 * The PURE core of `sop draft`, `sop lint` and `sop publish` — argument parsing and form validation. No I/O,
 * so all of it is unit-testable without a mock.
 *
 * `publish` is a COMPOSITION rather than a second Notion writer: it lints the bytes, then hands them to the
 * same `notion page` core the standalone verb uses. There is one write path to Notion in this program.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { sopFormSchema } from "../../../outbound/sop/schema.js";
import type { SopForm } from "../../../outbound/sop/types.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/**
 * A parsed `sop draft` invocation.
 *
 * `formExample` is its own arm rather than a flag alongside `formSource`, because the two are exclusive:
 * printing the example reads nothing and writes nothing, so requiring `--form` beside it would refuse the
 * one invocation someone reaches for when they do not yet know what `--form` wants.
 *
 * @internal
 */
export type SopDraftArgs =
  | { readonly kind: "example" }
  | {
      readonly kind: "render";
      readonly formSource: string;
      readonly out: string | undefined;
      readonly json: boolean;
    };

/**
 * A parsed `sop lint` invocation.
 *
 * @internal
 */
export interface SopLintArgs {
  readonly path: string;
  readonly json: boolean;
}

/**
 * A parsed `sop publish` invocation.
 *
 * @internal
 */
export interface SopPublishArgs {
  readonly path: string;
  readonly title: string | undefined;
  readonly icon: string | undefined;
  /** The page a re-publish replaces in place, keeping its id and URL. */
  readonly page: string | undefined;
  /** The parent a FIRST publish is created under. */
  readonly parent: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * The flags `sop draft` accepts; `SOP_DRAFT_FLAG_NAMES` below is what the help-truth ratchet reads.
 *
 * @internal
 */
export const SOP_DRAFT_FLAGS: FlagSpec = { boolean: ["json", "form-example"], string: ["form", "out"] };

/**
 * The flags `sop lint` accepts.
 *
 * @internal
 */
export const SOP_LINT_FLAGS: FlagSpec = { boolean: ["json"] };

/**
 * The flags `sop publish` accepts.
 *
 * @internal
 */
export const SOP_PUBLISH_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["title", "icon", "page", "parent", "home"],
};

/** Every declared flag name of a spec, prefixed, for the help-truth ratchet. */
function flagNames({ spec }: { spec: FlagSpec }): readonly string[] {
  return [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`);
}

/** Every `sop draft` flag, WITH the `--`, for the help-truth ratchet. */
export const SOP_DRAFT_FLAG_NAMES: readonly string[] = flagNames({ spec: SOP_DRAFT_FLAGS });

/** Every `sop lint` flag, WITH the `--`, for the help-truth ratchet. */
export const SOP_LINT_FLAG_NAMES: readonly string[] = flagNames({ spec: SOP_LINT_FLAGS });

/** Every `sop publish` flag, WITH the `--`, for the help-truth ratchet. */
export const SOP_PUBLISH_FLAG_NAMES: readonly string[] = flagNames({ spec: SOP_PUBLISH_FLAGS });

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
 * Parse `sop draft --form <json|-> [--out <md>]`.
 *
 * @param rest the verb's arguments, excluding the noun and the verb
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseSopDraftArgs({ rest }: { rest: readonly string[] }): Result<SopDraftArgs> {
  const parsed = parseFlags({ args: rest, spec: SOP_DRAFT_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  if (values["form-example"] === true) {
    return ok({ kind: "example" });
  }
  const formSource = text({ name: "form", values });
  if (formSource === undefined) {
    return err(["--form <json|-> is required (use `-` to read the filled form from stdin, or --form-example)"]);
  }
  return ok({ formSource, json: values["json"] === true, kind: "render", out: text({ name: "out", values }) });
}

/**
 * Parse `sop lint <path>`.
 *
 * @param rest the verb's arguments, excluding the noun and the verb
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseSopLintArgs({ rest }: { rest: readonly string[] }): Result<SopLintArgs> {
  const [path, ...flags] = rest;
  if (path === undefined || path.startsWith("-")) {
    return err(["usage: slopweaver sop lint <path-to-draft.md> [--json]"]);
  }
  const parsed = parseFlags({ args: flags, spec: SOP_LINT_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ json: parsed.value.values["json"] === true, path });
}

/**
 * Parse `sop publish <path> [--parent <page>] [--page <id>]`.
 *
 * @param rest the verb's arguments, excluding the noun and the verb
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseSopPublishArgs({ rest }: { rest: readonly string[] }): Result<SopPublishArgs> {
  const [path, ...flags] = rest;
  if (path === undefined || path.startsWith("-")) {
    return err(["usage: slopweaver sop publish <path-to-draft.md> [--parent <page>] [--page <id>] [...]"]);
  }
  const parsed = parseFlags({ args: flags, spec: SOP_PUBLISH_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  return ok({
    dryRun: values["dry-run"] === true,
    home: text({ name: "home", values }),
    icon: text({ name: "icon", values }),
    json: values["json"] === true,
    page: text({ name: "page", values }),
    parent: text({ name: "parent", values }),
    path,
    title: text({ name: "title", values }),
  });
}

/**
 * Where an SOP publish is going, once the flags have been reconciled.
 *
 * @internal
 */
export type SopPublishTarget =
  | { readonly kind: "create"; readonly parent: string }
  | { readonly kind: "update"; readonly page: string }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Decide whether a publish creates a page or replaces one.
 *
 * There is deliberately no local register behind this — unlike a proposal, an SOP has no decision to track,
 * and its lifecycle is a review cadence printed on the page itself. So the caller says which page a
 * re-publish replaces, and `--page` with `--parent` is refused rather than silently preferring one.
 *
 * @param page the page a re-publish replaces in place
 * @param parent the parent a first publish is created under
 * @returns the resolved destination, or the named refusal
 */
export function sopPublishTarget({
  page,
  parent,
}: {
  page: string | undefined;
  parent: string | undefined;
}): SopPublishTarget {
  if (page !== undefined && parent !== undefined) {
    return {
      kind: "refused",
      reason:
        "--page and --parent say two different things: --page replaces an existing page in place, --parent " +
        "creates a new one. Pass exactly one.",
    };
  }
  if (page !== undefined) {
    return { kind: "update", page };
  }
  if (parent !== undefined) {
    return { kind: "create", parent };
  }
  return {
    kind: "refused",
    reason:
      "this SOP has no destination, so it needs --parent <page-id-or-url> to say where it goes, or --page " +
      "<id-or-url> to replace one. Notion refuses workspace-parented creation from an internal integration, " +
      "so a new page always inherits the permissions of the page it is created under.",
  };
}

/**
 * Validate a filled SOP form.
 *
 * @param raw the JSON text of the form
 * @returns the typed form, or one line per rejection naming its path
 */
export function parseSopForm({ raw }: { raw: string }): Result<SopForm> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error: unknown) {
    return err([`the form is not valid JSON: ${error instanceof Error ? error.message : "unknown"}`]);
  }
  const parsed = sopFormSchema.safeParse(json);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    parsed.error.issues.flatMap((issue) => issue.message.split("\n").map((line) => `${issue.path.join(".")}: ${line}`)),
  );
}
