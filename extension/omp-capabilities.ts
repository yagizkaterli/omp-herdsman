import { execFileSync, execSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { herdsmanDataRoot, herdsmanTempRoot } from "./storage.ts";

/** Long CLI flag name without leading dashes (e.g. "no-tools"). */
export type OmpFlagName = string;

export type OmpCapabilities = {
  version: string;
  flags: ReadonlySet<OmpFlagName>;
  /** Built-in tool names accepted by `--tools` (when known). */
  builtinTools: ReadonlySet<string>;
  source: "live" | "cache" | "fallback";
  detectedAt: string;
};

export type ContextInheritIntent = {
  inheritProjectContext: boolean;
  inheritGlobalContext: boolean;
};

export type LaunchMapInput = {
  /** Emit project-trust approve intent (Pi: --approve). */
  approveProject?: boolean;
  model?: string;
  thinking?: string;
  systemPromptMode?: "append" | "replace";
  bodyPromptPath?: string;
  sharedPromptPath?: string;
  managedAgentName?: string;
  context: ContextInheritIntent;
  /** Extra context file paths to re-append after suppression. */
  appendContextPaths?: string[];
  noTools?: boolean;
  noBuiltinTools?: boolean;
  /** Configured tool allowlist (unnormalized). */
  tools?: string[];
  excludeTools?: string[];
  /** Tools the runtime must keep even when not in frontmatter (managed). */
  requiredTools?: string[];
  /** Tool names that must never appear on the CLI allowlist (extension-owned). */
  extensionOnlyTools?: string[];
  noSkills?: boolean;
  /** Skill paths or globs from frontmatter. */
  skills?: string[];
  noExtensions?: boolean;
  extensions?: string[];
  /** Directory for generated overlay files. */
  overlayDir?: string;
};

const FLAG_RE = /^\s+--([a-z0-9-]+)(?:[=\s]|$)/gm;

/** omp 18.8.6 flags measured 2026-10-12 on the lead workstation. */
export const OMP_18_8_6_FLAGS: readonly OmpFlagName[] = [
  "add-dir",
  "advisor",
  "alias",
  "allow-home",
  "api-key",
  "append-system-prompt",
  "approval-mode",
  "auto-approve",
  "config",
  "cwd",
  "export",
  "external-thinking",
  "from-claude",
  "from-codex",
  "goal",
  "hide-thinking",
  "hook",
  "max-time",
  "mode",
  "model",
  "models",
  "no-extensions",
  "extension",
  "no-lsp",
  "no-prewalk",
  "no-pty",
  "no-rules",
  "no-session",
  "no-skills",
  "no-title",
  "no-tools",
  "no-ui",
  "plan",
  "plan-yolo",
  "plan-yolo-into",
  "plugin-dir",
  "prewalk",
  "prewalk-into",
  "print-thoughts",
  "profile",
  "provider",
  "service-tier",
  "session-dir",
  "skills",
  "slow",
  "smol",
  "system-prompt",
  "system-prompt-template",
  "thinking",
  "tools",
] as const;

/** Built-ins from omp 18.8.6 unknown-tool error text (2026-10-12). */
export const OMP_18_8_6_BUILTIN_TOOLS: readonly string[] = [
  "read",
  "bash",
  "edit",
  "ast_grep",
  "ast_edit",
  "ask",
  "debug",
  "ida",
  "eval",
  "github",
  "glob",
  "grep",
  "find",
  "lsp",
  "checkpoint",
  "rewind",
  "context_notes",
  "new_context",
  "security_scan",
  "task",
  "wait",
  "todo",
  "web_search",
  "write",
  "memory_edit",
  "retain",
  "recall",
  "reflect",
  "learn",
  "manage_skill",
] as const;

/** Pi-era flags herdsman historically emitted (for tests / older runtimes). */
export const PI_LEGACY_FLAGS: readonly OmpFlagName[] = [
  ...OMP_18_8_6_FLAGS,
  "approve",
  "no-context-files",
  "no-builtin-tools",
  "exclude-tools",
  "skill",
  "no-prompt-templates",
  "extension",
] as const;

const CONTEXT_FILE_PROJECT = [
  "context-file:project:AGENTS.md",
  "context-file:project:CLAUDE.md",
  "context-file:project:GEMINI.md",
  "context-file:project:copilot-instructions.md",
] as const;

const CONTEXT_FILE_USER = [
  "context-file:user:AGENTS.md",
  "context-file:user:CLAUDE.md",
  "context-file:user:GEMINI.md",
  "context-file:user:copilot-instructions.md",
] as const;

/** Common Pi → omp tool renames. */
export const TOOL_ALIASES: Readonly<Record<string, string>> = {
  ls: "glob",
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_OMP_BIN = process.env.OMP_BIN?.trim() || "omp";
const WINDOWS_SHELL_UNSAFE = /[&|<>^()%!\r\n"]/;

let sharedCapabilities: OmpCapabilities | undefined;

export function ompCapabilitiesFallback(
  version = "18.8.6",
): OmpCapabilities {
  return freezeCapabilities({
    version,
    flags: new Set(OMP_18_8_6_FLAGS),
    builtinTools: new Set(OMP_18_8_6_BUILTIN_TOOLS),
    source: "fallback",
    detectedAt: new Date().toISOString(),
  });
}

export function ompCapabilitiesPiLegacy(
  version = "pi-legacy",
): OmpCapabilities {
  return freezeCapabilities({
    version,
    flags: new Set(PI_LEGACY_FLAGS),
    builtinTools: new Set(OMP_18_8_6_BUILTIN_TOOLS),
    source: "fallback",
    detectedAt: new Date().toISOString(),
  });
}

export function parseOmpHelpFlags(helpText: string): Set<OmpFlagName> {
  const flags = new Set<OmpFlagName>();
  FLAG_RE.lastIndex = 0;
  for (const match of helpText.matchAll(FLAG_RE)) {
    const name = match[1];
    if (name) flags.add(name);
  }
  // Short -e form is documented as --extension in some builds; accept both.
  if (helpText.includes(" --extension") || helpText.includes("\n  -e, "))
    flags.add("extension");
  if (helpText.includes(" --plugin-dir") || /\b-e\b/.test(helpText)) {
    // plugin-dir already captured; -e may map to extension or plugin-dir.
    if (!flags.has("extension") && helpText.includes("Load plugin"))
      flags.add("extension");
  }
  return flags;
}

export function parseOmpBuiltinTools(errorOrHelpText: string): Set<string> {
  const tools = new Set<string>();
  const match = errorOrHelpText.match(
    /Built-in tools:\s*([^.]+?)(?:\.\s*Other registered tools:|\.\s*Run `omp|\.$)/s,
  );
  if (!match?.[1]) return tools;
  for (const part of match[1].split(",")) {
    const name = part.trim();
    if (name) tools.add(name);
  }
  return tools;
}

export function hasFlag(
  caps: OmpCapabilities,
  name: OmpFlagName,
): boolean {
  return caps.flags.has(name);
}

function freezeCapabilities(caps: OmpCapabilities): OmpCapabilities {
  return {
    version: caps.version,
    flags: caps.flags,
    builtinTools: caps.builtinTools,
    source: caps.source,
    detectedAt: caps.detectedAt,
  };
}

function cachePath(cacheDir?: string): string {
  return join(cacheDir ?? herdsmanDataRoot(), "omp-capabilities.json");
}

type CacheFile = {
  version: string;
  flags: string[];
  builtinTools?: string[];
  detectedAt: string;
};

export function loadCachedCapabilities(
  cacheDir?: string,
  ttlMs = CACHE_TTL_MS,
): OmpCapabilities | undefined {
  try {
    const path = cachePath(cacheDir);
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (
      typeof parsed?.version !== "string" ||
      !parsed.version ||
      !Array.isArray(parsed.flags) ||
      !parsed.flags.every((flag) => typeof flag === "string") ||
      (parsed.builtinTools !== undefined &&
        (!Array.isArray(parsed.builtinTools) ||
          !parsed.builtinTools.every((tool) => typeof tool === "string"))) ||
      typeof parsed.detectedAt !== "string"
    )
      return undefined;
    const age = Date.now() - Date.parse(parsed.detectedAt);
    if (!Number.isFinite(age) || age < 0 || age > ttlMs) return undefined;
    return freezeCapabilities({
      version: parsed.version,
      flags: new Set(parsed.flags),
      builtinTools: new Set(parsed.builtinTools ?? OMP_18_8_6_BUILTIN_TOOLS),
      source: "cache",
      detectedAt: parsed.detectedAt,
    });
  } catch {
    return undefined;
  }
}

export function saveCachedCapabilities(
  caps: OmpCapabilities,
  cacheDir?: string,
): void {
  const dir = cacheDir ?? herdsmanDataRoot();
  mkdirSync(dir, { recursive: true });
  const payload: CacheFile = {
    version: caps.version,
    flags: [...caps.flags].sort(),
    builtinTools: [...caps.builtinTools].sort(),
    detectedAt: caps.detectedAt,
  };
  writeFileSync(cachePath(dir), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function runOmp(
  ompBin: string,
  args: string[],
): { stdout: string; stderr: string; status: number | null } {
  try {
    let stdout: string;
    if (process.platform === "win32") {
      const tokens = [ompBin, ...args];
      if (tokens.some((token) => WINDOWS_SHELL_UNSAFE.test(token))) {
        throw new Error("OMP command contains unsupported cmd.exe syntax");
      }
      stdout = execSync(tokens.map((token) => "\"" + token + "\"").join(" "), {
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      stdout = execFileSync(ompBin, args, {
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    return { stdout: stdout ?? "", stderr: "", status: 0 };
  } catch (error) {
    const err = error as {
      status?: number | null;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    return {
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
      status: err.status ?? 1,
    };
  }
}

export function detectOmpCapabilities(options?: {
  ompBin?: string;
  cacheDir?: string;
  ttlMs?: number;
  force?: boolean;
}): OmpCapabilities {
  const ompBin = options?.ompBin ?? DEFAULT_OMP_BIN;
  const cacheDir = options?.cacheDir;
  if (!options?.force) {
    const cached = loadCachedCapabilities(cacheDir, options?.ttlMs);
    if (cached) return cached;
  }

  try {
    const versionResult = runOmp(ompBin, ["--version"]);
    if (versionResult.status !== 0) return ompCapabilitiesFallback();
    const versionText = (versionResult.stdout + versionResult.stderr).trim();
    const version = versionText.match(/(\d+\.\d+\.\d+)/)?.[1];
    if (!version) return ompCapabilitiesFallback();

    const helpResult = runOmp(ompBin, ["--help"]);
    if (helpResult.status !== 0) return ompCapabilitiesFallback(version);
    const helpText = helpResult.stdout + "\n" + helpResult.stderr;
    const flags = parseOmpHelpFlags(helpText);
    if (flags.size === 0) return ompCapabilitiesFallback(version);

    // Probe built-in tool inventory via unknown-tool rejection (cheap, no model).
    let builtinTools = new Set<string>(OMP_18_8_6_BUILTIN_TOOLS);
    if (flags.has("tools")) {
      const probe = runOmp(ompBin, [
        "-p",
        "--mode",
        "text",
        "--no-session",
        "--no-title",
        "--tools",
        "herdsman_unknown_tool_probe_xyz",
        "x",
      ]);
      const probeText = `${probe.stdout}\n${probe.stderr}`;
      const parsed = parseOmpBuiltinTools(probeText);
      if (parsed.size > 0) builtinTools = parsed;
    }

    const caps = freezeCapabilities({
      version,
      flags,
      builtinTools,
      source: "live",
      detectedAt: new Date().toISOString(),
    });
    try {
      saveCachedCapabilities(caps, cacheDir);
    } catch {
      // Cache write is best-effort.
    }
    return caps;
  } catch {
    return ompCapabilitiesFallback();
  }
}

export function getSharedCapabilities(options?: {
  ompBin?: string;
  force?: boolean;
}): OmpCapabilities {
  if (!options?.force && sharedCapabilities) return sharedCapabilities;
  sharedCapabilities = detectOmpCapabilities(options);
  return sharedCapabilities;
}

export function setSharedCapabilitiesForTests(
  caps: OmpCapabilities | undefined,
): void {
  sharedCapabilities = caps;
}

export function writeContextDisableOverlay(options: {
  dir?: string;
  disableProject: boolean;
  disableUser: boolean;
  id?: string;
}): string | undefined {
  if (!options.disableProject && !options.disableUser) return undefined;
  const disabled: string[] = [];
  if (options.disableProject) disabled.push(...CONTEXT_FILE_PROJECT);
  if (options.disableUser) disabled.push(...CONTEXT_FILE_USER);
  const dir = options.dir ?? join(herdsmanTempRoot(), "overlays");
  mkdirSync(dir, { recursive: true });
  const id = options.id ?? `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = join(dir, `${id}.yml`);
  const body = `disabledExtensions:\n${disabled.map((d) => `  - ${d}`).join("\n")}\n`;
  writeFileSync(path, body, "utf8");
  return path;
}

export function normalizeToolName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return TOOL_ALIASES[trimmed] ?? TOOL_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * Filter + alias tool names for a CLI `--tools` allowlist.
 * Drops extension-only names (e.g. ask_owner) that fail CLI validation
 * before the extension registers them.
 */
export function filterToolsForCli(
  tools: Iterable<string>,
  caps: OmpCapabilities,
  options?: {
    extensionOnlyTools?: Iterable<string>;
    /** When true, keep names even if not in builtinTools (coordination). */
    allowUnknown?: boolean;
  },
): string[] {
  const extensionOnly = new Set(
    [...(options?.extensionOnlyTools ?? [])].map((t) => t.trim()),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tools) {
    const name = normalizeToolName(raw);
    if (!name || seen.has(name) || extensionOnly.has(name)) continue;
    if (
      !options?.allowUnknown &&
      caps.builtinTools.size > 0 &&
      !caps.builtinTools.has(name)
    )
      continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Map herdsman/Pi launch intent onto flags the installed omp accepts.
 * Never emits Pi-only flags: --approve, --no-context-files, --no-builtin-tools,
 * --exclude-tools, --skill, --no-prompt-templates.
 */
export function mapLaunchArgs(
  input: LaunchMapInput,
  caps: OmpCapabilities,
): string[] {
  const args: string[] = [];
  const has = (flag: OmpFlagName): boolean => caps.flags.has(flag);

  // Project trust is always on in omp 18.8.6; --approve does not exist.
  void input.approveProject;

  if (input.model !== undefined && has("model")) {
    args.push("--model", input.model);
  }
  if (input.thinking !== undefined && has("thinking")) {
    args.push("--thinking", input.thinking);
  }

  if (input.bodyPromptPath !== undefined) {
    const mode = input.systemPromptMode ?? "replace";
    if (mode === "append" && has("append-system-prompt")) {
      args.push("--append-system-prompt", input.bodyPromptPath);
    } else if (has("system-prompt")) {
      args.push("--system-prompt", input.bodyPromptPath);
    }
  }

  const inheritProject = input.context.inheritProjectContext === true;
  const inheritGlobal = input.context.inheritGlobalContext === true;
  // omp has no --no-context-files. When anything is withheld, disable both
  // context-file extensions and re-append only the wanted paths (see
  // appendContextPaths) so partial inherit cannot double-load via native
  // discovery.
  if ((!inheritProject || !inheritGlobal) && has("config")) {
    const overlay = writeContextDisableOverlay({
      dir: input.overlayDir,
      disableProject: true,
      disableUser: true,
      id:
        input.overlayDir === undefined
          ? undefined
          : `ctx-p${inheritProject ? 1 : 0}-u${inheritGlobal ? 1 : 0}`,
    });
    if (overlay) args.push("--config", overlay);
  }

  if (has("append-system-prompt")) {
    for (const path of input.appendContextPaths ?? []) {
      args.push("--append-system-prompt", path);
    }
    if (input.sharedPromptPath) {
      args.push("--append-system-prompt", input.sharedPromptPath);
    }
    if (input.managedAgentName) {
      args.push(
        "--append-system-prompt",
        `<active_agent name="${input.managedAgentName}"/>`,
      );
    }
  }

  const extensionOnly = new Set(
    [...(input.extensionOnlyTools ?? [])].map((t) => normalizeToolName(t)),
  );
  const required = [...(input.requiredTools ?? [])].map((t) =>
    normalizeToolName(t),
  );
  const requiredSet = new Set(required);
  const excluded = new Set(
    [...(input.excludeTools ?? [])]
      .map((t) => normalizeToolName(t))
      .filter((t) => t && !requiredSet.has(t)),
  );

  const disableBuiltins = input.noTools === true || input.noBuiltinTools === true;
  if (disableBuiltins && has("no-tools")) {
    args.push("--no-tools");
  }

  const explicitTools = input.tools !== undefined;
  const configured = explicitTools
    ? [...input.tools]
        .map((t) => normalizeToolName(t))
        .filter((t) => t && t !== "agent")
    : undefined;

  // Build CLI allowlist only when an explicit tools intent exists and builtins
  // are not fully disabled. Extension-only names never appear on --tools.
  if (!disableBuiltins && has("tools")) {
    let candidates: string[] | undefined;
    if (configured !== undefined) {
      candidates = [...new Set([...configured, ...required])];
    } else if (required.length > 0) {
      candidates = [...required];
    } else if (excluded.size > 0 && caps.builtinTools.size > 0) {
      candidates = [...caps.builtinTools];
    }
    if (candidates) {
      const kept = candidates.filter((t) => !excluded.has(t) || requiredSet.has(t));
      const cliTools = filterToolsForCli(kept, caps, {
        extensionOnlyTools: extensionOnly,
        allowUnknown: false,
      });
      if (cliTools.length) args.push("--tools", cliTools.join(","));
    }
  } else if (
    disableBuiltins &&
    has("tools") &&
    configured !== undefined &&
    configured.length > 0
  ) {
    // noTools + explicit non-empty tools: keep requested builtins on allowlist
    // (extension-only still stripped). omp may interpret this as re-enable.
    const kept = [...new Set([...configured, ...required])].filter(
      (t) => !excluded.has(t) || requiredSet.has(t),
    );
    const cliTools = filterToolsForCli(kept, caps, {
      extensionOnlyTools: extensionOnly,
      allowUnknown: false,
    });
    if (cliTools.length) args.push("--tools", cliTools.join(","));
  }

  if (input.noSkills === true && has("no-skills")) {
    args.push("--no-skills");
  }
  if (input.skills?.length && has("skills")) {
    // omp filters skill discovery via comma-separated globs; paths best-effort.
    args.push(`--skills=${input.skills.join(",")}`);
  }

  if (input.noExtensions === true && has("no-extensions")) {
    args.push("--no-extensions");
  }
  if (input.extensions?.length) {
    if (has("extension")) {
      for (const extension of input.extensions) {
        args.push("--extension", extension);
      }
    }
  }

  return args;
}

