/**
 * The store's Storage API SELECTION, read off the running local stack, and the two pure halves of its client:
 * a body that does not hash to its key is refused, and a failure is typed whether the SDK returned it or threw it.
 *
 * The selection reads one `docker context inspect` and two `docker inspect` answers and nothing else — no secret
 * file, no environment — so each docker read here is a plain fake function, and every value a parser sees is
 * synthetic.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { objectFailure, verifiedBytes, withoutServiceKey } from "../../../store/objects/client.js";
import { ObjectStoreErrors } from "../../../store/objects/errors.js";
import {
  type DockerContextEndpoint,
  type DockerInspect,
  storeObjectsSelection,
} from "../../../store/objects/selection.js";
import {
  envProxyOff,
  GATEWAY_INSPECT_FORMAT,
  inspectFailureReason,
  localDockerEnv,
  localDockerHost,
  STORAGE_INSPECT_FORMAT,
  serviceKeyFromInspect,
  storageApiUrlFromInspect,
} from "../../../store/objects/selectionCore.js";

const GATEWAY = "supabase_kong_slopweaver";
const STORAGE = "supabase_storage_slopweaver";
const SENTINEL_KEY = "eyJGSVhUVVJF.FIXTURE-service-key.FIXTURE_sentinel";
const LOCAL_HOST = "unix:///Users/fixture/.docker/run/docker.sock";

/** What the gateway template prints for the given bindings of `8000/tcp`. */
function gatewayText({
  bindings,
  running = true,
}: {
  bindings: readonly { HostIp: string; HostPort: string }[] | null;
  running?: boolean;
}): string {
  return JSON.stringify({ ports: { "8000/tcp": bindings }, running });
}

/** What the Storage template prints for the given settings list. */
function storageText({ env, running = true }: { env: readonly string[] | null; running?: boolean }): string {
  return JSON.stringify({ env, running });
}

describe("storageApiUrlFromInspect", () => {
  it("builds an IPv4 loopback URL, preferring it over ::1", () => {
    const text = gatewayText({
      bindings: [
        { HostIp: "127.0.0.1", HostPort: "54321" },
        { HostIp: "::1", HostPort: "54321" },
      ],
    });

    expect(unwrap(storageApiUrlFromInspect({ container: GATEWAY, text }))).toBe("http://127.0.0.1:54321");
  });

  it("brackets ::1 when it is the only loopback binding", () => {
    const text = gatewayText({ bindings: [{ HostIp: "::1", HostPort: "54321" }] });

    expect(unwrap(storageApiUrlFromInspect({ container: GATEWAY, text }))).toBe("http://[::1]:54321");
  });

  it("refuses a binding on every interface, naming it once", () => {
    const text = gatewayText({
      bindings: [
        { HostIp: "127.0.0.1", HostPort: "54321" },
        { HostIp: "0.0.0.0", HostPort: "54321" },
        { HostIp: "::", HostPort: "54321" },
      ],
    });

    expect(unwrapErr(storageApiUrlFromInspect({ container: GATEWAY, text }))).toEqual(
      ObjectStoreErrors.apiPortExposed({ container: GATEWAY, hostIps: ["every interface"] }),
    );
  });

  it("refuses a LAN address and an empty HostIp by kind, never quoting the address", () => {
    const text = gatewayText({
      bindings: [
        { HostIp: "192.168.1.20", HostPort: "54321" },
        { HostIp: "", HostPort: "54321" },
      ],
    });
    const error = unwrapErr(storageApiUrlFromInspect({ container: GATEWAY, text }));

    expect(text).toContain("192.168.1.20");
    expect(error).toEqual(
      ObjectStoreErrors.apiPortExposed({ container: GATEWAY, hostIps: ["a non-loopback address", "every interface"] }),
    );
    expect(error.message).not.toContain("192.168.1.20");
  });

  it("calls an absent, null or empty publication unpublished", () => {
    const absent = JSON.stringify({ ports: {}, running: true });
    const nullPorts = JSON.stringify({ ports: null, running: true });

    const texts = [absent, nullPorts, gatewayText({ bindings: null }), gatewayText({ bindings: [] })];

    expect(texts.map((text) => unwrapErr(storageApiUrlFromInspect({ container: GATEWAY, text })))).toEqual(
      texts.map(() => ObjectStoreErrors.apiPortUnpublished({ container: GATEWAY })),
    );
  });

  it("calls a stopped gateway, a bad port or non-JSON unreadable", () => {
    const cases = [
      { reason: "the container is stopped", text: gatewayText({ bindings: [], running: false }) },
      {
        reason: "it publishes 8000/tcp on no single valid host port",
        text: gatewayText({ bindings: [{ HostIp: "127.0.0.1", HostPort: "70000" }] }),
      },
      {
        reason: "it publishes 8000/tcp on no single valid host port",
        text: gatewayText({ bindings: [{ HostIp: "127.0.0.1", HostPort: "abc" }] }),
      },
      { reason: "docker printed something that is not JSON", text: "<no value>" },
      { reason: "its metadata is not the shape docker prints", text: JSON.stringify({ running: "yes" }) },
    ];

    expect(cases.map(({ text }) => unwrapErr(storageApiUrlFromInspect({ container: GATEWAY, text })))).toEqual(
      cases.map(({ reason }) => ObjectStoreErrors.stackUnreadable({ container: GATEWAY, reason })),
    );
  });
});

