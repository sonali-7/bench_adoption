import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import {
  adoptionStatusLabel,
  displayValue,
  durationCopy,
  googleMapsUrl,
  infoSourceLabel,
  prettyId,
  verificationLabel,
} from "./format.js";

const AVAILABLE = "#2f9e44";
const ADOPTED = "#c92a2a";
const UNKNOWN = "#868e96";
const REQUEST = "#fab005";
const CROWD = "#1971c2";
const PROPOSED = "#e67700";

function benchPinColor(bench) {
  // if (bench.info_source === "crowdsourced" && bench.verification_status !== "verified") {
  // return CROWD;
  // }
  switch (bench.adoption_status) {
    case "adopted":
      return ADOPTED;
    case "available":
      return AVAILABLE;
    case "request_submitted":
      return REQUEST;
    default:
      if (bench.info_source === "crowdsourced" && bench.verification_status !== "verified") {
        return CROWD;
      }
      return UNKNOWN;
  }
}

function pinIcon(color, selected, dashed = false) {
  const size = selected ? 28 : 22;
  const dash = dashed ? " pin-glyph--dashed" : "";
  return L.divIcon({
    className: "bench-pin",
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 2],
    popupAnchor: [0, -size + 4],
    html: `<span class="pin-glyph${dash}" style="--pin:${color};width:${size}px;height:${size}px" aria-hidden="true"></span>`,
  });
}

function proposedIcon(selected = false) {
  // Slightly smaller than bench pins (22→28); grow on select the same way.
  const size = selected ? 28 : 22;
  const glyph = selected ? 22 : 16;
  return L.divIcon({
    className: "bench-pin",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `<span class="proposal-glyph" style="width:${glyph}px;height:${glyph}px;margin:${(size - glyph) / 2}px" aria-hidden="true"></span>`,
  });
}

function existingDraftIcon() {
  return L.divIcon({
    className: "bench-pin",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
    html: `<span class="existing-draft-glyph" aria-hidden="true"></span>`,
  });
}

