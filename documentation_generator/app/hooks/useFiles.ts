import { useCallback, useState } from "react";
import { AttachedFile } from "../types";

export default function useFiles(initial: AttachedFile[] = []) {
  const [files, setFiles] = useState<AttachedFile[]>(initial);

  const addFiles = useCallback((newFiles: AttachedFile[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateFileText = useCallback((index: number, text: string) => {
    setFiles((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], text };
      }
      return next;
    });
  }, []);

  return {
    files,
    setFiles,
    addFiles,
    removeFile,
    updateFileText,
  } as const;
}