describe("serviceKeyFromInspect", () => {
  it("keeps the whole value after the first =", () => {
    const text = storageText({ env: ["ANON_KEY=anon", `SERVICE_KEY=${SENTINEL_KEY}`] });

    expect(unwrap(serviceKeyFromInspect({ container: STORAGE, text }))).toBe(SENTINEL_KEY);
  });

  it("refuses a key no HTTP header can carry, quoting none of it", () => {
    const keys = [
      `abc\n${SENTINEL_KEY}`,
      `abc ${SENTINEL_KEY}`,
      `abc\u0000${SENTINEL_KEY}`,
      `abcé${SENTINEL_KEY}`,
      ` ${SENTINEL_KEY} `,
    ];
    const failures = keys.map((key) =>
      unwrapErr(serviceKeyFromInspect({ container: STORAGE, text: storageText({ env: [`SERVICE_KEY=${key}`] }) })),
    );

    expect(failures).toEqual(
      keys.map(() =>
        ObjectStoreErrors.stackUnreadable({
          container: STORAGE,
          reason: "its SERVICE_KEY setting holds a character an HTTP header cannot carry",
        }),
      ),
    );
    expect(keys.every((key) => key.includes(SENTINEL_KEY))).toBe(true);
    expect(failures.filter((failure) => failure.message.includes(SENTINEL_KEY))).toEqual([]);
  });

  it("refuses a key too short to be a service key, quoting none of it, and accepts one at the floor", () => {
    const short = "eyJ.FIXTURE.abcdefg"; // 19 characters
    const atFloor = "eyJ.FIXTURE.abcdefgh"; // 20 characters

    const refused = unwrapErr(
      serviceKeyFromInspect({ container: STORAGE, text: storageText({ env: [`SERVICE_KEY=${short}`] }) }),
    );
    const accepted = serviceKeyFromInspect({
      container: STORAGE,
      text: storageText({ env: [`SERVICE_KEY=${atFloor}`] }),
    });

    expect([short.length, atFloor.length]).toEqual([19, 20]);
    expect(refused).toEqual(
      ObjectStoreErrors.stackUnreadable({
        container: STORAGE,
        reason: "its SERVICE_KEY setting is shorter than 20 characters, too short to be a service key",
      }),
    );
    expect(refused.message.includes(short)).toBe(false);
    expect(unwrap(accepted)).toBe(atFloor);
  });

  it("refuses a key not shaped like the CLI's signed token — an error code, a word, a hex digest — quoting none", () => {
    const keys = ["OBJECT_REQUEST_FAILED", "redacted-redacted-redacted", "a".repeat(64), "eyJonly.one-dot-here"];

    const refused = keys.map((key) =>
      unwrapErr(serviceKeyFromInspect({ container: STORAGE, text: storageText({ env: [`SERVICE_KEY=${key}`] }) })),
    );

    expect(refused).toEqual(
      keys.map(() =>
        ObjectStoreErrors.stackUnreadable({
          container: STORAGE,
          reason: "its SERVICE_KEY setting is not shaped like the signed token the Supabase CLI issues",
        }),
      ),
    );
    expect(refused.filter((failure, index) => failure.message.includes(keys[index]!))).toEqual([]);
  });

  it("names SERVICE_KEY when it is absent or empty", () => {
    const envs = [["ANON_KEY=anon"], ["SERVICE_KEY="], null];

    expect(
      envs.map((env) => unwrapErr(serviceKeyFromInspect({ container: STORAGE, text: storageText({ env }) }))),
    ).toEqual(envs.map(() => ObjectStoreErrors.serviceKeyMissing({ container: STORAGE })));
  });

  it("refuses two SERVICE_KEY settings without quoting either", () => {
    const text = storageText({ env: [`SERVICE_KEY=${SENTINEL_KEY}`, "SERVICE_KEY=other"] });
    const error = unwrapErr(serviceKeyFromInspect({ container: STORAGE, text }));

    expect(error.code).toBe("OBJECTS_STACK_UNREADABLE");
    expect(text).toContain(SENTINEL_KEY);
    expect(error.message).not.toContain(SENTINEL_KEY);
  });

  it("refuses a malformed settings list without quoting it", () => {
    const text = JSON.stringify({ env: `SERVICE_KEY=${SENTINEL_KEY}`, running: true });
    const error = unwrapErr(serviceKeyFromInspect({ container: STORAGE, text }));

    expect(error).toEqual(
      ObjectStoreErrors.stackUnreadable({ container: STORAGE, reason: "its metadata is not the shape docker prints" }),
    );
    expect(text).toContain(SENTINEL_KEY);
    expect(error.message).not.toContain(SENTINEL_KEY);
  });

  it("refuses a stopped Storage container", () => {
    const text = storageText({ env: [`SERVICE_KEY=${SENTINEL_KEY}`], running: false });

    expect(unwrapErr(serviceKeyFromInspect({ container: STORAGE, text }))).toEqual(
      ObjectStoreErrors.stackUnreadable({ container: STORAGE, reason: "the container is stopped" }),
    );
  });
});

