import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { durationCopy, prettyId } from "./format.js";

const AVAILABLE = "#2f9e44";
const ADOPTED = "#c92a2a";
const PROPOSED = "#e67700";

function pinIcon(color, selected) {
  const size = selected ? 28 : 22;
  return L.divIcon({
    className: "bench-pin",
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 2],
    popupAnchor: [0, -size + 4],
    html: `<span class="pin-glyph" style="--pin:${color};width:${size}px;height:${size}px" aria-hidden="true"></span>`,
  });
}

function proposedIcon() {
  return L.divIcon({
    className: "bench-pin",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<span class="proposal-glyph" aria-hidden="true"></span>`,
  });
}

function popupHtml(bench) {
  const adoption = bench.adoption;
  const sample = adoption?.is_sample
    ? `<p class="popup-note">Demonstration adoption record — not an official Parks donation listing.</p>`
    : "";
  const adoptedBlock = adoption
    ? `
      <dt>Adoptee</dt><dd>${escapeHtml(adoption.adopter_name)}</dd>
      <dt>Adopted</dt><dd>${escapeHtml(adoption.adoption_date)}</dd>
      <dt>Duration</dt><dd>${escapeHtml(durationCopy(adoption.duration_months))}</dd>
      <dt>Time remaining</dt><dd>${escapeHtml(adoption.time_remaining)}</dd>
      <dt>Expires</dt><dd>${escapeHtml(adoption.expiration_date)}</dd>
    `
    : `<dt>Adoptee</dt><dd>Available for adoption</dd>`;
  const extra = [];
  if (bench.bench_type) extra.push(`<dt>Type</dt><dd>${escapeHtml(bench.bench_type)}</dd>`);
  if (bench.material) extra.push(`<dt>Material</dt><dd>${escapeHtml(bench.material)}</dd>`);
  if (bench.backrest) extra.push(`<dt>Backrest</dt><dd>${escapeHtml(bench.backrest)}</dd>`);
  return `
    <article class="popup-card">
      <h3>${escapeHtml(bench.gis_name || prettyId(bench.bench_id))}</h3>
      <dl>
        <dt>Bench ID</dt><dd>${escapeHtml(bench.bench_id)}</dd>
        <dt>Coordinates</dt><dd>${bench.latitude.toFixed(6)}, ${bench.longitude.toFixed(6)}</dd>
        <dt>Status</dt><dd>${bench.status === "adopted" ? "Adopted" : "Available"}</dd>
        ${adoptedBlock}
        <dt>GIS source</dt><dd>${escapeHtml(bench.gis_source)}</dd>
        ${extra.join("")}
      </dl>
      ${sample}
    </article>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export default function MapCanvas({
  park,
  trails,
  benches,
  proposals,
  filter,
  selectedId,
  proposeMode,
  draftProposal,
  overlayParkMap,
  onSelectBench,
  onProposeClick,
  onOutsidePark,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const onSelectRef = useRef(onSelectBench);
  const parkRef = useRef(park);
  const proposeClickRef = useRef(onProposeClick);
  const outsideRef = useRef(onOutsidePark);
  const proposeModeRef = useRef(proposeMode);
  onSelectRef.current = onSelectBench;
  parkRef.current = park;
  proposeClickRef.current = onProposeClick;
  outsideRef.current = onOutsidePark;
  proposeModeRef.current = proposeMode;

  const visibleBenches = useMemo(() => {
    if (filter === "available") return benches.filter((b) => b.status === "available");
    if (filter === "adopted") return benches.filter((b) => b.status === "adopted");
    return benches;
  }, [benches, filter]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      minZoom: 12,
      maxZoom: 19,
      attributionControl: true,
    }).setView([40.897, -73.884], 14);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const handleProposeEvent = (event) => {
      if (!proposeModeRef.current) return;
      L.DomEvent.stopPropagation(event);
      const { lat, lng } = event.latlng;
      const parkFc = parkRef.current;
      if (parkFc?.features?.[0] && !pip(lng, lat, parkFc.features[0].geometry)) {
        outsideRef.current?.();
        return;
      }
      proposeClickRef.current?.({ latitude: lat, longitude: lng });
    };

    layersRef.current.park = L.geoJSON(null, {
      style: {
        color: "#1b4332",
        weight: 2,
        fillColor: "#74c69d",
        fillOpacity: 0.22,
      },
      onEachFeature: (_feature, layer) => {
        layer.on("click", handleProposeEvent);
      },
    }).addTo(map);

    layersRef.current.trails = L.geoJSON(null, {
      style: (feature) => {
        const name = feature.properties?.trail_name || "";
        const paved = /greenway|putnam/i.test(name);
        return {
          color: paved ? "#bc6c25" : "#52796f",
          weight: paved ? 3 : 1.8,
          opacity: 0.9,
        };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        layer.bindPopup(
          `<strong>${escapeHtml(p.trail_name)}</strong><br/>${escapeHtml(p.surface || "")}`
        );
        layer.on("click", handleProposeEvent);
      },
    }).addTo(map);

    layersRef.current.overlay = L.imageOverlay("/vcpa-map.jpg", [
      [40.88286, -73.89953],
      [40.91133, -73.86801],
    ], { opacity: 0, interactive: false }).addTo(map);

    layersRef.current.benches = L.layerGroup().addTo(map);
    layersRef.current.proposals = L.layerGroup().addTo(map);
    layersRef.current.draft = L.layerGroup().addTo(map);

    map.on("click", handleProposeEvent);

    mapRef.current = map;
    map.options.vcpProposeMode = proposeModeRef.current;
    map.getContainer().classList.toggle("is-proposing", proposeModeRef.current);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.options.vcpProposeMode = proposeMode;
    map.getContainer().classList.toggle("is-proposing", proposeMode);
  }, [proposeMode]);

  useEffect(() => {
    const layer = layersRef.current.park;
    if (!layer || !park) return;
    layer.clearLayers();
    layer.addData(park);
    if (!mapRef.current._fittedPark) {
      mapRef.current.fitBounds(layer.getBounds(), { padding: [24, 24] });
      mapRef.current._fittedPark = true;
    }
  }, [park]);

  useEffect(() => {
    const layer = layersRef.current.trails;
    if (!layer || !trails) return;
    layer.clearLayers();
    layer.addData(trails);
  }, [trails]);

  useEffect(() => {
    const overlay = layersRef.current.overlay;
    if (!overlay) return;
    overlay.setOpacity(overlayParkMap ? 0.45 : 0);
  }, [overlayParkMap]);

  useEffect(() => {
    const group = layersRef.current.benches;
    const map = mapRef.current;
    if (!group || !map) return;
    group.clearLayers();
    visibleBenches.forEach((bench) => {
      const selected = bench.bench_id === selectedId;
      const marker = L.marker([bench.latitude, bench.longitude], {
        icon: pinIcon(bench.status === "adopted" ? ADOPTED : AVAILABLE, selected),
        zIndexOffset: selected ? 1000 : 0,
        keyboard: true,
        title: `${bench.status === "adopted" ? "Adopted" : "Available"} bench ${bench.bench_id}`,
        alt: `${bench.status === "adopted" ? "Adopted" : "Available"} bench ${bench.bench_id}`,
      });
      marker.bindPopup(popupHtml(bench), { maxWidth: 320 });
      marker.on("click", () => onSelectRef.current?.(bench.bench_id));
      marker.addTo(group);
    });
    const selected = visibleBenches.find((b) => b.bench_id === selectedId);
    if (selected && !proposeModeRef.current) {
      group.eachLayer((layer) => {
        const latlng = layer.getLatLng?.();
        if (latlng && Math.abs(latlng.lat - selected.latitude) < 1e-8 && Math.abs(latlng.lng - selected.longitude) < 1e-8) {
          if (!layer.isPopupOpen()) layer.openPopup();
        }
      });
    }
  }, [visibleBenches, selectedId]);

  useEffect(() => {
    const group = layersRef.current.proposals;
    if (!group) return;
    group.clearLayers();
    proposals.forEach((proposal) => {
      const marker = L.marker([proposal.latitude, proposal.longitude], {
        icon: proposedIcon(),
        title: `Proposed bench ${proposal.proposal_id}`,
        zIndexOffset: 400,
      });
      marker.bindPopup(`
        <article class="popup-card">
          <h3>Proposed location</h3>
          <dl>
            <dt>Proposal ID</dt><dd>${escapeHtml(proposal.proposal_id)}</dd>
            <dt>Coordinates</dt><dd>${Number(proposal.latitude).toFixed(6)}, ${Number(proposal.longitude).toFixed(6)}</dd>
            <dt>Status</dt><dd>${escapeHtml(proposal.status)}</dd>
            <dt>Submitted</dt><dd>${escapeHtml(String(proposal.submitted_at).slice(0, 10))}</dd>
            <dt>Name</dt><dd>${escapeHtml(proposal.proposer_name || "Not provided")}</dd>
            <dt>Reason</dt><dd>${escapeHtml(proposal.reason)}</dd>
          </dl>
        </article>
      `);
      marker.addTo(group);
    });
  }, [proposals]);

  useEffect(() => {
    const group = layersRef.current.draft;
    if (!group) return;
    group.clearLayers();
    if (!draftProposal) return;
    L.marker([draftProposal.latitude, draftProposal.longitude], {
      icon: proposedIcon(),
      zIndexOffset: 800,
      title: "Draft proposed location",
    }).addTo(group);
  }, [draftProposal]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const bench = benches.find((b) => b.bench_id === selectedId);
    if (bench) map.panTo([bench.latitude, bench.longitude], { animate: true });
  }, [selectedId, benches]);

  return <div ref={containerRef} className="map-canvas" role="application" aria-label="Van Cortlandt Park bench map" />;
}

function pip(lon, lat, geometry) {
  const polys = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  return polys.some((poly) => ringContains(lon, lat, poly[0]) && !poly.slice(1).some((hole) => ringContains(lon, lat, hole)));
}

function ringContains(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-16) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
