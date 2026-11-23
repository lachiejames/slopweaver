/**
 * `slopweaver github pr` — every DECISION this verb makes, as pure functions.
 *
 * The effectful shell in `./run.ts` resolves the home and token, routes through the door and performs the
 * mutation; nothing here touches the network, the clock or the filesystem.
 *
 * ## There is no `create` here — `github stack push` is the one creation door
 *
 * Owner ruling: every pull request Slopweaver opens is a native GitHub stack entry, so the only
 * verb that opens one is `github stack push`. `pr create` is REFUSED in `./run.ts` before this parser ever
 * sees the tail, and this file carries no create arm at all — a parser that still accepted the shape would
 * read to the next session as though the door were open. `stackPushCore.ts` owns the creation arguments now,
 * including the `--file`/example input modes and the base-freshness acknowledgement flags that came with it.
 *
 * `update` takes an EDIT plus the branch locus, and deliberately not a whole form: handing the caller a full
 * form for every edit is exactly how the claims and the review get destroyed, since the caller must
 * reconstruct fields it never meant to touch. The locus comes from flags because {@link PrFormEdit} has no
 * `target` — the base and head of an existing pull request are not a description edit.
 */
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { withholdingCredentialLines } from "../../../outbound/github/descriptionWords.js";
import type { PrFormDraft } from "../../../outbound/github/types.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type GithubVerbError, GithubVerbErrors } from "./errors.js";
import type { PrAddress } from "./updateCore.js";

/** The parsed arguments for one invocation. */
export interface GithubPrArgs {
  readonly verb: "update";
  readonly formSource?: string | undefined;
  readonly editSource?: string | undefined;
  /**
   * A markdown+frontmatter authoring file, as a real path or `-` for stdin — the human-editable alternative
   * to `--form`'s raw JSON. A third whole-replacement input alongside `--edit`/`--form`.
   */
  readonly fileSource?: string | undefined;
  /** Where `--pull` writes the authoring file it reads the live description into. Defaults to the CWD. */
  readonly outPath?: string | undefined;
  /**
   * Read the live description into an editable authoring file and exit, rather than sending a change.
   *
   * `update` only, and mutually exclusive with every other input mode — there is nothing to merge into or
   * replace, only something to read.
   */
  readonly pull: boolean;
  /**
   * With `--pull`, convert a pre-C3 description into a C3 authoring file plus a conversion report, sending nothing.
   */
  readonly convertC3: boolean;
  /** Optional reviewer-orienting inline comments to post after the PR write. */
  readonly selfReviewSource?: string | undefined;
  /** How this update was addressed. */
  readonly address?: PrAddress | undefined;
  /** The full head sha the edit was derived at; the write is refused when the live head is another one. */
  readonly expectHead?: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home?: string | undefined;
}

/**
 * The flags this verb accepts.
 *
 * `helpTruth.test.ts` compares the names derived from it below against the manifest usage string in BOTH
 * directions — a flag the parser takes but the usage hides, and a flag the usage advertises but the parser
 * rejects, are both failures. Names here omit the leading `--`, which is what `parseFlags` expects.
 */
const GITHUB_PR_FLAGS: FlagSpec = {
  boolean: ["convert-c3", "dry-run", "json", "pull"],
  string: ["form", "edit", "file", "out", "self-review", "repo", "base", "head", "number", "expect-head", "home"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const GITHUB_PR_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_PR_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_PR_FLAGS }),
].map((name) => `--${name}`);

/** A repo slug is `owner/name`; both segments must be present and free of whitespace. */
const SLUG = /^([^\s/]+)\/([^\s/]+)$/;

/**
 * Split an `owner/name` slug.
 *
 * @param slug the `--repo` value
 * @returns the two segments, or undefined when malformed
 */
export function parseRepoSlug({ slug }: { slug: string }): { owner: string; repo: string } | undefined {
  const match = SLUG.exec(slug);
  return match === null ? undefined : { owner: match[1]!, repo: match[2]! };
}

