/**
 * Where a `notion page` body's relative media placeholders resolve from — split from `pageRun.ts` as its own
 * seam, the one rule every placeholder path depends on.
 */
import { dirname } from "node:path";

import type { NotionPageArgs } from "./pageCore.js";

/**
 * Where relative `file:` placeholder paths resolve from.
 *
 * The markdown file's own directory, because that is where a person writing `![](file:./shots/hero.png)`
 * means. `--media-base` overrides it, and is REQUIRED in spirit for a body piped on stdin: there is no file
 * to be relative to, so the working directory is the only honest default and `--media-base` is how a caller
 * says otherwise. `proposal publish` passes it explicitly for exactly that reason.
 *
 * @returns the directory relative placeholder paths resolve against
 */
export function mediaBaseOf({ args }: { args: NotionPageArgs }): string {
  if (args.mediaBase !== undefined) {
    return args.mediaBase;
  }
  return args.bodySource === "-" ? process.cwd() : dirname(args.bodySource);
}
