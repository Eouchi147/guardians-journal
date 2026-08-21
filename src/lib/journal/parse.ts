export type ParsedEntry = {
  title: string;
  dek: string;
  tags: string;
  body: string;
  flagged: string | null;
  raw: string;
};

const HEADERS = ["TITLE", "DEK", "TAGS", "BODY", "FLAGGED"] as const;

export function parseEntry(raw: string): ParsedEntry | null {
  const text = stripFences(raw).replace(/\r\n/g, "\n").trim();
  if (!text) return null;

  const positions: { header: (typeof HEADERS)[number]; index: number }[] = [];
  for (const header of HEADERS) {
    const re = new RegExp(`^${header}\\s*$`, "m");
    const match = re.exec(text);
    if (match && match.index !== undefined) {
      positions.push({ header, index: match.index });
    }
  }

  if (!positions.some((p) => p.header === "TITLE")) return null;
  if (!positions.some((p) => p.header === "BODY")) return null;

  positions.sort((a, b) => a.index - b.index);

  const sections: Record<string, string> = {};
  for (let i = 0; i < positions.length; i++) {
    const current = positions[i]!;
    const start = current.index + current.header.length;
    const end = i + 1 < positions.length ? positions[i + 1]!.index : text.length;
    sections[current.header] = text.slice(start, end).trim();
  }

  return {
    title: sections.TITLE ?? "",
    dek: sections.DEK ?? "",
    tags: sections.TAGS ?? "",
    body: sections.BODY ?? "",
    flagged: sections.FLAGGED ? sections.FLAGGED : null,
    raw: text,
  };
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
}

export function formatEntry(entry: ParsedEntry): string {
  const parts = [
    "TITLE",
    entry.title,
    "",
    "DEK",
    entry.dek,
    "",
    "TAGS",
    entry.tags,
    "",
    "BODY",
    entry.body,
  ];
  if (entry.flagged) {
    parts.push("", "FLAGGED", entry.flagged);
  }
  return parts.join("\n");
}
