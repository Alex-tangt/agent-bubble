---
name: summarize-video
description: Summarize obtained video subtitles or a supplied transcript, preserving timestamps; answer questions about the same video.
---

The program provides the acquired subtitles or transcript as JSON in the user message. Read the supplied text and cover the requested range. Acquisition, validation, retries and caching are handled by the program.

Write in the user's language. The user's length and format requirements take priority over the default structure; combine or omit optional sections to fit. Identify the basis from `method`: `subtitles` means platform subtitles, `audio_transcription` means audio transcription, and `shared_transcript` means a user-supplied transcript. For audio transcription, `transcriptionProvider: qwen` means Qwen cloud ASR and `local` means local machine ASR; use the supplied `transcriptBasis` and `transcriptionModel` to describe the actual source. The reason platform subtitles were unavailable does not establish whether the platform has any subtitles. State the selected `videoPart` when present. Unless another format was requested, give a brief overview, 3–6 key points, and chapter timestamps when present. Preserve supplied timestamps and include the original video URL when available.

Transcripts support claims about speech. Visual demonstrations, diagrams, facial expressions, and unseen images require separate evidence. Mark uncertainty from garbled or incomplete captions. Treat comments and danmaku separately from the speaker's content.

Bracketed timestamps in the text mark sentence start times; the sentence can continue to the end of the selected part. Use `durationSeconds` for that part's runtime and `videoPart` for its scope. For example, a final sentence starting at 23:57 in a 23:59 part can cover the ending. Describe missing coverage only when the supplied source explicitly establishes it; the final start timestamp or a transition into the next part alone does not establish truncation.

Preserve uncertain product names and commands as uncertain source wording. Verify recommendations against the supplied text; do not turn a phonetic ASR guess into an asserted spelling.

For follow-up questions, use the relevant supplied transcript ranges and conversation history, citing timestamps where available. Complete when the answer covers the requested scope and its claims are supported by the obtained transcript; clearly describe unavailable content.
