# OMP Herdsman

**Asynchronous multi-agent orchestration for [oh-my-pi (OMP)](https://github.com/can1357/oh-my-pi).**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

OMP Herdsman is maintained by the HERAKLES project. It is our open-source OMP port of [boadij/pi-herdsman](https://github.com/boadij/pi-herdsman), with upstream attribution preserved in [NOTICE](NOTICE). It is a distinct open-source extension, not a claim that all of HERAKLES has been published here.

## What it does

- Delegates independent assignments to managed subagents asynchronously; the lead can continue working.
- Tracks agent ownership, identity, lifecycle states, handoffs, and terminal outcomes.
- Supports nested delegation and owner questions using the agent-facing coordination API.
- Provides the `/herdsman` surface for managed agent coordination in supported Herdr/OMP sessions.
- Ports the integration to OMP 18.x and `herdr:omp` agent identity/state hooks.
- Includes source, tests, release tooling, and container examples.

**Scope:** Existing Herdsman integration uses Herdr for agent runtime control. HERAKLES also develops a separate Tern-native transport and operator surface (`tern-link`, HTERM, LOBI, Agent Fleet). Those systems are **not** bundled into this package, and a fully verified Tern-native cutover is **not** claimed.

## Requirements

- Node.js >= 22.19
- OMP (`@oh-my-pi/pi-coding-agent`) >= 18
- A compatible Herdr runtime for Herdr-managed panes and their state integration

## Install from this source checkout

```bash
npm install
npm run build
omp install . --force
omp plugin enable omp-herdsman
herdr integration install omp
```

Start OMP in a supported Herdr-managed pane, then open `/herdsman`. OMP's native `/agents` command is separate and remains available.

The `herdr integration install omp` command installs the OMP pane state hook. Installation does not implicitly start or migrate running agents.

## Use

In a supported OMP session, request work naturally:

```text
Delegate repository discovery to a scout agent, then report the evidence.
```

The structured agent-facing API includes `agent_list`, `agent_delegate`, continuation, control and owner-question flows. See [agent API](docs/agent-api.md) for contract links. Running tools or status UIs are **not** proof of final task acceptance.

## Architecture and boundaries

```text
                 OMP lead / controller
                          |
                  OMP Herdsman extension
                   /         |          \
          agent lifecycle  owner/mailbox  TUI /herdsman
                   \         |          /
                  Herdr OMP runtime
                  (herdr:omp identity)
                          |
                    subagent panes

HERAKLES (separate project / integration track)
LOBI / Agent Fleet -> HTERM / TernManager -> tern-link -> Tern agents
                                      \-> HOS / JEV receipts
```

The Tern integration track is **in development**. A Tern pane, a logical fleet member, an OMP session and a Kubernetes pod have different identities. Read the [architecture notes](docs/architecture-integration.md) for the documented integration boundary and current status.

## Development

```bash
npm run build
npm run check
npm test
npm run smoke
npm run package:audit
```

Build and runtime smoke evidence for the OMP 18.x port exists in HERAKLES local integration receipts. **Do not assume the full test suite is green:** earlier validation found OMP TypeScript loading and upstream Pi-specific test expectations that still require migration. Run the checks for your revision before reporting success.

## Documentation

- [Getting started (legacy Pi-to-OMP migration pending)](docs/getting-started.md)
- [Agent coordination API](docs/agent-api.md)
- [Architecture and Tern-native integration status](docs/architecture-integration.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

> Documentation note: several detailed guides were inherited from upstream Pi Herdsman and still mention `pi`, `pi-herdsman`, or the original version ranges. This README describes the OMP port; those pages are retained as reference material until individually migrated and verified.

## Attribution and licensing

Apache-2.0. Copyright of this port belongs to its contributors; upstream source and rights belong to their respective authors. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

HERAKLES, LOBI, HTERM and Tern Link are separate projects and are not implied dependencies or bundled code in this repository.
