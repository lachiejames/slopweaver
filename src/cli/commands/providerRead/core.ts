/** Pure argument handling shared by the GitHub, Linear and Notion named-object readers. */

import { err, ok, type Result } from "../../../lib/result.js";
import { type LinearReadInclude, parseLinearReadInclude } from "../../../live/linear/read.js";
import { NOTION_NESTED_CALLS_DEFAULT, NOTION_NESTED_CALLS_MAX } from "../../../live/notion/blockTree.js";
import type { NotionObjectKind } from "../../../live/notion/read.js";
import type { ProviderReadSource } from "../../../live/providerRead.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { type ProviderReadArgsError, ProviderReadArgsErrors } from "./errors.js";

const DEFAULT_PROVIDER_READ_LIMIT = 25;
const MAX_PROVIDER_READ_LIMIT = 100;

const GITHUB_FLAGS: FlagSpec = { boolean: ["files", "json"], string: ["home", "limit", "media-out"] };

/** A pull request's path in a GitHub address — `--files` reads nothing else, so anything without one is refused. */
const PULL_PATH = /github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+(?!\d)/iu;
const LINEAR_FLAGS: FlagSpec = { boolean: ["json", "pdf"], string: ["home", "include", "limit"] };
const NOTION_FLAGS: FlagSpec = {
  boolean: ["json", "pdf"],
  string: ["after", "home", "kind", "limit", "nested-calls"],
};

/**
 * The flag spec one provider's reader parses, which is what makes an option on another provider unknown.
 *
 * `--include` is Linear's alone (an issue's comments, attachments and history, a document's comments) and
 * `--after`/`--kind` are Notion's, so each is REFUSED as an unknown flag elsewhere rather than parsed and
 * silently ignored — the same reason `--include` refuses an unknown connection name.
 *
 * @param provider the provider noun
 * @returns the exact spec that provider's parser uses
 */
function providerReadSpec({ provider }: { provider: ProviderReadSource }): FlagSpec {
  switch (provider) {
    case "notion":
      return NOTION_FLAGS;
    case "linear":
      return LINEAR_FLAGS;
    case "github":
      return GITHUB_FLAGS;
    default: {
      // ProviderReadSource is derived from the registry: a new member fails to compile here, never parses as GitHub.
      const unhandled: never = provider;
      return unhandled;
    }
  }
}

/** The address each provider's reader takes. A `Record`, so a new provider is a compile error here. */
const READ_TARGETS: Readonly<Record<ProviderReadSource, string>> = {
  github: "<github-object-url>",
  linear: "<linear-id-or-url>",
  notion: "<notion-id-or-url>",
};

/** Every accepted flag, derived from the exact specs passed to the parser. */
export const PROVIDER_READ_FLAG_NAMES: Readonly<Record<ProviderReadSource, readonly string[]>> = {
  github: ["--files", "--home", "--json", "--limit", "--media-out"],
  linear: ["--home", "--include", "--json", "--limit", "--pdf"],
  notion: ["--after", "--home", "--json", "--kind", "--limit", "--nested-calls", "--pdf"],
};

/** A parsed, credential-free live-read invocation. */
export interface ProviderReadOptions {
  /** Which activity connections a Linear issue read should ask for. Empty means the object alone. */
  readonly include: LinearReadInclude;
  readonly address: string;
  readonly home: string | undefined;
  readonly json: boolean;
  readonly limit: number;
  readonly notionKind: NotionObjectKind;
  /** Notion only: the opaque cursor continuing a page past `limit`, or undefined to start at the beginning. */
  readonly after: string | undefined;
  /** Notion pages only: the child-list calls the nested-block expansion may spend. */
  readonly nestedCalls: number;
  /** Linear and Notion: open the provider-hosted files the object addresses and carry what they say. */
  readonly pdf: boolean;
  /** GitHub only: the directory the body's pictures and videos are downloaded into, or undefined for none. */
  readonly mediaOut: string | undefined;
  /** GitHub pull requests only: also read the files it changes, each with its patch. */
  readonly files: boolean;
}

/**
 * The usage text for one provider's reader.
 *
 * @param provider the provider noun
 * @returns exact command help, including only flags its parser accepts
 */
