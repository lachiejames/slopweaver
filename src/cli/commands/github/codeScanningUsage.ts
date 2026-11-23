/** `github code-scanning`'s usage — a dependency-free leaf the manifest reads without loading the command. */

export const GITHUB_CODE_SCANNING_USAGE =
  "usage: slopweaver github code-scanning <show|enable|disable> --repo <owner/name> [--approve <ghrepo-digest>]\n" +
  "                                       [--dry-run] [--json] [--home <dir>]\n" +
  "  show               the repository's code-scanning DEFAULT SETUP (the no-workflow CodeQL switch) and the\n" +
  "                     org security configuration attached to it, with whether that configuration is enforced\n" +
  "  enable             switch default setup on (state configured): previews the change and a digest by default;\n" +
  "                     sends once only with --approve, then reads it back — only a read-back of configured is\n" +
  "                     success; refused when a configuration is ENFORCED or cannot be read\n" +
  "  disable            switch default setup off (state not-configured) through the door, then read it back;\n" +
  "                     refused when an ENFORCED security configuration is attached — only an org admin can lift it\n" +
  "  --repo <owner/name>  the repository\n" +
  "  --approve <digest> enable only: the digest a preview printed; re-checked against fresh reads before sending\n" +
  "  --dry-run          disable only: read both settings and print the plan; no write, no door record\n" +
  "  --json             machine-readable output\n" +
  "  --home <dir>       the state home whose door records the write";
