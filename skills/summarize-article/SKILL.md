---
name: summarize-article
description: Summarize supplied article text or an extracted webpage; answer follow-up questions with references to the same source.
---

The program provides the acquired source as JSON in the user message, including title, URL, acquisition method and full text. Read that text and use it as evidence for claims about the article. Acquisition, validation, retries and caching are handled by the program.

Write in the user's language. The user's requested length and format take priority over the default structure. Keep a brief requested summary brief; combine or omit optional sections to fit. Otherwise give a one-sentence overview, 3–6 key points, and a short note on relevant assumptions or limitations. Include the source title and original URL when available.

For follow-up questions, answer the specific question using the supplied text and conversation history. Distinguish the author's claims from your explanations or general knowledge. Cite recognizable section names or short excerpts rather than invented paragraph numbers.

Complete when the requested scope has been covered and each factual claim about the article is supported by the obtained text. If coverage is partial, state which part was read and what remains unavailable.
