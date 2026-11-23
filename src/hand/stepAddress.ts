/**
 * The four fields that say WHERE a hand step happens — the command the owner pastes, where they run it, the link the note
 * opens, and the poster's reason for giving none — each checked on its own terms.
 *
 * Its own module because `./step.ts` is the record and every rule about its sentence, while these four are the
 * step's address: what the card draws under the headline, and what `./posting.ts`'s address rule asks a new posting
 * to carry at least one of, since a card that does not say where the step happens leaves the owner hunting.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandStepDraft } from "./step.js";
import { optionalText, requiredText } from "./stepText.js";

/** How long the destination may be. Same surface as the sentence, one line under the headline. */
const WHERE_CAP = 120;

/**
 * How long a stated reason for having no address may be (`hand post --no-address`). The card draws it as its own
 * row, one line under the headline like `where`, so it shares that cap and is refused rather than truncated.
 */
export const UNADDRESSED_CAP = 120;

/**
 * How long the literal the owner pastes may be.
 *
 * Far past the prose caps on purpose: this is DATA the owner copies rather than words they read, so the limit is
 * about a pasteboard and a panel rather than about attention. A key, a `gcloud` line, a short block.
 */
export const LITERAL_CAP = 2_000;

/**
 * One address the note's Open button can take: absolute http(s), or an absolute local file. A scheme is
 * case-insensitive (RFC 3986 § 3.1), so `HTTPS://` is one too: a monitor card mints its link from the configured
 * console base, which `new URL` accepts in any case, and a case-sensitive test here refused every card under such a
 * base.
 */
const LINK = /^(?:https?:\/\/|file:\/\/\/)\S+$/i;

/**
 * The step's own address, checked as one an `open` could actually take.
 *
 * An absolute `file:///` address is one, and refusing it puts a shell command on the owner's screen: the
 * artifact a session hands the owner is most often a page `slopweaver page` published under
 * `$SLOPWEAVER_HOME/pages/`, whose address is a file url. Refused here, the poster reaches for
 * `--literal "open file:///…"` instead, and the owner is told to copy a command into a terminal to read a page the
 * note could have opened itself. A row already in the register may still carry one, so the
 * builder reads it; a NEW posting is refused one by `./localFileUrl.ts`, naming the page's viewer address, because a
 * note opening a file in the owner's browser cannot reach the console's page frame.
 *
 * @param url what the caller supplied, or `undefined`
 * @returns the url, `undefined` when absent, or the refusal
 */
function checkedUrl({ url }: { url: string | undefined }): Result<string | undefined, HandStepError> {
  if (url === undefined || url.trim().length === 0) {
    return ok(undefined);
  }
  const trimmed = url.trim();
  if (!LINK.test(trimmed)) {
    return err(
      HandStepErrors.invalidField({
        field: "url",
        why: "must be one absolute http(s) or file:/// address — the note opens it, so a fragment or a description is a button that goes nowhere",
      }),
    );
  }
  return ok(trimmed);
}

/**
 * One page the fleet can have opened in a browser: absolute http(s), case-insensitive like {@link LINK}, and no
 * control character — `\S` admits a NUL, which no browser opens and a process launch throws on.
 */
const WEB_PAGE = /^https?:\/\/[^\s\p{Cc}]+$/iu;

/** The scheme an opened page starts with, cut off before its host and path are read as written. */
const WEB_SCHEME = /^https?:\/\//iu;

/**
 * The text up to the first of a set of delimiters, and everything from that delimiter on.
 *
 * @param text what to cut
 * @param at the delimiters, as a character class
 * @returns the part before and the part from the delimiter
 */
function cutAt({ text, at }: { text: string; at: RegExp }): { before: string; after: string } {
  const index = text.search(at);
  return index === -1 ? { after: "", before: text } : { after: text.slice(index), before: text.slice(0, index) };
}

/** A host as written, without DNS's trailing root dot: `127.0.0.1.:3000` is `127.0.0.1:3000`. */
function rootless({ host }: { host: string }): string {
  return host.replace(/\.(?=(?::\d*)?$)/u, "");
}

/**
 * Whether the parser keeps an address exactly as written — the console's reader (`site/lib/workspacePlacementAddress.ts`'s
 * `isWebUrl`) refuses the whole register on one it would REPAIR, so `--opened` is refused it here first. The parser
 * drops a default port (`:443`), resolves a `..` segment and maps a character outside printable ASCII; each changes
 * the host or path it hands back.
 *
 * @param address an address {@link WEB_PAGE} already admitted
 * @returns true when the parsed host and path are the written ones
 */
