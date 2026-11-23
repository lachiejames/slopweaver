/**
 * Messenger's composer: the box the owner types to the voice in, its buttons, and the files waiting to go with their next
 * message — Messenger's foot in the card, and the foot of the conversation on the stage. Split from `Messenger.tsx` to
 * keep it under the line cap.
 */
import { LoaderCircle, type LucideIcon, Paperclip, SendHorizontal } from "lucide-react";
import {
  type ClipboardEventHandler,
  type Dispatch,
  type KeyboardEvent,
  type ReactElement,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  attachmentsAfterKeep,
  attachmentsAfterSend,
  attachmentsSending,
  type MessengerAttachReceipt,
  messengerAttachRoom,
  messengerMessageOf,
  messengerTransferDecision,
  type PendingMessengerAttachment,
} from "../../lib/messengerAttachment";
import { MESSENGER_PLACEHOLDER, messengerComposerMode } from "../../lib/messengerMode";
import { TYPED_TEXT_MAX_CHARS } from "../../lib/planCallContract";
import { attachFile } from "./attachClient";
import { revokePreviews } from "./attachmentPreviews";
import { MessengerAttachments } from "./MessengerAttachments";
import { type ComposerNote, ComposerNoteLine } from "./MessengerComposerNote";
import { ICON_CONTROL, RailIcon, RailTip } from "./StageRailParts";
import { typeIntoLiveCall } from "./typedInClient";
import { useWindowFileDrop } from "./useWindowFileDrop";
import type { VoiceState } from "./voiceContext";

/** The widest a desktop-width window autofocuses the box from; a phone's keyboard is never thrown up unasked. */
const FOCUS_ON_OPEN = "(min-width: 640px)";

/** The composer's button: the stage's round icon control, filled as the console's primary action. */
// Greyed, not a dimmed blue, while there is nothing to send.
const SEND_CONTROL = `${ICON_CONTROL} border-transparent bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-(--c-panel) disabled:text-muted-foreground disabled:opacity-100`;

/** The paperclip's tooltip and accessible name. */
const ATTACH_WORD = "attach pictures or text files";

/** The composer's frame; a file dragged over the page outlines it as where the drop lands. */
const FORM =
  "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 border-0 border-t border-solid border-border px-[0.8rem] pt-[0.6rem] pb-[0.7rem]";

/**
 * The box the owner types to the voice in, and its buttons: Messenger's foot in the card, and on the stage the foot of the
 * conversation (`VoiceStage.tsx`). It takes the owner's keyboard as it opens.
 *
 * @param voice the console voice's state
 * @param draft what the owner has typed and not sent, kept by the widget across a close
 * @param onDraft sets it, or updates it against its newest value once a send lands
 * @param attached the files waiting to go with the owner's next message, kept by the widget across a close
 * @param onAttached sets them, or updates them against their newest value once a keep or a send answers
 * @returns the composer
 */
