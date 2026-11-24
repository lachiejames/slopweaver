/**
 * The `chatgpt` noun's usage lines — a LEAF, so the manifest can quote them without loading the verbs.
 */

/** The usage line for `chatgpt import-request`, shared by `--help` and the manifest so the two cannot drift. */
export const CHATGPT_IMPORT_REQUEST_USAGE =
  "usage: slopweaver chatgpt import-request --from <file> [--json] [--home <dir>]\n" +
  "  --from   a signed-in chatgpt.com backend-api request copied from Chrome DevTools (its Request Headers)\n" +
  "  --json   emit one machine-readable document on stdout\n" +
  "  Keeps five headers (authorization, cookie, chatgpt-account-id, oai-did, user-agent) in\n" +
  "  $SLOPWEAVER_HOME/secrets/chatgpt-web-session.json at 0600, then REMOVES the file it read.\n" +
  "  Prints header names and the bearer's expiry, never a value.";

/** The usage line for `chatgpt conversation`. */
export const CHATGPT_CONVERSATION_USAGE =
  "usage: slopweaver chatgpt conversation <id> [--max-pages <n>] [--json] [--home <dir>]\n" +
  "  <id>         one conversation's id, or its chatgpt.com/c/<id> link\n" +
  "  --max-pages  refuse, writing nothing, past this many pages of ten turns (default 200)\n" +
  "  --json       emit one machine-readable document on stdout\n" +
  "  Read-only GETs of that one conversation through the imported session. Writes messages.jsonl and\n" +
  "  transcript.md under $SLOPWEAVER_HOME/live/chatgpt/conversations/<id>/.";

/** The caveats every verb reading the web backend prints, so the owner never mistakes it for an official API. */
export const CHATGPT_WEB_CAVEATS: readonly string[] = [
  "ChatGPT's private web API: undocumented, and it can change shape or close; a change of shape stops the read by name.",
  "The pasted session expires (bearer about ten days, cookie life unmeasured); renew it with chatgpt import-request.",
];

/** The usage line for `chatgpt list`. */
export const CHATGPT_LIST_USAGE =
  "usage: slopweaver chatgpt list [--max-pages <n>] [--json] [--home <dir>]\n" +
  "  --max-pages  refuse past this many pages in any one lane (default 500, 28 chats a page)\n" +
  "  --json       emit one machine-readable document on stdout, every listed conversation included\n" +
  "  Lists every conversation on the account through the imported session: the main list, archived chats,\n" +
  "  and each ChatGPT Project's chats. Serial GETs at least three seconds apart; the first refusal (a 429,\n" +
  "  an expired session, a Cloudflare challenge, a change of shape) stops it. Writes nothing.\n" +
  `  ${CHATGPT_WEB_CAVEATS.join("\n  ")}`;

/** The usage line for `chatgpt live-sync`. */
export const CHATGPT_LIVE_SYNC_USAGE =
  "usage: slopweaver chatgpt live-sync [--max-conversations <n>] [--max-pages <n>] [--relist] [--home <dir>]\n" +
  "  --max-conversations  read at most this many chats this run, newest first (default: every one due)\n" +
  "  --max-pages          refuse past this many listing pages in any one lane (default 500, 28 chats a page)\n" +
  "  --relist             list the whole account again, ignoring the listing the last walk carried\n" +
  "  Lists the account as chatgpt list does, then reads whole every chat the live copy does not hold at its\n" +
  "  listed update, newest first, holding each under $SLOPWEAVER_HOME/corpus/chatgpt/live as it is read. The\n" +
  "  first run is the full-history backfill (hours: one request at a time, at least three seconds apart); each\n" +
  "  later run reads only what changed. The first refusal stops every further request, and the next run picks\n" +
  "  up where it stopped. A listing page answered with a 5xx is retried three times with a growing wait; a 429\n" +
  "  or any other refusal is not. A completed listing is carried (listing-carry.json beside the snapshots) and\n" +
  "  the next run lists only what moved since, for up to three days, then lists everything again; a stopped\n" +
  "  listing names the lane and the offset or page it stopped at. Then refreshes the live copy and every held\n" +
  "  export into the corpus and the store.\n" +
  "  Exit 3 when nothing is held or new, 4 while another run holds the lock, 1 on any refusal.\n" +
  `  ${CHATGPT_WEB_CAVEATS.join("\n  ")}`;

/** Every flag `chatgpt live-sync` accepts, for the help-truth sweep. */
export const CHATGPT_LIVE_SYNC_FLAG_NAMES: readonly string[] = [
  "--home",
  "--max-conversations",
  "--max-pages",
  "--relist",
];

/** Every flag `chatgpt list` accepts, for the help-truth sweep. */
export const CHATGPT_LIST_FLAG_NAMES: readonly string[] = ["--home", "--json", "--max-pages"];

/** Every flag `chatgpt import-request` accepts, for the help-truth sweep. */
export const CHATGPT_IMPORT_REQUEST_FLAG_NAMES: readonly string[] = ["--from", "--home", "--json"];

/** Every flag `chatgpt conversation` accepts, for the help-truth sweep. */
export const CHATGPT_CONVERSATION_FLAG_NAMES: readonly string[] = ["--home", "--json", "--max-pages"];

/** The usage line for `chatgpt import-export`. */
export const CHATGPT_IMPORT_EXPORT_USAGE =
  "usage: slopweaver chatgpt import-export [--from <zip|dir|file>] [--json] [--home <dir>]\n" +
  "  --from   the export zip chatgpt.com emailed, its unzipped folder, a one-file export's conversations file\n" +
  "           (one part of a split export is refused: name its folder), or a folder\n" +
  "           to take the newest export zip from (default: ~/Downloads)\n" +
  "  --json   emit one machine-readable document on stdout\n" +
  "  Copies the export's conversations files into $SLOPWEAVER_HOME/corpus/exports/chatgpt/<sha256>/ at 0600\n" +
  "  and writes nothing else. Exit 3 when that export is already held, or none was found.\n" +
  "  The export: chatgpt.com → Settings → Data controls → Export data, then download the emailed zip.";

/** The usage line for `chatgpt sync`. */
export const CHATGPT_SYNC_USAGE =
  "usage: slopweaver chatgpt sync [--from <zip|dir|file>] [--replay] [--home <dir>]\n" +
  "  --from    as for import-export, but a folder gives every export zip in it (default: ~/Downloads)\n" +
  "  --replay  forget every receipt first, so a refresh runs again — after bronze or the store is rebuilt\n" +
  "  Takes in every export zip it finds that is not yet held, then, while any held export has no receipt, refreshes\n" +
  "  every held export into the corpus and the store, each chat from its latest version, and writes the receipts\n" +
  "  last. Exit 1 while any held export no longer hashes to what was taken in, a receipted older one included,\n" +
  "  or two exports hold differing versions of a chat with no later update on either. With every export in: exit 3\n" +
  "  while the newest export, or a later re-download of it, is inside ChatGPT's freshness window (a day),\n" +
  "  else exit 4 (deferred) naming its age.\n" +
  "  Exit 3 too when no export was ever taken in.\n" +
  "  A local history, not a mirror: a chat deleted on chatgpt.com stays in the corpus.";

/** Every flag `chatgpt import-export` accepts, for the help-truth sweep. */
export const CHATGPT_IMPORT_EXPORT_FLAG_NAMES: readonly string[] = ["--from", "--home", "--json"];

/** Every flag `chatgpt sync` accepts, for the help-truth sweep. */
export const CHATGPT_SYNC_FLAG_NAMES: readonly string[] = ["--from", "--home", "--replay"];
