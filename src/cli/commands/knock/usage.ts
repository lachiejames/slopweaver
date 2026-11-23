/**
 * The usage lines of every `slopweaver knock` verb, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/knock.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

/** The message-list filters `knock messages` and `knock user-messages` share. */
const FILTERS =
  "[--channel-id <id>] [--status <status> ...] [--source <workflow-key>] [--tenant <id>] [--workflow-run-id <id>] [--workflow-recipient-run-id <id>] [--inserted-after <iso>] [--inserted-before <iso>] [--limit <n>] [--home <dir>] [--json]";

/** `slopweaver knock verify`'s usage line. */
export const KNOCK_VERIFY_USAGE = "usage: slopweaver knock verify [--home <dir>] [--json]";

/** `slopweaver knock messages`'s usage line. */
export const KNOCK_MESSAGES_USAGE = `usage: slopweaver knock messages ${FILTERS}`;

/** `slopweaver knock user-messages`'s usage line. */
export const KNOCK_USER_MESSAGES_USAGE = `usage: slopweaver knock user-messages --user-id <id> ${FILTERS}`;

/** `slopweaver knock message`'s usage line. */
export const KNOCK_MESSAGE_USAGE = "usage: slopweaver knock message --id <message-id> [--home <dir>] [--json]";

/** `slopweaver knock message-events`'s usage line. */
export const KNOCK_MESSAGE_EVENTS_USAGE =
  "usage: slopweaver knock message-events --id <message-id> [--limit <n>] [--home <dir>] [--json]";

/** `slopweaver knock delivery-logs`'s usage line. */
export const KNOCK_DELIVERY_LOGS_USAGE =
  "usage: slopweaver knock delivery-logs --id <message-id> [--limit <n>] [--home <dir>] [--json]";
