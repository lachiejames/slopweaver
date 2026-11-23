/**
 * The usage lines of `slopweaver talk`'s code, file, log, offer, pack, row, supervisor, relay, transcript, calls, thread, unread, cursor-retire, land,
 * cards, steers, laps, restore and attach verbs, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/talk.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

/** The usage `talk pack` prints. */
export const TALK_PACK_USAGE =
  "usage: slopweaver talk pack [--write [--if-older-than <minutes>]] [--base <ref>] [--dir <dir>] [--home <dir>] [--json]";

/** The usage `talk offer` prints. */
export const TALK_OFFER_USAGE =
  "usage: slopweaver talk offer [--voice <plan voice>] [--reconnect | --rollover | --typed] [--test-instance e2e] [--home <dir>] [--json]";

/** The usage `talk code` prints. */
export const TALK_CODE_USAGE = [
  "usage: slopweaver talk code find (--text <literal> | --text-hex <utf8-hex>) [--max-hits <n>] [--budget <bytes>] [--cwd <dir>] [--json]",
  "       slopweaver talk code read --path <repo-relative> [--from <byte>] [--budget <bytes>] [--cwd <dir>] [--json]",
  "       slopweaver talk code list [--dir <repo-relative>] [--cwd <dir>] [--json]",
].join("\n");

/** The usage `talk file` prints. */
export const TALK_FILE_USAGE = [
  "usage: slopweaver talk file read --path <absolute|~/path> [--words] [--from <byte>] [--budget <bytes>] [--home <dir>] [--json]",
  "       slopweaver talk file list --dir <absolute|~/path> [--limit <n>] [--home <dir>] [--json]",
].join("\n");

/** The usage `talk row` prints. */
export const TALK_ROW_USAGE = "usage: slopweaver talk row --slug <board-slug> [--dir <dir>] [--home <dir>] [--json]";

/** The usage `talk log` prints. */
export const TALK_LOG_USAGE =
  "usage: slopweaver talk log [--limit <n> | --about-prefix <kind:> | --turn <uuid>] [--home <dir>] [--json]";

/** The usage `talk check-ins` prints. */
export const TALK_CHECK_INS_USAGE = "usage: slopweaver talk check-ins [--skip <n>] [--home <dir>] [--json]";

/** The usage `talk supervisor` prints. */
export const TALK_SUPERVISOR_USAGE =
  "usage: slopweaver talk supervisor [--max-bytes <n>] [--session <claude-session-id>] [--home <dir>] [--json]";

/** The usage `talk relay` prints. */
export const TALK_RELAY_USAGE =
  "usage: slopweaver talk relay --turn <uuid> (--say <words> | --read-after <tool,...> | --words-alone | --typed) [--heard <their words> | --heard-stdin] [--heard-tail cut|whole] [--about <kind:id> [--covers rule|this]] [--also-answers <kind:id>]... [--candidate <id> --reaction <word>] [--triage <verdict> [--label <label>] [--feedback no-receipts|not-at-a-glance]] [--workspace team|self --workspace-because <line>] [--offered-file <json-file>] [--discuss-first put|override --team-fix <owner/repo> [--fix-thread <slack-link>] [--discuss-first-turn <uuid>]] [--screen <webp-file> | --screen-failed | --screen-not-taken | --screen-recording-off] [--priority p1|p2|p3] [--deliver-to-supervisor] [--console-root <dir> --console-port <n> --console-default-port <n>] [--dir <dir>] [--home <dir>] [--json]";

/** The usage `talk transcript` prints. */
export const TALK_TRANSCRIPT_USAGE =
  "usage: slopweaver talk transcript --call <uuid> --entries-file <jsonl|-> [--console-root <dir> --console-port <n> --console-default-port <n> [--console-instance e2e]] [--handoff <intent>] [--dir <dir>] [--home <dir>] [--json]";

/** The usage `talk calls` prints. */
export const TALK_CALLS_USAGE = "usage: slopweaver talk calls [--limit <n>] [--home <dir>] [--json]";

