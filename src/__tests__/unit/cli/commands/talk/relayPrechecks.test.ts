/**
 * `talk relay`'s refusals before it writes: a team fix is judged against the organisation passed in, which is read
 * only when the relay names one. The organisation read is a plain recording function, never a mock.
 */
import { describe, expect, it } from "vitest";

import { parseRelayArgs } from "../../../../../cli/commands/talk/relayArgs.js";
import { type RelayOrganisationRead, refuseBeforeRelay } from "../../../../../cli/commands/talk/relayPrechecks.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { OrganisationErrors } from "../../../../../organisation/errors.js";
import { ACME_ORGANISATION, GLOBEX_ORGANISATION } from "../../../../organisationFixture.js";

const HOME = "/tmp/slopweaver-relay-precheck-home";

/** One relay's verdict, and how many times it read the organisation. */
async function precheck({
  extra,
  read,
}: {
  extra: readonly string[];
  read: RelayOrganisationRead;
}): Promise<{ exit: number | undefined; reads: number }> {
  let reads = 0;
  const args = unwrap(
    parseRelayArgs({
      rest: ["--turn", "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f", "--heard", "raise a fix", "--say", "on it", ...extra],
    }),
  );
  const exit = await refuseBeforeRelay({
    args,
    home: HOME,
    readOrganisation: (input) => {
      reads += 1;
      return read(input);
    },
  });
  return { exit, reads };
}

const acme: RelayOrganisationRead = () => Promise.resolve(ok(ACME_ORGANISATION));
const TEAM_FIX = ["--discuss-first", "put", "--team-fix", "acme/acme-admin"] as const;

describe("refuseBeforeRelay", () => {
  it("lets a relay naming no team fix through without reading the organisation", async () => {
    const absent: RelayOrganisationRead = () =>
      Promise.resolve(err(OrganisationErrors.notConfigured({ missing: "organisation" })));
    expect(await precheck({ extra: [], read: absent })).toEqual({ exit: undefined, reads: 0 });
  });

  it("lets a team fix in the organisation's repositories through, reading the organisation once", async () => {
    expect(await precheck({ extra: TEAM_FIX, read: acme })).toEqual({ exit: undefined, reads: 1 });
  });

  it("refuses the same fix as the caller's mistake against an organisation that does not hold it", async () => {
    const globex: RelayOrganisationRead = () => Promise.resolve(ok(GLOBEX_ORGANISATION));
    expect(await precheck({ extra: TEAM_FIX, read: globex })).toEqual({ exit: EXIT_USAGE, reads: 1 });
  });

  it("refuses as a failed read when the organisation will not read", async () => {
    const absent: RelayOrganisationRead = () =>
      Promise.resolve(err(OrganisationErrors.notConfigured({ missing: "organisation" })));
    expect(await precheck({ extra: TEAM_FIX, read: absent })).toEqual({ exit: EXIT_ERROR, reads: 1 });
  });
});
