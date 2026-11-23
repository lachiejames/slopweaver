import { describe, expect, it } from "vitest";

import {
  cookieAppliesToHost,
  expiresFromChrome,
  hostOfOrigin,
  type JarCookie,
  storageStateFromJar,
} from "../../../browser/cookieScope.js";

const cookie = (over: Partial<JarCookie> = {}): JarCookie => ({
  domain: ".github.com",
  expires: -1,
  httpOnly: true,
  name: "user_session",
  path: "/",
  secure: true,
  value: "v",
  ...over,
});

describe("cookieAppliesToHost", () => {
  it("sends a host-only cookie to that host alone", () => {
    expect(cookieAppliesToHost({ host: "github.com", hostKey: "github.com" })).toBe(true);
    expect(cookieAppliesToHost({ host: "gist.github.com", hostKey: "github.com" })).toBe(false);
  });

  it("sends a domain cookie to the bare domain and to a subdomain", () => {
    expect(cookieAppliesToHost({ host: "github.com", hostKey: ".github.com" })).toBe(true);
    expect(cookieAppliesToHost({ host: "gist.github.com", hostKey: ".github.com" })).toBe(true);
  });

  it("does not treat a suffix collision as the same site", () => {
    expect(cookieAppliesToHost({ host: "notgithub.com", hostKey: ".github.com" })).toBe(false);
    expect(cookieAppliesToHost({ host: "github.com.example.invalid", hostKey: "github.com" })).toBe(false);
  });

  it("matches case-insensitively, because a jar row is not normalised", () => {
    expect(cookieAppliesToHost({ host: "GitHub.com", hostKey: ".GITHUB.COM" })).toBe(true);
  });
});

describe("hostOfOrigin", () => {
  it("reads the hostname of an absolute origin", () => {
    expect(hostOfOrigin({ origin: "https://github.com" })).toBe("github.com");
  });

  it("lowercases it", () => {
    expect(hostOfOrigin({ origin: "https://GitHub.COM/x" })).toBe("github.com");
  });

  it("answers undefined for a value that is not an absolute URL", () => {
    expect(hostOfOrigin({ origin: "github.com" })).toBe(undefined);
    expect(hostOfOrigin({ origin: "" })).toBe(undefined);
  });
});

describe("expiresFromChrome", () => {
  it("converts Chrome's 1601-epoch microseconds to epoch seconds", () => {
    // A real row's value, read off this machine's own jar. 13459480961651281 µs since 1601-01-01 is epoch
    // second 1815007361; reproduce with `slopweaver browser cookies --origin https://github.com --json`.
    expect(expiresFromChrome({ expiresUtc: 13459480961651281n })).toBe(1815007361);
  });

  it("reports a session cookie as -1 rather than as the year 1601", () => {
    expect(expiresFromChrome({ expiresUtc: 0n })).toBe(-1);
  });

  it("accepts a plain number as well as a bigint, because a column is what it is at runtime", () => {
    expect(expiresFromChrome({ expiresUtc: 0 })).toBe(-1);
  });

  it("reports an unreadable value as a session cookie rather than inventing an instant", () => {
    expect(expiresFromChrome({ expiresUtc: "nonsense" })).toBe(-1);
    expect(expiresFromChrome({ expiresUtc: undefined })).toBe(-1);
  });
});

describe("storageStateFromJar", () => {
  it("renders the document every reader in webSessionCookies.ts already parses", () => {
    const parsed: unknown = JSON.parse(storageStateFromJar({ cookies: [cookie()] }));
    expect(parsed).toEqual({
      cookies: [
        {
          domain: ".github.com",
          expires: -1,
          httpOnly: true,
          name: "user_session",
          path: "/",
          sameSite: "Lax",
          secure: true,
          value: "v",
        },
      ],
      origins: [],
    });
  });

  it("renders an empty jar as an empty document rather than as a failure", () => {
    expect(JSON.parse(storageStateFromJar({ cookies: [] }))).toEqual({ cookies: [], origins: [] });
  });
});
