# CLAUDE.md

## Tools

- The `gws` executable can be used for accessing Google Docs, Slides, and Gmail. However, ~/.claude/scripts/fetch-google-doc.ts is even more helpful for Google Docs, and ~/.claude/scripts/fetch-google-slides.ts even more helpful for Google Slides. Both scripts accept the document ID as the first argument. If there's an authentication failure, inform the end user instead of trying to fetch the document instead.
