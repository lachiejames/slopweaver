/**
 * The provider workspace-location rules — the generic half of `./forbiddenIdentifiers.ts`.
 *
 * A location (`<label>.slack.com`, `linear.app/<workspace>`, …) matches EVERY label but the ones listed as
 * allowed: the provider's own hosts and paths, and the synthetic workspaces fixtures and docs use. So these
 * rules name nobody, and need no hashing. A new synthetic name goes in its rule's `allowed`; a real workspace
 * never does.
 *
 * Every pattern is case-insensitive and global. A label starts with a letter or digit, as a hostname label
 * must, and the lookbehind skips one glued to a letter, digit, `-`, `%` or backslash, so a URL-encoded
 * `%2Fapp.` or an escaped `\napp.` is never read as a label. Each rule's `marker` is the host or path literal
 * every match contains, so a text without it skips the pattern.
 */
import type { ProviderLocationRule } from "./identifierScan.js";

/** Datadog's own leftmost labels and regional sites — every host Datadog itself serves. */
const DATADOG_OWN = ["ap1", "ap2", "api", "app", "docs", "eu1", "help", "intake", "uk1", "us3", "us5", "us9", "www"];

/** The location rules, one per provider. */
export const PROVIDER_LOCATION_RULES = [
  {
    allowed: [
      "a",
      "acme",
      "acme-eng",
      "acme-group",
      "acme-sandbox",
      "acmecorp",
      "another-org",
      "api",
      "app",
      "b",
      "beta",
      "enterprise",
      "example",
      "example-org",
      "example-workspace",
      "files",
      "fixture",
      "globex",
      "globex-eng",
      "hooks",
      "mcp",
      "old-workspace",
      "other",
      "other-org",
      "othercompany",
      "status",
      "wrong-host",
      "www",
      "x",
    ],
    marker: "slack.com",
    provider: "slack",
    re: /(?<![a-z0-9%\\-])([a-z0-9][a-z0-9-]*)\.(?:enterprise\.)?slack\.com/gi,
  },
  {
    allowed: [
      "a",
      "abc",
      "acme",
      "acme-eng",
      "acme-sentinel",
      "api",
      "assets",
      "d1",
      "doc-1",
      "docs",
      "elsewhere",
      "example",
      "globex",
      "graphql",
      "i1",
      "issue",
      "mcp",
      "me",
      "members",
      "o",
      "oauth",
      "other",
      "p",
      "placeholder",
      "settings",
      "someone-else",
      "team",
      "u1",
      "w",
      "x",
      "y",
    ],
    marker: "linear.app/",
    provider: "linear",
    re: /(?<![a-z0-9%\\-])linear\.app\/([a-z0-9][a-z0-9-]*)/gi,
  },
  {
    allowed: ["acme", "example", "team-example"],
    marker: "trelica.app",
    provider: "trelica",
    re: /(?<![a-z0-9%\\-])([a-z0-9][a-z0-9-]*)\.trelica\.app/gi,
  },
  {
    allowed: ["acme", "downloads", "ent", "events", "example", "i", "my", "other", "start", "support", "team"],
    marker: "1password.com",
    provider: "1password",
    re: /(?<![a-z0-9%\\-])([a-z0-9][a-z0-9-]*)\.1password\.com/gi,
  },
  {
    allowed: ["acme", "example", "your-domain"],
    marker: "atlassian.net",
    provider: "atlassian",
    re: /(?<![a-z0-9%\\-])([a-z0-9][a-z0-9-]*)\.atlassian\.net/gi,
  },
  {
    allowed: ["acme", "example", "team"],
    marker: "cloudflareaccess.com",
    provider: "cloudflare-access",
    re: /(?<![a-z0-9%\\-])([a-z0-9][a-z0-9-]*)\.cloudflareaccess\.com/gi,
  },
  {
    allowed: [...DATADOG_OWN, "account-a", "acme", "example", "moon", "xapp"],
    marker: "datadoghq.com",
    provider: "datadog",
    re: /(?<![a-z0-9%\\-])([a-z0-9][a-z0-9-]*)\.(?:(?:ap1|ap2|eu1|uk1|us3|us5|us9)\.)?datadoghq\.com/gi,
  },
] as const satisfies readonly ProviderLocationRule[];
