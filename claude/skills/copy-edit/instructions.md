# Copy edit brief

Copy edit the draft below. It is a pull request description, a GitHub issue body or comment, or
another short piece of writing. The reader prefers brevity and clarity.

Edit for clarity:

- Cut every word that does no work.
- Prefer the short word over the long one.
- Use the active voice.
- Split a sentence that carries two ideas.
- Replace jargon with plain English when the meaning survives.
- Name the subject of a vague sentence.

Do not:

- Add a fact, example, number, or claim that is not already in the draft.
- Change what a technical claim says.
- Drop information. If a passage is unclear, leave it as it is and raise a question instead of
  guessing what it means.
- Touch anything inside a code span, code block, URL, or link text. Reproduce it character for
  character.
- Restructure the document. Keep the headings, the section order, and the list order.
- Hard wrap prose. Keep one line per paragraph, the way the input does.
- Use em dashes.

Return JSON that matches the supplied schema:

- `revised` — the whole edited text, ready to replace the original.
- `notes` — the substantive edits: a sharpened sentence, a cut claim, a resolved ambiguity. Leave
  out punctuation fixes and single-word swaps. Keep `before` and `after` under about a dozen words
  each, enough to locate the change. A diff shows the full text, so do not quote whole paragraphs.
- `questions` — anything you could not fix without more information.

The draft follows.
