import type { Message } from "@oh-my-pi/pi-ai";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent";
import { customMessageEntryMessage } from "@oh-my-pi/pi-tui/chat/transcript-entry";

export interface ProjectedSessionEntry {
  sourceEntry: SessionEntry;
  messages: Message[];
}

export function buildSessionProjection(
  entries: readonly SessionEntry[],
): { entries: ProjectedSessionEntry[] } {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: SessionEntry[] = [];
  const visited = new Set<string>();

  for (let entry = entries.at(-1); entry && !visited.has(entry.id); ) {
    visited.add(entry.id);
    branch.push(entry);
    entry = entry.parentId ? entriesById.get(entry.parentId) : undefined;
  }
  branch.reverse();

  return {
    entries: branch.map((sourceEntry) => ({
      sourceEntry,
      messages:
        sourceEntry.type === "message"
          ? [sourceEntry.message]
          : sourceEntry.type === "custom_message"
            ? [customMessageEntryMessage(sourceEntry)].filter(
                (message): message is Message => message !== undefined,
              )
            : [],
    })),
  };
}
