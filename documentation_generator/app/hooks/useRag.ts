import { useState } from "react";

export default function useRag() {
  const [ragStatus, setRagStatus] = useState<any | null>(null);

  // placeholder for ingesting and generating docs/chat
  return { ragStatus } as const;
}
