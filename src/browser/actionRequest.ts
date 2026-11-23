/**
 * What one governed browser interaction is asked to do, and the pure decisions made about it before any browser is
 * touched: the client argv it becomes, and whether it must cite a look at the page.
 *
 * Pure. Split from `./actionExecutor.ts`, the effectful shell that judges the live page, dispatches and
 * photographs, so that shell's own reading order stays judge, dispatch, photograph.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type BrowserActionKind, isWriteCapableAction } from "./action.js";
import { type BrowserActionError, BrowserActionErrors } from "./actionErrors.js";
import type { AimMark } from "./aimShot.js";
import type { PageObservation } from "./interactionSession.js";

/** What one interaction was asked to do. */
export interface BrowserActionRequest {
  readonly kind: BrowserActionKind;
  /** The element the client should aim at — a ref out of a snapshot; a selector is refused. */
  readonly target: string | undefined;
  /** The typed text, the option to choose, the key to press, or the file to upload. */
  readonly value: string | undefined;
  /**
   * The element a keystroke says holds the cursor, as a ref.
   *
   * Required by `./aim.ts` on `type` and `press`, which carry no element of their own; meaningless on every
   * other kind, which name the element they act on directly.
   */
  readonly expectFocus: string | undefined;
  /** The look the caller decided against, when one is cited. */
  readonly observation: PageObservation | undefined;
  /** Where the after-picture — the VIEWPORT once the action has run — is written. */
  readonly screenshotPath: string;
  /**
   * The path the BEFORE-pictures are named from, with no extension — the viewport with the target scrolled
   * into it, and the same viewport with the target marked.
   *
   * Taken on every write-capable kind and on
   * none of the others; see `./aimShot.ts` for what each picture answers, and for what this does and does
   * not close.
   */
  readonly aimShotStem: string;
  /**
   * How the aim shot marks its target: a highlight overlay, or that plus the page's own focus.
   *
   * The caller decides, and the CALLER is what stops a focus reaching a page this session may not write to —
   * `src/cli/commands/browser/actionCore.ts`'s `resolveAimMark` is the gate, because the register's answer is
   * about the page rather than about the interaction, and the executor's own admission is deliberately the
   * last thing before the dispatch.
   */
  readonly aimMark: AimMark;
  /**
   * Whether a whole-page picture is taken beside the viewport ones.
   *
   * Off by default and named by `--full-page`. A whole-page capture is not what a
   * person sees, and the one it replaced made every highlight an unreadable speck. It stays available
   * because a tall page's shape is occasionally the question.
   */
  readonly fullPage: boolean;
  /** The directory a download is watched in. */
  readonly downloadDir: string | undefined;
  /** The filename a download is expected to produce, when the caller named one. */
  readonly expectName: string | undefined;
  /** Where a downloaded file is copied to. */
  readonly downloadOut: string | undefined;
}

/**
 * The client command one interaction becomes.
 *
 * Every element is one argv value. The command NAME comes from the closed list in `./action.ts`, never from
 * a caller, so the worst a malformed target can do is name an element that is not there.
 *
 * @param request what the interaction was asked to do
 * @returns the argv tail, or why the request is not a runnable one
 */
export function clientArgsFor({
  request,
}: {
  request: BrowserActionRequest;
}): Result<readonly string[], BrowserActionError> {
  const { kind, target, value } = request;
  const needsTarget = (): Result<string, BrowserActionError> =>
    target === undefined || target.length === 0
      ? err(BrowserActionErrors.requestIncomplete({ kind, missing: "--target <ref|selector>" }))
      : ok(target);
  const needsValue = (): Result<string, BrowserActionError> =>
    value === undefined ? err(BrowserActionErrors.requestIncomplete({ kind, missing: "--value <text>" })) : ok(value);
  switch (kind) {
    case "back":
      return ok(["go-back"]);
    case "forward":
      return ok(["go-forward"]);
    case "reload":
      return ok(["reload"]);
    case "dialog-accept":
      return ok(value === undefined ? ["dialog-accept"] : ["dialog-accept", value]);
    case "dialog-dismiss":
      return ok(["dialog-dismiss"]);
    case "navigate":
      return needsValue().map((url) => ["goto", url]);
    case "type":
      return needsValue().map((text) => ["type", text]);
    case "press":
      return needsValue().map((key) => ["press", key]);
    case "scroll":
      return needsValue().map((delta) => ["mousewheel", "0", delta]);
    case "click":
      return needsTarget().map((ref) => ["click", ref]);
    case "double-click":
      return needsTarget().map((ref) => ["dblclick", ref]);
    case "check":
      return needsTarget().map((ref) => ["check", ref]);
    case "uncheck":
      return needsTarget().map((ref) => ["uncheck", ref]);
    case "hover":
      return needsTarget().map((ref) => ["hover", ref]);
    case "download":
      return needsTarget().map((ref) => ["click", ref]);
    case "fill":
      return needsTarget().andThen((ref) => needsValue().map((text) => ["fill", ref, text]));
    case "select":
      return needsTarget().andThen((ref) => needsValue().map((option) => ["select", ref, option]));
    case "drag":
      return needsTarget().andThen((from) => needsValue().map((to) => ["drag", from, to]));
    case "upload":
      // Two client commands in one interaction, by the client's own contract: the click opens the page's
      // file chooser and `upload` answers it. MEASURED — the click's reply says
      // `[File chooser]: can be handled by upload`, and the upload then runs `fileChooser.setFiles([...])`.
      // Split here rather than hidden, because the chooser is real state: a failed second half leaves the
      // page holding an open chooser, which the receipt has to be able to say.
      return needsTarget().andThen((ref) => needsValue().map((file) => ["__upload__", ref, file]));
  }
}

/**
 * Whether this kind of action needs an observation cited before it runs.
 *
 * Every write-capable one does, and no read does. The rule the owner's read-before-write category already
 * carried, applied to a lane where the "read" is a snapshot the caller has actually been shown.
 *
 * @param kind the interaction
 * @returns true when an action of this kind must cite a look at the page
 */
export function actionNeedsObservation({ kind }: { kind: BrowserActionKind }): boolean {
  return isWriteCapableAction({ kind });
}
