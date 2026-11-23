/**
 * The ONE source of truth for `refresh`'s flag surface — the names, the parser spec, and the usage string.
 *
 * `refresh` carried three divergent copies of this. The parser accepted 19 flags; `run.ts` printed an
 * 18-flag usage on a parse error; the manifest — which is what `--help` shows — advertised 9. So the help a
 * caller reads omitted `--sample`, and a run shaped around it failed for a reason the help could not explain.
 * That cost a whole PR.
 *
 * A deliberately LEAF module: the manifest imports it to publish the usage, and importing it must not drag
 * in the octokit-heavy command module, or the lazy-load bridge stops being lazy.
 */
import type { FlagTailSpec } from "../../optionParsers.js";

/** Flags that may be repeated; collected before the tail parse, so they are not in {@link REFRESH_FLAG_SPEC}. */
const REFRESH_REPEATED_FLAGS: readonly string[] = [
  "source",
  "slack-channel",
  "include-repo",
  "exclude-repo",
  "self-root",
  "self-exclude",
];

/**
 * The opt-in flag for the `self` source, named here so the help-truth ratchet can assert the surface advertises
 * it. `self` is NOT reachable through `--source`: it is not a fetchable source, and `--source self` is a usage
 * error naming the four that are. One door, and it is off unless asked for, so a bare `refresh` stays
 * network-shaped and never touches the filesystem.
 */
export const REFRESH_SELF_FLAGS: readonly string[] = ["--self", "--self-root", "--self-exclude"];

/** The single-occurrence flags, exactly as `parseRefreshOptions` passes them to `parseFlagTail`. */
export const REFRESH_FLAG_SPEC: FlagTailSpec = {
  boolean: [
    "no-enrich",
    "all-sources",
    "all",
    "all-repos",
    "accept-full-history",
    "numbers-only",
    "self",
    "refetch-unchanged",
    "coverage",
    "no-derive",
    "no-notion-attachments",
    "if-stale",
    "jit",
    "store",
  ],
  value: [
    "repo",
    "since",
    "until",
    "lookback-days",
    "home",
    "github-org",
    "repo-cap",
    "github-page-cap",
    "slack-membership-cap",
    "sample",
    "fetch-cap",
    "stale-after",
    "notion-block-depth",
    "notion-item-calls",
    "notion-item-time",
  ],
};

/* A destructured default rather than `#lib/absent.js`: this leaf is in every verb's `--help` closure. */
const { boolean: refreshBooleanFlags = [] } = REFRESH_FLAG_SPEC;

/** Every flag the parser accepts, WITH the leading `--`, for the help-truth ratchet. */
export const REFRESH_FLAG_NAMES: readonly string[] = [
  ...REFRESH_REPEATED_FLAGS,
  ...refreshBooleanFlags,
  ...REFRESH_FLAG_SPEC.value,
].map((name) => `--${name}`);

/**
 * The usage string, published by the manifest AND printed on a parse error, so the two cannot disagree.
 * Every flag in {@link REFRESH_FLAG_NAMES} appears here; the ratchet fails the build if one stops doing so.
 */
export const REFRESH_USAGE =
  "usage: slopweaver refresh [--repo owner/repo] [--source github|slack|linear|notion|gmail|calendar|fathom]... " +
  "[--all-sources (github/slack/linear/notion — NOT gmail or calendar; name them)] [--since YYYY-MM-DD] " +
  "[--until YYYY-MM-DD] [--all --accept-full-history] " +
  "[--slack-channel <id>]... [--lookback-days N] [--no-enrich] [--coverage] [--all-repos [--github-org <org>] " +
  "[--include-repo <glob>]... [--exclude-repo <glob>]... [--repo-cap N]] [--github-page-cap N] [--slack-membership-cap N] " +
  "[--sample N] [--fetch-cap N] [--refetch-unchanged] [--no-derive] [--no-notion-attachments] [--numbers-only] " +
  "[--notion-block-depth N] [--notion-item-calls N] [--notion-item-time 30m|2h] " +
  "[--if-stale [--stale-after 30m|4h|7d]] [--jit] [--store] " +
  "[--self [--self-root <dir>]... [--self-exclude <rel-path>]...] [--home <dir>]";
