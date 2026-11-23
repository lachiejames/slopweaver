/**
 * The per-channel claim: created exclusively, read back as `held` by every later attempt, given back only by the
 * sweep that took it, and refusing — never answering "claimed" — when it cannot be written at all.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CLAIM_RELEASE_BY_MS,
  CLAIM_STALE_MS,
  claimedIncidentChannelIds,
  claimIncidentChannel,
  incidentClaimPath,
  incidentClaimStamp,
  reclaimStaleIncidentClaim,
  releaseIncidentClaim,
} from "../../../incident/claim.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

const AT = "2026-10-04T05:00:00.000Z";

describe("incident channel claims", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "incident-claim-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("names the claim by the channel id under the incidents state", () => {
    expect(incidentClaimPath({ channelId: "C0LIVE", home })).toBe(
      join(stateHomePaths({ home }).incidents, "claims", "C0LIVE"),
    );
  });

  it("takes a fresh claim, owner-only, stamped with its instant", () => {
    const claim = unwrap(claimIncidentChannel({ atIso: AT, holder: "A", channelId: "C0LIVE", home }));

    expect(claim).toEqual({ path: incidentClaimPath({ channelId: "C0LIVE", home }), state: "claimed" });
    expect(readFileSync(claim.path, "utf8")).toBe(`${AT} A\n`);
    expect(statSync(claim.path).mode & 0o777).toBe(0o600);
  });

  it("reads a second attempt as held and leaves the first stamp untouched", () => {
    unwrap(claimIncidentChannel({ atIso: AT, holder: "A", channelId: "C0LIVE", home }));

    const second = unwrap(
      claimIncidentChannel({ atIso: "2026-10-04T05:05:00.000Z", channelId: "C0LIVE", holder: "B", home }),
    );

    expect(second.state).toBe("held");
    expect(readFileSync(second.path, "utf8")).toBe(`${AT} A\n`);
  });

  it("claims two channels independently", () => {
    const states = ["C0ONE", "C0TWO"].map(
      (channelId) => unwrap(claimIncidentChannel({ atIso: AT, holder: "A", channelId, home })).state,
    );

    expect(states).toEqual(["claimed", "claimed"]);
  });

  it("refuses when the claims directory cannot be made", () => {
    mkdirSync(stateHomePaths({ home }).incidents, { recursive: true });
    writeFileSync(join(stateHomePaths({ home }).incidents, "claims"), "not a directory");

    const result = claimIncidentChannel({ atIso: AT, holder: "A", channelId: "C0LIVE", home });

    expect(unwrapErr(result).code).toBe("CLAIM_IO");
    expect(unwrapErr(result).message).toContain(
      `${incidentClaimPath({ channelId: "C0LIVE", home })} would not write: `,
    );
  });

  it("releases a claim so the next attempt takes it afresh, and an absent claim releases cleanly", () => {
    const claim = unwrap(claimIncidentChannel({ atIso: AT, holder: "A", channelId: "C0LIVE", home }));

    expect(unwrap(releaseIncidentClaim({ atIso: AT, holder: "A", nowMs: Date.parse(AT), path: claim.path }))).toBe(
      true,
    );
    expect(unwrap(claimIncidentChannel({ atIso: AT, holder: "A", channelId: "C0LIVE", home })).state).toBe("claimed");
    expect(
      unwrap(
        releaseIncidentClaim({ atIso: AT, holder: "A", nowMs: Date.parse(AT), path: join(home, "never-claimed") }),
      ),
    ).toBe(true);
  });

  it("gives back its own claim just short of the release bound, and keeps it from the bound on", () => {
    const claim = unwrap(claimIncidentChannel({ atIso: AT, holder: "A", channelId: "C0LIVE", home }));
    const atMs = Date.parse(AT);

    expect(
      unwrap(releaseIncidentClaim({ atIso: AT, holder: "A", nowMs: atMs + CLAIM_RELEASE_BY_MS, path: claim.path })),
    ).toBe(false);
    expect(readFileSync(claim.path, "utf8")).toBe(incidentClaimStamp({ atIso: AT, holder: "A" }));
    expect(
      unwrap(releaseIncidentClaim({ atIso: AT, holder: "A", nowMs: atMs + CLAIM_RELEASE_BY_MS - 1, path: claim.path })),
    ).toBe(true);
    expect(readdirSync(dirname(claim.path))).toEqual([]);
  });

  it("leaves a claim another sweep restamped, so a takeover is never given back", () => {
    const claim = unwrap(claimIncidentChannel({ atIso: AT, holder: "A", channelId: "C0LIVE", home }));
    unwrap(reclaimStaleIncidentClaim({ holder: "B", nowMs: Date.parse(AT) + CLAIM_STALE_MS, path: claim.path }));

    expect(unwrap(releaseIncidentClaim({ atIso: AT, holder: "A", nowMs: Date.parse(AT), path: claim.path }))).toBe(
      false,
    );
    expect(readFileSync(claim.path, "utf8")).toBe("2026-10-04T05:30:00.000Z B\n");
  });

  it("keeps a claim younger than the stale bound and restamps one at it in place, leaving no staged file", () => {
    const claim = unwrap(claimIncidentChannel({ atIso: AT, holder: "A", channelId: "C0LIVE", home }));
    const atMs = Date.parse(AT);

    expect(unwrap(reclaimStaleIncidentClaim({ holder: "B", nowMs: atMs + CLAIM_STALE_MS - 1, path: claim.path }))).toBe(
      false,
    );
    expect(readFileSync(claim.path, "utf8")).toBe(`${AT} A\n`);
    expect(unwrap(reclaimStaleIncidentClaim({ holder: "B", nowMs: atMs + CLAIM_STALE_MS, path: claim.path }))).toBe(
      true,
    );
    expect(readFileSync(claim.path, "utf8")).toBe("2026-10-04T05:30:00.000Z B\n");
    expect(statSync(claim.path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dirname(claim.path))).toEqual(["C0LIVE"]);
  });

  it("restamps a claim with no readable stamp", () => {
    const path = incidentClaimPath({ channelId: "C0LIVE", home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");

    expect(unwrap(reclaimStaleIncidentClaim({ holder: "B", nowMs: Date.parse(AT), path }))).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(`${AT} B\n`);
  });

  it("never gives back a claim another sweep stamped at the very same instant", () => {
    const path = incidentClaimPath({ channelId: "C0LIVE", home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");
    unwrap(reclaimStaleIncidentClaim({ holder: "B", nowMs: Date.parse(AT), path }));

    expect(unwrap(releaseIncidentClaim({ atIso: AT, holder: "A", nowMs: Date.parse(AT), path }))).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(`${AT} B\n`);
  });

  it("takes a claim its holder released in between afresh, and only once", () => {
    const path = incidentClaimPath({ channelId: "C0LIVE", home });
    mkdirSync(dirname(path), { recursive: true });

    expect(unwrap(reclaimStaleIncidentClaim({ holder: "B", nowMs: Date.parse(AT), path }))).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(`${AT} B\n`);
    expect(unwrap(reclaimStaleIncidentClaim({ holder: "B", nowMs: Date.parse(AT), path }))).toBe(false);
  });

  it("does not list a takeover's staged stamp as a claimed channel", () => {
    unwrap(claimIncidentChannel({ atIso: AT, holder: "A", channelId: "C0ONE", home }));
    const staged = `${incidentClaimPath({ channelId: "C0ONE", home })}.4242.0b5624f7-7150-4a33-8e94-258f0f35c614.tmp`;
    writeFileSync(staged, `${AT} B\n`);

    expect([...unwrap(claimedIncidentChannelIds({ home }))]).toEqual(["C0ONE"]);
  });

  it("refuses to reclaim what will not read", () => {
    const dir = join(home, "a-directory");
    mkdirSync(dir);

    expect(unwrapErr(reclaimStaleIncidentClaim({ holder: "B", nowMs: Date.parse(AT), path: dir })).message).toContain(
      `${dir} would not read: `,
    );
  });

  it("lists every claimed channel id, and none before anything was claimed", () => {
    expect([...unwrap(claimedIncidentChannelIds({ home }))]).toEqual([]);

    unwrap(claimIncidentChannel({ atIso: AT, holder: "A", channelId: "C0ONE", home }));
    unwrap(claimIncidentChannel({ atIso: AT, holder: "A", channelId: "C0TWO", home }));

    expect([...unwrap(claimedIncidentChannelIds({ home }))].toSorted()).toEqual(["C0ONE", "C0TWO"]);
  });

  it("refuses to list claims when the claims path is not a directory", () => {
    mkdirSync(stateHomePaths({ home }).incidents, { recursive: true });
    writeFileSync(join(stateHomePaths({ home }).incidents, "claims"), "not a directory");

    expect(unwrapErr(claimedIncidentChannelIds({ home })).message).toContain(" would not list: ");
  });

  it("refuses to release what is not a removable file", () => {
    const dir = join(home, "a-directory");
    mkdirSync(dir);

    const result = releaseIncidentClaim({ atIso: AT, holder: "A", nowMs: Date.parse(AT), path: dir });

    expect(unwrapErr(result).message).toContain(`${dir} would not remove: `);
  });
});
