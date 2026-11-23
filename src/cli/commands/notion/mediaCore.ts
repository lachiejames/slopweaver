/**
 * The PURE core of `notion attach` — argument parsing, the dry-run preview, and the outcome
 * vocabulary. No I/O, so all of it is unit-testable without a mock.
 *
 * The verb exists alongside the pass folded into `notion page create|update` rather than instead of it. The
 * folded pass is what makes a normal publish produce a finished document; this verb is what makes a partial
 * failure recoverable, because the markdown on disk plus the page id is everything the pass needs, and a
 * marker that is still on the page is the record that its image never landed.
 */
import type { DoorRequest } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { mediaPlaceholders } from "../../../outbound/notion/mediaPlaceholder.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type NotionCommandError, NotionCommandErrors } from "./errors.js";
import { previewAddress } from "./previewAddress.js";

/** A parsed `notion attach` invocation. */
export interface NotionAttachArgs {
  readonly page: string;
  readonly from: string;
  /** The directory relative placeholder paths resolve against; defaults to the markdown file's own. */
  readonly mediaBase: string | undefined;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
  /**
   * Overwrite a page a human genuinely edited since slopweaver last wrote it — never needed for a
   * byte-identical touch, which `resolveExternalEdit` waves through on its own. Always the caller's stated
   * reason, journaled; undefined when the flag was not given.
   */
  readonly overwriteExternalEdit: string | undefined;
}

/** The flags this verb accepts; `helpTruth.test.ts` compares the names derived below against the manifest. */
const NOTION_ATTACH_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["page", "from", "media-base", "home", "overwrite-external-edit"],
};

/** Every accepted flag, WITH the `--`, for the help-truth ratchet. */
export const NOTION_ATTACH_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: NOTION_ATTACH_FLAGS }),
  ...booleanFlagsOf({ spec: NOTION_ATTACH_FLAGS }),
].map((name) => `--${name}`);

/**
 * The `file:` placeholders the body carries, what block each becomes, and where it would land.
 *
 * Shown in the dry run because ordering is the whole promise: a reader has to be able to see, before
 * anything is uploaded, that the hero shot goes where the placeholder sits rather than at the end. The
 * KIND is shown for the same reason — the sigil is one character, so a document written `![…]` would
 * otherwise become a broken image block with nothing in the preview saying so.
 *
 * It lives beside the attach verb's own parser rather than in `notion page`'s, because both verbs preview
 * the same placeholders and only one of them should own how a placeholder READS.
 *
 * @param body the authored markdown, still carrying its placeholders
 * @returns the preview lines, one summary and one per placeholder
 */
export function mediaPreviewLines({ body }: { body: string }): readonly string[] {
  const placeholders = mediaPlaceholders({ markdown: body });
  if (placeholders.length === 0) {
    return ["files:     none (no `file:` placeholders in the body)"];
  }
  return [
    `files:     ${String(placeholders.length)} placeholder(s), each uploaded and inserted AT its own position`,
    ...placeholders.map(
      (placeholder) => `  line ${String(placeholder.line)}: ${placeholder.source} → ${placeholder.kind} block`,
    ),
  ];
}

/**
 * Parse `notion attach …`.
 *
 * @param argv the arguments from the VERB onwards, so `argv[0]` is `attach` itself
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseNotionAttachArgs({
  argv,
}: {
  argv: readonly string[];
}): Result<NotionAttachArgs, NotionCommandError> {
  if (argv[0] !== "attach") {
    return err(NotionCommandErrors.attachUsage({ got: argv[0] }));
  }
  const parsed = parseFlags({ args: argv.slice(1), spec: NOTION_ATTACH_FLAGS });
  if (parsed.isErr()) {
    return err(NotionCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const text = ({ name }: { name: string }): string | undefined =>
    typeof values[name] === "string" ? values[name] : undefined;
  const errors: string[] = [];
  const page = text({ name: "page" });
  const from = text({ name: "from" });
  if (page === undefined) {
    errors.push("--page <page-id-or-url> is required; it is the page the markers were published to");
  }
  if (from === undefined) {
    errors.push(
      "--from <md-path> is required: the AUTHORED markdown, still carrying its `file:` placeholders. " +
        "It is what says which file belongs at which marker, and the published page no longer knows.",
    );
  }
  const overwriteExternalEdit = text({ name: "overwrite-external-edit" });
  if (overwriteExternalEdit === "") {
    errors.push("--overwrite-external-edit requires a non-empty reason, journaled alongside who last edited the page");
  }
  if (errors.length > 0) {
    return err(NotionCommandErrors.argsRefused({ reasons: errors }));
  }
  return ok({
    dryRun: values["dry-run"] === true,
    from: from!,
    home: text({ name: "home" }),
    mediaBase: text({ name: "media-base" }),
    json: values["json"] === true,
    overwriteExternalEdit,
    page: page!,
  });
}

/**
 * The dry-run preview: the destination, and every placeholder that would be uploaded, in document order.
 *
 * @param pageId the resolved page id, or undefined when the address did not resolve
 * @param baseDir the directory relative placeholder paths resolve against
 * @param markdown the authored body
 * @returns the operator-facing lines
 */
export function notionAttachDryRunLines({
  pageId,
  baseDir,
  markdown,
}: {
  pageId: string | undefined;
  baseDir: string;
  markdown: string;
}): readonly string[] {
  const placeholders = mediaPlaceholders({ markdown });
  return [
    `action:    attach`,
    `page:      ${previewAddress({ resolved: pageId, typed: undefined })}`,
    `base dir:  ${baseDir}`,
    `files:     ${String(placeholders.length)} placeholder(s)`,
    ...placeholders.map(
      (placeholder) =>
        `  line ${String(placeholder.line)}: ${placeholder.source} → ${placeholder.kind} block at marker ${placeholder.marker}` +
        (placeholder.caption === "" ? "" : ` (caption: ${JSON.stringify(placeholder.caption)})`),
    ),
    "nothing was uploaded, inserted or deleted.",
  ];
}

/**
 * The door request for an image attach pass.
 *
 * @param pageId the page being written to
 * @param home the resolved state home
 * @returns the request to admit
 */
export function notionImageDoorRequest({ pageId, home }: { pageId: string; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "notion", verb: "image attach" },
    artifact: { destination: pageId, id: `image-attach:${pageId}` },
    meta: {
      // Nothing new appears in anyone's sidebar: this finishes a page that already exists.
      createsWorkItem: false,
      effect: "external-write",
      home,
      requiresApproval: false,
    },
  };
}
