# Provenance: SYNTHETIC

Every conversation, id, timestamp and word in this folder was written by hand for the tests. None of it came from
a real ChatGPT account, and it is not a recording.

The SHAPE follows ChatGPT's data export as `src/corpus/chatgpt/exportConversation.ts` reads it: a conversations file
is a JSON array of conversations, each a `mapping` tree with a `current_node`, split across a numbered run
(`conversations-000.json`, `conversations-001.json`) the way a large account's export splits. It covers the cases the
parser has to get right:

- a hidden system turn and hidden custom instructions, which are withheld;
- a regenerated answer, kept as an `alternate` branch beside the `current` one;
- a voice exchange (`audio_transcription` beside `audio_asset_pointer`);
- an image attachment with a caption;
- a tool call to `python`, its execution output and the model's `thoughts`, all withheld;
- a code block written to the owner, carried as a fenced block.

The first real export is the owner's: the Queue card names the export step, and `chatgpt sync` takes it in. Replace nothing
here with real data — this folder is committed.
