# OMP Herdsman

Fork/port of [pi-herdsman](https://github.com/boadij/pi-herdsman) for **omp** (`@oh-my-pi/pi-coding-agent`).

Apache-2.0. Upstream: boadij/pi-herdsman.

## Status

- OMP 18.x dependencies and runtime APIs; Herdr agent kind, identity, and state integration use `omp` / `herdr:omp`.
- `npm run build` creates `dist/index.js`.
- `herdr integration install omp` installs the current OMP pane-state hook.
- Runtime smoke-tested: extension loads in OMP and `/herdsman` registers.

## Install (development)

```sh
npm install
npm run build
omp install . --force
omp plugin enable omp-herdsman
herdr integration install omp
```

In a Herdr OMP pane, run `/herdsman`. OMP's built-in `/agents` remains separate.

## Validation and known differences

- Verified: `npm run build`, OMP startup, and `/herdsman` menu in a Herdr OMP pane.
- `npm run check` and `npm test` are not green: Node 22 cannot load OMP TypeScript sources from `node_modules`, and migrated tests still contain Pi-specific expectations.
- OMP has `registerMessageRenderer` but no `registerEntryRenderer`; custom-entry visual parity is not complete.

## Difference from pi-herdsman

| | pi-herdsman | omp-herdsman |
|---|---|---|
| runtime | `@earendil-works/pi` | `@oh-my-pi/*` 18.x / `omp` |
| herdr kind | `pi` | `omp` |
| session source | `herdr:pi` | `herdr:omp` |
| agent-state | `herdr-agent-state.ts` | `herdr-omp-agent-state.ts` |
