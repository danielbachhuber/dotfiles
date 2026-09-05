# @danielb/harvest-fallback

A stand-in for `bb-plugin-harvest`, used only on a machine where that plugin is
not checked out.

## Why

The three sweep plugins depend on the Harvest plugin by `file:` path
(`~/projects/harvest-bb-plugin`). On a machine without that checkout,
`npm install` leaves a dangling symlink and says nothing; the failure surfaces
much later, as `Could not resolve "bb-plugin-harvest/bridge"` stopping
`bb plugin build` outright. Every one of these plugins already has a
fully-supported "Harvest unavailable" state — the clock simply is not drawn —
so a missing checkout should reach that state rather than the build.

## How

Each plugin runs this on `postinstall`:

```json
{ "scripts": { "postinstall": "node ../harvest-fallback/install.mjs" } }
```

The script copies these modules to `node_modules/bb-plugin-harvest` **only when
the real package is not there**, leaving a `.harvest-fallback` marker so a
later run can tell its own copy from a real checkout and step aside as soon as
one appears. On a machine with the checkout, nothing happens.

## What it costs

A bundle built here has Harvest compiled out until it is rebuilt somewhere the
real plugin is present. That is inherent to a build-time fallback, so it is
never silent: the installer warns, and `createHarvestBridge` logs once per load.

The Harvest tests in `app.test.tsx` skip themselves when the marker is present
(`describe.skipIf`) — passing them against a no-op component would say less
than not running them.