/** The usage `talk thread` prints. */
export const TALK_THREAD_USAGE = "usage: slopweaver talk thread [--turns <n>] [--home <dir>] [--json]";

/** The usage `talk cut-ins` prints. */
export const TALK_CUT_INS_USAGE = "usage: slopweaver talk cut-ins [--since <iso|60d|12h>] [--home <dir>] [--json]";

/** The usage `talk fidelity` prints. */
export const TALK_FIDELITY_USAGE =
  "usage: slopweaver talk fidelity [--call <uuid> | --since <iso|60d|12h> [--until <iso>]] [--limit <n>] [--words] [--home <dir>] [--json]";

/** The usage `talk quarantine` prints. */
export const TALK_QUARANTINE_USAGE =
  'usage: slopweaver talk quarantine <callId> --reason "<what removed it, and whose words they were>" [--home <dir>] [--json]';

/** The usage `talk cursor-retire` prints. */
export const TALK_CURSOR_RETIRE_USAGE =
  'usage: slopweaver talk cursor-retire [--cursor <name>] [--apply --source-sha256 <hex> --reason "<what rewrote the call files>"] [--home <dir>] [--json]';

/** The usage `talk unread` prints. */
export const TALK_UNREAD_USAGE =
  "usage: slopweaver talk unread [--mark [--adopt]] [--all] [--cursor <name>] [--now <iso>] [--home <dir>] [--json]";

/** The usage `talk unread-adopt` prints. */
export const TALK_UNREAD_ADOPT_USAGE =
  'usage: slopweaver talk unread-adopt --before <iso> --why "<who already read them>" [--approve <digest>] ' +
  "[--cursor <name>] [--now <iso>] [--home <dir>] [--json]\n" +
  "  Marks every stretch on every call stamped strictly before --before read for one cursor, WITHOUT printing them.\n" +
  "  With no --approve it previews: per call, what it passes and what stays unread, and a digest, writing nothing.\n" +
  "  Re-run with --approve <digest> to write exactly that, through the same compare-and-swap as a mark,\n" +
  "  and leave a receipt in $SLOPWEAVER_HOME/talk/unread-adopt-receipts.jsonl. For a backlog another reader already\n" +
  "  read (a home carried from another machine), never for words nobody has read.";

/** The usage `talk wake-chair` prints. */
export const TALK_WAKE_CHAIR_USAGE =
  "usage: slopweaver talk wake-chair [--dry-run [--home <dir>] [--now <iso>]] [--console-root <dir> --console-port <n> --console-default-port <n>] [--json]";

/** The usage `talk courier` prints. */
export const TALK_COURIER_USAGE = "usage: slopweaver talk courier (--follow | --once [--json])";

/** The usage `talk land` prints. */
export const TALK_LAND_USAGE =
  "usage: slopweaver talk land --card <kind:id> --words <their words> --anchor <utterance> --decided <iso> [--dir <dir>] [--home <dir>] [--json]";

/** The usage `talk cards` prints. */
export const TALK_CARDS_USAGE = "usage: slopweaver talk cards [--home <dir>] [--json]";

/** The usage `talk steers` prints. */
export const TALK_STEERS_USAGE = "usage: slopweaver talk steers [--home <dir>] [--json]";

/** The usage `talk laps` prints. */
export const TALK_LAPS_USAGE =
  "usage: slopweaver talk laps [--since <iso|14d|12h>] [--calibrate] [--home <dir>] [--json]";

/** The usage `talk attach` prints. */
export const TALK_ATTACH_USAGE =
  "usage: slopweaver talk attach --file <staged-file> --name <their file name> [--home <dir>] [--json]";

/** The usage `talk restore` prints. */
export const TALK_RESTORE_USAGE =
  "usage: slopweaver talk restore --card <kind:id> --anchor <where you decided> --why <reason> [--home <dir>] [--json]";
