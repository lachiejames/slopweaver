/**
 * The usage of `slopweaver gmail unsubscribe`, and nothing else.
 *
 * A LEAF on purpose, like `./triageUsage.ts`: `cli/manifests/gmail.ts` reads this on every invocation. Import only
 * other leaves: `manifestBarrelClosure.test.ts` fails on anything else.
 */

/** The usage line, shared by `--help`, the manifest and the parser's refusals so the three cannot drift. */
export const GMAIL_UNSUBSCRIBE_USAGE =
  "usage: slopweaver gmail unsubscribe <message-id> [--dry-run] [--json] [--home <dir>]\n" +
  "  Performs the sender's RFC 8058 one-click unsubscribe for the message's list: one POST of\n" +
  "  List-Unsubscribe=One-Click to the https target the message's own List-Unsubscribe header names,\n" +
  "  with no credential and no cookie. A sender publishing no one-click is REFUSED, naming what it offers\n" +
  "  instead — a link opens its page, a mailto is a send under your name, none leaves its settings page\n" +
  "  --dry-run print the origin it would POST to (all after it withheld: it carries your token), send nothing\n" +
  "  --json    emit the outcome as one machine-readable document";
