/**
 * Format source chunks from RAG retrieval into a standardized format
 * for display in the chat interface.
 */

interface RagChunk {
  source?: string;
  content?: string;
  text?: string;
  metadata?: {
    source?: string;
    filename?: string;
    [key: string]: unknown;
  };
}

interface FormattedSource {
  label: string;
  path: string;
  snippet?: string;
}

/**
 * Extracts a clean filename from a path or source string
 */
function extractFilename(source: string): string {
  if (!source) return "Unknown";
  // Handle various path formats
  const parts = source.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || source;
}

/**
 * Formats RAG chunks into a consistent source array for display
 */
export function formatSources(chunks: RagChunk[]): FormattedSource[] {
  if (!chunks || !Array.isArray(chunks)) {
    return [];
  }

  const seen = new Set<string>();
  const sources: FormattedSource[] = [];

  for (const chunk of chunks) {
    const sourcePath =
      chunk.source ||
      chunk.metadata?.source ||
      chunk.metadata?.filename ||
      "";

    if (!sourcePath || seen.has(sourcePath.toLowerCase())) {
      continue;
    }

    seen.add(sourcePath.toLowerCase());

    sources.push({
      label: extractFilename(sourcePath),
      path: sourcePath,
      snippet: chunk.content || chunk.text || undefined,
    });
  }

  return sources;
}
