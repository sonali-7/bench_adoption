export function durationCopy(months) {
  if (months === 12) return "1 year";
  if (months === 36) return "3 years";
  if (months === 60) return "5 years";
  return `${months} months`;
}

export function prettyId(id) {
  return String(id).replace("osm-node-", "OSM ").replace("osm-way-", "OSM way ");
}
