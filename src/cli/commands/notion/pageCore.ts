/**
 * The PURE core of `notion page <create|update|archive|move>` — argument parsing, body conversion and the
 * outcome vocabulary; the dry-run preview is `./pagePreview.ts`. No I/O, so all of it is unit-testable
 * without a mock.
 *
 * ## `--private` is not a flag here, and that is a measured constraint rather than an omission
 *
 * The original design asked for a page with no parent, on the reasoning that a parentless page is
 * workspace-private. Notion refuses it outright for an internal integration:
 *
 *   Provide a `parent.page_id` or `parent.database_id` parameter to create a page, or use a public
 *   integration with `insert_content` capability. Internal integrations aren't owned by a single user, so
 *   creating workspace-level private pages is not supported.
 *
 * So a created page ALWAYS inherits its parent's permissions, and `--parent` is required. Privacy is a
 * property of where you publish, not of a flag this verb could offer, and pretending otherwise would ship a
 * `--private` that quietly did nothing.
 *
 * ## `move` is the one sub-command that sends no content
 *
 * A move re-parents a page and changes nothing inside it: the id, the URL and every block survive. That is
 * why it carries no `--body`, takes no intent digest, and is NOT gated on an external edit — the refusal
 * `update` owes a human exists because an update DESTROYS what they wrote, and a move destroys nothing.
 * What a move does change is who can see the page, since Notion permissions are inherited from the parent,
 * so the destination is named in the report rather than left for the reader to infer.
 */
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { checkMarkdownBody } from "../../../outbound/notion/markdownBody.js";
import { isValidPageId } from "../../../outbound/notion/pageLedger.js";
import { verifyReminderLines } from "../../../outbound/notion/verifyCommand.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type NotionCommandError, NotionCommandErrors } from "./errors.js";

/** Every sub-command `notion page` dispatches. */
export type NotionPageVerb = "create" | "update" | "archive" | "move";

/** The sub-commands, in the order the usage string lists them — one source for the parser and the usage. */
const NOTION_PAGE_VERBS: readonly NotionPageVerb[] = ["create", "update", "archive", "move"];

/** A parsed `notion page` invocation. */
export interface NotionPageArgs {
  readonly verb: NotionPageVerb;
  readonly parent: string | undefined;
  readonly page: string | undefined;
  /** `move` only: the page the subject is being re-parented under. */
  readonly to: string | undefined;
  readonly title: string | undefined;
  readonly icon: string | undefined;
  readonly bodySource: string;
  /** Where relative `file:` placeholder paths resolve from; defaults to the body file's own directory. */
  readonly mediaBase: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
  /** Record ownership of a page absent from the ledger, but ONLY on the provider's own authorship evidence. */
  readonly adopt: boolean;
  /**
   * Overwrite a page a human genuinely edited since slopweaver last wrote it — never needed for a
   * byte-identical touch, which `resolveExternalEdit` waves through on its own. Always the caller's stated
   * reason, journaled; undefined when the flag was not given.
   */
  readonly overwriteExternalEdit: string | undefined;
}

/** What went wrong parsing argv, in the operator's vocabulary. */
export type NotionPageArgParse = Result<NotionPageArgs, NotionCommandError>;

/**
 * The flags this verb accepts.
 *
 * `helpTruth.test.ts` compares the names derived from it below against the manifest usage string in both
 * directions.
 */
const NOTION_PAGE_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json", "adopt"],
  string: ["parent", "page", "to", "title", "icon", "body", "media-base", "home", "overwrite-external-edit"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const NOTION_PAGE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: NOTION_PAGE_FLAGS }),
  ...booleanFlagsOf({ spec: NOTION_PAGE_FLAGS }),
].map((name) => `--${name}`);

/**
 * What each sub-command requires, as a table rather than a run of guards.
 *
 * A table because the rule genuinely IS one: every entry reads "this sub-command needs this flag, and here
 * is what to tell someone who left it out". Written as branches it grew one `if` per verb per flag, which
 * is how {@link missingRequired} passed this repo's cognitive-complexity ceiling the moment `move` — with
 * two required flags of its own — arrived.
 */
