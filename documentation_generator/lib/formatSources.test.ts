import { describe, it, expect } from "vitest";
import { formatSources } from "./formatSources";

describe("formatSources", () => {
  it("returns empty array for null or undefined", () => {
    expect(formatSources(null as any)).toEqual([]);
    expect(formatSources(undefined as any)).toEqual([]);
  });

  it("returns empty array for non-array input", () => {
    expect(formatSources({} as any)).toEqual([]);
  });

  it("returns empty array for empty chunks", () => {
    expect(formatSources([])).toEqual([]);
  });

  it("uses chunk.source when present", () => {
    const result = formatSources([
      { source: "/path/to/doc.pdf", content: "snippet" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      label: "doc.pdf",
      path: "/path/to/doc.pdf",
      snippet: "snippet",
    });
  });

  it("uses metadata.source when source is missing", () => {
    const result = formatSources([
      { metadata: { source: "folder/file.md" }, content: "text" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("folder/file.md");
    expect(result[0].label).toBe("file.md");
  });

  it("uses metadata.filename when source and metadata.source are missing", () => {
    const result = formatSources([
      { metadata: { filename: "notes.txt" }, text: "snippet" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("notes.txt");
    expect(result[0].label).toBe("notes.txt");
    expect(result[0].snippet).toBe("snippet");
  });

  it("deduplicates by path (case-insensitive)", () => {
    const result = formatSources([
      { source: "/a/doc.pdf", content: "1" },
      { source: "/a/DOC.PDF", content: "2" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("/a/doc.pdf");
  });

  it("skips chunks with no source path", () => {
    const result = formatSources([
      { content: "no path" },
      { metadata: {}, text: "empty meta" },
    ]);
    expect(result).toEqual([]);
  });

  it("extracts filename from path with backslashes", () => {
    const result = formatSources([
      { source: "folder\\sub\\file.json", content: "x" },
    ]);
    expect(result[0].label).toBe("file.json");
  });

  it("returns Unknown for empty source string", () => {
    const result = formatSources([
      { source: "", metadata: { source: "" }, content: "x" },
    ]);
    expect(result).toHaveLength(0);
  });

  it("handles multiple chunks with different sources", () => {
    const result = formatSources([
      { source: "a.pdf", content: "a" },
      { source: "b.md", content: "b" },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.label)).toEqual(["a.pdf", "b.md"]);
  });
});
