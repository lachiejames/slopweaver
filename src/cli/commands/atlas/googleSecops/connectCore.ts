/**
 * PURE argument handling for `atlas google-secops connect`. The tail is parsed here and nowhere else, so a
 * malformed invocation is refused before a credential is read or a socket is opened.
 *
 * There is no `--grant` and no `--without`, unlike `atlas google-admin connect`: this door has exactly one
 * capability beside identity (`chronicle.readonly`), so a narrowing flag would
 * have nothing to narrow. A wider scope is its own pull request, never a flag.
 */
import { err, ok, type Result } from "../../../../lib/result.js";
import type { GoogleSecopsCapability } from "../../../../live/googleSecops/scopes.js";
import { parseFlagTail } from "../../../optionParsers.js";
import type { GoogleConnectArgs } from "../../google/connectShell.js";

/**
 * `atlas google-secops connect` usage.
 *
 * @internal
 */
export const GOOGLE_SECOPS_CONNECT_USAGE =
  "usage: slopweaver atlas google-secops connect [--status] [--revoke] [--json] [--home <dir>]\n" +
  "  Opens Google's consent screen in your browser and stores the resulting grant, owner-only\n" +
  "  Requests `chronicle.readonly` and nothing wider, through this door's OWN OAuth client\n" +
  "  (`google-secops-client-id`), so this consent screen cannot approve a write\n" +
  "  --status   report the stored grant's account and scopes and stop — no browser, no socket\n" +
  "  --revoke   withdraw the stored grant at Google and delete it — no browser, no socket\n" +
  "  --json     emit the token-free grant status as one machine-readable document";

/** Every flag this verb's parser accepts, so the help-truth contract can check the usage against it. */
export const GOOGLE_SECOPS_CONNECT_FLAG_NAMES: readonly string[] = ["--home", "--json", "--revoke", "--status"];

/**
 * Parse the `atlas google-secops connect` tail.
 *
 * Its one failure is the tokeniser's own list, only ever printed, so it stays the default `Result` error
 * rather than a one-variant union — the usage rides as the last line, because the shared shell knows no
 * door's usage.
 *
 * @param rest the argv tail after `atlas google-secops connect`
 * @returns the validated request, or the tokeniser's reasons followed by the usage
 */
export function parseGoogleSecopsConnectArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<GoogleConnectArgs<GoogleSecopsCapability>> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json", "revoke", "status"], value: ["home"] } });
  if (parsed.isErr()) {
    return err([...parsed.error, GOOGLE_SECOPS_CONNECT_USAGE]);
  }
  return ok({
    capabilities: ["chronicle"],
    home: parsed.value.values["home"],
    json: parsed.value.flags.has("json"),
    revoke: parsed.value.flags.has("revoke"),
    statusOnly: parsed.value.flags.has("status"),
  });
}
