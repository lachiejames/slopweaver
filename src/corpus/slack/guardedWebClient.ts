/**
 * The Slack WRITE client: a `WebClient` that refuses to send a dead Datadog console host, and refuses a write the
 * outbound privacy check stops (`../../outbound/slack/writePrivacy.ts`) — both before the SDK sends anything.
 *
 * `../../outbound/invalidDatadogHost.ts` carries the policy and why it lives at the transports. This is the Slack
 * half, and it is a SUBCLASS for a mechanical reason: `@slack/web-api` binds every convenience method
 * (`chat.postMessage`, `chat.update`, `canvases.create`, …) to `this.apiCall` when the client is constructed, so
 * replacing `apiCall` on an instance afterwards intercepts nothing. An override on the class is what every bound
 * method reaches, which makes this one method the choke point for every call either write client makes.
 *
 * Every call is judged, reads included, and deliberately: a read in the write lane carries channel ids and
 * timestamps, never text a dead host could sit in, while an exemption list would be one more thing a new write
 * method could fall outside. `search.messages` — the read a session uses to FIND a dead link — goes through the
 * read clients in `./api.ts`, which this does not touch.
 *
 * `filesUploadV2` is the one write whose content never reaches `apiCall`: the SDK posts the file's bytes straight
 * to the upload URL Slack hands back. So that method is judged too, on its whole arguments,
 * bytes included, before the SDK asks Slack for anything — and the upload address Slack answers with is judged
 * before the SDK posts to it.
 */
import { readFile } from "node:fs/promises";
import { Stream } from "node:stream";

import { type FilesUploadV2Arguments, type WebAPICallResult, WebClient, type WebClientOptions } from "@slack/web-api";
import { scopeIdForToken } from "../../lib/providerCall.js";
import { invalidDatadogHostHatchOpen, refuseInvalidDatadogHost } from "../../outbound/invalidDatadogHost.js";
import { refuseSlackWriteOnPrivacy, type SlackWritePrivacy } from "../../outbound/slack/writePrivacy.js";

/**
 * A `WebClient` whose every API call refuses a payload carrying a dead Datadog console host.
 *
 * The refusal throws before the SDK sends anything; every write seam in `./writeApi.ts` runs its call inside
 * `safeProviderCall`, so the verb reports it as that write's failure with the four-line message intact.
 */
export class GuardedWebClient extends WebClient {
  /** The outbound privacy check every write this client sends is judged by (`../../outbound/slack/writePrivacy.ts`). */
  private readonly privacy: SlackWritePrivacy;

  /** An opaque digest of the token, never the token: a held write's key covers the workspace it writes into. */
  private readonly principal: string;

  /**
   * A write client over one token, judged by one privacy capability. Both are required: there is no Slack write
   * client that skips the privacy check.
   *
   * @param token the token the client writes as
   * @param privacy the outbound privacy capability, built from the verb's own home
   * @param options the SDK's own options, the at-most-once retry budget among them
   */
  constructor({ token, privacy, options }: { token: string; privacy: SlackWritePrivacy; options?: WebClientOptions }) {
    super(token, options);
    this.privacy = privacy;
    this.principal = scopeIdForToken({ token });
  }

  /**
   * Refuse a payload carrying a dead Datadog console host, then a write the outbound privacy check stops, then make
   * the SDK's own call. A read passes the privacy check without loading anything.
   *
   * @param method the Slack Web API method every bound convenience method names, e.g. `chat.postMessage`
   * @param options the call's arguments, judged whole before anything is sent
   * @returns the SDK's own call result
   */
  // named-object-params-exempt: overrides the SDK's own apiCall(method, options), which every bound method calls positionally
  override async apiCall(method: string, options?: Record<string, unknown>): Promise<WebAPICallResult> {
    refuseInvalidDatadogHost({
      command: `slack ${method}`,
      hatchIsOpen: invalidDatadogHostHatchOpen,
      payload: options,
    });
    await refuseSlackWriteOnPrivacy({ args: options, method, principal: this.principal, privacy: this.privacy });
    const result = await super.apiCall(method, options);
    refuseUploadAddressedToDeadHost({ method, result });
    return result;
  }