const REQUIRED_BY_VERB: Readonly<Record<NotionPageVerb, ReadonlyArray<{ flag: string; why: string }>>> = {
  archive: [
    { flag: "page", why: "--page <page-id-or-url> is required for archive; it is the page to move to Notion's trash" },
  ],
  create: [
    {
      flag: "parent",
      why:
        "--parent <page-id-or-url> is required. Notion refuses workspace-parented page creation from an " +
        "internal integration, so a new page always inherits the permissions of the page it is created under.",
    },
    {
      flag: "title",
      why: "--title <text> is required for create; a Notion page title is a property, not part of the body",
    },
  ],
  move: [
    { flag: "page", why: "--page <page-id-or-url> is required for move; it is the page being re-parented" },
    {
      flag: "to",
      why:
        "--to <page-id-or-url> is required for move; it is the page the subject is moved under. Notion refuses " +
        "a workspace-level move from an internal integration exactly as it refuses a workspace-level create, " +
        "so a moved page always inherits some parent's permissions.",
    },
  ],
  update: [{ flag: "page", why: "--page <page-id-or-url> is required for update; it is the page slopweaver created" }],
};

/** The sub-commands that send no markdown body at all, so `--body` is not theirs to require. */
const BODYLESS_VERBS: ReadonlySet<NotionPageVerb> = new Set<NotionPageVerb>(["archive", "move"]);

/**
 * Every argument this sub-command needs and did not get.
 *
 * Split out of {@link parseNotionPageArgs} so that function stays under this repository's
 * cognitive-complexity ceiling: what is required is a table keyed by sub-command, and reading it as one is
 * easier than reading a run of guards.
 *
 * @param verb which sub-command was asked for
 * @param text a reader for one string flag, `--body` included — which the bodyless sub-commands do not need
 * @returns one operator-facing line per missing argument
 */
function missingRequired({
  verb,
  text,
}: {
  verb: NotionPageVerb;
  text: (args: { name: string }) => string | undefined;
}): readonly string[] {
  const errors: string[] = [];
  // `archive` trashes a page and `move` re-parents one; neither sends content, so requiring a body would be
  // ceremony — and worse than ceremony for a default of `-`, which would sit waiting on stdin nobody types.
  if (text({ name: "body" }) === undefined && !BODYLESS_VERBS.has(verb)) {
    errors.push("--body <md-path|-> is required (use `-` to read the markdown body from stdin)");
  }
  for (const required of REQUIRED_BY_VERB[verb]) {
    if (text({ name: required.flag }) === undefined) {
      errors.push(required.why);
    }
  }
  if (text({ name: "overwrite-external-edit" }) === "") {
    errors.push("--overwrite-external-edit requires a non-empty reason, journaled alongside who last edited the page");
  }
  return errors;
}

/**
 * Where the markdown body is read from: `--body` as given, or stdin (`-`) when it was left out. Only the
 * bodyless sub-commands reach the stdin default — {@link missingRequired} refuses a create or update without
 * `--body` — and they never read a body, so the default exists to keep the parsed shape whole.
 */
function bodySourceOf({ text }: { text: (args: { name: string }) => string | undefined }): string {
  const given = text({ name: "body" });
  if (given === undefined) {
    return "-";
  }
  return given;
}

/**
 * Parse `notion page <create|update|archive|move> …`.
 *
 * @param argv the verb's arguments, excluding the noun and the verb
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseNotionPageArgs({ argv }: { argv: readonly string[] }): NotionPageArgParse {
  const verb = NOTION_PAGE_VERBS.find((known) => known === argv[0]);
  if (verb === undefined) {
    return err(NotionCommandErrors.pageUsage({ got: argv[0], verbs: NOTION_PAGE_VERBS }));
  }
  const parsed = parseFlags({ args: argv.slice(1), spec: NOTION_PAGE_FLAGS });
  if (parsed.isErr()) {
    return err(NotionCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const text = ({ name }: { name: string }): string | undefined =>
    typeof values[name] === "string" ? values[name] : undefined;
  const errors = missingRequired({ text, verb });
  if (errors.length > 0) {
    return err(NotionCommandErrors.argsRefused({ reasons: errors }));
  }
  return ok({
    adopt: values["adopt"] === true,
    bodySource: bodySourceOf({ text }),
    dryRun: values["dry-run"] === true,
    home: text({ name: "home" }),
    icon: text({ name: "icon" }),
    mediaBase: text({ name: "media-base" }),
    json: values["json"] === true,
    overwriteExternalEdit: text({ name: "overwrite-external-edit" }),
    page: text({ name: "page" }),
    parent: text({ name: "parent" }),
    title: text({ name: "title" }),
    to: text({ name: "to" }),
    verb,
  });
}

/** A body that may be published, or every reason it may not. */
export type BodyParse = Result<void>;

/**
 * Preflight a markdown body.
 *
 * Notion's own enhanced-Markdown endpoint does the conversion, so there is nothing here to render — only
 * the refusals that must happen BEFORE a page exists, because a publish that fails at the provider has
 * already created one.
 *
 * @param markdown the body, without its H1 title line
 * @returns ok, or the refusals naming what cannot be sent
 */
