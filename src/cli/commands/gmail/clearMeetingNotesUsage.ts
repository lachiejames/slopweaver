/**
 * The usage of `slopweaver gmail clear-meeting-notes`, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/gmail.ts` reads this on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not this verb runs. The command module imports it
 * from here, never the reverse. Import only other leaves: `manifestBarrelClosure.test.ts` fails on anything else.
 */

/** The usage line, shared by `--help`, the manifest and the parser's refusals so the three cannot drift. */
export const GMAIL_CLEAR_MEETING_NOTES_USAGE =
  "usage: slopweaver gmail clear-meeting-notes [--audit | --dry-run] [--limit <1..500>] [--home <dir>]\n" +
  "  For every Gemini meeting-notes mail in the INBOX: prove its transcript is in the corpus by meeting title and\n" +
  "  date (gmail bronze AND the store), ingest it when it is missing, and only then archive the mail. A mail\n" +
  "  whose notes document was read and holds no transcript is archived too, since there is nothing to download.\n" +
  "  A mail whose transcript cannot be reached stays, with ONE Queue card saying why\n" +
  "  --audit    read the WHOLE mailbox's meeting-notes mail and report which transcripts are held; changes\n" +
  "             nothing, and exits 0 only when every one is held or never had a transcript to hold\n" +
  "  --dry-run  read and report what one run would ingest, archive and card; changes nothing\n" +
  "  --limit    the most meeting-notes mails to read (default 100, maximum 500)\n" +
  "  Exits 3 when the inbox holds no meeting-notes mail, 1 when a step failed or a mail stayed for a reason the\n" +
  "  next pass repairs";