/**
 * This verb's input modes: a partial edit, a whole replacement (JSON or an authoring file), or a read-only
 * pull. They are mutually exclusive rather than merged — a partial edit, a whole replacement and a read-only
 * pull are different operations with different consequences, so a caller who gave more than one has said two
 * things and there is no safe way to pick.
 */
function checkUpdateInputMode({
  formSource,
  editSource,
  fileSource,
  selfReviewSource,
  pull,
  errors,
}: {
  formSource: string | undefined;
  editSource: string | undefined;
  fileSource: string | undefined;
  selfReviewSource: string | undefined;
  pull: boolean;
  errors: string[];
}): void {
  if (pull) {
    if (
      editSource !== undefined ||
      formSource !== undefined ||
      fileSource !== undefined ||
      selfReviewSource !== undefined
    ) {
      errors.push(
        "--pull is read-only — it reads the live description into an editable file and cannot combine with " +
          "--edit, --form, --file or --self-review",
      );
    }
    return;
  }
  const descriptionInputs = [editSource, formSource, fileSource].filter((source) => source !== undefined);
  if (descriptionInputs.length === 0 && selfReviewSource === undefined) {
    errors.push(
      "update needs --edit <json|->, which names ONLY the fields to change so the rest survives, or " +
        "--form <json|-> or --file <path|-> to replace the whole description, or --self-review <json|-> to " +
        "refresh only the inline walkthrough, or --pull to read the live description into an editable file",
    );
    return;
  }
  if (descriptionInputs.length > 1) {
    errors.push(
      "give exactly ONE of --edit, --form or --file to update: a partial edit and a whole replacement are " +
        "different operations",
    );
  }
  // The description input that would read stdin: the first one given, in `--form`, `--edit`, `--file` order.
  const descriptionSource = [formSource, editSource, fileSource].find((source) => source !== undefined);
  if (descriptionSource === "-" && selfReviewSource === "-") {
    errors.push("--self-review and the description input cannot both read from stdin; pass one as inline JSON");
  }
}

/** The repository half of an update address, which both shapes need. */
function repoFrom({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | boolean>>;
  errors: string[];
}): { owner: string; repo: string } | undefined {
  const slug = typeof values["repo"] === "string" ? values["repo"] : undefined;
  if (slug === undefined) {
    errors.push("update needs --repo <owner/name>, plus either --number <n> or --base <ref> --head <ref>");
    return undefined;
  }
  const parsed = parseRepoSlug({ slug });
  if (parsed === undefined) {
    errors.push(`--repo must be owner/name; "${slug}" is not`);
  }
  return parsed;
}

/** The `--number` shape, whose only validation is that the number is a plausible pull-request number. */
function numberAddress({
  raw,
  owner,
  repo,
  errors,
}: {
  raw: string;
  owner: string;
  repo: string;
  errors: string[];
}): PrAddress | undefined {
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0) {
    errors.push(`--number must be a positive whole number; "${raw}" is not`);
    return undefined;
  }
  return { kind: "number", number, owner, repo };
}

/**
 * Collect the update address, in whichever of the two shapes the caller used.
 *
 * `--repo --number` is the direct shape and the one to prefer: a number identifies a pull request outright,
 * and it is the only shape that still works once the branches have been deleted or renamed. The branch pair
 * stays supported because it was the only shape that ever existed, but it is now RESOLVED against GitHub
 * rather than trusted, because two pull requests can share one base and head over time.
 *
 * Exactly one of the two, never both — a caller who gives both has told us two things and we cannot know
 * which they meant.
 */
