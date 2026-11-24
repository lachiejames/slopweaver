import { describe, expect, it } from "vitest";

import { toolCachesUnder } from "../../../../../cli/commands/github/lapShell.js";
import { publishedPort, storeRemovalArgs, storeUrls } from "../../../../../cli/commands/github/lapStore.js";

describe("toolCachesUnder", () => {
  it("points a lane at each download cache present under the real home, and at nothing absent", () => {
    const present = new Set(["/h/.proto", "/h/.yarn/berry", "/h/Library/Caches/electron"]);
    expect(toolCachesUnder({ exists: (path) => present.has(path), osHome: "/h" })).toEqual({
      PROTO_HOME: "/h/.proto",
      YARN_GLOBAL_FOLDER: "/h/.yarn/berry",
      electron_config_cache: "/h/Library/Caches/electron",
    });
  });
});

describe("publishedPort", () => {
  it("reads the host port from docker's first line, ignoring an IPv6 line after it", () => {
    expect(publishedPort({ output: "127.0.0.1:55012\n[::1]:55013" })).toBe("55012");
  });

  it("answers undefined when no line names a port", () => {
    expect(publishedPort({ output: "" })).toBe(undefined);
  });
});

describe("storeRemovalArgs", () => {
  it("force-removes the store together with its anonymous volume", () => {
    expect(storeRemovalArgs({ id: "lap-store-id" })).toEqual(["rm", "-f", "-v", "lap-store-id"]);
  });
});

describe("storeUrls", () => {
  it("points every store-backed lane at the one throwaway server on its port", () => {
    expect(storeUrls({ port: "55012" })).toEqual({
      DESKTOP_E2E_STORE_ADMIN_URL: "postgresql://postgres:postgres@127.0.0.1:55012/postgres",
      DOOR_LEDGER_STORE_PROOF_URL: "postgresql://postgres:postgres@127.0.0.1:55012/door_ledger_proof",
      PROFILE_STEERS_PROOF_ADMIN_URL: "postgresql://postgres:postgres@127.0.0.1:55012/postgres",
      STORE_PROOF_ADMIN_URL: "postgresql://postgres:postgres@127.0.0.1:55012/postgres",
    });
  });
});