  /**
   * Refuse an upload whose file, content or comment carries a dead Datadog console host, then make the SDK's own
   * upload. Every `file` — a `Buffer`, a path, a `Stream` or a `Blob` — is read into a `Buffer` FIRST, and that
   * same `Buffer` is what the SDK uploads, so the bytes judged are the bytes sent and nothing is read twice (a Blob and a
   * stream each otherwise reached the upload unjudged or refused without the host).
   *
   * @param options the upload's arguments, judged whole — the bytes are read as the text they carry
   * @returns the SDK's own upload result
   */
  // named-object-params-exempt: overrides the SDK's own filesUploadV2(options), which files.uploadV2 is bound to
  override async filesUploadV2(options: FilesUploadV2Arguments): ReturnType<WebClient["filesUploadV2"]> {
    const single = "file" in options ? { ...options, file: await uploadFileBytes({ file: options.file }) } : options;
    const read =
      "file_uploads" in single
        ? {
            ...single,
            file_uploads: await Promise.all(
              single.file_uploads.map(async (upload) =>
                "file" in upload ? { ...upload, file: await uploadFileBytes({ file: upload.file }) } : upload,
              ),
            ),
          }
        : single;
    refuseInvalidDatadogHost({
      command: "slack files.uploadV2",
      hatchIsOpen: invalidDatadogHostHatchOpen,
      payload: read,
    });
    // The same bytes the SDK uploads, judged before it asks Slack for an upload address.
    await refuseSlackWriteOnPrivacy({
      args: read,
      method: "files.uploadV2",
      principal: this.principal,
      privacy: this.privacy,
    });
    return super.filesUploadV2(read);
  }
}

/**
 * Refuse the upload address Slack hands back when it carries a dead Datadog console host. `files.uploadV2` asks
 * `files.getUploadURLExternal` for an address and then posts the bytes to it outside `apiCall`, so that answer is
 * the last point the address can be judged before a network call is made to it. Every other
 * method's answer passes untouched: it addresses nothing the SDK sends next.
 *
 * @param method the Slack Web API method that answered
 * @param result that method's answer, judged only when it is an upload address
 */
export function refuseUploadAddressedToDeadHost({
  method,
  result,
}: {
  method: string;
  result: WebAPICallResult;
}): void {
  if (method !== "files.getUploadURLExternal") {
    return;
  }
  refuseInvalidDatadogHost({
    command: "slack files.uploadV2",
    hatchIsOpen: invalidDatadogHostHatchOpen,
    payload: result,
  });
}

/**
 * One upload's file as the bytes the SDK will send: a path is read, any stream drained, a `Blob` copied out.
 *
 * @param file the upload's `file` argument, in any shape the SDK accepts
 * @returns the file's bytes
 */
async function uploadFileBytes({ file }: { file: unknown }): Promise<Buffer> {
  if (Buffer.isBuffer(file)) {
    return file;
  }
  if (file instanceof Uint8Array) {
    return Buffer.from(file);
  }
  if (file instanceof Blob) {
    return Buffer.from(await file.arrayBuffer());
  }
  if (typeof file === "string") {
    return readFile(file);
  }
  if (file instanceof Stream) {
    return streamBytes({ stream: file });
  }
  throw new Error("slack files.uploadV2 cannot read this file to judge it — pass a Buffer, a path or a Stream");
}

/**
 * Drain a stream the way the SDK's own `getFileDataAsStream` does — `read()` on every `readable`, done at
 * `end` — so any `Stream` the SDK's `file` contract admits is read, not only a `Readable`.
 *
 * @param stream the upload's file, as the caller handed it over
 * @returns every chunk the stream yielded, joined
 */
async function streamBytes({ stream }: { stream: Stream }): Promise<Buffer> {
  const read: unknown = Reflect.get(stream, "read");
  if (typeof read !== "function") {
    throw new Error("slack files.uploadV2 cannot read this stream to judge it — it has no read()");
  }
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("readable", () => {
      for (
        let chunk: unknown = Reflect.apply(read, stream, []);
        chunk !== null;
        chunk = Reflect.apply(read, stream, [])
      ) {
        if (chunk instanceof Uint8Array) {
          chunks.push(Buffer.from(chunk));
        } else if (typeof chunk === "string") {
          chunks.push(Buffer.from(chunk));
        } else {
          reject(new Error("slack files.uploadV2 cannot read this stream to judge it — a chunk was not bytes or text"));
          return;
        }
      }
    });
    stream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", reject);
  });
}