function addressFrom({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | boolean>>;
  errors: string[];
}): PrAddress | undefined {
  const rawNumber = typeof values["number"] === "string" ? values["number"] : undefined;
  const base = typeof values["base"] === "string" ? values["base"] : undefined;
  const head = typeof values["head"] === "string" ? values["head"] : undefined;
  const byBranch = base !== undefined || head !== undefined;
  const parsed = repoFrom({ errors, values });
  if (parsed === undefined) {
    return undefined;
  }
  if (rawNumber !== undefined && byBranch) {
    errors.push(
      "give EITHER --number or --base/--head, not both: they are two different ways to name one pull request",
    );
    return undefined;
  }
  if (rawNumber !== undefined) {
    return numberAddress({ errors, owner: parsed.owner, raw: rawNumber, repo: parsed.repo });
  }
  if (base === undefined || head === undefined) {
    errors.push(
      "--base and --head go together: together they are the branch pair. Or name the pull request with --number",
    );
    return undefined;
  }
  return { base, head, kind: "branch", owner: parsed.owner, repo: parsed.repo };
}

/** A flag's string value, undefined when it was not given (or given as a bare switch). */
function stringFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** The refusals two flags earn on their own: `--convert-c3` without `--pull`, and a malformed `--expect-head`. */
function pairedFlagErrors({
  convertC3,
  expectHead,
  pull,
}: {
  convertC3: boolean;
  expectHead: string | undefined;
  pull: boolean;
}): readonly string[] {
  const errors: string[] = [];
  if (convertC3 && !pull) {
    errors.push(
      "--convert-c3 rides --pull: it converts the pulled pre-C3 description into a C3 authoring file and sends nothing",
    );
  }
  if (expectHead !== undefined && !/^[0-9a-f]{40}$/.test(expectHead)) {
    errors.push("--expect-head must be a full 40-character lowercase commit sha");
  }
  return errors;
}

/**
 * Parse this verb's arguments.
 *
 * @param argv the verb's own arguments, starting with the sub-command
 * @returns the parsed arguments, or every usage error at once
 */
export function parseGithubPrArgs({ argv }: { argv: readonly string[] }): Result<GithubPrArgs, GithubVerbError> {
  const verb = argv[0];
  if (verb !== "update") {
    return err(GithubVerbErrors.usage({ command: "pr", shape: "<update|request-review|retarget>" }));
  }
  const parsed = parseFlags({ args: argv.slice(1), spec: GITHUB_PR_FLAGS });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const formSource = stringFlag({ name: "form", values });
  const editSource = stringFlag({ name: "edit", values });
  const fileSource = stringFlag({ name: "file", values });
  const outPath = stringFlag({ name: "out", values });
  const selfReviewSource = stringFlag({ name: "self-review", values });
  const expectHead = stringFlag({ name: "expect-head", values });
  const pull = values["pull"] === true;
  const convertC3 = values["convert-c3"] === true;
  const errors: string[] = [...pairedFlagErrors({ convertC3, expectHead, pull })];
  checkUpdateInputMode({ editSource, errors, fileSource, formSource, pull, selfReviewSource });
  const address = addressFrom({ errors, values });
  if (errors.length > 0) {
    return err(GithubVerbErrors.argumentsRefused({ reasons: errors }));
  }
  return ok({
    address,
    convertC3,
    dryRun: values["dry-run"] === true,
    editSource,
    expectHead,
    fileSource,
    formSource,
    home: stringFlag({ name: "home", values }),
    json: values["json"] === true,
    outPath,
    pull,
    selfReviewSource,
    verb,
  });
}

/**
 * What a dry run prints: the exact bytes, and the gate's verdict on them.
 *
 * @param body the rendered pull-request body
 * @param form the validated form it came from, for the destination line
 * @param validation the PR-format gate's verdict on the title and body (`renderAndCheck`: CI's `pr-format` shape
 *   check and its secret scan)
 * @returns the lines to print
 */
