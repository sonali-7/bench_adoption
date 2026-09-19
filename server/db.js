const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "server", "var");
const DB_PATH = path.join(DATA_DIR, "bench-adoption.sqlite");
const BENCHES_GIS = path.join(ROOT, "data", "processed", "benches.geojson");

const SAMPLE_ADOPTERS = [
  {
    name: "Demonstration: Rivera Family",
    contact: "demo-rivera@example.org",
    months: 36,
    adoptedDaysAgo: 140,
  },
  {
    name: "Demonstration: Friends of the Parade Ground",
    contact: "demo-parade@example.org",
    months: 60,
    adoptedDaysAgo: 400,
  },
  {
    name: "Demonstration: Van Cortlandt Track Club",
    contact: "demo-track@example.org",
    months: 12,
    adoptedDaysAgo: 80,
  },
  {
    name: "Demonstration: Mosholu Birders",
    contact: "demo-birders@example.org",
    months: 36,
    adoptedDaysAgo: 20,
  },
  {
    name: "Demonstration: Woodlawn Neighbor Circle",
    contact: "demo-woodlawn@example.org",
    months: 60,
    adoptedDaysAgo: 900,
  },
];

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

function daysFromNow(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function remainingLabel(expirationDate) {
  const now = new Date();
  const end = new Date(expirationDate + "T00:00:00Z");
  const diffMs = end.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round(diffMs / 86400000);
  if (days < 0) {
    const overdue = Math.abs(days);
    return overdue === 1 ? "Expired 1 day ago" : `Expired ${overdue} days ago`;
  }
  if (days === 0) return "Expires today";
  if (days < 30) return days === 1 ? "1 day remaining" : `${days} days remaining`;
  const months = Math.round(days / 30.437);
  if (months < 18) return months === 1 ? "About 1 month remaining" : `About ${months} months remaining`;
  const years = Math.round(days / 365.25);
  return years === 1 ? "About 1 year remaining" : `About ${years} years remaining`;
}

function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS benches (
      bench_id TEXT PRIMARY KEY,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      gis_source TEXT NOT NULL,
      gis_id TEXT NOT NULL,
      osm_id INTEGER,
      osm_type TEXT,
      material TEXT,
      backrest TEXT,
      bench_type TEXT,
      gis_name TEXT,
      extra_json TEXT,
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'adopted'))
    );

    CREATE TABLE IF NOT EXISTS adoptions (
      adoption_id TEXT PRIMARY KEY,
      bench_id TEXT NOT NULL REFERENCES benches(bench_id),
      adopter_name TEXT NOT NULL,
      contact TEXT,
      adoption_date TEXT NOT NULL,
      duration_months INTEGER NOT NULL,
      expiration_date TEXT NOT NULL,
      is_sample INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_adoptions_bench ON adoptions(bench_id);

    CREATE TABLE IF NOT EXISTS bench_proposals (
      proposal_id TEXT PRIMARY KEY,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      reason TEXT NOT NULL,
      proposer_name TEXT,
      contact TEXT,
      submitted_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted'
    );
  `);
  return db;
}

function syncBenchesFromGis(db) {
  const fc = JSON.parse(fs.readFileSync(BENCHES_GIS, "utf8"));
  const upsert = db.prepare(`
    INSERT INTO benches (
      bench_id, latitude, longitude, gis_source, gis_id, osm_id, osm_type,
      material, backrest, bench_type, gis_name, extra_json, status
    ) VALUES (
      @bench_id, @latitude, @longitude, @gis_source, @gis_id, @osm_id, @osm_type,
      @material, @backrest, @bench_type, @gis_name, @extra_json, 'available'
    )
    ON CONFLICT(bench_id) DO UPDATE SET
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      gis_source = excluded.gis_source,
      gis_id = excluded.gis_id,
      osm_id = excluded.osm_id,
      osm_type = excluded.osm_type,
      material = excluded.material,
      backrest = excluded.backrest,
      bench_type = excluded.bench_type,
      gis_name = excluded.gis_name,
      extra_json = excluded.extra_json
  `);

  const sync = db.transaction((features) => {
    for (const feature of features) {
      const p = feature.properties;
      const [longitude, latitude] = feature.geometry.coordinates;
      upsert.run({
        bench_id: p.gis_id,
        latitude,
        longitude,
        gis_source: p.gis_source,
        gis_id: p.gis_id,
        osm_id: p.osm_id,
        osm_type: p.osm_type,
        material: p.material || null,
        backrest: p.backrest || null,
        bench_type: p.bench_type || null,
        gis_name: p.name || null,
        extra_json: JSON.stringify(p.extra || {}),
      });
    }
  });
  sync(fc.features);
}

function seedSampleAdoptions(db) {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM adoptions").get().n;
  if (existing > 0) return;

  const benches = db.prepare("SELECT bench_id FROM benches ORDER BY bench_id").all();
  const insert = db.prepare(`
    INSERT INTO adoptions (
      adoption_id, bench_id, adopter_name, contact, adoption_date,
      duration_months, expiration_date, is_sample, created_at
    ) VALUES (
      @adoption_id, @bench_id, @adopter_name, @contact, @adoption_date,
      @duration_months, @expiration_date, 1, @created_at
    )
  `);
  const mark = db.prepare("UPDATE benches SET status = 'adopted' WHERE bench_id = ?");

  const seed = db.transaction(() => {
    SAMPLE_ADOPTERS.forEach((sample, i) => {
      const bench = benches[i * 2];
      if (!bench) return;
      const adopted = daysFromNow(-sample.adoptedDaysAgo);
      const expires = addMonths(adopted, sample.months);
      insert.run({
        adoption_id: `sample-${i + 1}`,
        bench_id: bench.bench_id,
        adopter_name: sample.name,
        contact: sample.contact,
        adoption_date: isoDate(adopted),
        duration_months: sample.months,
        expiration_date: isoDate(expires),
        created_at: new Date().toISOString(),
      });
      mark.run(bench.bench_id);
    });
  });
  seed();
}

function currentAdoption(db, benchId) {
  return db
    .prepare(
      `SELECT * FROM adoptions
       WHERE bench_id = ?
       ORDER BY date(expiration_date) DESC, created_at DESC
       LIMIT 1`
    )
    .get(benchId);
}

function decorateBench(db, bench) {
  const adoption = bench.status === "adopted" ? currentAdoption(db, bench.bench_id) : null;
  return {
    bench_id: bench.bench_id,
    latitude: bench.latitude,
    longitude: bench.longitude,
    gis_source: bench.gis_source,
    gis_id: bench.gis_id,
    osm_id: bench.osm_id,
    osm_type: bench.osm_type,
    material: bench.material,
    backrest: bench.backrest,
    bench_type: bench.bench_type,
    gis_name: bench.gis_name,
    extra: bench.extra_json ? JSON.parse(bench.extra_json) : {},
    status: bench.status,
    adoption: adoption
      ? {
          adoption_id: adoption.adoption_id,
          adopter_name: adoption.adopter_name,
          contact: adoption.contact,
          adoption_date: adoption.adoption_date,
          duration_months: adoption.duration_months,
          expiration_date: adoption.expiration_date,
          is_sample: Boolean(adoption.is_sample),
          time_remaining: remainingLabel(adoption.expiration_date),
        }
      : null,
  };
}

function listBenches(db) {
  return db
    .prepare("SELECT * FROM benches ORDER BY bench_id")
    .all()
    .map((row) => decorateBench(db, row));
}

function getBench(db, benchId) {
  const row = db.prepare("SELECT * FROM benches WHERE bench_id = ?").get(benchId);
  return row ? decorateBench(db, row) : null;
}

function adoptBench(db, { benchId, adopterName, contact, durationMonths }) {
  const adopt = db.transaction(() => {
    const updated = db
      .prepare(
        `UPDATE benches
         SET status = 'adopted'
         WHERE bench_id = ? AND status = 'available'`
      )
      .run(benchId);
    if (updated.changes !== 1) {
      const current = getBench(db, benchId);
      const error = new Error("BENCH_UNAVAILABLE");
      error.code = "BENCH_UNAVAILABLE";
      error.bench = current;
      throw error;
    }
    const adoptionId = `adp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const adoptionDate = isoDate(new Date());
    const expirationDate = isoDate(addMonths(new Date(), durationMonths));
    db.prepare(
      `INSERT INTO adoptions (
        adoption_id, bench_id, adopter_name, contact, adoption_date,
        duration_months, expiration_date, is_sample, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      adoptionId,
      benchId,
      adopterName,
      contact || null,
      adoptionDate,
      durationMonths,
      expirationDate,
      new Date().toISOString()
    );
    return getBench(db, benchId);
  });
  return adopt();
}

function listProposals(db) {
  return db.prepare("SELECT * FROM bench_proposals ORDER BY submitted_at DESC").all();
}

function createProposal(db, payload) {
  const proposalId = `prp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const submittedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO bench_proposals (
      proposal_id, latitude, longitude, reason, proposer_name, contact, submitted_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted')`
  ).run(
    proposalId,
    payload.latitude,
    payload.longitude,
    payload.reason,
    payload.proposerName || null,
    payload.contact || null,
    submittedAt
  );
  return db.prepare("SELECT * FROM bench_proposals WHERE proposal_id = ?").get(proposalId);
}

function init() {
  const db = openDb();
  syncBenchesFromGis(db);
  seedSampleAdoptions(db);
  return db;
}

module.exports = {
  init,
  listBenches,
  getBench,
  adoptBench,
  listProposals,
  createProposal,
  remainingLabel,
};
