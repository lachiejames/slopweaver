/**
 * `machine free-disk`'s usage text — a leaf the manifest and the command both import, so the barrel stays
 * metadata-only and the line `--help` prints is the one the manifest declares.
 */

/** The one-line usage the manifest declares. */
export const MACHINE_FREE_DISK_USAGE_LINE =
  "usage: slopweaver machine free-disk <package-caches|docker-data|before-setup-copy|app> [--bundle <name>] [--apply] [--json]";

/** What `machine free-disk --help` prints. */
export const MACHINE_FREE_DISK_USAGE =
  `${MACHINE_FREE_DISK_USAGE_LINE}\n` +
  "\n" +
  "Frees disk on the owner's disk ruling, one target at a time. Without --apply it changes\n" +
  "nothing: it reads the target, prints what each path holds, what removing it would free and the exact\n" +
  "act, then stops. With --apply it prints that same plan, then reads each path again immediately before\n" +
  "acting on it and stops on the first one that changed. The targets are a closed list and there is no\n" +
  "path flag, so nothing the ruling did not name is reachable.\n" +
  "\n" +
  "  package-caches     remove ~/Library/Caches/{pypoetry,pnpm,pip,pipenv}; npm, Yarn and every child of\n" +
  "                     Slopweaver's own cache are reported and kept, each with its reason\n" +
  "  docker-data        TRIM the Docker VM's /var/lib so Docker.raw hands its unused blocks back: nothing\n" +
  "                     deleted, no prune, no restart, the local postgres:17 image and never a pull\n" +
  "  before-setup-copy  remove a declared main checkout's .before-setup sibling, refused if a .git\n" +
  "                     entry sits anywhere inside it or it sits inside any git repository\n" +
  "  app                move one ruled-removable app from /Applications to the Trash on the same volume\n" +
  "                     (needs --bundle); recoverable, so it frees its space once the Trash is emptied\n" +
  "\n" +
  "  --bundle <name>  the application, `.app` optional, resolved against the owner's ruling in\n" +
  "                   $SLOPWEAVER_HOME/machine/free-disk-bundles.json\n" +
  "  --apply          carry the plan out\n" +
  "  --json           one JSON document: the plan, each outcome, the state home's df before and after,\n" +
  "                   and any stop, printed even when an apply stops partway\n" +
  "\n" +
  "example: slopweaver machine free-disk package-caches";
