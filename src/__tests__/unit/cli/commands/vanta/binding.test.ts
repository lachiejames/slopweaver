/**
 * The Vanta binding: credentials resolved first, and only then ONE transport built and handed to the token
 * provider together with the same credentials and home. Both factories are plain fakes recording what they
 * were given, so nothing mints a token or reaches the network; the home is an empty temp directory, so the
 * secrets-store route finds nothing and the explicit `env` is the only credential source.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { vantaCredentialErrorsLines } from "../../../../../atlas/vanta/credentialErrors.js";
import type { VantaCredentials } from "../../../../../atlas/vanta/credentials.js";
import type { VantaTokenProvider } from "../../../../../atlas/vanta/oauth.js";
import type { VantaTransport } from "../../../../../atlas/vanta/transport.js";
import { bindVanta } from "../../../../../cli/commands/vanta/binding.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "vanta-binding-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Fake factories that record each call and hand back fixed, recognisable values. */
function recordingFactories(): {
  transport: VantaTransport;
  tokenProvider: VantaTokenProvider;
  transportCalls: number[];
  providerCalls: { credentials: VantaCredentials; home: string; transport: VantaTransport }[];
  createTransport: () => VantaTransport;
  createTokenProvider: (args: {
    credentials: VantaCredentials;
    home: string;
    transport: VantaTransport;
  }) => VantaTokenProvider;
} {
  const transport: VantaTransport = { request: async () => err(["the fake transport is never asked"]) };
  const tokenProvider: VantaTokenProvider = { getToken: async () => ok("fake-token") };
  const transportCalls: number[] = [];
  const providerCalls: { credentials: VantaCredentials; home: string; transport: VantaTransport }[] = [];
  return {
    createTokenProvider: (args) => {
      providerCalls.push({ credentials: args.credentials, home: args.home, transport: args.transport });
      return tokenProvider;
    },
    createTransport: () => {
      transportCalls.push(transportCalls.length + 1);
      return transport;
    },
    providerCalls,
    tokenProvider,
    transport,
    transportCalls,
  };
}

describe("bindVanta", () => {
  it("binds one transport and a token provider built on that same transport, the credentials and the home", () => {
    const fakes = recordingFactories();

    const result = bindVanta({
      clientIdFile: null,
      clientSecretFile: null,
      createTokenProvider: fakes.createTokenProvider,
      createTransport: fakes.createTransport,
      env: { VANTA_CLIENT_ID: "client-id-1", VANTA_CLIENT_SECRET: "client-secret-1" },
      home,
    });

    expect(result.isOk()).toBe(true);
    const binding = unwrap(result);
    expect(binding.transport).toBe(fakes.transport);
    expect(binding.tokenProvider).toBe(fakes.tokenProvider);
    expect(fakes.transportCalls).toEqual([1]);
    expect(fakes.providerCalls).toEqual([
      { credentials: { clientId: "client-id-1", clientSecret: "client-secret-1" }, home, transport: fakes.transport },
    ]);
    expect(fakes.providerCalls[0]!.transport).toBe(fakes.transport);
  });

  it("returns the resolver's reasons and builds neither a transport nor a token provider without credentials", () => {
    const fakes = recordingFactories();

    const result = bindVanta({
      clientIdFile: null,
      clientSecretFile: null,
      createTokenProvider: fakes.createTokenProvider,
      createTransport: fakes.createTransport,
      env: {},
      home,
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).map((error) => error.code)).toEqual(["CREDENTIAL_UNSET", "CREDENTIAL_UNSET"]);
    expect(vantaCredentialErrorsLines({ errors: unwrapErr(result) })).toEqual([
      "VANTA_CLIENT_ID is not set — export it, or run: slopweaver secrets set vanta-client-id (Settings → Developer Console → your Manage Vanta application)",
      "VANTA_CLIENT_SECRET is not set — export it, or run: slopweaver secrets set vanta-client-secret (Settings → Developer Console → your Manage Vanta application)",
    ]);
    expect(fakes.transportCalls).toEqual([]);
    expect(fakes.providerCalls).toEqual([]);
  });

  it("refuses a lone credential file as unpaired, before building anything", () => {
    const fakes = recordingFactories();

    const result = bindVanta({
      clientIdFile: join(home, "client-id"),
      clientSecretFile: null,
      createTokenProvider: fakes.createTokenProvider,
      createTransport: fakes.createTransport,
      env: { VANTA_CLIENT_ID: "client-id-1", VANTA_CLIENT_SECRET: "client-secret-1" },
      home,
    });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).map((error) => error.code)).toEqual(["CREDENTIAL_FILES_UNPAIRED"]);
    expect(vantaCredentialErrorsLines({ errors: unwrapErr(result) })).toEqual([
      "--client-id-file and --client-secret-file must be supplied together",
    ]);
    expect(fakes.transportCalls).toEqual([]);
    expect(fakes.providerCalls).toEqual([]);
  });
});
