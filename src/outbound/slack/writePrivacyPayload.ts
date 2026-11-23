/**
 * What the Slack write transport's privacy guard judges in one call, and the verdict over it. Pure: the effectful
 * half — loading the policy from a home and throwing before the SDK sends — is `./writePrivacy.ts`, called by
 * `../../corpus/slack/guardedWebClient.ts`.
 *
 * ## Which calls are writes
 *
 * Every Web API method NOT on {@link SLACK_READ_METHODS}, an exact list of the reads the write lane makes. A method
 * added later is a write until somebody lists it as a read, so a new write can never slip past unjudged; the cost
 * is that a new read needs the private-terms file until it is listed. `files.getUploadURLExternal` and
 * `files.completeUploadExternal` are not listed: they are halves of an upload, which is judged whole before either.
 *
 * ## What is judged
 *
 * Every STRING LEAF of the call's arguments, at any depth — message text, every text leaf in blocks and
 * attachments, canvas titles and markdown, channel names, topics and purposes, upload filenames, titles and comments,
 * status text, assistant thread titles and statuses, and metadata (content, so never skipped wholesale) — except a
 * key on {@link SLACK_STRUCTURAL_KEYS}, wherever it sits: a token, a channel, user, team, file or canvas id, or a
 * timestamp says where a write goes, not what it says.
 *
 * An upload's BYTES are judged when its filename has a text-like extension ({@link TEXT_UPLOAD_EXTENSIONS}), decoded
 * as strict UTF-8; a text-like upload that is not valid UTF-8 refuses. Every other upload — an image, a PDF, an
 * office document, an archive, a binary under an extension not on the list — passes with its BYTES UNREAD. That is
 * a stated residue: no OCR, EXIF or document parsing happens here, and text rendered into pixels reaches Slack
 * unjudged. Its filename, title and comment are still judged.
 *
 * ## Where it goes
 *
 * Always the installation's own workspace (`identifierAudience: "installation-workspace"`), which forgives
 * forbidden-identifier findings only: installation state, credentials, the denylist and private terms refuse there
 * exactly as anywhere else, the owner's own name in a DM to the owner included. The residue is a Slack Connect
 * channel, which carries the organisation's names outside it while the call names only a channel id.
 */
import { err, ok, type Result } from "../../lib/result.js";
import {
  checkPrivacy,
  type PrivacyDestination,
  type PrivacyFinding,
  type PrivacyPolicy,
  UNASSESSED_PERSONAL_MATERIAL,
} from "../privacyCheck.js";
import { payloadLeaves } from "../writePrivacyLeaves.js";

/** One string the guard judges, and the locus a refusal names it by. */
export interface SlackWriteLeaf {
  readonly locus: string;
  readonly text: string;
}

/** The reads the Slack write lane makes. Every other method is judged as a write. */
export const SLACK_READ_METHODS: ReadonlySet<string> = new Set([
  "auth.test",
  "conversations.history",
  "conversations.info",
  "conversations.members",
  "conversations.replies",
  "reactions.get",
  "usergroups.list",
  "users.getPresence",
  "users.info",
  "users.profile.get",
]);

/** Keys that say where a write goes or who sent it, never what it says; skipped at every depth. */
const SLACK_STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  "canvas_id",
  "channel",
  "channel_id",
  "file",
  "file_id",
  "file_ids",
  "recipient_team_id",
  "recipient_user_id",
  "team_id",
  "thread_ts",
  "timestamp",
  "token",
  "ts",
  "user",
  "user_id",
  "usergroup_id",
  "users",
]);

