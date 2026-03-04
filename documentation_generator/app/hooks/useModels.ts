import { useEffect, useState } from "react";

export default function useModels() {
  const [models, setModels] = useState<string[]>([]);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // placeholder for fetching models
  }, []);

  return { models, localModels, loading, error } as const;
}