describe("localDockerEnv", () => {
  it("drops every variable that aims docker at another daemon and keeps the rest", () => {
    const env = {
      DOCKER_CERT_PATH: "/certs",
      DOCKER_CONTEXT: "remote",
      DOCKER_HOST: "tcp://192.168.1.50:2375",
      DOCKER_TLS_VERIFY: "1",
      HOME: "/Users/fixture",
      PATH: "/usr/bin",
      UNSET: undefined,
    };

    expect(localDockerEnv({ env })).toEqual({ HOME: "/Users/fixture", PATH: "/usr/bin" });
  });
});

describe("inspectFailureReason", () => {
  it("names the two common failures and otherwise only the exit status", () => {
    const cases = [
      { status: 1, stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock." },
      { status: 1, stderr: "Error: No such object: supabase_storage_slopweaver" },
      { status: 125, stderr: "something new" },
      { status: null, stderr: "" },
    ];

    expect(cases.map((input) => inspectFailureReason(input))).toEqual([
      "the docker daemon is not running",
      "no such container",
      "docker inspect exited 125",
      "docker inspect was ended by a signal",
    ]);
  });

  it("never copies stderr, even when stderr carries the settings list", () => {
    const stderr = storageText({ env: [`SERVICE_KEY=${SENTINEL_KEY}`] });
    const reason = inspectFailureReason({ status: 1, stderr });

    expect(stderr).toContain(SENTINEL_KEY);
    expect(reason).toBe("docker inspect exited 1");
  });
});

describe("localDockerHost", () => {
  it("accepts a Unix socket endpoint", () => {
    expect(unwrap(localDockerHost({ text: JSON.stringify(LOCAL_HOST) }))).toBe(LOCAL_HOST);
  });

  it("refuses every other endpoint, naming only its scheme", () => {
    const hosts = ["tcp://192.168.1.50:2375", "ssh://fixture@build-box", "npipe:////./pipe/docker_engine", "unix://"];

    expect(hosts.map((host) => unwrapErr(localDockerHost({ text: JSON.stringify(host) })))).toEqual([
      ObjectStoreErrors.dockerNotLocal({ scheme: "tcp" }),
      ObjectStoreErrors.dockerNotLocal({ scheme: "ssh" }),
      ObjectStoreErrors.dockerNotLocal({ scheme: "npipe" }),
      ObjectStoreErrors.dockerNotLocal({ scheme: "unix" }),
    ]);
  });

  it("never quotes the remote address", () => {
    const message = unwrapErr(localDockerHost({ text: JSON.stringify("tcp://192.168.1.50:2375") })).message;

    expect(message).not.toContain("192.168.1.50");
    expect(message).toContain("over tcp");
  });

  it("names an unknown scheme as unrecognised, so an address hidden in it is never echoed", () => {
    const hosts = ["tcp+10.20.30.40://daemon", "daemon.internal:2375"];

    expect(hosts.map((host) => unwrapErr(localDockerHost({ text: JSON.stringify(host) })))).toEqual([
      ObjectStoreErrors.dockerNotLocal({ scheme: "an unrecognised scheme" }),
      ObjectStoreErrors.dockerNotLocal({ scheme: "an unrecognised scheme" }),
    ]);
  });

  it("refuses an answer that is not an endpoint string", () => {
    expect(unwrapErr(localDockerHost({ text: "<no value>" }))).toEqual(
      ObjectStoreErrors.dockerEndpointUnreadable({ reason: "the active context names no endpoint" }),
    );
  });
});

describe("envProxyOff", () => {
  const PROXY = { HTTPS_PROXY: "http://192.0.2.7:3128" };

  it("names whichever switch turns Node's environment proxy on while a proxy is set", () => {
    const cases = [
      { env: { ...PROXY, NODE_USE_ENV_PROXY: "1" }, execArgv: [], switchedOnBy: "NODE_USE_ENV_PROXY" },
      {
        env: { ...PROXY, NODE_OPTIONS: "--enable-source-maps --use-env-proxy" },
        execArgv: [],
        switchedOnBy: "NODE_OPTIONS",
      },
      { env: PROXY, execArgv: ["--use-env-proxy"], switchedOnBy: "--use-env-proxy" },
      { env: { ...PROXY, NODE_OPTIONS: "--use-env-proxy=true" }, execArgv: [], switchedOnBy: "NODE_OPTIONS" },
      { env: { ...PROXY, NODE_OPTIONS: "--use_env_proxy" }, execArgv: [], switchedOnBy: "NODE_OPTIONS" },
      { env: PROXY, execArgv: ["--use-env-proxy=1"], switchedOnBy: "--use-env-proxy" },
      { env: PROXY, execArgv: ["--use_env_proxy=yes"], switchedOnBy: "--use-env-proxy" },
      { env: { ...PROXY, NODE_OPTIONS: "--use-env-proxy=false" }, execArgv: [], switchedOnBy: "NODE_OPTIONS" },
      { env: PROXY, execArgv: ["--use-env-proxy=FALSE"], switchedOnBy: "--use-env-proxy" },
      { env: { ...PROXY, NODE_OPTIONS: '"--use-env-proxy"' }, execArgv: [], switchedOnBy: "NODE_OPTIONS" },
      { env: { ...PROXY, NODE_OPTIONS: "'--use-env-proxy'" }, execArgv: [], switchedOnBy: "NODE_OPTIONS" },
      { env: { ...PROXY, NODE_OPTIONS: '"--use-env-pro\\xy"' }, execArgv: [], switchedOnBy: "NODE_OPTIONS" },
      { env: { ...PROXY, NODE_OPTIONS: '--a "b" --use"-env-"proxy' }, execArgv: [], switchedOnBy: "NODE_OPTIONS" },
      { env: { ...PROXY, NODE_OPTIONS: "--use-env-proxy-other" }, execArgv: [], switchedOnBy: "NODE_OPTIONS" },
    ];

    expect(cases.map(({ env, execArgv }) => unwrapErr(envProxyOff({ env, execArgv })))).toEqual(
      cases.map(({ switchedOnBy }) => ObjectStoreErrors.envProxyOn({ switchedOnBy })),
    );
  });

  it("admits a proxy that is set but not switched on, a switch with no proxy, and an explicit off", () => {
    const cases = [
      { env: PROXY, execArgv: [] },
      { env: { NODE_USE_ENV_PROXY: "1" }, execArgv: ["--use-env-proxy"] },
      { env: { ...PROXY, NODE_USE_ENV_PROXY: "0" }, execArgv: [] },
      { env: { HTTP_PROXY: "  ", NODE_USE_ENV_PROXY: "1" }, execArgv: [] },
      { env: { ...PROXY, NODE_OPTIONS: "--enable-source-maps" }, execArgv: ["--use-env-proxy-other"] },
    ];

    expect(cases.map(({ env, execArgv }) => envProxyOff({ env, execArgv }).isOk())).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe("storeObjectsSelection", () => {
  /** A fake context read answering one endpoint. */
  const localEndpoint: DockerContextEndpoint = () => ok(JSON.stringify(LOCAL_HOST));

  /** A fake docker read answering each container from a table, and recording every request in order. */
  function fakeInspect({ answers }: { answers: Readonly<Record<string, string>> }): {
    inspect: DockerInspect;
    calls: { container: string; format: string; host: string }[];
  } {
    const calls: { container: string; format: string; host: string }[] = [];
    const inspect: DockerInspect = (request) => {
      calls.push(request);
      const answer = answers[request.container];
      if (answer === undefined) {
        return err(ObjectStoreErrors.stackUnreadable({ container: request.container, reason: "No such object" }));
      }
      return ok(answer);
    };
    return { calls, inspect };
  }

  it("reads the gateway then the Storage container, and composes the selection", () => {
    const { calls, inspect } = fakeInspect({
      answers: {
        [GATEWAY]: gatewayText({ bindings: [{ HostIp: "127.0.0.1", HostPort: "54321" }] }),
        [STORAGE]: storageText({ env: [`SERVICE_KEY=${SENTINEL_KEY}`] }),
      },
    });

    expect(unwrap(storeObjectsSelection({ endpoint: localEndpoint, env: {}, execArgv: [], inspect }))).toEqual({
      apiUrl: "http://127.0.0.1:54321",
      serviceKey: SENTINEL_KEY,
    });
    expect(calls).toEqual([
      { container: GATEWAY, format: GATEWAY_INSPECT_FORMAT, host: LOCAL_HOST },
      { container: STORAGE, format: STORAGE_INSPECT_FORMAT, host: LOCAL_HOST },
    ]);
  });

  it("reads no container at all when Node's environment proxy could carry the request", () => {
    const { calls, inspect } = fakeInspect({
      answers: {
        [GATEWAY]: gatewayText({ bindings: [{ HostIp: "127.0.0.1", HostPort: "54321" }] }),
        [STORAGE]: storageText({ env: [`SERVICE_KEY=${SENTINEL_KEY}`] }),
      },
    });
    const env = { NODE_USE_ENV_PROXY: "1", http_proxy: "http://192.0.2.7:3128" };

    const refused = unwrapErr(storeObjectsSelection({ endpoint: localEndpoint, env, execArgv: [], inspect }));

    expect(refused).toEqual(ObjectStoreErrors.envProxyOn({ switchedOnBy: "NODE_USE_ENV_PROXY" }));
    expect(refused.message.includes("192.0.2.7")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("reads no container at all when the active context is a remote daemon", () => {
    const { calls, inspect } = fakeInspect({
      answers: {
        [GATEWAY]: gatewayText({ bindings: [{ HostIp: "127.0.0.1", HostPort: "54321" }] }),
        [STORAGE]: storageText({ env: [`SERVICE_KEY=${SENTINEL_KEY}`] }),
      },
    });
    const remoteEndpoint: DockerContextEndpoint = () => ok(JSON.stringify("tcp://192.168.1.50:2375"));

    expect(unwrapErr(storeObjectsSelection({ endpoint: remoteEndpoint, env: {}, execArgv: [], inspect }))).toEqual(
      ObjectStoreErrors.dockerNotLocal({ scheme: "tcp" }),
    );
    expect(calls).toEqual([]);
  });

  it("never reads the Storage container's settings when the gateway is exposed", () => {
    const { calls, inspect } = fakeInspect({
      answers: {
        [GATEWAY]: gatewayText({ bindings: [{ HostIp: "0.0.0.0", HostPort: "54321" }] }),
        [STORAGE]: storageText({ env: [`SERVICE_KEY=${SENTINEL_KEY}`] }),
      },
    });

    expect(unwrapErr(storeObjectsSelection({ endpoint: localEndpoint, env: {}, execArgv: [], inspect })).code).toBe(
      "OBJECTS_API_PORT_EXPOSED",
    );
    expect(calls.map((call) => call.container)).toEqual([GATEWAY]);
  });

  it("carries docker's own failure for a container it cannot describe", () => {
    const { inspect } = fakeInspect({
      answers: { [GATEWAY]: gatewayText({ bindings: [{ HostIp: "127.0.0.1", HostPort: "54321" }] }) },
    });

    expect(unwrapErr(storeObjectsSelection({ endpoint: localEndpoint, env: {}, execArgv: [], inspect }))).toEqual(
      ObjectStoreErrors.stackUnreadable({ container: STORAGE, reason: "No such object" }),
    );
  });
});

describe("verifiedBytes", () => {
  it("hands back bytes that hash to their key", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const key = createHash("sha256").update(bytes).digest("hex");

    expect(unwrap(verifiedBytes({ bytes, key }))).toEqual(bytes);
  });

  it("refuses bytes that do not, naming what they hashed to", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const error = unwrapErr(verifiedBytes({ bytes, key: "0".repeat(64) }));

    expect(error.code).toBe("OBJECT_DIGEST_MISMATCH");
    expect(error.message).toContain(createHash("sha256").update(bytes).digest("hex"));
  });
});

describe("objectFailure", () => {
  it("carries the status of an error the SDK returned", () => {
    const failure = objectFailure({ error: { message: "Bucket not found", status: 404 }, key: "measurements" });

    expect(failure).toMatchObject({ code: "OBJECT_REQUEST_FAILED", key: "measurements", status: 404 });
  });

  it("carries no status for a transport failure that never reached the API", () => {
    const failure = objectFailure({ error: new TypeError("fetch failed"), key: "abc" });

    expect(failure).toMatchObject({ code: "OBJECT_REQUEST_FAILED", key: "abc", status: undefined });
    expect(failure.message).toContain("fetch failed");
  });
});

describe("withoutServiceKey", () => {
  const withheldLine = ({ status }: { status: string }): string =>
    `the Storage API refused [withheld]${status}: the failure was withheld because it carried the service key`;

  it("withholds a failure whichever of its fields spells the key — the API's message, the object key, a digest", () => {
    const keys = [SENTINEL_KEY, "redacted-redacted-redacted", "withheld-because-it-carried", "a".repeat(64)];
    const cases = keys.flatMap((serviceKey) => [
      {
        failure: objectFailure({
          error: Object.assign(new Error(`bad key ${serviceKey} (Bearer ${serviceKey})`), { status: 500 }),
          key: "abc",
        }),
        serviceKey,
        status: " (HTTP 500)",
      },
      {
        failure: objectFailure({
          error: Object.assign(new Error("Bucket not found"), { status: 404 }),
          key: serviceKey,
        }),
        serviceKey,
        status: " (HTTP 404)",
      },
      {
        failure: ObjectStoreErrors.digestMismatch({ actual: serviceKey, key: "b".repeat(64) }),
        serviceKey,
        status: "",
      },
    ]);

    const scrubbed = cases.map(({ failure, serviceKey }) => withoutServiceKey({ failure, serviceKey }));

    expect(cases.length).toBe(12);
    expect(cases.every(({ failure, serviceKey }) => failure.message.includes(serviceKey))).toBe(true);
    expect(scrubbed.map((failure) => failure.message)).toEqual(cases.map(({ status }) => withheldLine({ status })));
    expect(
      scrubbed.filter((failure, index) =>
        Object.values(failure).some((value) => typeof value === "string" && value.includes(cases[index]!.serviceKey)),
      ),
    ).toEqual([]);
  });

  it("returns a failure carrying no part of the key unchanged", () => {
    const failure = objectFailure({ error: Object.assign(new Error("Bucket not found"), { status: 404 }), key: "abc" });

    expect(withoutServiceKey({ failure, serviceKey: SENTINEL_KEY })).toBe(failure);
    expect(failure.message).toBe("the Storage API refused abc (HTTP 404): Bucket not found");
  });

  it("returns the failure unchanged when the key it was given is empty", () => {
    const failure = objectFailure({ error: Object.assign(new Error("Bucket not found"), { status: 404 }), key: "abc" });

    expect(withoutServiceKey({ failure, serviceKey: "" })).toBe(failure);
  });
});
