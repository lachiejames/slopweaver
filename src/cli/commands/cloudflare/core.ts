/**
 * The PURE core of `slopweaver cloudflare sync`'s flag parsing. No fs, no clock, no network — the shells do
 * every read, write and credential resolution.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";

/** The validated invocation for `cloudflare sync` — the state home, the output shape and the two selection flags. */
export interface CloudflareSyncOptions {
  readonly home: string;
  readonly json: boolean;
  readonly accountIdFlag: string | undefined;
  readonly deepZoneFlag: string | undefined;
}

/**
 * Parse the verb tail into a validated {@link CloudflareSyncOptions}.
 *
 * @param rest the argv tail (after `slopweaver cloudflare sync`)
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every rejection
 */
export function parseCloudflareSyncOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<CloudflareSyncOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json"], value: ["home", "account-id", "deep-zone"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return ok({
    accountIdFlag: values["account-id"],
    deepZoneFlag: values["deep-zone"],
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
  });
}
