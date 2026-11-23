/**
 * The drift gate between what an atlas DECLARES and what the guard ENFORCES.
 *
 * The rule: no atlas or integration may be undoored, the right policy is enforced by default, and it must not
 * be possible to add something with no policy. The required `writePolicy` field on
 * `atlasDescriptorSchema` makes the omission impossible; this file makes the LIE impossible — a descriptor
 * may not claim `read-before-write` unless `WRITE_POLICY_REGISTER` actually grants it, because the register
 * is the only list the hook reads and a declaration nothing checks is exactly the "silently proceed" the
 * rule forbids.
 *
 * It DISCOVERS the atlases by walking every directory under `src/atlas` that ships a `descriptor.ts` and importing each module, rather than
 * importing a hand-written list, and that is the point rather than a shortcut: a list would itself need
 * maintaining, so a new atlas could be added and simply not be checked. A directory on disk cannot hide
 * from a glob. It imports rather than text-scrapes because a descriptor spells its `platform` as a shared
 * constant (`VANTA_ATLAS_PLATFORM`), which a regex reads as an empty string and would then pass vacuously —
 * measured while writing this file.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  classifyBrowserUrl,
  registeredWritePlatforms,
  UNREGISTERED_WRITE_POLICY,
} from "../../../admit/browserSurface.js";
import { ATLAS_WRITE_POLICIES } from "../../../atlas/kit/contract.js";
import { isRecord } from "../../../lib/parsers.js";

/** Where the per-platform atlas modules live, relative to the repository root. */
const ATLAS_DIR = "src/atlas";

/** One descriptor's two declared facts, read off the real object. */
interface DeclaredAtlas {
  readonly dir: string;
  readonly platform: string;
  readonly writePolicy: string;
}

/** Every directory under `src/atlas` that ships a `descriptor.ts`. */
function atlasDirs(): readonly string[] {
  return readdirSync(ATLAS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(ATLAS_DIR, entry.name, "descriptor.ts")))
    .map((entry) => entry.name);
}

/**
 * Import every atlas descriptor and read its declared platform and write policy.
 *
 * @returns one entry per descriptor module found, in directory order
 */
async function declaredAtlases(): Promise<readonly DeclaredAtlas[]> {
  const found: DeclaredAtlas[] = [];
  for (const dir of atlasDirs()) {
    // `@vite-ignore` because the specifier is computed: vite refuses to analyse a fully variable import,
    // and the whole point here is that the list is discovered rather than written down.
    const module: Record<string, unknown> = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ATLAS_DIR, dir, "descriptor.ts")).href
    );
    for (const value of Object.values(module)) {
      if (!isRecord(value) || typeof value["writePolicy"] !== "string" || typeof value["platform"] !== "string") {
        continue;
      }
      found.push({ dir, platform: value["platform"], writePolicy: value["writePolicy"] });
      break;
    }
  }
  return found;
}

/** Lowercased register names, for comparison with a descriptor's own `platform` slug. */
function registeredSlugs(): readonly string[] {
  return registeredWritePlatforms().map((name) => name.toLowerCase());
}

describe("every atlas declares a write policy", () => {
  it("finds the atlases (a glob that matched nothing would pass every test below vacuously)", async () => {
    expect((await declaredAtlases()).length).toBeGreaterThan(20);
  });

  it("declares a policy on every descriptor, spelled as one of the two the enum allows", async () => {
    const bad = (await declaredAtlases()).filter((a) => !ATLAS_WRITE_POLICIES.some((p) => p === a.writePolicy));
    expect(bad.map((a) => a.dir)).toEqual([]);
  });

  it("names a platform on every descriptor", async () => {
    expect((await declaredAtlases()).filter((a) => a.platform === "").map((a) => a.dir)).toEqual([]);
  });
});

describe("a declared write policy is backed by the register the guard actually reads", () => {
  it("carries exactly the platforms the owner named, JumpCloud last and refusing", () => {
    expect(registeredWritePlatforms()).toEqual([
      "Slack",
      "GitHub",
      "Linear",
      "Notion",
      "Vanta",
      "Datadog",
      "JumpCloud",
    ]);
  });

  it("lets no descriptor claim read-before-write that the register does not grant", async () => {
    const slugs = registeredSlugs();
    const claiming = (await declaredAtlases()).filter((a) => a.writePolicy === "read-before-write");
    const unbacked = claiming.filter((a) => !slugs.includes(a.platform.toLowerCase()));
    expect(unbacked.map((a) => `${a.dir} (platform ${a.platform})`)).toEqual([]);
  });

  it("has every read-before-write atlas name a platform the register carries", async () => {
    const claiming = (await declaredAtlases())
      .filter((a) => a.writePolicy === "read-before-write")
      .map((a) => a.platform)
      .toSorted();
    expect(claiming).toEqual(["datadog", "github", "linear", "notion", "slack", "vanta"]);
  });
});

describe("the unregistered default", () => {
  it("refuses every write, which is the whole of the default-refusal rule", () => {
    expect(UNREGISTERED_WRITE_POLICY).toBe("refuse-every-write");
  });

  it("leaves the platforms the owner named as unwritable unregistered, so they inherit that default", () => {
    expect(classifyBrowserUrl({ url: "https://admin.google.com/ac/orgunits" })).toBe(undefined);
    expect(classifyBrowserUrl({ url: "https://console.twilio.com/us1/account" })).toBe(undefined);
    expect(classifyBrowserUrl({ url: "https://falcon.us-2.crowdstrike.com/hosts" })).toBe(undefined);
  });

  it("names JumpCloud instead of leaving it to the default, so its refusal names it", () => {
    expect(classifyBrowserUrl({ url: "https://console.jumpcloud.com/#/users" })?.policy).toBe("refuse-every-write");
  });

  it("registers Datadog with a policy and no door, so a write is judged and a read is not gated", () => {
    const datadog = classifyBrowserUrl({ url: "https://app.datadoghq.com/monitors/12345" })!;
    expect(datadog.provider).toBe("Datadog");
    expect(datadog.policy).toBe("read-before-write");
    expect(datadog.door).toBe(null);
  });

  it("keeps a door on every platform whose web client a verb replaces", () => {
    expect(classifyBrowserUrl({ url: "https://app.slack.com/client/T0/C0" })!.door).toBe(
      "slopweaver slack read-thread / slack post / slack as-me",
    );
  });
});
