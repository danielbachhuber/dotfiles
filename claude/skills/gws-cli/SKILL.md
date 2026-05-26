---
name: gws-cli
description: Use when interacting with Google Workspace (Drive, Sheets, Gmail, Calendar, Docs, Slides, Tasks, Contacts, Chat, Forms, Keep, Meet, Classroom, Apps Script) via the `gws` command-line tool
---

# gws — Google Workspace CLI

## Overview

`gws` is a CLI that wraps the Google Workspace REST APIs. It's already installed at `/opt/homebrew/bin/gws` and authenticated.

**Call shape:**

```
gws <service> <resource> [sub-resource] <method> [flags]
```

Parameters that go in the URL/query string are passed as JSON via `--params`. Request bodies for POST/PATCH/PUT are passed as JSON via `--json`.

```bash
gws drive files list --params '{"pageSize": 10}'
gws drive files get --params '{"fileId": "abc123"}'
gws sheets spreadsheets values get --params '{"spreadsheetId": "...", "range": "Sheet1!A1:C10"}'
gws gmail users messages list --params '{"userId": "me", "q": "is:unread"}'
```

## Prefer helper scripts for Docs and Slides

For Google Docs and Slides, **use these helpers instead of `gws docs` / `gws slides`** — they handle the multi-step fetch + flatten that you'd otherwise hand-roll:

```bash
~/.claude/scripts/fetch-google-doc.ts <DOC_ID>
~/.claude/scripts/fetch-google-slides.ts <PRESENTATION_ID>
```

If they fail with an auth error, tell the user — don't fall back to `gws` and retry.

## Services

| Service | Purpose |
|---|---|
| `drive` | Files, folders, shared drives, permissions |
| `sheets` | Read/write spreadsheets |
| `gmail` | Send, read, manage email |
| `calendar` | Calendars and events |
| `docs` | Read/write Google Docs (prefer helper script above) |
| `slides` | Read/write presentations (prefer helper script above) |
| `tasks` | Task lists and tasks |
| `people` | Contacts and profiles |
| `chat` | Chat spaces and messages |
| `forms` | Read/write Google Forms |
| `keep` | Google Keep notes |
| `meet` | Google Meet conferences |
| `classroom` | Classes, rosters, coursework |
| `script` | Apps Script projects |
| `events` | Subscribe to Workspace events |
| `admin-reports` (alias `reports`) | Audit logs, usage reports |
| `workflow` (alias `wf`) | Cross-service productivity workflows |
| `modelarmor` | Filter user-generated content for safety |

## Discovering resources, methods, and parameters

Don't guess — `gws` is self-documenting. Three cheap probes:

```bash
gws <service>                        # lists resources (prints as a validation error)
gws <service> <resource>             # lists methods on that resource
gws schema <service.resource.method> # full JSON schema: parameters, types, required, enums
gws schema drive.files.list --resolve-refs  # also inlines $ref definitions
```

Use `gws schema …` before composing a non-trivial request — it shows every parameter, which are required, accepted enums, and the response shape. Much faster than trial-and-error.

## Useful flags

| Flag | Use |
|---|---|
| `--params <JSON>` | URL/query parameters |
| `--json <JSON>` | Request body (POST/PATCH/PUT) |
| `--upload <PATH>` | Upload a local file as media (multipart) |
| `--upload-content-type <MIME>` | Override the auto-detected MIME type |
| `--output <PATH>` | Write binary responses to a file |
| `--format <json\|table\|yaml\|csv>` | Output format (default `json`) |
| `--page-all` | Auto-paginate, NDJSON output, one line per page |
| `--page-limit <N>` | Cap pages fetched by `--page-all` (default 10) |
| `--api-version <VER>` | Override API version (e.g. `v2`, `v3`) |
| `--dry-run` | Validate request locally without sending it |

## Common patterns

**Find a file by name:**
```bash
gws drive files list --params '{"q": "name = '\''Budget 2026'\''", "fields": "files(id,name,mimeType)"}'
```

**Read a sheet range:**
```bash
gws sheets spreadsheets values get --params '{"spreadsheetId": "...", "range": "Sheet1!A:D"}'
```

**Send mail:**
```bash
gws gmail users messages send --params '{"userId": "me"}' --json '{"raw": "<base64url RFC2822>"}'
```

**Page through results without truncation:**
```bash
gws drive files list --params '{"pageSize": 100}' --page-all --page-limit 50
```

## Exit codes

`0` success · `1` API error · `2` auth · `3` validation (bad args) · `4` discovery (couldn't fetch schema) · `5` internal

Auth failures (`2`) usually mean the user needs to refresh credentials — surface this to them rather than retrying.
