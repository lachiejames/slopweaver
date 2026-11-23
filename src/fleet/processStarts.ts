/**
 * The one `ps` listing both `fleet health` and `fleet resume` bind a session or a pass to its process with, so the
 * two never disagree about whether a seat is running. The pure halves are `./liveSeat.ts`.
 */
import { execFileSync } from "node:child_process";

import { parseProcessStarts } from "./liveSeat.js";

/**
 * Each running pid's start stamp, or why `ps` gave none. Asked of `/bin/ps` by its path in UTC and the C locale and
 * inheriting nothing else, so it prints exactly as Claude Code's registry records `procStart` and as a lock holder's
 * stamp is taken (`../talk/relayLease.ts`).
 *
 * @returns the stamp per pid, or why the listing could not be taken or held a row that would not read
 */
export function readProcessStarts(): { readonly starts: ReadonlyMap<number, string> } | { readonly why: string } {
  try {
    const text = execFileSync("/bin/ps", ["-ax", "-o", "pid=,lstart="], {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", TZ: "UTC" },
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    return parseProcessStarts({ text }).match(
      (starts) => ({ starts }),
      (why) => ({ why }),
    );
  } catch (error: unknown) {
    return { why: error instanceof Error ? error.message : String(error) };
  }
}
