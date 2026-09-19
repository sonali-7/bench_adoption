const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const dbApi = require("./db");
const { isInsidePark } = require("./geo");

const PORT = process.env.PORT || 3001;
const ROOT = path.join(__dirname, "..");
const PROCESSED = path.join(ROOT, "data", "processed");
const isProd = process.env.NODE_ENV === "production";

const db = dbApi.init();
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

function sendGeojson(res, filename) {
  res.type("application/geo+json");
  res.send(fs.readFileSync(path.join(PROCESSED, filename), "utf8"));
}

app.get("/api/meta", (_req, res) => {
  const meta = JSON.parse(fs.readFileSync(path.join(PROCESSED, "meta.json"), "utf8"));
  res.json({
    ...meta,
    adoption_data: "demonstration",
    adoption_disclaimer:
      "Adoption names, contacts, and dates are sample records for this prototype. They are stored separately from GIS bench coordinates and can be replaced with official program records.",
  });
});

app.get("/api/park-boundary", (_req, res) => sendGeojson(res, "park-boundary.geojson"));
app.get("/api/trails", (_req, res) => sendGeojson(res, "trails.geojson"));

app.get("/api/benches", (_req, res) => {
  res.json({ benches: dbApi.listBenches(db) });
});

app.get("/api/benches/:id", (req, res) => {
  const bench = dbApi.getBench(db, req.params.id);
  if (!bench) return res.status(404).json({ error: "Bench not found." });
  res.json({ bench });
});

app.get("/api/proposals", (_req, res) => {
  res.json({ proposals: dbApi.listProposals(db) });
});

app.post("/api/proposals", (req, res) => {
  const { latitude, longitude, reason, proposerName, contact } = req.body || {};
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: "A valid map location is required." });
  }
  if (!reason || String(reason).trim().length < 8) {
    return res.status(400).json({ error: "Please describe why this location needs a bench." });
  }
  if (!isInsidePark(lon, lat)) {
    return res.status(400).json({
      error: "Proposed locations must fall inside the official Van Cortlandt Park boundary (Park ID X092).",
    });
  }
  const proposal = dbApi.createProposal(db, {
    latitude: lat,
    longitude: lon,
    reason: String(reason).trim(),
    proposerName: proposerName ? String(proposerName).trim() : "",
    contact: contact ? String(contact).trim() : "",
  });
  res.status(201).json({ proposal });
});

app.post("/api/adoptions", (req, res) => {
  const { benchId, adopterName, contact, durationMonths } = req.body || {};
  const months = Number(durationMonths);
  if (!benchId) return res.status(400).json({ error: "Please choose a bench." });
  if (!adopterName || String(adopterName).trim().length < 2) {
    return res.status(400).json({ error: "Please enter the adopter name." });
  }
  if (![12, 36, 60].includes(months)) {
    return res.status(400).json({ error: "Please choose a 1-, 3-, or 5-year adoption." });
  }
  const bench = dbApi.getBench(db, benchId);
  if (!bench) return res.status(404).json({ error: "Bench not found." });
  try {
    const adopted = dbApi.adoptBench(db, {
      benchId,
      adopterName: String(adopterName).trim(),
      contact: contact ? String(contact).trim() : "",
      durationMonths: months,
    });
    res.status(201).json({ bench: adopted });
  } catch (err) {
    if (err.code === "BENCH_UNAVAILABLE") {
      return res.status(409).json({
        error:
          "This bench was just adopted by someone else. Please return to Explore to choose another available bench.",
        bench: err.bench,
      });
    }
    throw err;
  }
});

if (isProd) {
  const dist = path.join(ROOT, "dist");
  app.use(express.static(dist));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`VCP Bench Adoption API on http://localhost:${PORT}`);
});
