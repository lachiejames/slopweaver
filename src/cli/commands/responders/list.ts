/**
 * `slopweaver responders list` — who is on the responder whitelist, in ONE call: each Slack user id on
 * `responders.json` beside the name the local Slack member rows give it. Read-only: it reads that one file and
 * `members/slack.jsonl`, writes nothing, posts nothing and runs no model, which is why the console voice may run it
 * (`talk/modelReads.ts`). It reports the CONFIGURED list; a journalled `responder-allow-open` grant, which admits
 * every addresser for one session, is a separate state it does not read.
 *
 * The voice once took about thirty reads to answer "who is on the allowlist?", because only `add` and `remove`
 * existed and nothing printed the list. The render is pure ({@link renderResponderList}); the run function is the
 * thin edge that reads the two files.
 */
import { slackMemberNames } from "../../../corpus/members/slackNames.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { type ResponderWhitelist } from "../../../live/listen/whitelist.js";
import { loadResponderWhitelist } from "../../../live/listen/whitelistStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";

/** Where the verb's own arguments start in `process.argv`: `[node, cli, responders, list, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

const LIST_FLAG_SPEC = { boolean: ["json"], string: ["home"] } as const;

export const RESPONDERS_LIST_USAGE =
  "usage: slopweaver responders list [--json] [--home <dir>]\n" +
  "  Lists the responder whitelist (who may address the bot): each Slack user id on responders.json, with\n" +
  "  the name the local Slack member rows give it. Read-only. Exits 0 with entries, 3 when the list is\n" +
  "  empty or the file is absent (both refuse everyone), 1 when the file exists and cannot be read.\n" +
  "  --json     one JSON document: { state, responders: [{ id, name }], why? }.\n";

/** Every flag `responders list` accepts, as the `--`-prefixed tokens a caller types. */
export const RESPONDERS_LIST_FLAG_NAMES: readonly string[] = [
  ...LIST_FLAG_SPEC.boolean.map((name) => `--${name}`),
  ...LIST_FLAG_SPEC.string.map((name) => `--${name}`),
];

/** One admitted person: the Slack id the gate matches, and the name the member rows give it, `null` when none do. */
export interface ListedResponder {
  readonly id: string;
  readonly name: string | null;
}

/** What `responders list` reports: the gate's state, who is on it, and why it is closed when it is. */
export interface ResponderListing {
  readonly state: "absent" | "empty" | "list" | "unreadable";
  readonly responders: readonly ListedResponder[];
  readonly why?: string;
}

/**
 * Parse the verb's argv tail. Pure, so a bad flag is refused before any file is read.
 *
 * @param rest the argv tail after `responders list`
 * @returns the parsed flags, or the rejections
 */
export function parseRespondersListArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: { boolean: [...LIST_FLAG_SPEC.boolean], string: [...LIST_FLAG_SPEC.string] } });
}

/**
 * Pair each id on the gate with its name. Pure: the whitelist and an id → name map in, the listing out.
 *
 * @param whitelist the loaded gate, in whichever state this machine is in
 * @param names Slack user id → display name, from the member rows; an id missing from it lists with a `null` name
 * @returns the listing, its state distinguishing an empty list from an absent or unreadable file
 */
export function renderResponderList({
  whitelist,
  names,
}: {
  whitelist: ResponderWhitelist;
  names: Readonly<Record<string, string>>;
}): ResponderListing {
  if (whitelist.kind === "absent") {
    return { responders: [], state: "absent", why: "responders.json is absent under $SLOPWEAVER_HOME" };
  }
  if (whitelist.kind === "unreadable") {
    return { responders: [], state: "unreadable", why: whitelist.why };
  }
  if (whitelist.identities.length === 0) {
    return { responders: [], state: "empty" };
  }
  const responders = whitelist.identities.map((id): ListedResponder => {
    // An own-property read: an id spelled like an Object-prototype member (`toString`) must not inherit one as a name.
    if (!Object.hasOwn(names, id)) {
      return { id, name: null };
    }
    return { id, name: names[id]! };
  });
  return { responders, state: "list" };
}

/**
 * The listing as lines a person reads: one per admitted id, or the one line saying why nobody is.
 *
 * @param listing the rendered listing
 * @returns the lines to print, in order
 */
export function responderListLines({ listing }: { listing: ResponderListing }): readonly string[] {
  if (listing.state === "absent") {
    return ["responders.json is ABSENT — the responder whitelist admits nobody"];
  }
  if (listing.state === "unreadable") {
    return [`responders.json is UNREADABLE (${String(listing.why)}) — the responder whitelist admits nobody`];
  }
  if (listing.state === "empty") {
    return ["responders.json is EMPTY — the responder whitelist admits nobody"];
  }
  const count = listing.responders.length;
  return [
    `${String(count)} ${count === 1 ? "person is" : "people are"} on the responder whitelist:`,
    ...listing.responders.map((responder) => {
      if (responder.name === null) {
        return `  ${responder.id}  (no Slack member row)`;
      }
      return `  ${responder.id}  ${responder.name}`;
    }),
  ];
}

/** The exit code a listing's state carries: entries are success, a closed gate is a status, a broken file a fault. */
function exitFor({ listing }: { listing: ResponderListing }): number {
  if (listing.state === "list") {
    return EXIT_OK;
  }
  if (listing.state === "unreadable") {
    return EXIT_ERROR;
  }
  return EXIT_EXPECTED_EMPTY;
}

/**
 * Run the `list` verb.
 *
 * @param argv the FULL process argv — the router passes it whole, and the tail starts at {@link VERB_ARG_OFFSET}
 * @returns the process exit code
 */
export function runRespondersList(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: RESPONDERS_LIST_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRespondersListArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: RESPONDERS_LIST_USAGE });
    return EXIT_USAGE;
  }
  const { values } = parsed.value;
  const named = values["home"];
  const home = resolveHome({ named: typeof named === "string" ? named : undefined });
  const members = slackMemberNames({ home });
  for (const warning of members.warnings) {
    logger.error({ msg: `responders list: members/slack.jsonl: ${warning} — a name may be missing` });
  }
  const listing = renderResponderList({ names: members.names, whitelist: loadResponderWhitelist({ home }) });
  if (values["json"] === true) {
    logger.out({ line: JSON.stringify(listing) });
  } else {
    for (const line of responderListLines({ listing })) {
      logger.out({ line });
    }
  }
  return exitFor({ listing });
}

export const respondersListCommand = defineCommand({ run: runRespondersList });
