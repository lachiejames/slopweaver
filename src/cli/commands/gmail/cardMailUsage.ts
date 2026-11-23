/**
 * The usage of `slopweaver gmail card-mail`, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/gmail.ts` reads this on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not this verb runs. The command module imports it
 * from here, never the reverse. Import only other leaves: `manifestBarrelClosure.test.ts` fails on anything else.
 */

/** The usage line, shared by `--help`, the manifest and the parser's refusals so the three cannot drift. */
export const GMAIL_CARD_MAIL_USAGE =
  "usage: slopweaver gmail card-mail <card-slug> [--message <id>] [--fetch] [--json] [--home <dir>]\n" +
  "  Prints the mail an inbox-triage card pinned, from the copy `gmail triage` stored when it pinned the card —\n" +
  "  every message's sender, recipients, received date and subject. Reads only this home: never Gmail\n" +
  "  --message <id>  print that one message with its body: the sanitised HTML as the sender laid it out, else\n" +
  "                  the plain text — the read a Queue card takes when the owner opens one\n" +
  "  --fetch         first re-read the pinned messages from Gmail and replace the stored copy — the backfill for\n" +
  "                  a card pinned before cards kept their mail; the one mode that reaches Gmail\n" +
  "  --json          emit what the Queue draws; an HTML body is a whole inert document for a sandboxed iframe\n" +
  "  The slug starts inbox-triage-. Changes nothing in the mailbox. Exits 3 when the card has no pin, no stored\n" +
  '  mail, or no readable --message by that id (no pin with --json prints {"pinned":false,…}); 1 when the\n' +
  "  stored mail is not what the pin holds";
