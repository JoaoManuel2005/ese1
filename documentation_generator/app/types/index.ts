export type AttachedFile = {
  name: string;
  type: string;
  size: number;
  text?: string;
  truncated?: boolean;
  error?: string;
  isText: boolean;
  file?: File;
};

export type OutputFile = {
  id: string;
  filename: string;
  mime: string;
  createdAt: number;
  bytesBase64: string;
  htmlPreview?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: { label: string; path: string }[];
};

export type GenerateError = {
  message: string;
  code?: string;
  hint?: string;
};
