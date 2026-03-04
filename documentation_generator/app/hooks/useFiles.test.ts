import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useFiles from "./useFiles";
import type { AttachedFile } from "../types";

function makeFile(overrides: Partial<AttachedFile> = {}): AttachedFile {
  return {
    name: "test.txt",
    type: "text/plain",
    size: 100,
    isText: true,
    ...overrides,
  };
}

describe("useFiles", () => {
  it("returns initial files", () => {
    const initial: AttachedFile[] = [makeFile({ name: "a.txt" })];
    const { result } = renderHook(() => useFiles(initial));
    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0].name).toBe("a.txt");
  });

  it("returns empty array when no initial", () => {
    const { result } = renderHook(() => useFiles());
    expect(result.current.files).toEqual([]);
  });

  it("addFiles appends files", () => {
    const { result } = renderHook(() => useFiles());
    const toAdd = [makeFile({ name: "1.txt" }), makeFile({ name: "2.txt" })];

    act(() => {
      result.current.addFiles(toAdd);
    });

    expect(result.current.files).toHaveLength(2);
    expect(result.current.files[0].name).toBe("1.txt");
    expect(result.current.files[1].name).toBe("2.txt");
  });

  it("removeFile removes by index", () => {
    const initial = [makeFile({ name: "a" }), makeFile({ name: "b" }), makeFile({ name: "c" })];
    const { result } = renderHook(() => useFiles(initial));

    act(() => {
      result.current.removeFile(1);
    });

    expect(result.current.files).toHaveLength(2);
    expect(result.current.files[0].name).toBe("a");
    expect(result.current.files[1].name).toBe("c");
  });

  it("updateFileText updates text at index", () => {
    const initial = [makeFile({ name: "a.txt", text: "old" })];
    const { result } = renderHook(() => useFiles(initial));

    act(() => {
      result.current.updateFileText(0, "new content");
    });

    expect(result.current.files[0].text).toBe("new content");
  });

  it("updateFileText does nothing for out-of-range index", () => {
    const initial = [makeFile({ name: "a.txt", text: "x" })];
    const { result } = renderHook(() => useFiles(initial));

    act(() => {
      result.current.updateFileText(99, "y");
    });

    expect(result.current.files[0].text).toBe("x");
  });
});
