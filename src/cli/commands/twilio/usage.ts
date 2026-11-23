/**
 * The usage lines of every `slopweaver twilio` verb, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/twilio.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

/** `slopweaver twilio verify`'s usage line. */
export const TWILIO_VERIFY_USAGE = "usage: slopweaver twilio verify [--home <dir>] [--json]";

/** `slopweaver twilio messages`'s usage line. */
export const TWILIO_MESSAGES_USAGE =
  "usage: slopweaver twilio messages [--to <+E.164>] [--from <+E.164|sender-id>] [--sent-after <YYYY-MM-DD|iso>] [--sent-before <YYYY-MM-DD|iso>] [--limit <n>] [--home <dir>] [--json]";

/** `slopweaver twilio message`'s usage line. */
export const TWILIO_MESSAGE_USAGE = "usage: slopweaver twilio message --sid <SM…|MM…> [--home <dir>] [--json]";