export function dryRunLines({
  body,
  form,
  validation,
}: {
  body: string;
  form: PrFormDraft;
  validation: { ok: boolean; errors: readonly string[] };
}): readonly string[] {
  const { target } = form;
  // NO closing "no token, no network" line here any more, and its absence is deliberate. This helper is shared
  // by `pr update` and `stack push`, and their dry runs do not make the same promise: stack push's is fully
  // offline while update's resolves a token and performs GETs. A shared line said "no network" underneath an
  // update that had just read the pull request — printed output contradicting itself in the same breath. Each
  // caller states its own contract instead, because only the caller knows what it actually did.
  return [
    `would open: ${target.owner}/${target.repo}  ${target.head} -> ${target.base}${form.draft ? "  (draft)" : ""}`,
    `title: ${form.title}`,
    "",
    "--- body (exact bytes that would be sent) ---",
    body,
    "--- end body ---",
    "",
    validation.ok
      ? "pr-format: ACCEPTS this title and body (CI's shape check and secret scan)"
      : `pr-format: REJECTS this title and body:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`,
    "",
  ];
}

/**
 * The door request for one description write.
 *
 * `createsWorkItem` is false: re-rendering a description puts nothing new on a human's queue. Opening a pull
 * request does, and that request is `githubStackPushDoorRequest` in `./stackPushCore.ts` — the one creation
 * door.
 *
 * @param verb which sub-command
 * @param home the resolved state home
 * @param locus the branch locus, which is this write's identity
 * @returns the request to admit
 */
export function doorRequestFor({ verb, home, locus }: { verb: "update"; home: string; locus: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: `pr ${verb}` },
    artifact: { id: locus },
    meta: {
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}

/** Every way this verb can end, each reported as itself rather than folded into success or failure. */
export type PrOutcome =
  | { readonly kind: "created"; readonly number: number; readonly url: string }
  | { readonly kind: "updated"; readonly number: number; readonly url: string }
  /**
   * The merged form rendered the bytes already live, so nothing was sent.
   *
   * Its own kind rather than `updated`, because reporting a change that did not happen is the silent-success
   * class this verb exists to remove. It is NOT a failure — the description is already what the caller asked
   * for — so it exits 0.
   */
  | { readonly kind: "unchanged"; readonly number: number; readonly url: string }
  | { readonly kind: "duplicate"; readonly locus: string; readonly existing: number | undefined }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "unconfirmed"; readonly locus: string; readonly detail: string };

/**
 * The operator-facing report.
 *
 * An `unconfirmed` outcome is never phrased as a failure. A failure invites a retry, and a retry after a
 * create whose response was lost is how a second pull request gets opened.
 *
 * @param outcome what happened
 * @returns the lines to print
 */
export function outcomeLines({ outcome }: { outcome: PrOutcome }): readonly string[] {
  switch (outcome.kind) {
    case "created":
      return [`opened #${String(outcome.number)}  ${outcome.url}`];
    case "updated":
      return [`updated #${String(outcome.number)}  ${outcome.url}`];
    case "unchanged":
      return [
        `unchanged #${String(outcome.number)}  ${outcome.url}`,
        "  the merged description is byte-identical to the one already there, so nothing was sent.",
      ];
    case "duplicate":
      return [
        `refused: ${outcome.locus} is already reserved` +
          (outcome.existing === undefined ? "" : ` by #${String(outcome.existing)}`) +
          ". A second pull request for the same branches would be a duplicate, not a retry.",
      ];
    case "refused":
      // A refusal can quote what it judged (a scan finding, a reviewer's line), so a credential shape is withheld.
      return withholdingCredentialLines({ lines: [`refused: ${outcome.reason}`] });
    case "unconfirmed":
      return [
        `UNCONFIRMED: ${outcome.detail}`,
        `The reservation for ${outcome.locus} is held, and nothing here retries it — run this again.`,
        "The next attempt reads the branch pair itself and releases or adopts whatever is there; `github pr release-reservation` settles a pair that read cannot.",
      ];
  }
}
