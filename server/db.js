const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { haversineMeters } = require("./geo");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "server", "var");
const DB_PATH = path.join(DATA_DIR, "bench-adoption.sqlite");
const BENCHES_GIS = path.join(ROOT, "data", "processed", "benches.geojson");
const NEAR_DUPLICATE_METERS = 25;

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

const PENDING_REQUEST_STATUSES = ["submitted", "under_review"];

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
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

function googleMapsUrl(latitude, longitude) {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function createFreshSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS benches (
      bench_id TEXT PRIMARY KEY,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      gis_source TEXT NOT NULL DEFAULT 'unknown',
      gis_id TEXT NOT NULL,
      osm_id INTEGER,
      osm_type TEXT,
      material TEXT,
      backrest TEXT,
      bench_type TEXT,
      gis_name TEXT,
      extra_json TEXT,
      adoption_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (adoption_status IN ('available', 'adopted', 'unknown', 'request_submitted')),
      info_source TEXT NOT NULL DEFAULT 'other'
        CHECK (info_source IN ('nyc_parks_gis', 'openstreetmap', 'crowdsourced', 'other')),
      verification_status TEXT NOT NULL DEFAULT 'verified'
        CHECK (verification_status IN ('verified', 'pending_verification', 'needs_review')),
      description TEXT,
      notes TEXT,
      reported_adopter_name TEXT,
      reported_adoption_date TEXT,
      reported_duration_months INTEGER,
      date_added TEXT NOT NULL,
      last_updated TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS adoption_requests (
      request_id TEXT PRIMARY KEY,
      bench_id TEXT NOT NULL REFERENCES benches(bench_id),
      requester_name TEXT NOT NULL,
      contact TEXT NOT NULL,
      duration_months INTEGER NOT NULL,
      message TEXT,
      submitted_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'under_review', 'approved', 'declined', 'withdrawn'))
    );

    CREATE INDEX IF NOT EXISTS idx_adoption_requests_bench ON adoption_requests(bench_id);

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
}

function migrateLegacyBenches(db) {
  const cols = tableColumns(db, "benches");
  if (cols.includes("adoption_status")) return;

  const orphanedV2 = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='benches_v2'")
    .get();
  if (orphanedV2) {
    db.pragma("foreign_keys = OFF");
    db.exec("DROP TABLE IF EXISTS benches");
    db.exec("ALTER TABLE benches_v2 RENAME TO benches");
    db.pragma("foreign_keys = ON");
    return;
  }

  const ts = nowIso();
  db.exec(`
    CREATE TABLE benches_v2 (
      bench_id TEXT PRIMARY KEY,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      gis_source TEXT NOT NULL DEFAULT 'unknown',
      gis_id TEXT NOT NULL,
      osm_id INTEGER,
      osm_type TEXT,
      material TEXT,
      backrest TEXT,
      bench_type TEXT,
      gis_name TEXT,
      extra_json TEXT,
      adoption_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (adoption_status IN ('available', 'adopted', 'unknown', 'request_submitted')),
      info_source TEXT NOT NULL DEFAULT 'other'
        CHECK (info_source IN ('nyc_parks_gis', 'openstreetmap', 'crowdsourced', 'other')),
      verification_status TEXT NOT NULL DEFAULT 'verified'
        CHECK (verification_status IN ('verified', 'pending_verification', 'needs_review')),
      description TEXT,
      notes TEXT,
      reported_adopter_name TEXT,
      reported_adoption_date TEXT,
      reported_duration_months INTEGER,
      date_added TEXT NOT NULL,
      last_updated TEXT NOT NULL
    );
  `);

  const legacy = db.prepare("SELECT * FROM benches").all();
  const insert = db.prepare(`
    INSERT INTO benches_v2 (
      bench_id, latitude, longitude, gis_source, gis_id, osm_id, osm_type,
      material, backrest, bench_type, gis_name, extra_json, adoption_status,
      info_source, verification_status, description, notes,
      reported_adopter_name, reported_adoption_date, reported_duration_months,
      date_added, last_updated
    ) VALUES (
      @bench_id, @latitude, @longitude, @gis_source, @gis_id, @osm_id, @osm_type,
      @material, @backrest, @bench_type, @gis_name, @extra_json, @adoption_status,
      @info_source, @verification_status, @description, @notes,
      @reported_adopter_name, @reported_adoption_date, @reported_duration_months,
      @date_added, @last_updated
    )
  `);

  const migrate = db.transaction((rows) => {
    for (const row of rows) {
      let adoptionStatus = row.status === "adopted" ? "adopted" : "unknown";
      if (row.status === "available") adoptionStatus = "unknown";
      const gisSource =
        String(row.gis_source || "").toLowerCase().includes("openstreetmap") ||
        String(row.gis_source || "").toLowerCase().includes("osm")
          ? "openstreetmap"
          : "other";
      insert.run({
        bench_id: row.bench_id,
        latitude: row.latitude,
        longitude: row.longitude,
        gis_source: row.gis_source || "unknown",
        gis_id: row.gis_id || row.bench_id,
        osm_id: row.osm_id ?? null,
        osm_type: row.osm_type ?? null,
        material: row.material ?? null,
        backrest: row.backrest ?? null,
        bench_type: row.bench_type ?? null,
        gis_name: row.gis_name ?? null,
        extra_json: row.extra_json ?? null,
        adoption_status: adoptionStatus,
        info_source: gisSource,
        verification_status: "verified",
        description: null,
        notes: null,
        reported_adopter_name: null,
        reported_adoption_date: null,
        reported_duration_months: null,
        date_added: ts,
        last_updated: ts,
      });
    }
  });
  db.pragma("foreign_keys = OFF");
  migrate(legacy);
  db.exec("DROP TABLE benches");
  db.exec("ALTER TABLE benches_v2 RENAME TO benches");
  db.pragma("foreign_keys = ON");
}

