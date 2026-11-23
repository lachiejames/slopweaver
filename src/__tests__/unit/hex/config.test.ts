import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { hexApiOrigin, resolveHexConfig } from "../../../hex/config.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

let home: string | null = null;

/** A throwaway state home with a `secrets/` directory, removed after each case. */
function tempHome({ token }: { token: string | null }): string {
  const root = mkdtempSync(join(tmpdir(), "hex-config-"));
  mkdirSync(join(root, "secrets"), { recursive: true });
  if (token !== null) {
    writeFileSync(join(root, "secrets", "hex-api-token"), token, "utf8");
  }
  home = root;
  return root;
}

afterEach(() => {
  if (home !== null) {
    rmSync(home, { force: true, recursive: true });
    home = null;
  }
});

describe("hexApiOrigin", () => {
  it("is the one host the pinned document declares", () => {
    expect(hexApiOrigin()).toBe("https://app.hex.tech/api");
  });
});

describe("resolveHexConfig", () => {
  it("takes HEX_API_TOKEN from the environment ahead of the file", () => {
    const root = tempHome({ token: "from-file" });
    const config = resolveHexConfig({ env: { HEX_API_TOKEN: "from-env" }, home: root });
    expect(config.isOk()).toBe(true);
    expect(unwrap(config).token).toBe("from-env");
  });

  it("falls back to the secret file when the environment carries nothing", () => {
    const root = tempHome({ token: "from-file" });
    const config = resolveHexConfig({ env: {}, home: root });
    expect(config.isOk()).toBe(true);
    expect(unwrap(config).token).toBe("from-file");
  });

  it("pins the origin rather than taking one from the caller", () => {
    const root = tempHome({ token: "t" });
    expect(unwrap(resolveHexConfig({ env: {}, home: root })).apiOrigin).toBe("https://app.hex.tech/api");
  });

  it("refuses TOKEN_MISSING with the mint line when neither source holds one", () => {
    const root = tempHome({ token: null });
    const config = resolveHexConfig({ env: {}, home: root });
    expect(config.isErr()).toBe(true);
    expect(unwrapErr(config).code).toBe("TOKEN_MISSING");
    expect(unwrapErr(config).message).toContain("slopweaver secrets set hex-api-token");
  });

  it("treats a blank secret file as no token at all", () => {
    const root = tempHome({ token: "   \n" });
    const config = resolveHexConfig({ env: {}, home: root });
    expect(config.isErr()).toBe(true);
    expect(unwrapErr(config).code).toBe("TOKEN_MISSING");
  });
});
