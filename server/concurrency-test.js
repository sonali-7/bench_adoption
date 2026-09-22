/**
 * Two overlapping adoption request attempts against the same available bench.
 * The second request must fail because a pending request already exists.
 */
const API = process.env.API_URL || "http://localhost:3001";

async function main() {
  const res = await fetch(`${API}/api/benches`);
  const { benches } = await res.json();
  const available = benches.filter((b) => b.adoption_status === "available");
  if (available.length === 0) {
    throw new Error("Need at least one available bench. Restart the API server.");
  }
  const benchId = available[0].bench_id;
  const payloadA = {
    benchId,
    requesterName: "Concurrency Test A",
    contact: "a@example.org",
    durationMonths: 12,
    message: "First concurrent request",
  };
  const payloadB = {
    benchId,
    requesterName: "Concurrency Test B",
    contact: "b@example.org",
    durationMonths: 12,
    message: "Second concurrent request",
  };

  const [a, b] = await Promise.all([
    fetch(`${API}/api/adoption-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadA),
    }),
    fetch(`${API}/api/adoption-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadB),
    }),
  ]);

  const bodyA = await a.json();
  const bodyB = await b.json();
  const statuses = [a.status, b.status].sort();
  console.log("HTTP statuses", a.status, b.status);
  console.log("A", bodyA.error || bodyA.bench?.adoption_status, bodyA.request?.requester_name);
  console.log("B", bodyB.error || bodyB.bench?.adoption_status, bodyB.request?.requester_name);

  if (!(statuses[0] === 201 && statuses[1] === 409)) {
    throw new Error("Expected one 201 and one 409 concurrent adoption request result.");
  }
  const conflict = a.status === 409 ? bodyA : bodyB;
  if (!String(conflict.error).includes("already pending review")) {
    throw new Error("Conflict payload missing required user-facing message.");
  }
  console.log("Concurrency check passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
