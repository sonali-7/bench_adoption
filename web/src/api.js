export async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "Request failed.");
    error.status = res.status;
    error.body = data;
    throw error;
  }
  return data;
}

export const api = {
  meta: () => fetchJson("/api/meta"),
  benches: () => fetchJson("/api/benches"),
  park: () => fetchJson("/api/park-boundary"),
  trails: () => fetchJson("/api/trails"),
  proposals: () => fetchJson("/api/proposals"),
  propose: (payload) =>
    fetchJson("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  crowdsourceBench: (payload) =>
    fetchJson("/api/benches/crowdsource", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  submitAdoptionRequest: (payload) =>
    fetchJson("/api/adoption-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};