function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const hasBenches = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='benches'")
    .get();
  if (!hasBenches) {
    createFreshSchema(db);
  } else {
    migrateLegacyBenches(db);
    createFreshSchema(db);
  }
  return db;
}

function mapInfoSourceFromGis(gisSource) {
  const s = String(gisSource || "").toLowerCase();
  if (s.includes("openstreetmap") || s.includes("osm")) return "openstreetmap";
  if (s.includes("nyc") || s.includes("parks")) return "nyc_parks_gis";
  return "other";
}

function syncBenchesFromGis(db) {
  const fc = JSON.parse(fs.readFileSync(BENCHES_GIS, "utf8"));
  const ts = nowIso();
  const upsert = db.prepare(`
    INSERT INTO benches (
      bench_id, latitude, longitude, gis_source, gis_id, osm_id, osm_type,
      material, backrest, bench_type, gis_name, extra_json, adoption_status,
      info_source, verification_status, date_added, last_updated
    ) VALUES (
      @bench_id, @latitude, @longitude, @gis_source, @gis_id, @osm_id, @osm_type,
      @material, @backrest, @bench_type, @gis_name, @extra_json, 'unknown',
      @info_source, 'verified', @date_added, @last_updated
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
      extra_json = excluded.extra_json,
      last_updated = excluded.last_updated
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
        info_source: mapInfoSourceFromGis(p.gis_source),
        date_added: ts,
        last_updated: ts,
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
  const mark = db.prepare(`
    UPDATE benches SET adoption_status = 'adopted', last_updated = ? WHERE bench_id = ?
  `);

  const seed = db.transaction(() => {
    const ts = nowIso();
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
        created_at: ts,
      });
      mark.run(ts, bench.bench_id);
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

function pendingAdoptionRequest(db, benchId) {
  const placeholders = PENDING_REQUEST_STATUSES.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT * FROM adoption_requests
       WHERE bench_id = ? AND status IN (${placeholders})
       ORDER BY submitted_at DESC
       LIMIT 1`
    )
    .get(benchId, ...PENDING_REQUEST_STATUSES);
}

function findNearbyBenchIds(db, latitude, longitude, excludeId = null) {
  const rows = db.prepare("SELECT bench_id, latitude, longitude FROM benches").all();
  return rows
    .filter((row) => row.bench_id !== excludeId)
    .filter((row) => haversineMeters(latitude, longitude, row.latitude, row.longitude) <= NEAR_DUPLICATE_METERS)
    .map((row) => row.bench_id);
}

