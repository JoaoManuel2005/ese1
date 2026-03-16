export type MarkdownNormalizationContext = "document" | "chat";

type NormalizeMarkdownWhitespaceOptions = {
  context?: MarkdownNormalizationContext;
};

const FENCE_PATTERN = /^([ \t]*)(`{3,}|~{3,})/;
const MARKDOWN_STRUCTURE_PATTERN = /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|(\|[^|]+)+\||-{3,}$|\*{3,}$)/;
const MERMAID_PATTERN = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph)\b/m;
const MERMAID_CONNECTOR_PATTERN = /-->|==>|-.->|---|\bsubgraph\b|:::/;
const CODE_KEYWORD_PATTERN =
  /^(const|let|var|function|class|if|else|for|while|switch|case|return|import|export|async|await|public|private|protected|interface|type|enum|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|FROM|WHERE)\b/;

function getIndentWidth(line: string) {
  let width = 0;

  for (const char of line) {
    if (char === " ") {
      width += 1;
      continue;
    }
    if (char === "\t") {
      width += 4;
      continue;
    }
    break;
  }

  return width;
}

function stripIndent(line: string, width: number) {
  if (!line) return line;

  let remaining = width;
  let index = 0;

  while (index < line.length && remaining > 0) {
    const char = line[index];
    if (char === " ") {
      remaining -= 1;
      index += 1;
      continue;
    }
    if (char === "\t") {
      remaining -= 4;
      index += 1;
      continue;
    }
    break;
  }

  return line.slice(index);
}

function splitVisibleLines(markdown: string) {
  const lines = markdown.split("\n");
  const visibleIndexes: number[] = [];
  let inFence = false;
  let activeFenceChar = "";
  let activeFenceLength = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(FENCE_PATTERN);

    if (fenceMatch) {
      const fenceToken = fenceMatch[2];
      const fenceChar = fenceToken[0];
      const fenceLength = fenceToken.length;

      if (!inFence) {
        inFence = true;
        activeFenceChar = fenceChar;
        activeFenceLength = fenceLength;
        continue;
      }

      if (fenceChar === activeFenceChar && fenceLength >= activeFenceLength) {
        inFence = false;
        activeFenceChar = "";
        activeFenceLength = 0;
      }
      continue;
    }

    if (!inFence && line.trim() !== "") {
      visibleIndexes.push(index);
    }
  }

  return { lines, visibleIndexes };
}

function looksLikeMermaidText(markdown: string) {
  return MERMAID_PATTERN.test(markdown) || MERMAID_CONNECTOR_PATTERN.test(markdown);
}

function looksLikeCodeBlock(markdown: string) {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (lines.length === 0) return false;

  let score = 0;
  for (const line of lines) {
    if (CODE_KEYWORD_PATTERN.test(line)) score += 2;
    if (/^[A-Za-z_$][\w$]*\s*[:=]/.test(line)) score += 1;
    if (/[{}();<>]/.test(line)) score += 1;
  }

  return score >= Math.max(3, Math.ceil(lines.length / 2));
}

function looksLikeMarkdownContent(markdown: string, context: MarkdownNormalizationContext) {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return false;
  if (lines.some((line) => MARKDOWN_STRUCTURE_PATTERN.test(line))) return true;

  const sentenceLikeLines = lines.filter(
    (line) =>
      !looksLikeCodeBlock(line) &&
      !looksLikeMermaidText(line) &&
      line.split(/\s+/).length >= 3 &&
      /[A-Za-z]/.test(line)
  );

  if (sentenceLikeLines.length >= 1) return true;
  return context === "document" && lines.length === 1 && /[A-Za-z]/.test(lines[0]);
}

export function normalizeMarkdownWhitespace(
  markdown: string,
  options: NormalizeMarkdownWhitespaceOptions = {}
) {
  if (!markdown) return markdown;

  const context = options.context ?? "document";
  const normalizedNewlines = markdown.replace(/\r\n?/g, "\n");
  const { lines, visibleIndexes } = splitVisibleLines(normalizedNewlines);

  if (visibleIndexes.length === 0) return normalizedNewlines;

  const visibleIndents = visibleIndexes.map((index) => getIndentWidth(lines[index]));
  const allVisibleLinesIndented = visibleIndents.every((indentWidth) => indentWidth >= 4);
  if (!allVisibleLinesIndented) return normalizedNewlines;

  const commonIndent = Math.min(...visibleIndents);
  if (commonIndent < 4) return normalizedNewlines;

  const dedentedLines = lines.map((line) => stripIndent(line, commonIndent));
  const candidate = dedentedLines.join("\n");
  const { lines: candidateLines, visibleIndexes: candidateVisibleIndexes } = splitVisibleLines(candidate);
  const candidateVisible = candidateVisibleIndexes
    .map((index) => candidateLines[index])
    .join("\n")
    .trim();

  if (!candidateVisible) return normalizedNewlines;
  if (looksLikeMermaidText(candidateVisible) || looksLikeCodeBlock(candidateVisible)) {
    return normalizedNewlines;
  }
  if (!looksLikeMarkdownContent(candidateVisible, context)) {
    return normalizedNewlines;
  }

  return candidate;
}
