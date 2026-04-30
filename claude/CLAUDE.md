# CLAUDE.md

## Pull Requests

- When editing a pull request description, make sure to first fetch the existing description. I may have edited it in the interim and it's frustrating to have my edits blown away.
- When replying to PR review comments, push the commit first, then leave the reply. That way the reply can reference the commit SHA, and the reviewer can follow the link to the exact changeset.

## GitHub Issues

- When editing an issue body, first fetch the existing body — same reason as PR descriptions.
- No headings in the body. Write the context as prose, then any bulleted considerations or scope, then the "Done is:" block.
- End every issue with a `**Done is:**` section: a short bulleted list of concrete, verifiable completion criteria. See https://danielbachhuber.com/done-is/ for the reasoning.
- Let me verify the issue content before you create it.

## Tools

- The `gws` executable can be used for accessing Google Docs, Slides, and Gmail. However, ~/.claude/scripts/fetch-google-doc.ts is even more helpful for Google Docs, and ~/.claude/scripts/fetch-google-slides.ts even more helpful for Google Slides. Both scripts accept the document ID as the first argument. If there's an authentication failure, inform the end user instead of trying to fetch the document instead.
