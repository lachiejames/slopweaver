/**
 * The `desktop e2e --context` flag's read. It lives apart from `./e2eWorkContext.ts` because that module is
 * reached by the console site's own typecheck through `site/__tests__/unit/e2eWorkContextMirror.test.ts`, and the
 * site's CI job installs only `site/`'s dependencies: a `#lib/result.js` import there resolves `neverthrow` from
 * the root, which that job never installs (run 45321460719 on 24 Nov 2026, job site, TS2307 at `src/lib/result.ts`).
 */
import { err, ok, type Result } from "#lib/result.js";

import { type DesktopE2eFlagError, DesktopE2eFlagErrors } from "./e2eErrors.js";
import { E2E_WORK_CONTEXTS, type E2eWorkContext, isE2eWorkContext } from "./e2eWorkContext.js";

/**
 * The `--context` flag's value, read.
 *
 * @param text the flag's value, or `undefined` when the flag was not passed
 * @returns the context, `undefined` when not asked for — the instance then opens as it always has — or the refusal
 */
export function e2eContextOf({
  text,
}: {
  text: string | undefined;
}): Result<E2eWorkContext | undefined, DesktopE2eFlagError> {
  if (text === undefined) {
    return ok(undefined);
  }
  if (!isE2eWorkContext(text)) {
    return err(DesktopE2eFlagErrors.contextUnknown({ contexts: E2E_WORK_CONTEXTS, text }));
  }
  return ok(text);
}
