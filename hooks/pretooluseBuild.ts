/**
 * Build one `PreToolUse` bundle generation for the root named by the first argument, and make it current
 * (`src/admit/hookBundleBuild.ts`). `scripts/pretooluse.sh` launches this in the background, niced and with
 * every stream on `/dev/null`, when a call finds no generation it can run; by hand it is the way to build one
 * now and see why it did not:
 *
 *   node_modules/.bin/tsx hooks/pretooluseBuild.ts "$PWD"
 *
 * Exit 0 when a generation was published or another builder holds the lock, 1 with the reason on stderr when
 * nothing was published, 64 when no root was named.
 */

import { buildHookBundleGeneration } from "../src/admit/hookBundleBuild.js";

const root = process.argv[2];
if (root === undefined || root === "") {
  process.stderr.write("pretooluse build: name the plugin root to build, as the first argument\n");
  process.exitCode = 64;
} else {
  const outcome = await buildHookBundleGeneration({ nowMs: Date.now(), root });
  if (outcome.isErr()) {
    process.stderr.write(`pretooluse build: ${outcome.error.message}\n`);
    process.exitCode = 1;
  } else if (outcome.value.kind === "published") {
    process.stderr.write(`pretooluse build: published ${outcome.value.generation}\n`);
  } else {
    process.stderr.write("pretooluse build: another build holds the lock\n");
  }
}