export function parseNotionPageBody({ markdown }: { markdown: string }): BodyParse {
  const checked = checkMarkdownBody({ markdown });
  return checked;
}

/**
 * What became of a Notion page write.
 *
 * `unconfirmed` is the honest answer to a create whose response arrived but could not be read back: Notion
 * assigns the page id, so a retry cannot be aimed at the same page and would publish a second one.
 */
export type NotionPageOutcome =
  | { readonly kind: "created"; readonly pageId: string; readonly url: string }
  | { readonly kind: "updated"; readonly pageId: string; readonly url: string }
  | { readonly kind: "adopted"; readonly pageId: string; readonly url: string }
  | { readonly kind: "unchanged"; readonly pageId: string; readonly url: string }
  // Moved to Notion's trash, which keeps it for thirty days. Named `archived` rather than `deleted` because
  // that is what actually happened, and a reader who needs it back must know it is still there.
  | { readonly kind: "archived"; readonly pageId: string; readonly url: string }
  // Re-parented. `parentPageId` is read BACK off the page rather than echoed from the request, so this kind
  // is only ever reported when the provider agrees the page is where it was sent.
  | {
      readonly kind: "moved";
      readonly pageId: string;
      readonly url: string;
      readonly fromParentId: string | undefined;
      readonly parentPageId: string;
    }
  // The page was already under the requested parent, so nothing was sent. Kept apart from `moved` because
  // "it is there now" and "it was already there" answer different questions, and a caller told the first
  // when the second is true will believe a move it asked for did something it did not.
  | { readonly kind: "unmoved"; readonly pageId: string; readonly url: string; readonly parentPageId: string }
  // The page landed and is recorded, but at least one image did not attach. Named rather than folded into
  // `created`, because "the document is on Notion" and "the document is finished" are different claims and
  // a caller that cannot tell them apart will make the wrong one.
  | {
      readonly kind: "partial";
      readonly pageId: string;
      readonly url: string;
      readonly reasons: readonly string[];
    }
  // `url` is optional because the read-back that WOULD have supplied it is the very call that failed.
  | { readonly kind: "unconfirmed"; readonly pageId: string; readonly url: string | undefined; readonly reason: string }
  | { readonly kind: "duplicate"; readonly reservedIso: string; readonly url: string | undefined }
  | { readonly kind: "indeterminate"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * What a refused duplicate tells the operator.
 *
 * Split out for the same reason as {@link movedLines}: the arm needs three lines of explanation and one
 * branch, and a switch whose arms are paragraphs stops being readable as the table it is.
 *
 * @param outcome the refusal, carrying when the intent was reserved and where (if anywhere) it published
 * @returns the lines to print
 */
function duplicateLines({
  outcome: { reservedIso, url },
}: {
  outcome: { readonly reservedIso: string; readonly url: string | undefined };
}): readonly string[] {
  const found =
    url === undefined
      ? "No page was ever confirmed for it, so reconcile in Notion before retrying."
      : `It published to ${url}. Use \`--page\` with update to re-publish over it.`;
  return [
    `refused: this exact intent was already reserved at ${reservedIso}.`,
    found,
    "The intent is parent + title + body, so an identical publish maps to the identical page.",
  ];
}

/**
 * What a completed move tells the operator.
 *
 * Split out of {@link notionPageOutcomeLines} to keep that switch a table of one-liners per arm rather than
 * a run of paragraphs — the same reason `missingRequired` is its own function.
 *
 * @param outcome the confirmed move, carrying the parent it was read back under
 * @returns the lines to print
 */
function movedLines({
  outcome: { pageId, parentPageId, fromParentId, url },
}: {
  outcome: {
    readonly pageId: string;
    readonly parentPageId: string;
    readonly fromParentId: string | undefined;
    readonly url: string;
  };
}): readonly string[] {
  const origin = fromParentId === undefined ? "" : `, out from under ${fromParentId}`;
  return [
    `moved page ${pageId} under ${parentPageId}${origin}.`,
    url,
    "the page id, the URL and every block are unchanged, so every existing link to it still resolves.",
    "its permissions are now the destination's: whoever can see that parent can see this page.",
  ];
}

/** An unconfirmed write's URL, or — when the read-back that would have supplied it failed — that it never came. */
function unconfirmedUrl({
  outcome,
}: {
  outcome: Extract<NotionPageOutcome, { readonly kind: "unconfirmed" }>;
}): string {
  const { url } = outcome;
  if (url === undefined) {
    return "(its URL was never returned)";
  }
  return url;
}

/**
 * The operator-facing report for an outcome.
 *
 * @param outcome what happened
 * @returns the lines to print
 */
export function notionPageOutcomeLines({ outcome }: { outcome: NotionPageOutcome }): readonly string[] {
  switch (outcome.kind) {
    case "created":
      return [`created page ${outcome.pageId}`, outcome.url, ...verifyReminderLines({ pageUrl: outcome.url })];
    case "updated":
      return [
        `updated page ${outcome.pageId}: its whole content was replaced in place`,
        outcome.url,
        "the page id and URL are unchanged, so every existing link to it still resolves.",
        ...verifyReminderLines({ pageUrl: outcome.url }),
      ];
    case "adopted":
      return [
        `adopted page ${outcome.pageId} into the ledger; nothing was written.`,
        outcome.url,
        "slopweaver will now let `update` replace this page's content. Re-run the update to publish.",
      ];
    case "partial":
      return [
        `partial page ${outcome.pageId}: it was written, but ${String(outcome.reasons.length)} image(s) did not attach.`,
        outcome.url,
        ...outcome.reasons,
        "The page is recorded as slopweaver's, and every placeholder that failed still has its marker on the " +
          "page. Fix the file and re-run `slopweaver notion attach` — it will attach only those.",
        ...verifyReminderLines({ pageUrl: outcome.url }),
      ];
    case "archived":
      return [`archived page ${outcome.pageId}: it is in Notion's trash, recoverable for thirty days.`, outcome.url];
    case "duplicate":
      return duplicateLines({ outcome });
    case "moved":
      return movedLines({ outcome });
    case "unmoved":
      return [`page ${outcome.pageId} is already under ${outcome.parentPageId}, so nothing was sent.`, outcome.url];
    case "unchanged":
      return [
        `page ${outcome.pageId} was rewritten and came back byte-identical, so the re-publish changed nothing.`,
        outcome.url,
        ...verifyReminderLines({ pageUrl: outcome.url }),
      ];
    case "unconfirmed":
      return [
        `page ${outcome.pageId} was written but could NOT be read back, so its state is unverified.`,
        unconfirmedUrl({ outcome }),
        `the read-back failed with: ${outcome.reason}`,
        "Do not re-run this: Notion assigns the page id, so a retry publishes a SECOND page.",
      ];
    case "indeterminate":
      return [
        "the write errored AND the page could not be read back, so it is unknown whether it landed.",
        `the error was: ${outcome.reason}`,
        "Do NOT re-run this. Look in Notion under the parent page, then reconcile.",
      ];
    case "failed":
      return [`the write failed: ${outcome.reason}`];
  }
}

/**
 * The door request for a Notion page write.
 *
 * `artifact` deliberately carries only the destination and the intent — the door record is an audit trail,
 * not a copy of the page body.
 *
 * @param verb which action is being admitted
 * @param destination the parent page id for a create, or the page id for an update
 * @param home the resolved state home
 * @param intent the intent digest
 * @returns the request to admit
 */
export function notionPageDoorRequest({
  verb,
  destination,
  home,
  intent,
}: {
  verb: NotionPageVerb;
  destination: string;
  home: string;
  intent: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "notion", verb: `page ${verb}` },
    artifact: { destination, id: intent },
    meta: {
      // A new page in someone's workspace is the kind of thing a team notices unprompted; replacing the body
      // of a page slopweaver already owns is not. A move is the second one that IS: the page appears in a
      // place colleagues watch, and disappears from one they may have been watching instead.
      createsWorkItem: verb === "create" || verb === "move",
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}

/**
 * Whether two Notion ids name the same object, tolerating the two spellings the provider itself uses.
 *
 * Notion answers a page's `parent.page_id` dashed and lowercase, while a URL carries the same id compact and
 * a person may type it either way. Comparing raw strings would report a page as needing a move when it is
 * already exactly where it was being sent — the one comparison `move` cannot afford to get wrong, since the
 * consequence is an unnecessary write to someone's workspace.
 *
 * @param left one id, or nothing when the provider reported no parent at all
 * @param right the other id
 * @returns true iff both are present and name the same object
 */
export function sameNotionId({ left, right }: { left: string | undefined; right: string | undefined }): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }
  return left.replaceAll("-", "").toLowerCase() === right.replaceAll("-", "").toLowerCase();
}

/**
 * Whether a resolved id is safe to send and to name a ledger file.
 *
 * @param id the resolved Notion object id
 * @returns the id, or the refusal naming why it cannot be used
 */
export function checkedPageId({ id }: { id: string }): Result<string, NotionCommandError> {
  return isValidPageId({ id }) ? ok(id) : err(NotionCommandErrors.pageIdNotCanonical({ id }));
}