export function MessengerComposer({
  voice,
  draft,
  onDraft,
  attached,
  onAttached,
}: {
  voice: VoiceState;
  draft: string;
  onDraft: Dispatch<SetStateAction<string>>;
  attached: readonly PendingMessengerAttachment[];
  onAttached: Dispatch<SetStateAction<readonly PendingMessengerAttachment[]>>;
}): ReactElement {
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // Set the moment a send starts and cleared when it settles, so a second press before React re-renders cannot send
  // the same files again off the same render's state. Another composer is held off by the files'
  // `sending` mark in the widget's list instead. Not closed: two composers mounted at once (a `?stage=` preview beside
  // the card) submitted in ONE JavaScript task, before React commits either mark — a script can do that, a hand
  // cannot. A send lock held by the widget rather than each composer would close it.
  const submitting = useRef(false);
  const [sendingToCall, setSendingToCall] = useState(false);
  const [callNote, setCallNote] = useState<ComposerNote | undefined>(undefined);
  const [attachNote, setAttachNote] = useState<ComposerNote | undefined>(undefined);
  const mode = messengerComposerMode({ callUp: voice.callActiveAnywhere, phase: voice.typed.phase, sendingToCall });
  useEffect(() => {
    if (window.matchMedia(FOCUS_ON_OPEN).matches) {
      box.current?.focus();
    }
  }, []);
  const keeping = attached.some((file) => file.kind === "keeping");
  const receipts: MessengerAttachReceipt[] = [];
  for (const file of attached) {
    if (file.kind === "kept") {
      receipts.push(file.receipt);
    }
  }
  const keepOne = async ({ file, token, previewUrl }: KeepingFile): Promise<void> => {
    const kept = await attachFile({ file });
    let keptReceipt: MessengerAttachReceipt | undefined;
    if (kept.kind === "refused") {
      setAttachNote({ lead: `Not attached: ${file.name}`, why: kept.why });
      revokePreviews({ urls: [previewUrl] });
    } else {
      keptReceipt = kept.receipt;
    }
    onAttached((now) => attachmentsAfterKeep({ now, receipt: keptReceipt, token }));
  };
  // Every file the owner picks, pastes or drops is kept as it arrives, all at once, so a send is as quick as one without
  // files; past the cap the rest are left out and said so.
  const pickAll = ({ files }: { files: readonly File[] }): void => {
    const room = messengerAttachRoom({ offered: files.length, waiting: attached.length });
    setAttachNote(room.why === undefined ? undefined : { lead: room.why, why: undefined });
    const taken = files.slice(0, room.take).map((file): KeepingFile => ({
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      token: crypto.randomUUID(),
    }));
    if (taken.length === 0) {
      return;
    }
    const fresh = taken.map(({ file, token, previewUrl }): PendingMessengerAttachment => ({
      bytes: file.size,
      kind: "keeping",
      name: file.name,
      previewUrl,
      token,
    }));
    onAttached((now) => [...now, ...fresh]);
    for (const one of taken) {
      void keepOne(one);
    }
  };
  // A paste or a drop goes the paperclip's way when it carries files and the decision takes them, and is left to the
  // browser otherwise: text pastes as text (`messengerTransferDecision`).
  const take = ({ transfer, source }: { transfer: DataTransfer; source: "drop" | "paste" }): boolean => {
    const files = Array.from(transfer.files);
    const decision = messengerTransferDecision({
      files,
      hasPlainText: transfer.types.includes("text/plain"),
      nowIso: new Date().toISOString(),
      source,
    });
    if (decision.kind === "default") {
      return false;
    }
    const named = decision.picks.map(({ fileIndex, name }) => {
      const file = files[fileIndex];
      return name === file.name ? file : new File([file], name, { lastModified: file.lastModified, type: file.type });
    });
    pickAll({ files: named });
    return true;
  };
  const onPaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (take({ source: "paste", transfer: event.clipboardData })) {
      event.preventDefault();
    }
  };
  // A file dropped anywhere on the page lands here, not only on the one-line box.
  const dragging = useWindowFileDrop({
    onFiles: (transfer) => {
      take({ source: "drop", transfer });
    },
  });
  const remove = (token: string): void => {
    revokePreviews({ urls: attached.filter((file) => file.token === token).map((file) => file.previewUrl) });
    onAttached((now) => now.filter((file) => file.token !== token));
    setAttachNote(undefined);
  };
  const submit = async (): Promise<void> => {
    // The press's instant, read first: a call another window made after it is not the one the owner was typing to.
    const pressedMs = Date.now();
    if (submitting.current || mode.kind === "busy" || keeping || (draft.trim() === "" && receipts.length === 0)) {
      return;
    }
    // The owner's words, then one line per kept file; refused whole, never cut, when they do not fit one message.
    const message = messengerMessageOf({ draft, receipts });
    if (message.kind === "refused") {
      // The composer's own refusal, already the owner's words, so it is said as itself.
      setAttachNote({ lead: `Not sent: ${message.why}`, why: undefined });
      return;
    }
    // Cleared as it goes, so whatever the owner types while the send is out is their next message, never the sent one's to
    // clear. A refused send puts its text back — only into an empty box, never over a new draft.
    // Its files stay listed, marked as out with it in the widget's own list, so no press from this or a remounted
    // composer sends them again; once it goes only those leave, and once refused they are ready again, so a file added
    // or removed while it was out is never undone.
    const sent = draft;
    const sentAttached = attached.filter((file) => file.kind === "kept");
    const putBack = (): void => {
      onDraft((now) => (now === "" ? sent : now));
      onAttached((now) => attachmentsAfterSend({ now, sent: sentAttached, went: false }));
    };
    const letGo = (): void => {
      revokePreviews({ urls: sentAttached.map((file) => file.previewUrl) });
      onAttached((now) => attachmentsAfterSend({ now, sent: sentAttached, went: true }));
    };
    onDraft("");
    onAttached((now) => attachmentsSending({ now, sent: sentAttached }));
    setAttachNote(undefined);
    submitting.current = true;
    try {
      if (mode.target === "call") {
        setSendingToCall(true);
        setCallNote(undefined);
        const typed = await typeIntoLiveCall({ messageId: crypto.randomUUID(), pressedMs, text: message.text });
        setSendingToCall(false);
        if (typed.kind === "refused") {
          setCallNote({ lead: "Not sent", why: typed.why });
          putBack();
        } else {
          if (typed.kind === "unknown") {
            // The voice may have it, so the text is not put back for a second send it would hear twice.
            setCallNote({ lead: "Maybe sent; the call did not confirm it", why: typed.why });
          }
          letGo();
        }
        box.current?.focus();
        return;
      }
      const took = await voice.typed.send({ text: message.text });
      if (took) {
        letGo();
      } else {
        putBack();
      }
    } finally {
      submitting.current = false;
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    // Enter sends, to the call when one is up; it never ends one.
    void submit();
  };
  let failure: ComposerNote | undefined;
  if (voice.typed.failure !== undefined) {
    failure = { lead: undefined, why: voice.typed.failure };
  }
  if (mode.kind === "send" && mode.target === "call") {
    failure = callNote;
  }
  if (attachNote !== undefined) {
    failure = attachNote;
  }
  const sendable = mode.kind === "send" && !keeping && (draft.trim() !== "" || receipts.length > 0);
  let buttonIcon: LucideIcon = SendHorizontal;
  if (mode.kind === "busy") {
    buttonIcon = LoaderCircle;
  }
  let formLook = FORM;
  if (dragging) {
    formLook = `${FORM} bg-primary/10 outline-2 outline-dashed outline-primary -outline-offset-4`;
  }
  return (
    <form
      aria-label="type to the voice"
      className={formLook}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {dragging ? (
        <p className="m-0 text-center text-[0.78rem] font-medium text-primary">Drop files to attach them</p>
      ) : null}
      {attached.length === 0 ? null : <MessengerAttachments attached={attached} onRemove={remove} />}
      <div className="flex items-end gap-2">
        <input
          ref={picker}
          type="file"
          multiple
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const list = event.target.files;
            const files = list === null ? [] : Array.from(list);
            // Cleared at once, so picking the same file again after removing it still fires a change.
            event.target.value = "";
            pickAll({ files });
          }}
        />
        <RailTip word={ATTACH_WORD} side="top">
          <button
            type="button"
            className={ICON_CONTROL}
            aria-label={ATTACH_WORD}
            onClick={() => {
              picker.current?.click();
            }}
          >
            <RailIcon icon={Paperclip} />
          </button>
        </RailTip>
        {/* One line at rest, the button's height, growing with what the owner types up to its cap, then scrolling
            (never a paste box double the size of the button). */}
        <textarea
          ref={box}
          aria-label="message"
          className="max-h-32 min-h-8 min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border border-solid sw-glass-control px-[0.6rem] py-[0.3rem] text-[0.88rem] leading-5 text-foreground [field-sizing:content]"
          rows={1}
          maxLength={TYPED_TEXT_MAX_CHARS}
          value={draft}
          placeholder={MESSENGER_PLACEHOLDER}
          onChange={(event) => {
            onDraft(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <RailTip word={mode.button} side="top">
          <button type="submit" className={SEND_CONTROL} disabled={!sendable} aria-label={mode.button}>
            <span className={mode.kind === "busy" ? "inline-flex animate-spin" : "inline-flex"}>
              <RailIcon icon={buttonIcon} />
            </span>
          </button>
        </RailTip>
      </div>
      {failure === undefined ? null : <ComposerNoteLine note={failure} />}
    </form>
  );
}

/** One file on its way to being kept: the file, its keep's id, and its thumbnail's object URL when it is a picture. */
interface KeepingFile {
  readonly file: File;
  readonly token: string;
  readonly previewUrl: string | undefined;
}