export function providerReadUsage({ provider }: { provider: ProviderReadSource }): string {
  const kind = provider === "notion" ? " [--kind <page|database>]" : "";
  const after = provider === "notion" ? " [--after <cursor>] [--nested-calls <n>]" : "";
  const include = provider === "linear" ? " [--include comments,attachments,history]" : "";
  const pdf = provider === "github" ? " [--media-out <dir>] [--files]" : " [--pdf]";
  const target = READ_TARGETS[provider];
  return (
    `usage: slopweaver ${provider} read ${target}${kind} [--limit <1..100>]${after}${include}${pdf} [--json] [--home <dir>]\n` +
    "  Reads one named object from the provider now; it does not search the workspace or consult history\n" +
    "  --limit           cap each selected activity connection (default 25, maximum 100)\n" +
    (provider === "linear"
      ? "  --include         ask for activity connections by name (a document has comments only); omitted means the object alone\n"
      : "") +
    (provider === "github"
      ? "  --media-out       download the pictures and videos an issue or pull request body embeds into this\n" +
        "                    directory, numbered in body order, and list each file's path, size and sha256.\n" +
        "                    Absent means none were asked for; an empty list means the body embeds none\n" +
        "  --files           pull requests only: also read the files it changes, each with its patch, at\n" +
        "                    data.files (every page, up to GitHub's 3000-file cap; a cut is named in the\n" +
        "                    residue with how many files it left out). An un-merged one\n" +
        "                    also carries data.diffOnBase: whether every change is already on its base\n" +
        "                    branch's current tip (on-base, partly, not-on-base, unknown with a reason), and\n" +
        "                    each file's own answer at data.diffOnBaseFiles\n"
      : `  --pdf             open the ${provider === "linear" ? "Linear" : "Notion"}-hosted files this object addresses and carry their text. The\n` +
        "                    bytes decide what each one is, so a screen recording is reported as one rather\n" +
        "                    than parsed, and a scanned document says it has no text layer\n") +
    "  --json            emit one machine-readable document with freshness, coverage and residue\n" +
    (provider === "notion"
      ? "  --after           continue a page from a previous read's data.blocks.nextCursor; repeat while hasMore is true\n" +
        `  --nested-calls    child-list calls a page read may spend expanding nested blocks (default ${String(NOTION_NESTED_CALLS_DEFAULT)}, maximum ${String(NOTION_NESTED_CALLS_MAX)})\n` +
        "  --kind            choose the Notion endpoint explicitly (default page); database rows are not traversed\n"
      : "") +
    "  --home            resolve the credential from this Slopweaver state home"
  );
}

/** Parse the shared context bound without allowing an accidental unbounded provider read. */
function providerReadLimit({ value }: { value: string | boolean | undefined }): Result<number, ProviderReadArgsError> {
  if (value === undefined) {
    return ok(DEFAULT_PROVIDER_READ_LIMIT);
  }
  const limit = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(limit) && limit > 0 && limit <= MAX_PROVIDER_READ_LIMIT
    ? ok(limit)
    : err(ProviderReadArgsErrors.limitOutOfRange({ got: String(value), max: MAX_PROVIDER_READ_LIMIT }));
}

/** Parse Notion's endpoint selector, which defaults to `page` and refuses every other value. */
function notionKindFrom({
  value,
}: {
  value: string | boolean | undefined;
}): Result<NotionObjectKind, ProviderReadArgsError> {
  if (value === undefined || value === "page") {
    return ok("page");
  }
  return value === "database" ? ok("database") : err(ProviderReadArgsErrors.kindUnknown({ got: String(value) }));
}

/**
 * Parse Notion's continuation cursor, which only a page read can use.
 *
 * The value is Notion's OWN opaque `next_cursor` and is forwarded byte for byte. It is deliberately not
 * validated as a UUID, normalised, or derived from the last block: Notion documents it as opaque, and a
 * client that parses it is one format change away from silently reading the wrong slice.
 *
 * Only NOTION_FLAGS lists `after`, so a github or linear read never reaches here with a value: the flag
 * spec refuses it as an unknown flag first. This checks the two things the spec cannot.
 *
 * @param value the raw flag value
 * @param kind the Notion endpoint, since a database read never lists block children
 * @returns the cursor, or undefined when none was given
 */