function popupHtml(bench) {
  const adoption = bench.adoption;
  const sample = adoption?.is_sample
    ? `<p class="popup-note">Demonstration adoption record — not an official Parks donation listing.</p>`
    : "";
  const crowdNote = bench.is_crowdsourced
    ? `<p class="popup-note">Crowdsourced information — pending verification; not presented as authoritative.</p>`
    : "";

  let adopteeBlock;
  if (adoption) {
    adopteeBlock = `
      <dt>Adoptee</dt><dd>${escapeHtml(adoption.adopter_name)}</dd>
      <dt>Adopted</dt><dd>${escapeHtml(adoption.adoption_date)}</dd>
      <dt>Duration</dt><dd>${escapeHtml(durationCopy(adoption.duration_months))}</dd>
      <dt>Time remaining</dt><dd>${escapeHtml(adoption.time_remaining)}</dd>
      <dt>Expires</dt><dd>${escapeHtml(adoption.expiration_date)}</dd>
    `;
  } else if (bench.reported_adopter_name) {
    adopteeBlock = `
      <dt>Reported adoptee</dt><dd>${escapeHtml(bench.reported_adopter_name)}</dd>
      <dt>Reported adoption date</dt><dd>${escapeHtml(displayValue(bench.reported_adoption_date))}</dd>
      <dt>Reported duration</dt><dd>${escapeHtml(durationCopy(bench.reported_duration_months))}</dd>
    `;
  } else {
    adopteeBlock = `<dt>Adoptee</dt><dd>${escapeHtml(displayValue(null, "Unknown"))}</dd>`;
  }

  const extra = [];
  if (bench.bench_type) extra.push(`<dt>Type</dt><dd>${escapeHtml(bench.bench_type)}</dd>`);
  if (bench.material) extra.push(`<dt>Material</dt><dd>${escapeHtml(bench.material)}</dd>`);
  if (bench.backrest) extra.push(`<dt>Backrest</dt><dd>${escapeHtml(bench.backrest)}</dd>`);
  if (bench.description) extra.push(`<dt>Description</dt><dd>${escapeHtml(bench.description)}</dd>`);
  if (bench.notes) extra.push(`<dt>Notes</dt><dd>${escapeHtml(bench.notes)}</dd>`);

  const mapsLink = `<a class="popup-maps-link" href="${escapeHtml(bench.google_maps_url || googleMapsUrl(bench.latitude, bench.longitude))}" target="_blank" rel="noopener noreferrer">View in Google Maps</a>`;

  return `
    <article class="popup-card">
      <div class="popup-card-body">
        <h3>${escapeHtml(bench.gis_name || prettyId(bench.bench_id))}</h3>
        <dl>
          <dt>Coordinates</dt><dd>${bench.latitude.toFixed(6)}, ${bench.longitude.toFixed(6)}</dd>
          <dt>Adoption status</dt><dd>${escapeHtml(adoptionStatusLabel(bench.adoption_status))}</dd>
          ${adopteeBlock}
          <dt>Verification</dt><dd>${escapeHtml(verificationLabel(bench.verification_status))}</dd>
          <dt>Information source</dt><dd>${escapeHtml(infoSourceLabel(bench.info_source))}</dd>
          ${extra.join("")}
        </dl>
        ${sample}
        ${crowdNote}
      </div>
      <div class="popup-card-footer">${mapsLink}</div>
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
  selectedProposalId,
  onSelectProposal,
  proposeMode,
  addExistingMode,
  draftProposal,
  draftExisting,
  onSelectBench,
  onProposeClick,
  onProposeMove,
  onAddExistingClick,
  onAddExistingMove,
  onOutsidePark,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const draftMarkerRef = useRef(null);
  const existingDraftRef = useRef(null);
  const proposalMarkersRef = useRef(new Map());
  const onSelectRef = useRef(onSelectBench);
  const parkRef = useRef(park);
  const proposeClickRef = useRef(onProposeClick);
  const proposeMoveRef = useRef(onProposeMove);
  const addExistingClickRef = useRef(onAddExistingClick);
  const addExistingMoveRef = useRef(onAddExistingMove);
  const outsideRef = useRef(onOutsidePark);
  const proposeModeRef = useRef(proposeMode);
  const addExistingModeRef = useRef(addExistingMode);
  const onSelectProposalRef = useRef(onSelectProposal);
  onSelectProposalRef.current = onSelectProposal;
  onSelectRef.current = onSelectBench;
  parkRef.current = park;
  proposeClickRef.current = onProposeClick;
  proposeMoveRef.current = onProposeMove;
  addExistingClickRef.current = onAddExistingClick;
  addExistingMoveRef.current = onAddExistingMove;
  outsideRef.current = onOutsidePark;
  proposeModeRef.current = proposeMode;
  addExistingModeRef.current = addExistingMode;

  const visibleBenches = useMemo(() => {
    if (filter === "available") {
      return benches.filter((b) => b.adoption_status === "available");
    }
    if (filter === "adopted") {
      return benches.filter((b) => b.adoption_status === "adopted");
    }
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

    const handlePlacementEvent = (event) => {
      const inPropose = proposeModeRef.current;
      const inAddExisting = addExistingModeRef.current;
      if (!inPropose && !inAddExisting) {
        onSelectRef.current?.(null); // click away → deselect
        return;
      }
      L.DomEvent.stopPropagation(event);
      const { lat, lng } = event.latlng;
      const parkFc = parkRef.current;
      if (parkFc?.features?.[0] && !pip(lng, lat, parkFc.features[0].geometry)) {
        outsideRef.current?.();
        return;
      }
      if (inPropose) proposeClickRef.current?.({ latitude: lat, longitude: lng });
      if (inAddExisting) addExistingClickRef.current?.({ latitude: lat, longitude: lng });
    };

    layersRef.current.park = L.geoJSON(null, {
      style: {
        color: "#1b4332",
        weight: 2,
        fillColor: "#74c69d",
        fillOpacity: 0.22,
      },
      onEachFeature: (_feature, layer) => {
        layer.on("click", handlePlacementEvent);
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
        layer.on("click", handlePlacementEvent);
      },
    }).addTo(map);

    layersRef.current.benches = L.layerGroup().addTo(map);
    layersRef.current.proposals = L.layerGroup().addTo(map);
    layersRef.current.draft = L.layerGroup().addTo(map);
    layersRef.current.existingDraft = L.layerGroup().addTo(map);

    map.on("click", handlePlacementEvent);

    mapRef.current = map;
    map.getContainer().classList.toggle("is-proposing", proposeModeRef.current || addExistingModeRef.current);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().classList.toggle("is-proposing", proposeMode || addExistingMode);
  }, [proposeMode, addExistingMode]);

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
    const group = layersRef.current.benches;
    const map = mapRef.current;
    if (!group || !map) return;
    group.clearLayers();
    visibleBenches.forEach((bench) => {
      const selected = bench.bench_id === selectedId;
      const color = benchPinColor(bench);
      const marker = L.marker([bench.latitude, bench.longitude], {
        icon: pinIcon(color, selected, false),
        zIndexOffset: selected ? 1000 : 0,
        keyboard: true,
        title: `${adoptionStatusLabel(bench.adoption_status)} — ${bench.bench_id}`,
        alt: `${adoptionStatusLabel(bench.adoption_status)} bench ${bench.bench_id}`,
      });
      marker.bindPopup(popupHtml(bench), { maxWidth: 300, className: "bench-popup" });
      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        onSelectRef.current?.(bench.bench_id);
      });
      marker.addTo(group);
    });
    const selected = visibleBenches.find((b) => b.bench_id === selectedId);
    if (selected && !proposeModeRef.current && !addExistingModeRef.current) {
      group.eachLayer((layer) => {
        const latlng = layer.getLatLng?.();
        if (
          latlng &&
          Math.abs(latlng.lat - selected.latitude) < 1e-8 &&
          Math.abs(latlng.lng - selected.longitude) < 1e-8
        ) {
          if (!layer.isPopupOpen()) layer.openPopup();
        }
      });
    }
  }, [visibleBenches, selectedId]);

  useEffect(() => {
    const group = layersRef.current.proposals;
    if (!group) return;
    group.clearLayers();
    proposalMarkersRef.current.clear();
    proposals.forEach((proposal) => {
      const selected = proposal.proposal_id === selectedProposalId;
      const marker = L.marker([proposal.latitude, proposal.longitude], {
        icon: proposedIcon(selected),
        title: `Proposed bench ${proposal.proposal_id}`,
        zIndexOffset: selected ? 1000 : 400,
      });
      const mapsLink = `<a class="popup-maps-link" href="${escapeHtml(googleMapsUrl(proposal.latitude, proposal.longitude))}" target="_blank" rel="noopener noreferrer">View in Google Maps</a>`;
      marker.bindPopup(
        `<article class="popup-card">
          <div class="popup-card-body">
            <h3>Proposed location</h3>
            <p class="popup-note">This is a suggested bench location, not an existing bench in the inventory.</p>
            <dl>
              <dt>Proposal ID</dt><dd>${escapeHtml(proposal.proposal_id)}</dd>
              <dt>Coordinates</dt><dd>${Number(proposal.latitude).toFixed(6)}, ${Number(proposal.longitude).toFixed(6)}</dd>
              <dt>Status</dt><dd>${escapeHtml(proposal.status)}</dd>
              <dt>Submitted</dt><dd>${escapeHtml(String(proposal.submitted_at).slice(0, 10))}</dd>
              <dt>Name</dt><dd>${escapeHtml(proposal.proposer_name || "Not provided")}</dd>
              <dt>Reason</dt><dd>${escapeHtml(proposal.reason)}</dd>
            </dl>
          </div>
          <div class="popup-card-footer">${mapsLink}</div>
        </article>`,
        { maxWidth: 320 }
      );
      marker.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        onSelectProposalRef.current?.(proposal.proposal_id);
      });
      marker.addTo(group);
      proposalMarkersRef.current.set(proposal.proposal_id, marker);
    });
  }, [proposals]);

  // Update size in place on select so the popup is not destroyed (avoids double-click).
  useEffect(() => {
    proposalMarkersRef.current.forEach((marker, id) => {
      const selected = id === selectedProposalId;
      marker.setIcon(proposedIcon(selected));
      marker.setZIndexOffset(selected ? 1000 : 400);
      if (selected) {
        if (!marker.isPopupOpen()) marker.openPopup();
      } else if (marker.isPopupOpen()) {
        marker.closePopup();
      }
    });
  }, [selectedProposalId]);

  useEffect(() => {
    const group = layersRef.current.draft;
    if (!group) return;

    if (!draftProposal) {
      group.clearLayers();
      draftMarkerRef.current = null;
      return;
    }

    const existing = draftMarkerRef.current;
    if (existing && group.hasLayer(existing)) {
      const current = existing.getLatLng();
      if (
        Math.abs(current.lat - draftProposal.latitude) > 1e-9 ||
        Math.abs(current.lng - draftProposal.longitude) > 1e-9
      ) {
        existing.setLatLng([draftProposal.latitude, draftProposal.longitude]);
      }
      return;
    }

    group.clearLayers();
    const marker = L.marker([draftProposal.latitude, draftProposal.longitude], {
      icon: proposedIcon(),
      zIndexOffset: 800,
      title: "Draft proposed location — drag to adjust",
      draggable: true,
      autoPan: true,
    });
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLatLng();
      const parkFc = parkRef.current;
      if (parkFc?.features?.[0] && !pip(lng, lat, parkFc.features[0].geometry)) {
        const prev = draftMarkerRef.current?._vcpLastValid || {
          latitude: draftProposal.latitude,
          longitude: draftProposal.longitude,
        };
        marker.setLatLng([prev.latitude, prev.longitude]);
        outsideRef.current?.();
        return;
      }
      marker._vcpLastValid = { latitude: lat, longitude: lng };
      proposeMoveRef.current?.({ latitude: lat, longitude: lng });
    });
    marker._vcpLastValid = {
      latitude: draftProposal.latitude,
      longitude: draftProposal.longitude,
    };
    marker.addTo(group);
    draftMarkerRef.current = marker;
  }, [draftProposal]);

  useEffect(() => {
    const group = layersRef.current.existingDraft;
    const map = mapRef.current;
    if (!group) return;

    if (!draftExisting) {
      group.clearLayers();
      existingDraftRef.current = null;
      return;
    }

    const existing = existingDraftRef.current;
    if (existing && group.hasLayer(existing)) {
      const current = existing.getLatLng();
      if (
        Math.abs(current.lat - draftExisting.latitude) > 1e-9 ||
        Math.abs(current.lng - draftExisting.longitude) > 1e-9
      ) {
        existing.setLatLng([draftExisting.latitude, draftExisting.longitude]);
        existing._vcpLastValid = {
          latitude: draftExisting.latitude,
          longitude: draftExisting.longitude,
        };
        map?.panTo([draftExisting.latitude, draftExisting.longitude], { animate: true });
      }
      return;
    }

    group.clearLayers();
    const marker = L.marker([draftExisting.latitude, draftExisting.longitude], {
      icon: existingDraftIcon(),
      zIndexOffset: 850,
      title: "Draft existing bench location — drag to adjust",
      draggable: true,
      autoPan: true,
    });
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLatLng();
      const parkFc = parkRef.current;
      if (parkFc?.features?.[0] && !pip(lng, lat, parkFc.features[0].geometry)) {
        const prev = existingDraftRef.current?._vcpLastValid || {
          latitude: draftExisting.latitude,
          longitude: draftExisting.longitude,
        };
        marker.setLatLng([prev.latitude, prev.longitude]);
        outsideRef.current?.();
        return;
      }
      marker._vcpLastValid = { latitude: lat, longitude: lng };
      addExistingMoveRef.current?.({ latitude: lat, longitude: lng });
    });
    marker._vcpLastValid = {
      latitude: draftExisting.latitude,
      longitude: draftExisting.longitude,
    };
    marker.addTo(group);
    existingDraftRef.current = marker;
    map?.panTo([draftExisting.latitude, draftExisting.longitude], { animate: true });
  }, [draftExisting]);

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
  return polys.some(
    (poly) => ringContains(lon, lat, poly[0]) && !poly.slice(1).some((hole) => ringContains(lon, lat, hole))
  );
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
