# settings

Application preferences worth carrying between machines.

```sh
./read.sh    # capture from this machine into the .plist files
./write.sh   # apply the .plist files to this machine
```

`read.sh` is the one to run after changing something in an app. Review the
diff before committing: this repository is public.

## How a domain is described

Each `.conf` names an application, a preference domain, and an allowlist of
keys. `read.sh` captures only those keys; `write.sh` writes only those keys
back. Everything else on the machine is left alone, because `defaults import`
merges into a domain rather than replacing it.

The allowlist is the whole point. A preference domain is mostly noise: window
frames tied to one display, launch counters that change every time the app
opens, flags recording which tips have been dismissed. Capturing those would
produce a file that conflicts on every machine and churns on every launch.

Values are filtered in plist space rather than through JSON, so types survive
exactly. A boolean stays a boolean. JSON is not an option here: it cannot
represent a plist date, and the exports contain one.

## What is captured

| File | Domain |
| --- | --- |
| `dato.conf` | `com.sindresorhus.Dato`, the application container. |
| `dato-group.conf` | Dato's group container, which the widget reads. |

Dato stores its time zone list twice, once in each, so both are captured and a
restored machine agrees with itself.

Two things about Dato do not transfer, both noted in `dato.conf`:

- `enabledCalendars` holds EventKit UUIDs that macOS generates per machine.
  Copying them selects nothing. Choose the calendars again by hand.
- The menu bar item's position is a pixel offset for this display.

## Caveats

`write.sh` refuses to run while the target application is open. macOS holds
preferences in memory and rewrites the domain when the app quits, so anything
imported underneath a running app is silently discarded.

`write.sh` overwrites the current value of every allowlisted key, so on a
machine you have already configured it will discard local changes. Run
`read.sh` first if you want to keep them.

## Adding another application

This is deliberately a short list rather than a general preference sync. Most
applications are worse behaved than Dato: they store state in binary blobs, or
keep licence keys in the same domain as the settings, which cannot go in a
public repository.

To add one, find its domain, write a `.conf` with an allowlist, run `read.sh`,
and read the resulting plist before committing it.

```sh
defaults domains | tr ',' '\n' | grep -i <name>
defaults read <domain>
```
