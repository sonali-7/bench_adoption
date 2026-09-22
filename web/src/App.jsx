import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import {
  adoptionStatusLabel,
  canRequestAdoption,
  displayValue,
  durationCopy,
  googleMapsUrl,
  infoSourceLabel,
  prettyId,
  verificationLabel,
} from "./format.js";
import MapCanvas from "./MapCanvas.jsx";

const DURATIONS = [
  { months: 12, label: "1 year" },
  { months: 36, label: "3 years" },
  { months: 60, label: "5 years" },
];

const EMPTY_ADOPT_FORM = {
  requesterName: "",
  contact: "",
  durationMonths: 36,
  customDuration: false,
  message: "",
};

const EMPTY_PROPOSAL_FORM = {
  reason: "",
  proposerName: "",
  contact: "",
};

const EMPTY_EXISTING_FORM = {
  latitude: "",
  longitude: "",
  description: "",
  adoptionStatus: "unknown",
  adopterName: "",
  adoptionDate: "",
  durationMonths: "",
  notes: "",
  submitterName: "",
  contact: "",
};

function parseCoordinatePair(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { latitude: lat, longitude: lon };
}

export default function App() {
  const [tab, setTab] = useState("explore");
  const [meta, setMeta] = useState(null);
  const [park, setPark] = useState(null);
  const [trails, setTrails] = useState(null);
  const [benches, setBenches] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [proposeMode, setProposeMode] = useState(false);
  const [draftProposal, setDraftProposal] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [adoptStep, setAdoptStep] = useState(1);
  const [adoptForm, setAdoptForm] = useState(EMPTY_ADOPT_FORM);
  const [adoptError, setAdoptError] = useState("");
  const [adoptBusy, setAdoptBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [proposalForm, setProposalForm] = useState(EMPTY_PROPOSAL_FORM);
  const [proposalError, setProposalError] = useState("");
  const [proposalBusy, setProposalBusy] = useState(false);
  const [addExistingMode, setAddExistingMode] = useState(false);
  const [draftExisting, setDraftExisting] = useState(null);
  const [existingForm, setExistingForm] = useState(EMPTY_EXISTING_FORM);
  const [existingError, setExistingError] = useState("");
  const [existingBusy, setExistingBusy] = useState(false);
  const [selectedProposalId, setSelectedProposalId] = useState(null);

  const refresh = useCallback(async () => {
    const [benchPayload, proposalPayload] = await Promise.all([api.benches(), api.proposals()]);
    setBenches(benchPayload.benches);
    setProposals(proposalPayload.proposals);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [metaPayload, parkPayload, trailsPayload] = await Promise.all([
          api.meta(),
          api.park(),
          api.trails(),
        ]);
        if (cancelled) return;
        setMeta(metaPayload);
        setPark(parkPayload);
        setTrails(trailsPayload);
        await refresh();
      } catch (err) {
        if (!cancelled) setLoadError(err.message || "Unable to load park data.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const selected = benches.find((b) => b.bench_id === selectedId) || null;
  const available = useMemo(() => benches.filter((b) => b.adoption_status === "available"), [benches]);
  const adoptedCount = benches.filter((b) => b.adoption_status === "adopted").length;
  const mapBenches = useMemo(() => {
    if (tab === "adopt") {
      return benches.filter((b) => b.adoption_status === "available" || b.bench_id === selectedId);
    }
    return benches;
  }, [tab, benches, selectedId]);

  function exitPlacementModes({ keepNotice = false } = {}) {
    setProposeMode(false);
    setAddExistingMode(false);
    setDraftProposal(null);
    setDraftExisting(null);
    setProposalForm(EMPTY_PROPOSAL_FORM);
    setExistingForm(EMPTY_EXISTING_FORM);
    setProposalError("");
    setExistingError("");
    if (!keepNotice) setNotice("");
  }

  function exitProposalInteraction(opts) {
    exitPlacementModes(opts);
  }

  function goAdopt(benchId) {
    exitProposalInteraction();
    setSelectedId(benchId);
    setTab("adopt");
    setAdoptStep(2);
    setAdoptError("");
    setConfirmation(null);
  }

  function onProposeClick({ latitude, longitude }) {
    setDraftProposal({ latitude, longitude });
    setProposalError("");
    setNotice("Proposed marker placed. Drag it to adjust, then complete the form.");
  }

  function onProposeMove({ latitude, longitude }) {
    setDraftProposal({ latitude, longitude });
  }

  async function submitProposal(event) {
    event.preventDefault();
    if (!draftProposal) return;
    setProposalBusy(true);
    setProposalError("");
    try {
      await api.propose({
        latitude: draftProposal.latitude,
        longitude: draftProposal.longitude,
        reason: proposalForm.reason,
        proposerName: proposalForm.proposerName,
        contact: proposalForm.contact,
      });
      exitProposalInteraction();
      setNotice("Proposal saved. It appears on the map as an amber diamond, distinct from existing benches.");
      await refresh();
    } catch (err) {
      setProposalError(err.message);
    } finally {
      setProposalBusy(false);
    }
  }

  async function submitAdoptionRequest(event) {
    event.preventDefault();
    if (!selected || !canRequestAdoption(selected)) return;
    setAdoptBusy(true);
    setAdoptError("");
    try {
      const result = await api.submitAdoptionRequest({
        benchId: selected.bench_id,
        requesterName: adoptForm.requesterName,
        contact: adoptForm.contact,
        durationMonths: (() => {
          const n = Number(adoptForm.durationMonths);
          return Number.isFinite(n) ? Math.round(n) : n;
        })(),
        message: adoptForm.message,
      });
      setConfirmation(result);
      setAdoptStep(5);
      setAdoptForm(EMPTY_ADOPT_FORM);
      await refresh();
    } catch (err) {
      if (err.status === 409) {
        setAdoptError(err.message);
        await refresh();
      } else {
        setAdoptError(err.message);
      }
    } finally {
      setAdoptBusy(false);
    }
  }

  async function submitExistingBench(event) {
    event.preventDefault();
    const coords = parseCoordinatePair(existingForm.latitude, existingForm.longitude);
    if (!coords) {
      setExistingError("Enter a valid latitude and longitude for the bench location.");
      return;
    }
    setExistingBusy(true);
    setExistingError("");
    try {
      const result = await api.crowdsourceBench({
        latitude: coords.latitude,
        longitude: coords.longitude,
        description: existingForm.description,
        adoptionStatus: existingForm.adoptionStatus,
        adopterName: existingForm.adopterName,
        adoptionDate: existingForm.adoptionDate,
        durationMonths: existingForm.durationMonths,
        notes: existingForm.notes,
        submitterName: existingForm.submitterName,
        contact: existingForm.contact,
      });
      exitPlacementModes();
      const dup = result.duplicateWarning ? ` ${result.duplicateWarning}` : "";
      setNotice(
        `Existing bench saved as crowdsourced information (pending verification).${dup} Select it on the map to review details.`
      );
      setSelectedId(result.bench.bench_id);
      await refresh();
    } catch (err) {
      setExistingError(err.message);
    } finally {
      setExistingBusy(false);
    }
  }

  function syncExistingCoordsFromForm(latitude, longitude) {
    setExistingForm((prev) => ({ ...prev, latitude, longitude }));
    setDraftExisting(parseCoordinatePair(latitude, longitude));
  }

  function applyExistingCoordsFromMap(latitude, longitude) {
    setExistingForm((prev) => ({
      ...prev,
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
    }));
    setDraftExisting({ latitude, longitude });
  }

  function resetAdoptionForm() {
    setAdoptForm(EMPTY_ADOPT_FORM);
    setAdoptError("");
    setConfirmation(null);
  }

  function cancelAdoption({ returnToExplore = false } = {}) {
    resetAdoptionForm();
    setAdoptStep(1);
    setSelectedId(null);
    if (returnToExplore) setTab("explore");
  }

  if (loadError) {
    return (
      <main className="crash">
        <h1>Van Cortlandt Park Bench Adoption</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main-panel">
        Skip to content
      </a>
      <header className="masthead">
        <div className="brand">
          <p className="eyebrow">NYC Parks ID X092 · Bronx</p>
          <h1>Van Cortlandt Park Bench Adoption</h1>
          <p className="lede">
            A map-first inventory of park benches: official park geography, public bench coordinates, and a
            demonstration adoption registry.
          </p>
          <nav className="tabs" aria-label="Primary">
            <button
              type="button"
              className={tab === "explore" ? "tab is-active" : "tab"}
              aria-current={tab === "explore" ? "page" : undefined}
              onClick={() => {
                exitProposalInteraction();
                setTab("explore");
              }}
            >
              Explore
            </button>
            <button
              type="button"
              className={tab === "adopt" ? "tab is-active" : "tab"}
              aria-current={tab === "adopt" ? "page" : undefined}
              onClick={() => {
                exitProposalInteraction();
                setTab("adopt");
                setConfirmation(null);
                setAdoptStep(selected && canRequestAdoption(selected) ? 2 : 1);
              }}
            >
              Adopt
            </button>
          </nav>
        </div>
        <figure className="masthead-photo">
          <img
            src="/van-cortlandt-entrance.jpg"
            alt="Stone and iron entrance gates to Van Cortlandt Park"
            width={960}
            height={718}
          />
          <figcaption>
            Entrance to Van Cortlandt Park ·{" "}
            <a
              href="https://commons.wikimedia.org/wiki/File:Entrance_To_Van_Cortlandt_Park_2012.jpg"
              target="_blank"
              rel="noopener noreferrer"
            >
              Wikimedia Commons
            </a>
          </figcaption>
        </figure>
      </header>

      {proposeMode ? (
        <p className="notice propose-mode-banner" role="status">
          Proposal mode is active — click inside the park boundary to place a marker. Use another Explore control to
          cancel.
          <button type="button" className="text-btn" onClick={() => exitPlacementModes()}>
            Cancel proposal mode
          </button>
        </p>
      ) : null}

      {addExistingMode ? (
        <p className="notice propose-mode-banner" role="status">
          Add existing bench — enter coordinates in the form, or click the location on the map.
          <button type="button" className="text-btn" onClick={() => exitPlacementModes()}>
            Cancel
          </button>
        </p>
      ) : null}

      {notice && !proposeMode && !addExistingMode ? (
        <p className="notice" role="status">
          {notice}
          <button type="button" className="text-btn" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </p>
      ) : null}

      <div className="workspace">
        <section className="map-pane">
          {tab === "explore" ? (
            <div className={`map-toolbar${proposeMode || addExistingMode ? " is-proposing" : ""}`}>
              <fieldset className="filters">
                <legend className="sr-only">Filter benches</legend>
                {[
                  ["all", "All benches"],
                  ["available", "Available"],
                  ["adopted", "Adopted"],
                ].map(([value, label]) => (
                  <label key={value} className={filter === value ? "chip is-on" : "chip"}>
                    <input
                      type="radio"
                      name="filter"
                      value={value}
                      checked={filter === value}
                      onChange={() => {
                        exitPlacementModes();
                        setFilter(value);
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              <div className="toolbar-actions">
                <button
                  type="button"
                  className={addExistingMode ? "propose-btn is-on" : "propose-btn"}
                  aria-pressed={addExistingMode}
                  onClick={() => {
                    if (addExistingMode) {
                      exitPlacementModes();
                      return;
                    }
                    exitPlacementModes();
                    setSelectedId(null);
                    setDraftExisting(null);
                    setExistingForm(EMPTY_EXISTING_FORM);
                    setExistingError("");
                    setAddExistingMode(true);
                    setNotice("");
                  }}
                >
                  {addExistingMode ? "Cancel" : "Add an Existing Bench"}
                </button>
                <button
                  type="button"
                  className={proposeMode ? "propose-btn is-on" : "propose-btn"}
                  aria-pressed={proposeMode}
                  onClick={() => {
                    if (proposeMode) {
                      exitPlacementModes();
                      return;
                    }
                    exitPlacementModes();
                    setSelectedId(null);
                    setDraftProposal(null);
                    setProposalForm(EMPTY_PROPOSAL_FORM);
                    setProposalError("");
                    setProposeMode(true);
                    setNotice("");
                  }}
                >
                  {proposeMode ? "Cancel" : "Propose a Bench Location"}
                </button>
              </div>
            </div>
          ) : (
            <div className="map-toolbar">
              <p className="toolbar-copy">
                Green markers are explicitly available for adoption requests. Gray markers are existing benches with
                unknown adoption status.
              </p>
            </div>
          )}
          <MapCanvas
            park={park}
            trails={trails}
            benches={mapBenches}
            proposals={tab === "explore" && filter === "all" ? proposals : []}
            filter={tab === "explore" ? filter : "all"}
            selectedId={selectedId}
            proposeMode={tab === "explore" && proposeMode}
            addExistingMode={tab === "explore" && addExistingMode}
            draftProposal={tab === "explore" ? draftProposal : null}
            draftExisting={tab === "explore" ? draftExisting : null}
            onSelectBench={(id) => {
              if (tab === "explore") exitPlacementModes();
              setSelectedProposalId(null);
              setSelectedId(id);
              if (tab === "adopt" && id) {
                const bench = benches.find((b) => b.bench_id === id);
                if (canRequestAdoption(bench)) {
                  setAdoptStep(2);
                  setConfirmation(null);
                  setAdoptError("");
                }
              }
            }}
            selectedProposalId={selectedProposalId}
            onSelectProposal={(id) => {
              exitPlacementModes();
              setSelectedId(null);
              setSelectedProposalId(id);
            }}
            onProposeClick={onProposeClick}
            onProposeMove={onProposeMove}
            onAddExistingClick={({ latitude, longitude }) => {
              applyExistingCoordsFromMap(latitude, longitude);
              setExistingError("");
              setNotice("Coordinates set from the map. Edit them precisely in the form if needed.");
            }}
            onAddExistingMove={({ latitude, longitude }) => {
              applyExistingCoordsFromMap(latitude, longitude);
            }}
            onOutsidePark={() =>
              setNotice("That click is outside Van Cortlandt Park. Place markers inside the official X092 boundary.")
            }
          />
          <ul className="legend" aria-label="Map legend">
            <li>
              <span className="swatch green" /> Available bench
            </li>
            <li>
              <span className="swatch red" /> Adopted bench
            </li>
            <li>
              <span className="swatch gray" /> Unknown status
            </li>
            <li>
              <span className="swatch yellow" /> Request pending
            </li>
            <li>
              <span className="swatch blue" /> Crowdsourced (unverified)
            </li>
            <li>
              <span className="swatch amber diamond" /> Proposed location
            </li>
            <li>
              <span className="swatch teal circle" /> Draft existing bench
            </li>
            <li>
              <span className="swatch trail" /> Official park trails
            </li>
          </ul>
        </section>

        <aside id="main-panel" className="side-pane">
          {tab === "explore" ? (
            <ExplorePanel
              selected={selected}
              draftProposal={draftProposal}
              proposalForm={proposalForm}
              setProposalForm={setProposalForm}
              proposalError={proposalError}
              proposalBusy={proposalBusy}
              proposeMode={proposeMode}
              addExistingMode={addExistingMode}
              draftExisting={draftExisting}
              existingForm={existingForm}
              setExistingForm={setExistingForm}
              onExistingCoordsChange={syncExistingCoordsFromForm}
              existingError={existingError}
              existingBusy={existingBusy}
              onSubmitProposal={submitProposal}
              onSubmitExisting={submitExistingBench}
              onAdopt={goAdopt}
              onCancelDraft={() => exitPlacementModes()}
              meta={meta}
            />
          ) : (
            <AdoptPanel
              available={available}
              selected={selected}
              step={adoptStep}
              setStep={setAdoptStep}
              form={adoptForm}
              setForm={setAdoptForm}
              error={adoptError}
              busy={adoptBusy}
              confirmation={confirmation}
              onSelect={(id) => {
                setSelectedId(id);
                setAdoptStep(2);
                setConfirmation(null);
                setAdoptError("");
              }}
              onSubmit={submitAdoptionRequest}
              onCancelAdoption={() => cancelAdoption()}
              onCancelToExplore={() => cancelAdoption({ returnToExplore: true })}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function ExplorePanel({
  selected,
  draftProposal,
  proposalForm,
  setProposalForm,
  proposalError,
  proposalBusy,
  proposeMode,
  addExistingMode,
  draftExisting,
  existingForm,
  setExistingForm,
  onExistingCoordsChange,
  existingError,
  existingBusy,
  onSubmitProposal,
  onSubmitExisting,
  onAdopt,
  onCancelDraft,
  meta,
}) {
  if (addExistingMode) {
    return (
      <section>
        <h2>Add an existing bench</h2>
        <p className="hint">
          Enter the bench&apos;s latitude and longitude, or click/drag on the map. The marker moves to those exact
          coordinates. Crowdsourced records are pending verification.
        </p>
        <form className="stack" onSubmit={onSubmitExisting}>
          <label>
            Latitude
            <input
              required
              inputMode="decimal"
              placeholder="e.g. 40.897500"
              value={existingForm.latitude}
              onChange={(e) => onExistingCoordsChange(e.target.value, existingForm.longitude)}
            />
          </label>
          <label>
            Longitude
            <input
              required
              inputMode="decimal"
              placeholder="e.g. -73.884000"
              value={existingForm.longitude}
              onChange={(e) => onExistingCoordsChange(existingForm.latitude, e.target.value)}
            />
          </label>
          {draftExisting ? (
            <p className="hint">
              Map marker at {draftExisting.latitude.toFixed(6)}, {draftExisting.longitude.toFixed(6)}
            </p>
          ) : (
            <p className="hint">Enter both coordinates to place a marker on the map.</p>
          )}
          <label>
            Identifying description
            <textarea
              rows={3}
              value={existingForm.description}
              onChange={(e) => setExistingForm({ ...existingForm, description: e.target.value })}
              placeholder="e.g. wooden bench near the playground entrance"
            />
          </label>
          <label>
            Adoption status (if known)
            <select
              value={existingForm.adoptionStatus}
              onChange={(e) => setExistingForm({ ...existingForm, adoptionStatus: e.target.value })}
            >
              <option value="unknown">Unknown / not established</option>
              <option value="available">Available for adoption</option>
              <option value="adopted">Adopted (name visible or known)</option>
            </select>
          </label>
          <label>
            Adoptee name <span className="optional">(if known)</span>
            <input
              value={existingForm.adopterName}
              onChange={(e) => setExistingForm({ ...existingForm, adopterName: e.target.value })}
            />
          </label>
          <label>
            Adoption date <span className="optional">(if known)</span>
            <input
              type="date"
              value={existingForm.adoptionDate}
              onChange={(e) => setExistingForm({ ...existingForm, adoptionDate: e.target.value })}
            />
          </label>
          <label>
            Adoption duration (months) <span className="optional">(if known)</span>
            <input
              type="number"
              min={1}
              value={existingForm.durationMonths}
              onChange={(e) => setExistingForm({ ...existingForm, durationMonths: e.target.value })}
            />
          </label>
          <label>
            Notes / source <span className="optional">(optional)</span>
            <textarea
              rows={2}
              value={existingForm.notes}
              onChange={(e) => setExistingForm({ ...existingForm, notes: e.target.value })}
            />
          </label>
          <label>
            Your name <span className="optional">(optional)</span>
            <input
              value={existingForm.submitterName}
              onChange={(e) => setExistingForm({ ...existingForm, submitterName: e.target.value })}
            />
          </label>
          <label>
            Contact <span className="optional">(optional)</span>
            <input
              type="email"
              value={existingForm.contact}
              onChange={(e) => setExistingForm({ ...existingForm, contact: e.target.value })}
            />
          </label>
          {existingError ? <p className="error">{existingError}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={existingBusy || !draftExisting}>
              {existingBusy ? "Saving…" : "Save existing bench"}
            </button>
            <button type="button" className="ghost" onClick={onCancelDraft}>
              Cancel
            </button>
          </div>
        </form>
      </section>
    );
  }

  if (draftProposal) {
    return (
      <section>
        <h2>Propose this location</h2>
        <p className="hint">
          Marker coordinates: {draftProposal.latitude.toFixed(6)}, {draftProposal.longitude.toFixed(6)}
          <br />
          Drag the amber marker on the map to adjust the location before saving.
        </p>
        <form className="stack" onSubmit={onSubmitProposal}>
          <label>
            Reason for this location
            <textarea
              required
              minLength={8}
              rows={4}
              value={proposalForm.reason}
              onChange={(e) => setProposalForm({ ...proposalForm, reason: e.target.value })}
            />
          </label>
          <label>
            Name <span className="optional">(optional)</span>
            <input
              value={proposalForm.proposerName}
              onChange={(e) => setProposalForm({ ...proposalForm, proposerName: e.target.value })}
            />
          </label>
          <label>
            Contact <span className="optional">(optional)</span>
            <input
              type="email"
              value={proposalForm.contact}
              onChange={(e) => setProposalForm({ ...proposalForm, contact: e.target.value })}
            />
          </label>
          {proposalError ? <p className="error">{proposalError}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={proposalBusy}>
              {proposalBusy ? "Saving…" : "Save proposal"}
            </button>
            <button type="button" className="ghost" onClick={onCancelDraft}>
              Cancel
            </button>
          </div>
        </form>
      </section>
    );
  }

  if (selected) {
    const adoption = selected.adoption;
    const statusClass =
      selected.adoption_status === "adopted"
        ? "adopted"
        : selected.adoption_status === "available"
          ? "available"
          : "unknown";
    return (
      <section>
        <p className={`status-pill ${statusClass}`}>{adoptionStatusLabel(selected.adoption_status)}</p>
        <h2>{selected.gis_name || prettyId(selected.bench_id)}</h2>
        {selected.is_crowdsourced ? (
          <p className="sample-flag">Crowdsourced record — pending verification; not authoritative.</p>
        ) : null}
        <dl className="facts">
          <div>
            <dt>Bench ID</dt>
            <dd>{selected.bench_id}</dd>
          </div>
          <div>
            <dt>Coordinates</dt>
            <dd>
              {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}
            </dd>
          </div>
          <div>
            <dt>Information source</dt>
            <dd>{infoSourceLabel(selected.info_source)}</dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd>{verificationLabel(selected.verification_status)}</dd>
          </div>
          <div>
            <dt>Description</dt>
            <dd>{displayValue(selected.description)}</dd>
          </div>
          <div>
            <dt>GIS reference</dt>
            <dd>{displayValue(selected.gis_source)}</dd>
          </div>
          {selected.bench_type ? (
            <div>
              <dt>Bench type</dt>
              <dd>{selected.bench_type}</dd>
            </div>
          ) : null}
          {adoption ? (
            <>
              <div>
                <dt>Adoptee</dt>
                <dd>{adoption.adopter_name}</dd>
              </div>
              <div>
                <dt>Adopted</dt>
                <dd>{adoption.adoption_date}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{durationCopy(adoption.duration_months)}</dd>
              </div>
              <div>
                <dt>Time remaining</dt>
                <dd>{adoption.time_remaining}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Reported adoptee</dt>
                <dd>{displayValue(selected.reported_adopter_name, "Unknown")}</dd>
              </div>
              <div>
                <dt>Reported adoption date</dt>
                <dd>{displayValue(selected.reported_adoption_date)}</dd>
              </div>
            </>
          )}
          {selected.pending_adoption_request ? (
            <div>
              <dt>Adoption request</dt>
              <dd>
                Pending ({selected.pending_adoption_request.status}) since{" "}
                {String(selected.pending_adoption_request.submitted_at).slice(0, 10)}
              </dd>
            </div>
          ) : null}
          {selected.near_duplicate_bench_ids?.length ? (
            <div>
              <dt>Possible duplicates</dt>
              <dd>{selected.near_duplicate_bench_ids.join(", ")} — flagged for review</dd>
            </div>
          ) : null}
        </dl>
        {adoption?.is_sample ? (
          <p className="sample-flag">Demonstration adoption record — replaceable with official program data.</p>
        ) : null}
        <p>
          <a href={selected.google_maps_url || googleMapsUrl(selected.latitude, selected.longitude)} target="_blank" rel="noopener noreferrer">
            View in Google Maps
          </a>
        </p>
        {canRequestAdoption(selected) ? (
          <button type="button" className="primary" onClick={() => onAdopt(selected.bench_id)}>
            Request adoption
          </button>
        ) : null}
        {selected.adoption_status === "request_submitted" ? (
          <p className="hint">An adoption request is already pending review by Van Cortlandt Park.</p>
        ) : null}
      </section>
    );
  }

  return (
    <section>
      <h2>Explore the park</h2>
      <p>
        Click a bench marker to view its record. Only benches explicitly marked available can receive adoption requests.
        Unknown status does not mean available.
      </p>
      {proposeMode ? (
        <p className="hint propose-hint">Proposal mode is on. Click a point inside the park boundary.</p>
      ) : addExistingMode ? (
        <p className="hint propose-hint">Add existing bench mode is on. Click the bench location on the map.</p>
      ) : (
        <p className="hint">
          Use <strong>Add an Existing Bench</strong> for a physical bench missing from the map, or{" "}
          <strong>Propose a Bench Location</strong> for a suggested new bench site.
        </p>
      )}
      {meta ? (
        <details className="sources">
          <summary>Data sources</summary>
          <ul>
            <li>{meta.boundary_source}</li>
            <li>{meta.trails_source}</li>
            <li>{meta.bench_source}</li>
            {meta.notes?.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function AdoptPanel({
  available,
  selected,
  step,
  setStep,
  form,
  setForm,
  error,
  busy,
  confirmation,
  onSelect,
  onSubmit,
  onCancelAdoption,
  onCancelToExplore,
}) {
  if (confirmation) {
    const bench = confirmation.bench;
    const request = confirmation.request;
    return (
      <section className="confirm">
        <p className="status-pill available">Request submitted</p>
        <h2>Thank you, {request.requester_name}</h2>
        <p>
          Your adoption request for bench <strong>{bench.bench_id}</strong> has been saved. Van Cortlandt Park will
          review the request and follow up with you directly. This is not an official adoption until the park confirms
          it.
        </p>
        <dl className="facts">
          <div>
            <dt>Requested duration</dt>
            <dd>{durationCopy(request.duration_months)}</dd>
          </div>
          <div>
            <dt>Request status</dt>
            <dd>{request.status}</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{String(request.submitted_at).slice(0, 10)}</dd>
          </div>
        </dl>
        <button type="button" className="primary" onClick={onCancelToExplore}>
          Return to Explore
        </button>
      </section>
    );
  }

  const eligible = selected && canRequestAdoption(selected);

  return (
    <section>
      <p className="hint">
        Submitting a request is not the same as adopting a bench. Van Cortlandt Park handles confirmation and further
        communication.
      </p>
      <ol className="steps" aria-label="Adoption request steps">
        {["Choose", "Review", "Your details", "Confirm"].map((label, index) => (
          <li key={label} className={step === index + 1 ? "is-current" : step > index + 1 ? "is-done" : ""}>
            {label}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <>
          <h2>Select an available bench</h2>
          {available.length === 0 ? (
            <p>No benches are currently marked available for adoption requests.</p>
          ) : (
            <ul className="bench-list">
              {available.map((bench) => (
                <li key={bench.bench_id}>
                  <button type="button" onClick={() => onSelect(bench.bench_id)}>
                    <strong>{prettyId(bench.bench_id)}</strong>
                    <span>
                      {bench.latitude.toFixed(5)}, {bench.longitude.toFixed(5)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="ghost" onClick={onCancelToExplore}>
              Cancel
            </button>
          </div>
        </>
      ) : null}

      {step >= 2 && selected ? (
        <div className="review-block">
          <h2>{step === 2 ? "Review this bench" : prettyId(selected.bench_id)}</h2>
          <p>
            {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)} ·{" "}
            {adoptionStatusLabel(selected.adoption_status)}
          </p>
          <p>
            <a href={selected.google_maps_url || googleMapsUrl(selected.latitude, selected.longitude)} target="_blank" rel="noopener noreferrer">
              View in Google Maps
            </a>
          </p>
          {!eligible ? <p className="error">This bench is no longer available for an adoption request.</p> : null}
          {step === 2 && eligible ? (
            <div className="actions">
              <button type="button" className="primary" onClick={() => setStep(3)}>
                Continue
              </button>
              <button type="button" className="ghost" onClick={onCancelAdoption}>
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 3 && eligible ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const months = Number(form.durationMonths);
            if (
              form.customDuration &&
              (!Number.isInteger(months) || months < 1 || months > 120)
            ) {
              return;
            }
            setStep(4);
          }}
        >
          <label>
            Your name
            <input
              required
              minLength={2}
              value={form.requesterName}
              onChange={(e) => setForm({ ...form, requesterName: e.target.value })}
            />
          </label>
          <label>
            Email / contact information
            <input
              required
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
            />
          </label>
          <div className="duration-block">
            <span id="duration-label">Desired adoption duration</span>
            <div className="choice-list" role="radiogroup" aria-labelledby="duration-label">
              {DURATIONS.map((item) => (
                <label key={item.months} className="choice">
                  <input
                    type="radio"
                    name="duration"
                    value={item.months}
                    checked={!form.customDuration && Number(form.durationMonths) === item.months}
                    onChange={() =>
                      setForm({ ...form, durationMonths: item.months, customDuration: false })
                    }
                  />
                  <span>{item.label}</span>
                </label>
              ))}
              <label className="choice">
                <input
                  type="radio"
                  name="duration"
                  value="custom"
                  checked={Boolean(form.customDuration)}
                  onChange={() =>
                    setForm({
                      ...form,
                      customDuration: true,
                      durationMonths:
                        DURATIONS.some((d) => d.months === Number(form.durationMonths))
                          ? ""
                          : form.durationMonths,
                    })
                  }
                />
                <span>Choose your own</span>
              </label>
            </div>
            {form.customDuration ? (
              <input
                type="number"
                required
                min={1}
                max={120}
                step={1}
                inputMode="numeric"
                placeholder="Duration in months (1–120)"
                aria-label="Custom adoption duration in months"
                value={form.durationMonths}
                onChange={(e) => setForm({ ...form, durationMonths: e.target.value })}
              />
            ) : null}
          </div>
          <label>
            Message to Van Cortlandt Park <span className="optional">(optional)</span>
            <textarea
              rows={3}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          </label>
          <div className="actions">
            <button type="submit" className="primary">
              Review request
            </button>
            <button type="button" className="ghost" onClick={onCancelAdoption}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {step === 4 && eligible ? (
        <form className="stack" onSubmit={onSubmit}>
          <h2>Confirm adoption request</h2>
          <ul className="summary">
            <li>Bench {selected.bench_id}</li>
            <li>
              {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}
            </li>
            <li>{form.requesterName}</li>
            <li>{form.contact}</li>
            <li>{durationCopy(Number(form.durationMonths))}</li>
            {form.message ? <li>{form.message}</li> : null}
          </ul>
          {error ? <p className="error">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Submitting…" : "Submit adoption request"}
            </button>
            <button type="button" className="ghost" onClick={onCancelAdoption}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {error && step !== 4 ? <p className="error">{error}</p> : null}
    </section>
  );
  {/* <p className="data-banner" role="note">
        <strong>GIS is authoritative; adoptions are not.</strong> Park boundary and trails come from NYC Open Data
        (Parks Properties and Parks Trails, Park ID X092). Bench points are OpenStreetMap <code>amenity=bench</code>{" "}
        features clipped to that boundary — NYC Parks does not publish a public bench GIS layer. Names and dates on
        adopted benches are labeled demonstration records unless you just submitted one in this session.
      </p> */}
}
