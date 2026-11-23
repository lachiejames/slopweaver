/**
 * MSAL's transport cancels a request that outlives its deadline, rather than abandoning it to finish later: a
 * token endpoint that stalls before its headers, or part-way through its body, sees its connection CLOSED by
 * the client, so no late answer can rotate a refresh token after the grant lock was released. A loopback
 * server stands in for the identity platform; every value is synthetic.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { identityRequest } from "../../../../live/outlook/client.js";

/** A loopback server, and a promise that settles once the client has closed the one request it got. */
interface StallServer {
  readonly url: string;
  readonly closedByClient: Promise<void>;
  readonly server: Server;
}

let running: Server | undefined;

afterEach(async () => {
  const server = running;
  running = undefined;
  if (server !== undefined) {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => {
      server.close(() => {
        resolveClose();
      });
    });
  }
});

/** Start a server whose handler is `answer`, noting when the client closes the request's connection. */
async function stallServer({
  answer,
}: {
  answer: (args: { req: IncomingMessage; res: ServerResponse }) => void;
}): Promise<StallServer> {
  let resolveClosed: () => void = () => undefined;
  const closedByClient = new Promise<void>((resolveIt) => {
    resolveClosed = resolveIt;
  });
  const server = createServer((req, res) => {
    res.on("close", () => {
      resolveClosed();
    });
    answer({ req, res });
  });
  running = server;
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => {
      resolveListen();
    });
  });
  const { port } = server.address() as AddressInfo;
  return { closedByClient, server, url: `http://127.0.0.1:${String(port)}/consumers/oauth2/v2.0/token` };
}

/** A token POST as MSAL sends one. */
const FORM = {
  body: "grant_type=refresh_token&refresh_token=rt-synthetic",
  headers: { "content-type": "application/x-www-form-urlencoded" },
};

describe("identityRequest — MSAL's deadlined transport", () => {
  it("cancels a request whose headers never come, and the server sees the connection closed", async () => {
    const stall = await stallServer({ answer: () => undefined });

    const settled = identityRequest({ deadlineMs: 200, method: "POST", options: FORM, url: stall.url });

    await expect(settled).rejects.toMatchObject({ name: "TimeoutError" });
    await stall.closedByClient;
  });

  it("cancels a body that stops part-way, not only a request with no headers", async () => {
    const stall = await stallServer({
      answer: ({ res }) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"access_token":"at-');
      },
    });

    const settled = identityRequest({ deadlineMs: 200, method: "POST", options: FORM, url: stall.url });

    await expect(settled).rejects.toMatchObject({ name: "TimeoutError" });
    await stall.closedByClient;
  });

  it("hands MSAL the status, headers and JSON object answered, and the form body it was given", async () => {
    const seen: string[] = [];
    const stall = await stallServer({
      answer: ({ req, res }) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        req.on("end", () => {
          seen.push(Buffer.concat(chunks).toString("utf8"));
          res.writeHead(400, { "content-type": "application/json", "x-ms-request-id": "req-synthetic" });
          res.end('{"error":"invalid_grant"}');
        });
      },
    });

    const answered = await identityRequest({ deadlineMs: 5000, method: "POST", options: FORM, url: stall.url });

    expect(answered.status).toBe(400);
    expect(answered.body).toEqual({ error: "invalid_grant" });
    expect(answered.headers["x-ms-request-id"]).toBe("req-synthetic");
    expect(seen).toEqual([FORM.body]);
  });

  it("refuses an answer that is JSON but not an object, naming the boundary", async () => {
    const stall = await stallServer({
      answer: ({ res }) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("[1,2]");
      },
    });

    await expect(
      identityRequest({ deadlineMs: 5000, method: "GET", options: undefined, url: stall.url }),
    ).rejects.toThrow("login.microsoftonline.com/consumers (every MSAL request)");
  });
});
