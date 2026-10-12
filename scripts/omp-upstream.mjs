import { spawnSync } from "node:child_process";

const repository = "can1357/oh-my-pi";
const reportSchema = "omp-upstream-report-v1";
const usage = `Usage: npm run omp:upstream [-- --help|--dry-run]

Without an option, fetches the latest GitHub release metadata and compares
release-note long-option mentions with the local omp --help flags.
The report is JSON on stdout; the command does not download or execute an upstream build.
`;

class CommandFailure extends Error {
  constructor(command, args, { code, status, signal }) {
    const result = code ? `could not start (${code})` : `exited ${status ?? "unknown"}${signal ? ` (${signal})` : ""}`;
    super(`${command} ${args.join(" ")} ${result}`);
    this.command = command;
    this.args = args;
    this.code = code;
    this.status = status;
    this.signal = signal;
  }
}

function run(command, args) {
  const useWindowsCommandShell = process.platform === "win32" && command === "omp";
  const executable = useWindowsCommandShell ? process.env.ComSpec ?? "cmd.exe" : command;
  const executableArgs = useWindowsCommandShell ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args;

  const result = spawnSync(executable, executableArgs, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });

  if (result.error) {
    throw new CommandFailure(command, args, { code: result.error.code });
  }
  if (result.status !== 0) {
    throw new CommandFailure(command, args, { status: result.status, signal: result.signal });
  }
  return result.stdout ?? "";
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function localHelpFlags(help) {
  const flags = [];
  const plainHelp = help.replace(/\u001b\[[0-9;]*m/gu, "");

  for (const line of plainHelp.split(/\r?\n/u)) {
    const optionPrefix = line.match(/^\s*(?:-{1,2}[A-Za-z][A-Za-z0-9-]*(?:,?\s+)?)+/u)?.[0];
    if (!optionPrefix) continue;

    for (const match of optionPrefix.matchAll(/--[A-Za-z][A-Za-z0-9-]*/gu)) {
      flags.push(match[0]);
    }
  }

  return uniqueSorted(flags);
}

function releaseNoteFlags(body) {
  return uniqueSorted([...body.matchAll(/--[A-Za-z][A-Za-z0-9-]*/gu)].map(([flag]) => flag));
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function commandDescription(executable, args) {
  return { executable, args };
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(usage);
    return;
  }

  const commands = [
    commandDescription("gh", ["api", `repos/${repository}/releases/latest`]),
    commandDescription("omp", ["--version"]),
    commandDescription("omp", ["--help"]),
  ];

  if (args.length === 1 && args[0] === "--dry-run") {
    printJson({
      schema: reportSchema,
      mode: "dry-run",
      commands,
      output: "JSON to stdout; no files are written.",
      comparison: "Release-note option mentions versus local help flags; release notes are not a complete CLI reference.",
    });
    return;
  }

  if (args.length !== 0) {
    process.stderr.write(usage);
    process.exitCode = 2;
    return;
  }

  try {
    const releaseText = run("gh", commands[0].args);
    const release = JSON.parse(releaseText);
    if (!release || typeof release.tag_name !== "string") {
      throw new Error("GitHub release response is missing tag_name");
    }

    const version = run("omp", ["--version"]).trim();
    const help = run("omp", ["--help"]);
    const localFlags = localHelpFlags(help);
    const releaseFlags = releaseNoteFlags(typeof release.body === "string" ? release.body : "");
    const localSet = new Set(localFlags);
    const releaseSet = new Set(releaseFlags);

    printJson({
      schema: reportSchema,
      status: "ok",
      upstream: {
        repository,
        tag: release.tag_name,
        publishedAt: release.published_at ?? null,
        url: release.html_url ?? null,
        releaseNoteFlagMentions: releaseFlags,
      },
      local: {
        version,
        helpFlags: localFlags,
      },
      flagDiff: {
        basis: "upstream release-note long-option mentions compared with local omp --help long-option entries",
        localHelpFlagsNotMentionedInReleaseNotes: localFlags.filter((flag) => !releaseSet.has(flag)),
        releaseNoteMentionsNotInLocalHelp: releaseFlags.filter((flag) => !localSet.has(flag)),
      },
      limitations: [
        "Release notes are not a complete CLI reference; this report does not claim a full upstream --help comparison.",
        "No upstream release binary is downloaded or executed.",
      ],
    });
  } catch (error) {
    const missingCommand = error instanceof CommandFailure && error.code === "ENOENT";
    printJson({
      schema: reportSchema,
      status: missingCommand ? "OLCULMEDI" : "error",
      command: error instanceof CommandFailure ? [error.command, ...error.args].join(" ") : null,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

main();
