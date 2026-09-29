# OMP Herdsman

Fork/port of [pi-herdsman](https://github.com/boadij/pi-herdsman) for **omp** (`@oh-my-pi/pi-coding-agent`).

Apache-2.0. Upstream: boadij/pi-herdsman.

## Status (Herakles)

- Mechanical port: package peers `@oh-my-pi/*`, herdr `--kind omp`, session `herdr:omp`, agent-state `herdr-omp-agent-state.ts`
- Not drop-in complete until extension API + spawn dogfood pass under omp 18.x

## Install (dev)

```sh
cd /root/repos/omp-herdsman
npm install
npm run build
# link into omp extensions — TBD: omp install path
```

## Difference from pi-herdsman

| | pi-herdsman | omp-herdsman |
|---|---|---|
| runtime | @earendil-works/pi 0.87 | @oh-my-pi 18.x / omp CLI |
| herdr kind | pi | omp |
| session source | herdr:pi | herdr:omp |
| agent-state | herdr-agent-state.ts | herdr-omp-agent-state.ts |
