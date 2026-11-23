/**
 * The effectful shell for `gmail card-mail`: print the mail an inbox-triage card pinned, from the copy stored beside
 * its pin (`../../../live/gmail/cardMail.ts`), with each HTML body sanitised on the way out
 * (`../../../live/gmail/cardMailRender.ts`). This is what the Queue's card reads (`site/app/api/card-mail`).
 *
 * Without `--fetch` it reads only this home and resolves no Gmail client at all — the console draws a card from what
 * is stored, never from Gmail live. `--fetch` is the one mode that reads Gmail: it re-captures the pinned messages over
 * a pin that already stands, the backfill for a card pinned before cards kept their mail.
 *
 * Every edge is injected, so dispatch and exit codes are unit tested with plain fakes and no mailbox.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { type CardMailStore, type CardMailStoreError, readCardMailStore } from "../../../live/gmail/cardMail.js";
import { type CardMailCaptureError, captureCardMailWithGrant } from "../../../live/gmail/cardMailCapture.js";
import {
  type CardMailIndex,
  type CardMailUnpinned,
  type RenderedCardMail,
  renderCardMailIndex,
  renderCardMailMessage,
} from "../../../live/gmail/cardMailRender.js";
import { type GmailTriageCard, readTriageCard, type TriageCardError } from "../../../live/gmail/triageCards.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail } from "../../optionParsers.js";
import { GMAIL_CARD_MAIL_USAGE } from "./cardMailUsage.js";
import { type GmailArgsError, GmailArgsErrors, gmailArgsErrorLines } from "./errors.js";
import { isCardSlug } from "./triageCore.js";

const VERB_ARG_OFFSET = 4;

/** Every inbox-triage card's slug starts this way (`skills/automation/reference/inbox-triage.md`). */
const TRIAGE_SLUG_PREFIX = "inbox-triage-";

/** A parsed `gmail card-mail` invocation. */
export interface GmailCardMailArgs {
  readonly slug: string;
  readonly fetch: boolean;
  readonly json: boolean;
  /** The one stored message whose body to print; absent prints the headers of every one. */
  readonly message: string | undefined;
  readonly home: string | undefined;
}

/** The seams `gmail card-mail` performs its effects through. */
export interface GmailCardMailDeps {
  readonly readPin: (args: { slug: string; home: string }) => Result<GmailTriageCard, TriageCardError>;
  readonly readStore: (args: { pin: GmailTriageCard; home: string }) => Result<CardMailStore, CardMailStoreError>;
  /** Only `--fetch` calls this, and only the production one resolves a Gmail client. */
  readonly capture: (args: {
    pin: GmailTriageCard;
    home: string;
  }) => Promise<Result<{ readonly path: string; readonly store: CardMailStore }, CardMailCaptureError>>;
  readonly home: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Parse the `gmail card-mail` tail: one leading card slug, then flags.
 *
 * @param rest the argv tail after `gmail card-mail`
 * @returns the validated request, or the one reason it was refused
 */
export function parseGmailCardMailArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GmailCardMailArgs, GmailArgsError> {
  const slug = rest[0];
  if (slug === undefined || slug.startsWith("-")) {
    return err(GmailArgsErrors.argumentMissing({ name: "<card-slug>", usage: GMAIL_CARD_MAIL_USAGE }));
  }
  if (!slug.startsWith(TRIAGE_SLUG_PREFIX) || slug.length === TRIAGE_SLUG_PREFIX.length || !isCardSlug({ slug })) {
    return err(GmailArgsErrors.triageSlugInvalid({ got: slug, usage: GMAIL_CARD_MAIL_USAGE }));
  }
  const parsed = parseFlagTail({
    rest: rest.slice(1),
    spec: { boolean: ["fetch", "json"], value: ["home", "message"] },
  });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: GMAIL_CARD_MAIL_USAGE }));
  }
  return ok({
    fetch: parsed.value.flags.has("fetch"),
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    message: parsed.value.values["message"],
    slug,
  });
}

/** A count with its noun: `1 message`, `3 messages`. */
function counted({ count, noun }: { count: number; noun: string }): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The text reading of the index: ids, dates and counts only, never a subject or body — `--json` is how those are read.
 *
 * @param index the card's stored headers
 * @returns the lines to print
 */
export function renderCardMailIndexText({ index }: { index: CardMailIndex }): string {
  const lines = [
    `card ${index.slug} · key ${index.key} · stored ${index.storedAtIso}`,
    `${counted({ count: index.mails.length, noun: "message" })} stored of ${String(index.pinnedCount)} pinned`,
  ];
  for (const mail of index.mails) {
    if (mail.kind === "gone") {
      lines.push(`  ${mail.id} · gone from Gmail before it was stored`);
    } else {
      lines.push(`  ${mail.id} · received ${String(mail.receivedAtIso)}`);
    }
  }
  lines.push("headers are in --json; one body is --message <id> --json");
  return lines.join("\n");
}

