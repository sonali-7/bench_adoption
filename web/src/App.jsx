import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { durationCopy, prettyId } from "./format.js";
import MapCanvas from "./MapCanvas.jsx";

const DURATIONS = [
  { months: 12, label: "1 year" },
  { months: 36, label: "3 years" },
  { months: 60, label: "5 years" },
];

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
  const [overlayParkMap, setOverlayParkMap] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [adoptStep, setAdoptStep] = useState(1);
  const [adoptForm, setAdoptForm] = useState({
    adopterName: "",
    contact: "",
    durationMonths: 36,
  });
  const [adoptError, setAdoptError] = useState("");
  const [adoptBusy, setAdoptBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [proposalForm, setProposalForm] = useState({
    reason: "",
    proposerName: "",
    contact: "",
  });
  const [proposalError, setProposalError] = useState("");
  const [proposalBusy, setProposalBusy] = useState(false);

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
  const available = useMemo(() => benches.filter((b) => b.status === "available"), [benches]);
  const adoptedCount = benches.filter((b) => b.status === "adopted").length;
  const mapBenches = useMemo(() => {
    if (tab === "adopt") {
      return benches.filter((b) => b.status === "available" || b.bench_id === selectedId);
    }
    return benches;
  }, [tab, benches, selectedId]);

  function goAdopt(benchId) {
    setSelectedId(benchId);
    setTab("adopt");
    setAdoptStep(2);
    setAdoptError("");
    setConfirmation(null);
    setProposeMode(false);
  }

  const handleSelectBench = useCallback((id) => {
    setSelectedId(id);
  }, []);

  function onProposeClick({ latitude, longitude }) {
    setDraftProposal({ latitude, longitude });
    setProposalError("");
    setNotice("Proposed marker placed. Complete the form to save this location.");
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
      setDraftProposal(null);
      setProposeMode(false);
      setProposalForm({ reason: "", proposerName: "", contact: "" });
      setNotice("Proposal saved. It appears on the map as an amber diamond, distinct from existing benches.");
      await refresh();
    } catch (err) {
      setProposalError(err.message);
    } finally {
      setProposalBusy(false);
    }
  }

  async function submitAdoption(event) {
    event.preventDefault();
    if (!selected || selected.status !== "available") return;
    setAdoptBusy(true);
    setAdoptError("");
    try {
      const result = await api.adopt({
        benchId: selected.bench_id,
        adopterName: adoptForm.adopterName,
        contact: adoptForm.contact,
        durationMonths: Number(adoptForm.durationMonths),
      });
      setConfirmation(result.bench);
      setAdoptStep(5);
      await refresh();
    } catch (err) {
      if (err.status === 409) {
        setAdoptError(
          "This bench was just adopted by someone else. Please return to Explore to choose another available bench."
        );
        await refresh();
      } else {
        setAdoptError(err.message);
      }
    } finally {
      setAdoptBusy(false);
    }
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
        </div>
        <dl className="stats" aria-label="Inventory summary">
          <div>
            <dt>Mapped benches</dt>
            <dd>{benches.length}</dd>
          </div>
          <div>
            <dt>Available</dt>
            <dd>{available.length}</dd>
          </div>
          <div>
            <dt>Adopted</dt>
            <dd>{adoptedCount}</dd>
          </div>
          <div>
            <dt>Proposals</dt>
            <dd>{proposals.length}</dd>
          </div>
        </dl>
      </header>

      <nav className="tabs" aria-label="Primary">
        <button
          type="button"
          className={tab === "explore" ? "tab is-active" : "tab"}
          aria-current={tab === "explore" ? "page" : undefined}
          onClick={() => setTab("explore")}
        >
          Explore
        </button>
        <button
          type="button"
          className={tab === "adopt" ? "tab is-active" : "tab"}
          aria-current={tab === "adopt" ? "page" : undefined}
          onClick={() => {
            setTab("adopt");
            setProposeMode(false);
            setConfirmation(null);
            setAdoptStep(selected?.status === "available" ? 2 : 1);
          }}
        >
          Adopt
        </button>
      </nav>

      <p className="data-banner" role="note">
        <strong>GIS is authoritative; adoptions are not.</strong> Park boundary and trails come from NYC Open Data
        (Parks Properties and Parks Trails, Park ID X092). Bench points are OpenStreetMap <code>amenity=bench</code>{" "}
        features clipped to that boundary — NYC Parks does not publish a public bench GIS layer. Names and dates on
        adopted benches are labeled demonstration records unless you just submitted one in this session.
      </p>

      {notice ? (
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
            <div className="map-toolbar">
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
                      onChange={() => setFilter(value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                className={proposeMode ? "propose-btn is-on" : "propose-btn"}
                aria-pressed={proposeMode}
                onClick={() => {
                  setProposeMode((value) => !value);
                  setDraftProposal(null);
                  setSelectedId(null);
                  setNotice(
                    !proposeMode
                      ? "Click inside the green park boundary to place a proposed bench. Clicks outside the park are rejected."
                      : ""
                  );
                }}
              >
                Propose a Bench Location
              </button>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={overlayParkMap}
                  onChange={(e) => setOverlayParkMap(e.target.checked)}
                />
                Illustrated VCPA map overlay
              </label>
            </div>
          ) : (
            <div className="map-toolbar">
              <p className="toolbar-copy">
                Available benches are shown in green. Select one here or from the list to begin an adoption.
              </p>
            </div>
          )}
          <MapCanvas
            park={park}
            trails={trails}
            benches={mapBenches}
            proposals={tab === "explore" ? proposals : []}
            filter={tab === "explore" ? filter : "all"}
            selectedId={selectedId}
            proposeMode={tab === "explore" && proposeMode}
            draftProposal={tab === "explore" ? draftProposal : null}
            overlayParkMap={overlayParkMap}
            onSelectBench={(id) => {
              handleSelectBench(id);
              if (tab === "adopt") {
                const bench = benches.find((b) => b.bench_id === id);
                if (bench?.status === "available") {
                  setAdoptStep(2);
                  setConfirmation(null);
                  setAdoptError("");
                }
              }
            }}
            onProposeClick={onProposeClick}
            onOutsidePark={() =>
              setNotice("That click is outside Van Cortlandt Park. Place proposals inside the official X092 boundary.")
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
              <span className="swatch amber diamond" /> Proposed location
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
              onSubmitProposal={submitProposal}
              onAdopt={goAdopt}
              onCancelDraft={() => {
                setDraftProposal(null);
                setProposeMode(false);
              }}
              meta={meta}
            />
          ) : (
            <AdoptPanel
              benches={benches}
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
              onSubmit={submitAdoption}
              onBackToExplore={() => setTab("explore")}
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
  onSubmitProposal,
  onAdopt,
  onCancelDraft,
  meta,
}) {
  if (draftProposal) {
    return (
      <section>
        <h2>Propose this location</h2>
        <p className="hint">
          Marker coordinates: {draftProposal.latitude.toFixed(6)}, {draftProposal.longitude.toFixed(6)}
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
    return (
      <section>
        <p className={`status-pill ${selected.status}`}>{selected.status === "adopted" ? "Adopted" : "Available"}</p>
        <h2>{selected.gis_name || prettyId(selected.bench_id)}</h2>
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
            <dt>GIS source</dt>
            <dd>{selected.gis_source}</dd>
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
          ) : null}
        </dl>
        {adoption?.is_sample ? (
          <p className="sample-flag">Demonstration adoption record — replaceable with official program data.</p>
        ) : null}
        {selected.status === "available" ? (
          <button type="button" className="primary" onClick={() => onAdopt(selected.bench_id)}>
            Adopt this bench
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section>
      <h2>Explore the park</h2>
      <p>
        Zoom and pan the map, then click a marker. Green benches can be adopted. Red benches already have an adoptee
        in the demonstration registry.
      </p>
      {proposeMode ? (
        <p className="hint">Proposal mode is on. Click a point inside the park boundary.</p>
      ) : (
        <p className="hint">
          Use <strong>Propose a Bench Location</strong> to drop a new marker — not an existing bench — directly on the
          map.
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
  onBackToExplore,
}) {
  if (confirmation) {
    return (
      <section className="confirm">
        <p className="status-pill adopted">Adoption recorded</p>
        <h2>Thank you, {confirmation.adoption.adopter_name}</h2>
        <p>
          Bench <strong>{confirmation.bench_id}</strong> is now adopted through{" "}
          <strong>{confirmation.adoption.expiration_date}</strong>. It appears in red on Explore immediately.
        </p>
        <dl className="facts">
          <div>
            <dt>Duration</dt>
            <dd>{durationCopy(confirmation.adoption.duration_months)}</dd>
          </div>
          <div>
            <dt>Time remaining</dt>
            <dd>{confirmation.adoption.time_remaining}</dd>
          </div>
        </dl>
        <button type="button" className="primary" onClick={onBackToExplore}>
          Return to Explore
        </button>
      </section>
    );
  }

  return (
    <section>
      <ol className="steps" aria-label="Adoption steps">
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
            <p>Every mapped bench is currently adopted. Propose a new location from Explore.</p>
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
        </>
      ) : null}

      {step >= 2 && selected ? (
        <div className="review-block">
          <h2>{step === 2 ? "Review this bench" : prettyId(selected.bench_id)}</h2>
          <p>
            {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)} · {selected.status}
          </p>
          {selected.status !== "available" ? (
            <p className="error">
              This bench was just adopted by someone else. Please return to Explore to choose another available bench.
            </p>
          ) : null}
          {step === 2 && selected.status === "available" ? (
            <div className="actions">
              <button type="button" className="primary" onClick={() => setStep(3)}>
                Continue
              </button>
              <button type="button" className="ghost" onClick={() => setStep(1)}>
                Choose a different bench
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 3 && selected?.status === "available" ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(4);
          }}
        >
          <label>
            Adopter name
            <input
              required
              minLength={2}
              value={form.adopterName}
              onChange={(e) => setForm({ ...form, adopterName: e.target.value })}
            />
          </label>
          <label>
            Contact information
            <input
              required
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
            />
          </label>
          <fieldset>
            <legend>Adoption duration</legend>
            {DURATIONS.map((item) => (
              <label key={item.months} className="choice">
                <input
                  type="radio"
                  name="duration"
                  value={item.months}
                  checked={Number(form.durationMonths) === item.months}
                  onChange={() => setForm({ ...form, durationMonths: item.months })}
                />
                {item.label}
              </label>
            ))}
          </fieldset>
          <button type="submit" className="primary">
            Review adoption
          </button>
        </form>
      ) : null}

      {step === 4 && selected?.status === "available" ? (
        <form className="stack" onSubmit={onSubmit}>
          <h2>Confirm adoption</h2>
          <ul className="summary">
            <li>Bench {selected.bench_id}</li>
            <li>
              {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}
            </li>
            <li>{form.adopterName}</li>
            <li>{form.contact}</li>
            <li>{durationCopy(Number(form.durationMonths))} · no payment collected</li>
          </ul>
          {error ? <p className="error">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Submitting…" : "Submit adoption"}
            </button>
            <button type="button" className="ghost" onClick={() => setStep(3)}>
              Back
            </button>
          </div>
        </form>
      ) : null}

      {error && step !== 4 ? <p className="error">{error}</p> : null}
    </section>
  );
}
