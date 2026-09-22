export function durationCopy(months) {
  if (months == null || months === "") return "Not provided";
  const n = Number(months);
  if (!Number.isFinite(n)) return "Not provided";
  if (n === 12) return "1 year";
  if (n === 36) return "3 years";
  if (n === 60) return "5 years";
  return `${n} months`;
}

export function prettyId(id) {
  return String(id).replace("osm-node-", "OSM ").replace("osm-way-", "OSM way ");
}

export function googleMapsUrl(latitude, longitude) {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

export function displayValue(value, fallback = "Not provided") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function adoptionStatusLabel(status) {
  switch (status) {
    case "available":
      return "Available for adoption";
    case "adopted":
      return "Adopted";
    case "request_submitted":
      return "Adoption request submitted";
    case "unknown":
    default:
      return "Adoption status unknown";
  }
}

export function infoSourceLabel(source) {
  switch (source) {
    case "nyc_parks_gis":
      return "NYC Parks GIS";
    case "openstreetmap":
      return "OpenStreetMap";
    case "crowdsourced":
      return "Crowdsourced submission";
    default:
      return displayValue(source, "Unknown");
  }
}

export function verificationLabel(status) {
  switch (status) {
    case "verified":
      return "Verified";
    case "pending_verification":
      return "Pending verification";
    case "needs_review":
      return "Needs review";
    default:
      return displayValue(status, "Unknown");
  }
}

export function canRequestAdoption(bench) {
  if (!bench || bench.adoption_status !== "available") return false;
  if (bench.pending_adoption_request) return false;
  return true;
}
