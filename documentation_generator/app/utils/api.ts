export async function fetchModels() {
  const res = await fetch("/api/models");
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return Array.isArray(data?.models) ? data.models : [];
}

export async function fetchLocalModels() {
  const res = await fetch("/api/local-models");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Add other wrappers as needed