/** Upload extensions whose bytes are read as text and judged. Anything else passes with its bytes unread. */
export const TEXT_UPLOAD_EXTENSIONS: ReadonlySet<string> = new Set([
  "csv",
  "htm",
  "html",
  "json",
  "jsonl",
  "log",
  "markdown",
  "md",
  "tsv",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

/** The destination every Slack write is judged under: the installation's own workspace. */
export const SLACK_WORKSPACE_DESTINATION: PrivacyDestination = {
  identifierAudience: "installation-workspace",
  installationIdentifiers: undefined,
  ownRepository: undefined,
};

/**
 * Whether a Web API method is one of the lane's reads, which never need the private-terms file.
 *
 * @param method the Slack Web API method, `chat.postMessage`
 * @returns true only for a method on {@link SLACK_READ_METHODS}
 */
export function isSlackRead({ method }: { method: string }): boolean {
  return SLACK_READ_METHODS.has(method);
}

/**
 * Every string a write call would send that the guard judges, each under its locus. An upload's bytes are not
 * among them: {@link slackUploadLeaves} reads those.
 *
 * @param method the Slack Web API method the call names
 * @param args the call's arguments
 * @returns the leaves in walk order
 */
export function slackWriteLeaves({ method, args }: { method: string; args: unknown }): readonly SlackWriteLeaf[] {
  return payloadLeaves({ path: "", skipKey: ({ key }) => SLACK_STRUCTURAL_KEYS.has(key), value: args }).map(
    ({ path, text }) => ({ locus: `slack ${method} ${path}`, text }),
  );
}

/** What reading an upload's bytes found: the text leaves judged, and how many uploads passed unread. */
export interface SlackUploadRead {
  readonly leaves: readonly SlackWriteLeaf[];
  readonly unreadBinaries: number;
}

/**
 * The text of every text-like file in an upload's arguments, each under its locus, and the count of files passed
 * with their bytes unread. Handles a single `file` and every `file_uploads` entry.
 *
 * @param args the upload's arguments, every `file` already a `Uint8Array` (the client materialises it first)
 * @returns the leaves and the unread count, or the refusal for a text-like file that is not valid UTF-8 or whose
 *   bytes were not materialised
 */
export function slackUploadLeaves({ args }: { args: unknown }): Result<SlackUploadRead, string> {
  const files = uploadFiles({ args });
  const leaves: SlackWriteLeaf[] = [];
  let unreadBinaries = 0;
  for (const { at, file, filename } of files) {
    if (!isTextLike({ filename })) {
      unreadBinaries += 1;
      continue;
    }
    if (!(file instanceof Uint8Array)) {
      return err(`slack files.uploadV2 ${at}: a text-like file whose bytes were not read before the check`);
    }
    const text = decodeStrictUtf8({ bytes: file });
    if (text === undefined) {
      return err(`slack files.uploadV2 ${at}: a text-like file that is not valid UTF-8, so it cannot be judged`);
    }
    leaves.push({ locus: `slack files.uploadV2 ${at}`, text });
  }
  return ok({ leaves, unreadBinaries });
}

/** One file in an upload's arguments, where it sits, and its name. */
interface UploadFile {
  readonly at: string;
  readonly file: unknown;
  readonly filename: string | undefined;
}

/** A plain record, as an upload's arguments and each `file_uploads` entry are. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The single `file` and every `file_uploads` entry, in that order. */
function uploadFiles({ args }: { args: unknown }): readonly UploadFile[] {
  if (!isRecord(args)) {
    return [];
  }
  const single: UploadFile[] =
    "file" in args
      ? [{ at: "file", file: args["file"], filename: stringOrUndefined({ value: args["filename"] }) }]
      : [];
  const uploads = args["file_uploads"];
  const many: readonly unknown[] = Array.isArray(uploads) ? uploads : [];
  return [
    ...single,
    ...many.flatMap((upload: unknown, index) => {
      if (!isRecord(upload) || !("file" in upload)) {
        return [];
      }
      return [
        {
          at: `file_uploads[${String(index)}].file`,
          file: upload["file"],
          filename: stringOrUndefined({ value: upload["filename"] }),
        },
      ];
    }),
  ];
}

/** A string, or undefined for anything else. */
function stringOrUndefined({ value }: { value: unknown }): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

/** Whether a filename's extension is on {@link TEXT_UPLOAD_EXTENSIONS}; a file with no name is not. */
function isTextLike({ filename }: { filename: string | undefined }): boolean {
  if (filename === undefined) {
    return false;
  }
  const dot = filename.lastIndexOf(".");
  if (dot < 0) {
    return false;
  }
  return TEXT_UPLOAD_EXTENSIONS.has(filename.slice(dot + 1).toLowerCase());
}

/** The bytes as UTF-8, or undefined when they are not valid UTF-8. */
function decodeStrictUtf8({ bytes }: { bytes: Uint8Array }): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Judge every leaf of one write against the outbound privacy check, in the installation's own workspace. Pure.
 *
 * @param leaves the call's leaves, its upload text included
 * @param policy the denylist, identifier rules and private terms the check reads
 * @returns every finding, leaf by leaf in walk order; empty when the write may be sent
 */
export function slackWriteFindings({
  leaves,
  policy,
}: {
  leaves: readonly SlackWriteLeaf[];
  policy: PrivacyPolicy;
}): readonly PrivacyFinding[] {
  return leaves.flatMap(
    (leaf) =>
      checkPrivacy({
        content: leaf,
        destination: SLACK_WORKSPACE_DESTINATION,
        personalMaterial: UNASSESSED_PERSONAL_MATERIAL,
        policy,
      }).findings,
  );
}
