import { describe, expect, it } from "vitest";
import { accountHomeSandboxNodeOptions, accountHomeSandboxTokens } from "../accountHomeSandboxChild.js";

/** The `home` a token's import URL carries, read back the way the preload reads its own `import.meta.url`. */
function carriedHome({ token }: { token: string }): readonly string[] {
  return new URL(token.slice("--import=".length)).searchParams.getAll("home");
}

describe("accountHomeSandboxNodeOptions", () => {
  it("is the one preload token when nothing was inherited", () => {
    const value = accountHomeSandboxNodeOptions({ home: "/tmp/acme/account", inherited: undefined });
    expect(value.startsWith("--import=file://")).toBe(true);
    expect(value.split(" ").length).toBe(1);
    expect(carriedHome({ token: value })).toEqual(["/tmp/acme/account"]);
  });

  it("treats a blank inherited value as absent", () => {
    const value = accountHomeSandboxNodeOptions({ home: "/tmp/acme/account", inherited: "   " });
    expect(accountHomeSandboxTokens({ value })).toEqual([value]);
  });

  it("keeps an inherited option first, so an earlier preload still runs before this one", () => {
    const value = accountHomeSandboxNodeOptions({ home: "/tmp/acme/account", inherited: "--enable-source-maps" });
    const [first, second, ...rest] = value.split(" ");
    expect(first).toBe("--enable-source-maps");
    expect(rest).toEqual([]);
    expect(carriedHome({ token: second! })).toEqual(["/tmp/acme/account"]);
  });

  it("replaces an inherited account-home preload rather than stacking a second, keeping the other options", () => {
    const earlier = accountHomeSandboxNodeOptions({ home: "/tmp/acme/old", inherited: "--enable-source-maps" });
    const value = accountHomeSandboxNodeOptions({ home: "/tmp/acme/new", inherited: earlier });
    const tokens = accountHomeSandboxTokens({ value });
    expect(tokens.map((token) => carriedHome({ token }))).toEqual([["/tmp/acme/new"]]);
    expect(value).toBe(`--enable-source-maps ${tokens[0]!}`);
  });

  it("replaces another checkout's inherited account-home preload too", () => {
    const foreign = "--import=file:///tmp/acme/snapshot/src/__tests__/accountHomeSandboxPreload.ts?home=%2Ftmp%2Fold";
    const value = accountHomeSandboxNodeOptions({ home: "/tmp/acme/new", inherited: foreign });
    expect(value.split(" ").length).toBe(1);
    expect(carriedHome({ token: value })).toEqual(["/tmp/acme/new"]);
  });

  it("encodes a space, %, + and non-ASCII so NODE_OPTIONS never splits the token and the path reads back exactly", () => {
    const home = "/tmp/acme dir/100% a+b/ü";
    const value = accountHomeSandboxNodeOptions({ home, inherited: undefined });
    expect(/\s/.test(value)).toBe(false);
    expect(carriedHome({ token: value })).toEqual([home]);
  });

  it("names the preload module beside the helper", () => {
    const value = accountHomeSandboxNodeOptions({ home: "/tmp/acme/account", inherited: undefined });
    expect(
      new URL(value.slice("--import=".length)).pathname.endsWith("/src/__tests__/accountHomeSandboxPreload.ts"),
    ).toBe(true);
  });
});

describe("accountHomeSandboxTokens", () => {
  it("finds nothing in an absent value", () => {
    expect(accountHomeSandboxTokens({ value: undefined })).toEqual([]);
  });

  it("finds nothing in a value carrying only other preloads", () => {
    expect(accountHomeSandboxTokens({ value: "--import=file:///tmp/acme/other.ts --enable-source-maps" })).toEqual([]);
  });

  it("finds every preload token, so a doubled install is visible as two", () => {
    const one = accountHomeSandboxNodeOptions({ home: "/tmp/acme/a", inherited: undefined });
    const two = accountHomeSandboxNodeOptions({ home: "/tmp/acme/b", inherited: undefined });
    expect(
      accountHomeSandboxTokens({ value: `${one} --enable-source-maps ${two}` }).map((token) => carriedHome({ token })),
    ).toEqual([["/tmp/acme/a"], ["/tmp/acme/b"]]);
  });

  it("finds another checkout's preload token too", () => {
    const foreign = "--import=file:///tmp/acme/snapshot/src/__tests__/accountHomeSandboxPreload.ts?home=%2Ftmp%2Fold";
    expect(accountHomeSandboxTokens({ value: `--enable-source-maps ${foreign}` })).toEqual([foreign]);
  });
});
