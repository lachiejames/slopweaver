/**
 * The console's own landing refresh, one runner the shell owns (`../console/useLandingAutoRefresh.ts`): where
 * the run that takes a reading when the one shown calls for it (`landingFreshness.ts`) got to, which the Pull requests
 * page's line beside the selector words (`prFreshness.ts`). The POST itself is every page-owned reading's
 * (`./takeReading.ts`).
 */
import type { RefreshReason } from "../../lib/landingFreshness";

/**
 * Where the page's last refresh got to. `auto` is why the page took it (`landingFreshness.ts`), `undefined` when
 * the caller named no reason.
 */
export type SyncState =
  | { readonly phase: "idle" }
  | { readonly phase: "taking"; readonly startedAtIso: string; readonly auto: RefreshReason | undefined }
  | {
      readonly phase: "taken";
      readonly tookMs: number;
      readonly atIso: string;
      readonly auto: RefreshReason | undefined;
    }
  | {
      readonly phase: "failed";
      readonly why: string;
      readonly atIso: string;
      readonly auto: RefreshReason | undefined;
    };