function keptAsWritten({ address }: { address: string }): boolean {
  const scheme = WEB_SCHEME.exec(address);
  const printable = /^[\x21-\x7e]*$/u.test(address) && !address.includes("\\");
  if (scheme === null || !printable || !URL.canParse(address)) {
    return false;
  }
  const { before: host, after: rest } = cutAt({ at: /[/?#]/u, text: address.slice(scheme[0].length) });
  const { before: path } = cutAt({ at: /[?#]/u, text: rest });
  const parsed = new URL(address);
  const pathKept = parsed.pathname === path || (path === "" && parsed.pathname === "/");
  return host.length > 0 && rootless({ host: parsed.host }) === rootless({ host: host.toLowerCase() }) && pathKept;
}

/**
 * The page the fleet already opened on the owner's screen, checked as one a browser was really pointed at. A `file:///`
 * address is the note's own Open, never a window the fleet opened for a sign-in, so only http(s) is one.
 *
 * @param opened what the caller supplied, or `undefined`
 * @returns the address, `undefined` when absent, or the refusal
 */
function checkedOpened({ opened }: { opened: string | undefined }): Result<string | undefined, HandStepError> {
  if (opened === undefined || opened.trim().length === 0) {
    return ok(undefined);
  }
  const trimmed = opened.trim();
  if (!WEB_PAGE.test(trimmed)) {
    return err(
      HandStepErrors.invalidField({
        field: "opened",
        why: "must be the one absolute http(s) address the fleet opened on the owner's screen — the page the sign-in happens on",
      }),
    );
  }
  if (!keptAsWritten({ address: trimmed })) {
    return err(
      HandStepErrors.invalidField({
        field: "opened",
        why: "must be written as the browser keeps it — no default port, `..` segment, backslash or non-ASCII character — or the console cannot read the queue it sits on",
      }),
    );
  }
  return ok(trimmed);
}

/**
 * The poster's stated reason for giving no address, checked as a capped sentence — or as honestly absent.
 *
 * A present empty string is refused rather than folded into absence, and a present non-string is a corrupt
 * register line named as one, for `./stepMarks.ts`'s context check's reason: `--no-address ""` meant to say something.
 *
 * @param value whatever the caller or the register line carried
 * @returns the trimmed reason, `undefined` when the field was absent, or the refusal
 */
function checkedUnaddressed({ value }: { value: unknown }): Result<string | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== "string") {
    return err(
      HandStepErrors.invalidField({
        field: "unaddressed",
        why: "is a sentence saying why the step has no address, or absent — `hand post --no-address` is the only thing that writes it",
      }),
    );
  }
  return requiredText({ cap: UNADDRESSED_CAP, field: "unaddressed", value });
}

/**
 * The five address fields, each checked on its own terms: the command to copy, where to run it, the link, the page
 * the fleet already opened, and why there is none.
 *
 * @param draft every field as the caller has it
 * @returns each address field, `undefined` where it was not supplied, or the first refusal
 */
export function checkedAddress({ draft }: { draft: HandStepDraft }): Result<
  {
    literal: string | undefined;
    where: string | undefined;
    url: string | undefined;
    opened: string | undefined;
    unaddressed: string | undefined;
  },
  HandStepError
> {
  const literal = optionalText({ cap: LITERAL_CAP, field: "literal", value: draft.literal });
  if (literal.isErr()) {
    return err(literal.error);
  }
  const where = optionalText({ cap: WHERE_CAP, field: "where", value: draft.where });
  if (where.isErr()) {
    return err(where.error);
  }
  const url = checkedUrl({ url: draft.url });
  if (url.isErr()) {
    return err(url.error);
  }
  const opened = checkedOpened({ opened: draft.opened });
  if (opened.isErr()) {
    return err(opened.error);
  }
  const unaddressed = checkedUnaddressed({ value: draft.unaddressed });
  if (unaddressed.isErr()) {
    return err(unaddressed.error);
  }
  return ok({
    literal: literal.value,
    opened: opened.value,
    unaddressed: unaddressed.value,
    url: url.value,
    where: where.value,
  });
}
