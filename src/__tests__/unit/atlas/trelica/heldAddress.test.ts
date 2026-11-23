import { describe, expect, it } from "vitest";

import { TRELICA_SHELL_TITLE, TRELICA_UNDECLARED_PATH } from "../../../../atlas/trelica/browserPages.js";
import {
  isTrelicaSignInLanding,
  parseTrelicaAddress,
  trelicaHeldFinalUrl,
  trelicaHeldTitle,
} from "../../../../atlas/trelica/heldAddress.js";
import { TRELICA_PROVIDER_TEXT_WITHHELD } from "../../../../atlas/trelica/providerText.js";

const TENANT = "https://team-example.trelica.app";

describe("parseTrelicaAddress", () => {
  it("parses an address", () => {
    expect(parseTrelicaAddress({ url: `${TENANT}/Catalog` })!.pathname).toBe("/Catalog");
  });

  it("answers null for a string that is not one", () => {
    expect(parseTrelicaAddress({ url: "not a url" })).toBe(null);
  });
});

describe("isTrelicaSignInLanding", () => {
  it("recognises the vendor's shared sign-in origin", () => {
    expect(isTrelicaSignInLanding({ finalUrl: "https://app.trelica.com/Account/Login?ReturnUrl=%2F" })).toBe(true);
  });

  it.each([`${TENANT}/Account/Login?ReturnUrl=%2F`, `${TENANT}/account/LOGIN?ReturnUrl=%2F`])(
    "recognises the tenant's own sign-in path at %s",
    (finalUrl) => {
      expect(isTrelicaSignInLanding({ finalUrl })).toBe(true);
    },
  );

  it.each([
    `${TENANT}/Catalog`,
    `${TENANT}/Account/Login/Callback`,
    `${TENANT}/Account/LoginExtra`,
    "https://evil.team-example.trelica.app/Account/Login",
    "http://team-example.trelica.app/Account/Login",
    "https://example.com/Account/Login",
    "not a url",
  ])("does not read %s as a sign-in page", (finalUrl) => {
    expect(isTrelicaSignInLanding({ finalUrl })).toBe(false);
  });
});

describe("trelicaHeldFinalUrl", () => {
  it("holds a tenant sign-in landing as its fixed path, never the return address the client wrote", () => {
    expect(
      trelicaHeldFinalUrl({ finalUrl: `${TENANT}/Account/Login?ReturnUrl=%2FAdmin%2Fhunter2`, tenantOrigin: TENANT }),
    ).toBe(`${TENANT}/Account/Login`);
  });

  it("holds the vendor's sign-in origin alone", () => {
    expect(
      trelicaHeldFinalUrl({ finalUrl: "https://app.trelica.com/Account/Login?ReturnUrl=%2Fx", tenantOrigin: TENANT }),
    ).toBe("https://app.trelica.com");
  });

  it("holds a foreign origin as a fixed marker", () => {
    expect(trelicaHeldFinalUrl({ finalUrl: "https://example.com/secret", tenantOrigin: TENANT })).toBe(
      "an origin that is not the tenant's own",
    );
  });

  it("holds an unreadable address as a fixed marker", () => {
    expect(trelicaHeldFinalUrl({ finalUrl: "not a url", tenantOrigin: TENANT })).toBe(
      "an address the walk could not read",
    );
  });

  it("holds an undeclared tenant path as the undeclared marker", () => {
    expect(trelicaHeldFinalUrl({ finalUrl: `${TENANT}/Runs/abc-123`, tenantOrigin: TENANT })).toBe(
      TRELICA_UNDECLARED_PATH,
    );
  });
});

describe("trelicaHeldTitle", () => {
  it("holds the bare product title as written, trimmed", () => {
    expect(trelicaHeldTitle({ title: ` ${TRELICA_SHELL_TITLE} ` })).toBe(TRELICA_SHELL_TITLE);
  });

  it("withholds any other title", () => {
    expect(trelicaHeldTitle({ title: "Error: run abc-123 failed" })).toBe(TRELICA_PROVIDER_TEXT_WITHHELD);
  });
});