/**
 * The text reading of one message: which body it draws and its states, never the body itself.
 *
 * @param mail the rendered message
 * @returns the lines to print
 */
export function renderCardMailMessageText({ mail }: { mail: RenderedCardMail }): string {
  let body = "no body";
  if (mail.body.kind === "html") {
    body = `html, ${counted({ count: mail.body.remoteImagesBlocked, noun: "remote image" })} blocked`;
  } else if (mail.body.kind === "text") {
    body = "plain text";
  }
  const truncated = mail.body.truncated ? ", cut at the byte cap" : "";
  return `${mail.header.id} · received ${String(mail.header.receivedAtIso)} · ${body}${truncated}\nthe body is in --json`;
}

/** `--home` when given, else the ambient home. */
function homeOf({ args, deps }: { args: GmailCardMailArgs; deps: GmailCardMailDeps }): string {
  if (args.home !== undefined) {
    return args.home;
  }
  return deps.home();
}

/** Print the index, or the one `--message`, as JSON or as counts; an id the store holds no readable message for is 3. */
function print({
  args,
  deps,
  store,
}: {
  args: GmailCardMailArgs;
  deps: GmailCardMailDeps;
  store: CardMailStore;
}): number {
  if (args.message === undefined) {
    const index = renderCardMailIndex({ store });
    deps.writeOut(
      args.json ? safeJsonStringify({ label: "gmail card mail", value: index }) : renderCardMailIndexText({ index }),
    );
    return EXIT_OK;
  }
  const mail = renderCardMailMessage({ id: args.message, store });
  if (mail === undefined) {
    deps.writeDiagnostic(
      `gmail card-mail: card ${args.slug} stores no readable message ${args.message} — not pinned, or gone from Gmail`,
    );
    return EXIT_EXPECTED_EMPTY;
  }
  deps.writeOut(
    args.json
      ? safeJsonStringify({ label: "gmail card mail message", value: mail })
      : renderCardMailMessageText({ mail }),
  );
  return EXIT_OK;
}

/**
 * Answer a pin that did not read: a card that pinned nothing is an empty answer, any other failure an error.
 *
 * @param error why the pin did not read
 * @returns the process exit code
 */
function pinUnread({
  args,
  deps,
  error,
}: {
  args: GmailCardMailArgs;
  deps: GmailCardMailDeps;
  error: TriageCardError;
}): number {
  deps.writeDiagnostic(`gmail card-mail: ${error.message}`);
  if (error.code !== "CARD_NOT_PINNED") {
    return EXIT_ERROR;
  }
  // The index reading says so in JSON too, so the Queue draws no mail rather than a failed read (`site/`).
  if (args.json && args.message === undefined) {
    const unpinned: CardMailUnpinned = { pinned: false, schemaVersion: 1, slug: args.slug };
    deps.writeOut(safeJsonStringify({ label: "gmail card mail unpinned", value: unpinned }));
  }
  return EXIT_EXPECTED_EMPTY;
}

/**
 * Run `gmail card-mail` against injected edges.
 *
 * @param rest argv after `gmail card-mail`
 * @param deps the pin, store and capture seams and output sinks
 * @returns the process exit code
 */
export async function runGmailCardMail({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GmailCardMailDeps;
}): Promise<number> {
  const parsed = parseGmailCardMailArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = homeOf({ args, deps });
  const pin = deps.readPin({ home, slug: args.slug });
  if (pin.isErr()) {
    return pinUnread({ args, deps, error: pin.error });
  }
  if (args.fetch) {
    const captured = await deps.capture({ home, pin: pin.value });
    if (captured.isErr()) {
      deps.writeDiagnostic(`gmail card-mail: ${captured.error.message} — the stored mail is unchanged`);
      return EXIT_ERROR;
    }
    deps.writeDiagnostic(
      `gmail card-mail: stored ${counted({ count: captured.value.store.mails.length, noun: "message" })} at ${captured.value.path}`,
    );
    return print({ args, deps, store: captured.value.store });
  }
  const store = deps.readStore({ home, pin: pin.value });
  if (store.isErr()) {
    deps.writeDiagnostic(`gmail card-mail: ${store.error.message}`);
    return store.error.code === "CARD_MAIL_NOT_STORED" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
  }
  return print({ args, deps, store: store.value });
}

/**
 * The production seams. The Gmail client is resolved INSIDE `capture`, so the local read never touches a credential.
 *
 * @returns the pin and store readers, the grant-aware capture and output sinks
 */
export function productionGmailCardMailDeps(): GmailCardMailDeps {
  return {
    capture: ({ home, pin }) => captureCardMailWithGrant({ card: pin, home }),
    home: slopweaverHome,
    readPin: readTriageCard,
    readStore: readCardMailStore,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver gmail card-mail`. */
export const gmailCardMailCommand = defineCommand({
  run: (argv) => runGmailCardMail({ deps: productionGmailCardMailDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
