/**
 * `slopweaver connect`'s usage line, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/connect.ts` quotes it, and a manifest is enumerated by `--help`, `catalog` and
 * `discoverCommands` on invocations that dispatch no `connect` verb, so it must not drag the connector clients
 * `run.ts` imports onto their load path (`.claude/rules/area-cli.md` § "Metadata is eager, the run function is
 * lazy"). Its one import is the derived target list, so a new connect target joins the help with no edit here.
 */
import { CONNECT_TARGETS } from "../../../integrations/corpusSources.js";

/** The `usage:` line `connect` prints on `--help` and after a parse error, naming every preflight target. */
export const CONNECT_USAGE =
  `usage: slopweaver connect <${CONNECT_TARGETS.join("|")}> --check [--json] [--repo owner/repo] ` +
  "[--github-org <org>] [--home <dir>]";