function decorateBench(db, bench) {
  const adoption =
    bench.adoption_status === "adopted" ? currentAdoption(db, bench.bench_id) : null;
  const pendingRequest = pendingAdoptionRequest(db, bench.bench_id);
  const nearDuplicateIds = findNearbyBenchIds(db, bench.latitude, bench.longitude, bench.bench_id);

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
    adoption_status: bench.adoption_status,
    status: bench.adoption_status,
    info_source: bench.info_source,
    verification_status: bench.verification_status,
    description: bench.description,
    notes: bench.notes,
    reported_adopter_name: bench.reported_adopter_name,
    reported_adoption_date: bench.reported_adoption_date,
    reported_duration_months: bench.reported_duration_months,
    date_added: bench.date_added,
    last_updated: bench.last_updated,
    google_maps_url: googleMapsUrl(bench.latitude, bench.longitude),
    is_crowdsourced: bench.info_source === "crowdsourced",
    is_authoritative: bench.verification_status === "verified" && bench.info_source !== "crowdsourced",
    near_duplicate_bench_ids: nearDuplicateIds,
    pending_adoption_request: pendingRequest
      ? {
          request_id: pendingRequest.request_id,
          status: pendingRequest.status,
          submitted_at: pendingRequest.submitted_at,
          requester_name: pendingRequest.requester_name,
        }
      : null,
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

function normalizeReportedAdoptionStatus(value) {
  const v = String(value || "unknown").toLowerCase();
  if (v === "available" || v === "adopted" || v === "unknown") return v;
  return "unknown";
}

function createCrowdsourcedBench(db, payload) {
  const lat = Number(payload.latitude);
  const lon = Number(payload.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const error = new Error("INVALID_LOCATION");
    error.code = "INVALID_LOCATION";
    throw error;
  }

  const reportedStatus = normalizeReportedAdoptionStatus(payload.adoptionStatus);
  let adoptionStatus = reportedStatus;
  if (reportedStatus === "adopted" && !String(payload.adopterName || "").trim()) {
    adoptionStatus = "unknown";
  }

  const ts = nowIso();
  const benchId = `crowd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nearDuplicateBenchIds = findNearbyBenchIds(db, lat, lon);

  const insert = db.prepare(`
    INSERT INTO benches (
      bench_id, latitude, longitude, gis_source, gis_id,
      adoption_status, info_source, verification_status,
      description, notes, reported_adopter_name, reported_adoption_date,
      reported_duration_months, date_added, last_updated, extra_json
    ) VALUES (
      ?, ?, ?, 'Crowdsourced submission', ?,
      ?, 'crowdsourced', 'pending_verification',
      ?, ?, ?, ?, ?, ?, ?, '{}'
    )
  `);

  insert.run(
    benchId,
    lat,
    lon,
    benchId,
    adoptionStatus,
    payload.description ? String(payload.description).trim() : null,
    payload.notes ? String(payload.notes).trim() : null,
    payload.adopterName ? String(payload.adopterName).trim() : null,
    payload.adoptionDate ? String(payload.adoptionDate).trim() : null,
    payload.durationMonths != null && payload.durationMonths !== ""
      ? Number(payload.durationMonths)
      : null,
    ts,
    ts
  );

  const bench = getBench(db, benchId);
  return { bench, nearDuplicateBenchIds };
}

function submitAdoptionRequest(db, { benchId, requesterName, contact, durationMonths, message }) {
  const submit = db.transaction(() => {
    const row = db.prepare("SELECT * FROM benches WHERE bench_id = ?").get(benchId);
    if (!row) {
      const error = new Error("NOT_FOUND");
      error.code = "NOT_FOUND";
      throw error;
    }
    if (row.adoption_status !== "available") {
      const error = new Error("BENCH_NOT_AVAILABLE");
      error.code = "BENCH_NOT_AVAILABLE";
      error.bench = decorateBench(db, row);
      throw error;
    }
    const pending = pendingAdoptionRequest(db, benchId);
    if (pending) {
      const error = new Error("REQUEST_ALREADY_PENDING");
      error.code = "REQUEST_ALREADY_PENDING";
      error.bench = decorateBench(db, row);
      throw error;
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const submittedAt = nowIso();
    db.prepare(
      `INSERT INTO adoption_requests (
        request_id, bench_id, requester_name, contact, duration_months, message, submitted_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted')`
    ).run(
      requestId,
      benchId,
      requesterName,
      contact,
      durationMonths,
      message || null,
      submittedAt
    );

    db.prepare(
      `UPDATE benches SET adoption_status = 'request_submitted', last_updated = ? WHERE bench_id = ?`
    ).run(submittedAt, benchId);

    return {
      request: db.prepare("SELECT * FROM adoption_requests WHERE request_id = ?").get(requestId),
      bench: getBench(db, benchId),
    };
  });
  return submit();
}

function listProposals(db) {
  return db.prepare("SELECT * FROM bench_proposals ORDER BY submitted_at DESC").all();
}

function createProposal(db, payload) {
  const proposalId = `prp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const submittedAt = nowIso();
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

function ensureDemoAvailableBench(db) {
  const any = db.prepare("SELECT 1 AS ok FROM benches WHERE adoption_status = 'available' LIMIT 1").get();
  if (any) return;
  const candidate = db
    .prepare(
      `SELECT bench_id FROM benches
       WHERE adoption_status = 'unknown'
       ORDER BY bench_id LIMIT 1`
    )
    .get();
  if (!candidate) return;
  db.prepare("UPDATE benches SET adoption_status = 'available', last_updated = ? WHERE bench_id = ?").run(
    nowIso(),
    candidate.bench_id
  );
}

function init() {
  const db = openDb();
  syncBenchesFromGis(db);
  seedSampleAdoptions(db);
  ensureDemoAvailableBench(db);
  return db;
}

module.exports = {
  init,
  listBenches,
  getBench,
  createCrowdsourcedBench,
  submitAdoptionRequest,
  listProposals,
  createProposal,
  remainingLabel,
  googleMapsUrl,
};
