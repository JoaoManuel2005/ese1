"use client";

import React from "react";
import FileUploader from "../../components/FileUploader";
import useFiles from "../../hooks/useFiles";
import { AttachedFile } from "../../types";

export default function Page() {
  const { files, setFiles, addFiles, removeFile } = useFiles([]);

  function handleAdd(fileList: File[]) {
    const attached = fileList.map((f) => ({
      name: f.name,
      type: f.type,
      size: f.size,
      isText: false,
      file: f,
    })) as AttachedFile[];
    addFiles(attached);
  }

  function handleRemove(index: number) {
    removeFile(index);
  }

  function clearFiles() {
    setFiles([]);
  }

  return (
    <main style={{ padding: 20 }}>
      <h1>FileUploader demo</h1>
      <FileUploader files={files} onAdd={handleAdd} onRemove={handleRemove} clearFiles={clearFiles} />

      <section style={{ marginTop: 20 }}>
        <h2>Files (debug)</h2>
        <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(files, null, 2)}</pre>
      </section>
    </main>
  );
}
