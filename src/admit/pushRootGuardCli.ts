/**
 * `lefthook.yml`'s `old-history-push` pre-push entry point — nothing but the top-level invocation. `lefthook`
 * runs it first (`node_modules/.bin/tsx src/admit/pushRootGuardCli.ts {1} {2}`, `use_stdin: true`), so a raw
 * `git push` from any tool meets the same old-history guard the `github` push verbs ask in-process. The
 * decision lives in `pushRootGate.ts`, which is unit-tested; this file existing IS the invocation, so there is
 * no `isDirectInvocation` guard.
 *
 * Git hands a pre-push hook `<remote name> <push url>` as argv and one ref line per update on stdin. The URL is
 * the one judged: it is where the objects go, whatever the remote is named. A stdin line that is not a ref line
 * refuses rather than skips, because a skipped line is an unjudged push.
 *
 * `cwd` alone selects the repository: git exports `GIT_DIR` into every hook it runs, and the transport's own
 * reader (`./gitTransport.ts`, bounded and `GIT_*`-stripped) is the one the push verbs judge with too.
 * The state home is the ambient one — a hook has no `--home` — and with no register there it asks Git nothing.
 */
import { readFileSync } from "node:fs";

import { slopweaverHome } from "../homeDir.js";
import { readGit } from "./gitTransport.js";
import { prePushLocalShas, refuseOldHistoryPush } from "./pushRootGate.js";

const pushUrl = process.argv[3];
if (pushUrl === undefined || pushUrl.length === 0) {
  process.stderr.write("pre-push refused: the hook was not handed a push url, so the target cannot be judged\n");
  process.exit(1);
}

const parsed = prePushLocalShas({ stdin: readFileSync(0, "utf8") });
if (parsed.isErr()) {
  process.stderr.write(`pre-push refused: this is not a pre-push ref line, so it cannot be judged: ${parsed.error}\n`);
  process.exit(1);
}

const verdict = refuseOldHistoryPush({
  env: process.env,
  home: slopweaverHome(),
  localShas: parsed.value,
  pushUrls: () => [pushUrl],
  readGit,
  repoRoot: process.cwd(),
});
if (verdict.isErr()) {
  process.stderr.write(`pre-push refused: ${verdict.error.message}\n`);
  process.exit(1);
}
process.exit(0);
