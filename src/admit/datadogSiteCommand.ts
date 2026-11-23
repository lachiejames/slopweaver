/**
 * The admit hook's walk for a shell line that LAUNCHES a browser at a Datadog console on the wrong site —
 * `open https://app.datadoghq.com/…` on an install whose `DD_SITE` is `us3.datadoghq.com`.
 *
 * A separate walk with its own hatch, beside the raw and Python walks in `./hookPayload.ts`, for the reason
 * those two stay apart: `SLOPWEAVER_ALLOW_RAW` must never open a wrong-site refusal, and this hatch must never
 * hide a `curl` one. The rule itself is `../datadog/siteGuard.ts`; this file only finds the addresses, and
 * `./segmentWalk.ts` is what looks through `nohup`/`command`/`exec` and into an `sh -c '…'` payload.
 */
import { DATADOG_SITE_OVERRIDE_ENV, datadogSiteRefusal } from "../datadog/siteGuard.js";
import { withDatadogSite } from "../datadog/source.js";
import { extractShellWord } from "./argumentValue.js";
import { toolName } from "./commandTokens.js";
import { type WalkVerdict, walkSegments } from "./segmentWalk.js";

/** The commands that hand an address to a browser: macOS `open`, and its freedesktop twin. */
const BROWSER_LAUNCHERS: ReadonlySet<string> = new Set(["open", "xdg-open"]);

/**
 * Refuse a shell line whose `open`/`xdg-open` segment names a Datadog console on the wrong site.
 *
 * Each segment carries its own inline `SLOPWEAVER_ALLOW_DATADOG_SITE=1` scope, exactly as the raw walk's
 * override does, so a prefix on one `open` never waves through another.
 *
 * @param command the raw shell line
 * @param env the hook's environment, carrying `DD_SITE` and the ambient hatch
 * @returns the first refusal, or allow
 */
export function classifyDatadogSiteCommand({
  command,
  env,
}: {
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): WalkVerdict {
  return walkSegments({ command, env, judge: judgeLauncher, overrideEnv: DATADOG_SITE_OVERRIDE_ENV });
}

/**
 * Judge one segment's words: a launcher's addresses, each against this install's site. Every word is read as the
 * shell hands it over ({@link extractShellWord}), so a quoted or `$'…'`-encoded launcher or address is judged decoded.
 *
 * @param tokens the words, the command that runs first
 * @param env the environment in scope for this segment, inline hatch applied
 * @returns the first refusal, or allow
 */
function judgeLauncher({
  tokens,
  env,
}: {
  tokens: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
}): WalkVerdict {
  const first = tokens[0];
  if (first === undefined) {
    return { blocked: false };
  }
  const tool = toolName({ first: extractShellWord({ text: first }) });
  if (!BROWSER_LAUNCHERS.has(tool)) {
    return { blocked: false };
  }
  const urls = tokens
    .slice(1)
    .map((token) => extractShellWord({ text: token }))
    .filter((url) => /^https?:\/\//i.test(url));
  if (urls.length === 0) {
    return { blocked: false };
  }
  // The site may live in `profile.json` rather than `DD_SITE`, and only a launcher line handing over an
  // address pays for reading it — every other hook call stays free of file reads.
  const siteEnv = withDatadogSite({ env });
  for (const url of urls) {
    const message = datadogSiteRefusal({ command: `${tool} ${url}`, env: siteEnv, url });
    if (message !== undefined) {
      return { blocked: true, message };
    }
  }
  return { blocked: false };
}
