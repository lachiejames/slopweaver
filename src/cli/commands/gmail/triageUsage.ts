/**
 * The usage of `slopweaver gmail triage`, with the defaults it quotes, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/gmail.ts` reads this on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not this verb runs. The command module imports it
 * from here, never the reverse. Import only other leaves: `manifestBarrelClosure.test.ts` fails on anything else.
 */

/** The usage line, shared by `--help`, the manifest and the parser's refusals so the three cannot drift. */
export const GMAIL_TRIAGE_USAGE =
  "usage: slopweaver gmail triage [--key <group-key> [--pin <card-slug>] | --card <card-slug> | --ruled]\n" +
  "                               [--limit <1..2000>] [--write] [--json] [--home <dir>]\n" +
  "  Reads the INBOX as metadata only and groups it by sender — how many, how many unread, how old, whether\n" +
  "  it mails on a schedule, and what way out it offers. Never a body or a snippet, but for --pin\n" +
  "  --key      print ONE group and the ids of its messages, e.g. from:notifications@example.com\n" +
  "  --pin      with --key, record the newest 20 of those ids under a card's slug — the set the card shows the owner —\n" +
  "             reading those messages in full first and storing them for the card (`gmail card-mail`); a\n" +
  "             message that cannot be read pins nothing\n" +
  "  --card     print the ids a card pinned that are STILL in the inbox — the set the owner's answer acts on\n" +
  "  --ruled    print the ids every declared archive rule covers — the set archived unasked, never carded\n" +
  "  --limit    the most inbox messages to read (default 500, maximum 2000)\n" +
  "  --write    also persist the whole reading to live/gmail/triage.json\n" +
  "  --json     emit the reading as one machine-readable document\n" +
  "  Changes nothing in the mailbox. Exits 3 when the inbox, the named group, the card's set or the ruled set is empty";
