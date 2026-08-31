# setup

Configuration that lives in a service rather than on the machine.

Nothing here is executable and `setup.sh` does not read it. A new Mac signs in
and the state arrives on its own; what these files record is the *shape* of a
setup, so it can be rebuilt deliberately or reviewed when it drifts.

Everything here is sanitised. This repository is public, so names of people,
employers, products and internal initiatives are replaced with placeholders,
and service-side identifiers are dropped entirely. Placeholders follow the
convention used elsewhere in this repository: `Acme`, `octocat`, `<person>`.

Read [todoist.md](todoist.md) for what that looks like in practice.
