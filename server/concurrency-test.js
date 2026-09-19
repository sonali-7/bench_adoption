/**
 * Two overlapping adoption attempts against the same available bench.
 * The second request must fail with the civic conflict message.
 */
const API = process.env.API_URL || "http://localhost:3001";

async function main() {
  const res = await fetch(`${API}/api/benches`);
  const { benches } = await res.json();
  const available = benches.filter((b) => b.status === "available");
  if (available.length === 0) {
    throw new Error("Need at least one available bench. Reset server/var/bench-adoption.sqlite and restart.");
  }
  const benchId = available[0].bench_id;
  const payloadA = {
    benchId,
    adopterName: "Concurrency Test A",
    contact: "a@example.org",
    durationMonths: 12,
  };
  const payloadB = {
    benchId,
    adopterName: "Concurrency Test B",
    contact: "b@example.org",
    durationMonths: 12,
  };

  const [a, b] = await Promise.all([
    fetch(`${API}/api/adoptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadA),
    }),
    fetch(`${API}/api/adoptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadB),
    }),
  ]);

  const bodyA = await a.json();
  const bodyB = await b.json();
  const statuses = [a.status, b.status].sort();
  console.log("HTTP statuses", a.status, b.status);
  console.log("A", bodyA.error || bodyA.bench?.status, bodyA.bench?.adoption?.adopter_name);
  console.log("B", bodyB.error || bodyB.bench?.status, bodyB.bench?.adoption?.adopter_name);

  if (!(statuses[0] === 201 && statuses[1] === 409)) {
    throw new Error("Expected one 201 and one 409 concurrent adoption result.");
  }
  const conflict = a.status === 409 ? bodyA : bodyB;
  if (
    !String(conflict.error).includes(
      "This bench was just adopted by someone else. Please return to Explore to choose another available bench."
    )
  ) {
    throw new Error("Conflict payload missing required user-facing message.");
  }
  console.log("Concurrency check passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
