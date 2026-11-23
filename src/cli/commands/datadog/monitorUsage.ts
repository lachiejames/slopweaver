/**
 * The usage of `slopweaver datadog monitor`, and nothing else.
 *
 * A LEAF on purpose, for the reason `./usage.ts` gives: `cli/manifests/datadogMonitor.ts` reads this string on
 * every invocation, so it cannot live in a module that imports the Datadog SDK. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** `slopweaver datadog monitor`'s usage, shared by `--help` and the manifest so the two cannot drift. */
export const DATADOG_MONITOR_USAGE =
  "usage: slopweaver datadog monitor show <id> [--json]\n" +
  "       slopweaver datadog monitor update <id> (--query Q | --name N | --message M | --tags t1,t2 | --patch FILE|-)\n" +
  '         [--approve <digest>] [--iac-override "<why>"] [--home DIR] [--json]\n' +
  '       slopweaver datadog monitor delete <id[,id...]> [--approve <digest>] [--iac-override "<why>"] [--home DIR] [--json]\n' +
  "  show          read one monitor: name, type, state, creator, modified, tags, query, message, options\n" +
  "  update        read the live monitor, print the exact before/after and an approval digest, and send\n" +
  "                NOTHING. Re-run with --approve <digest> to PUT exactly that change; the digest covers the\n" +
  "                monitor as read (modified included) and the body sent, so any drift since the preview\n" +
  "                invalidates it. Each change flag is the value the field ends as; --tags replaces the list\n" +
  '  --patch       a JSON document {"query","name","message","tags","options"} instead of the flags, or - for\n' +
  "                stdin. Its options keys are merged over the live options, which are then sent whole\n" +
  "  delete        read every id, run Datadog's can_delete check, print each monitor and a digest, and delete\n" +
  "                NOTHING; re-run with --approve <digest> to delete exactly those, in order\n" +
  "  --iac-override  a monitor carrying an infrastructure-as-code ownership tag is refused without this; the\n" +
  "                reason is recorded in the door ledger. The tags are profile.json datadog.iacManagedTags in\n" +
  "                the --home profile, empty by default, which leaves the guard inert\n" +
  "  Refused with no override: a change that adds a {{#is_recovery}} block or sets a non-zero\n" +
  "  renotify_interval — monitors here are alert-only";