function providerReadAfter({
  value,
  kind,
}: {
  value: string | boolean | undefined;
  kind: NotionObjectKind;
}): Result<string | undefined, ProviderReadArgsError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (kind === "database") {
    return err(ProviderReadArgsErrors.afterOnDatabase());
  }
  if (typeof value !== "string" || value.length === 0) {
    return err(ProviderReadArgsErrors.afterEmpty({ got: String(value) }));
  }
  return ok(value);
}

/** Parse the nested-expansion call ceiling, which only a page read spends. */
function providerReadNestedCalls({
  value,
  kind,
}: {
  value: string | boolean | undefined;
  kind: NotionObjectKind;
}): Result<number, ProviderReadArgsError> {
  if (value === undefined) {
    return ok(NOTION_NESTED_CALLS_DEFAULT);
  }
  if (kind === "database") {
    return err(ProviderReadArgsErrors.nestedCallsOnDatabase({ got: String(value) }));
  }
  const calls = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(calls) && calls > 0 && calls <= NOTION_NESTED_CALLS_MAX
    ? ok(calls)
    : err(ProviderReadArgsErrors.nestedCallsOutOfRange({ got: String(value), max: NOTION_NESTED_CALLS_MAX }));
}

/**
 * Parse the endpoint, the slice bound, the cursor and the nested-call ceiling, in exactly that order: the
 * first refusal is the one reported, so the order is part of what a caller sees.
 */
function sliceArgs({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<
  { kind: NotionObjectKind; limit: number; after: string | undefined; nestedCalls: number },
  ProviderReadArgsError
> {
  return notionKindFrom({ value: values["kind"] }).andThen((kind) =>
    providerReadLimit({ value: values["limit"] }).andThen((limit) =>
      providerReadAfter({ kind, value: values["after"] }).andThen((after) =>
        providerReadNestedCalls({ kind, value: values["nested-calls"] }).map((nestedCalls) => ({
          after,
          kind,
          limit,
          nestedCalls,
        })),
      ),
    ),
  );
}

/**
 * Parse GitHub's media directory, refusing a flag given with nothing after it, and an address given in its place:
 * the directory is echoed in every written file's path, so a pasted signed link would be printed with its token.
 */
function providerReadMediaOut({
  value,
}: {
  value: string | boolean | undefined;
}): Result<string | undefined, ProviderReadArgsError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return err(ProviderReadArgsErrors.mediaOutEmpty({ got: String(value) }));
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) {
    return err(ProviderReadArgsErrors.mediaOutAddress());
  }
  return ok(value);
}

/**
 * Parse one provider read before any credential or network is touched.
 *
 * @param provider the provider noun
 * @param rest the argv tail after `<provider> read`
 * @returns the resolved options, or the first usage problem found
 */
export function parseProviderReadArgs({
  provider,
  rest,
}: {
  provider: ProviderReadSource;
  rest: readonly string[];
}): Result<ProviderReadOptions, ProviderReadArgsError> {
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: providerReadSpec({ provider }),
  });
  if (parsed.isErr()) {
    return err(ProviderReadArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  if (parsed.value.positionals.length === 0) {
    return err(ProviderReadArgsErrors.addressMissing({ provider }));
  }
  const slice = sliceArgs({ values: parsed.value.values });
  if (slice.isErr()) {
    return err(slice.error);
  }
  const include = parseLinearReadInclude({ value: parsed.value.values["include"] });
  if (include.isErr()) {
    // FORWARDED, not re-authored: the reader owns which connections exist, so it owns the wording too.
    return err(ProviderReadArgsErrors.includeInvalid({ cause: include.error }));
  }
  const mediaOut = providerReadMediaOut({ value: parsed.value.values["media-out"] });
  if (mediaOut.isErr()) {
    return err(mediaOut.error);
  }
  const address = parsed.value.positionals.join(" ");
  const files = parsed.value.values["files"] === true;
  if (files && !PULL_PATH.test(address)) {
    return err(ProviderReadArgsErrors.filesNotPullRequest());
  }
  const home = parsed.value.values["home"];
  return ok({
    address,
    files,
    after: slice.value.after,
    home: typeof home === "string" ? home : undefined,
    include: include.value,
    json: parsed.value.values["json"] === true,
    limit: slice.value.limit,
    mediaOut: mediaOut.value,
    nestedCalls: slice.value.nestedCalls,
    notionKind: slice.value.kind,
    pdf: parsed.value.values["pdf"] === true,
  });
}
