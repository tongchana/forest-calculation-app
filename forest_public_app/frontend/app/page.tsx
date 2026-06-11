"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";

type MetricCard = {
  label: string;
  value: string;
  help_text: string;
};

type PreviewMap = {
  summaryAll: Record<string, unknown>[];
  summaryBiomass: Record<string, unknown>[];
  summaryVolume: Record<string, unknown>[];
  summaryShannon: Record<string, unknown>[];
  unmatchedSpecies: Record<string, unknown>[];
};

type DownloadPayload = {
  filename: string;
  contentBase64: string;
};

type CalculationResponse = {
  metrics: MetricCard[];
  previews: PreviewMap;
  downloads: {
    summary: DownloadPayload;
    detail: DownloadPayload;
    component: DownloadPayload | null;
  };
};

type SheetGroup = {
  id: string;
  name: string;
  sheetNames: string[];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const tabOrder: Array<keyof PreviewMap> = [
  "summaryAll",
  "summaryBiomass",
  "summaryVolume",
  "summaryShannon",
  "unmatchedSpecies",
];
const tabLabels: Record<keyof PreviewMap, string> = {
  summaryAll: "Overall Summary",
  summaryBiomass: "Biomass",
  summaryVolume: "Volume",
  summaryShannon: "Shannon / IVI",
  unmatchedSpecies: "Unmatched Species",
};

function base64ToBlob(base64: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function downloadWorkbook(file: DownloadPayload) {
  const blob = base64ToBlob(file.contentBase64);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function normaliseGroupPayload(groups: SheetGroup[]) {
  return groups
    .filter((group) => group.name.trim() && group.sheetNames.length > 0)
    .map((group) => ({
      name: group.name.trim(),
      sheet_names: group.sheetNames,
    }));
}

export default function Page() {
  const [plotAreaHa, setPlotAreaHa] = useState(0.1);
  const [raiPerHectare, setRaiPerHectare] = useState(6.25);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [groups, setGroups] = useState<SheetGroup[]>([]);
  const [result, setResult] = useState<CalculationResponse | null>(null);
  const [activeTab, setActiveTab] = useState<keyof PreviewMap>("summaryAll");
  const [busy, setBusy] = useState(false);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/config`);
        const data = await response.json();
        if (typeof data.plotAreaHa === "number") setPlotAreaHa(data.plotAreaHa);
        if (typeof data.raiPerHectare === "number") setRaiPerHectare(data.raiPerHectare);
      } catch {
        // Keep defaults when the API is unavailable during first paint.
      }
    }
    void loadConfig();
  }, []);

  const groupedSheets = useMemo(() => new Set(groups.flatMap((group) => group.sheetNames)), [groups]);

  async function handleInspect(file: File) {
    setInspectBusy(true);
    setError(null);
    setMessage(null);
    setResult(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch(`${API_BASE_URL}/api/inspect`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ detail: "Could not inspect workbook." }));
        throw new Error(data.detail ?? "Could not inspect workbook.");
      }
      const data = (await response.json()) as { sheetNames: string[] };
      setSheetNames(data.sheetNames ?? []);
      setGroups([]);
      setMessage(`Detected ${data.sheetNames.length} worksheet(s). Build components if you want combined outputs.`);
    } catch (inspectError) {
      setSheetNames([]);
      setError(inspectError instanceof Error ? inspectError.message : "Could not inspect workbook.");
    } finally {
      setInspectBusy(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setWorkbookFile(file);
    if (file) {
      void handleInspect(file);
    } else {
      setSheetNames([]);
      setGroups([]);
      setResult(null);
      setMessage(null);
      setError(null);
    }
  }

  function addGroup() {
    setGroups((current) => [
      ...current,
      { id: crypto.randomUUID(), name: `Component ${current.length + 1}`, sheetNames: [] },
    ]);
  }

  function updateGroup(groupId: string, patch: Partial<SheetGroup>) {
    setGroups((current) => current.map((group) => (group.id === groupId ? { ...group, ...patch } : group)));
  }

  function removeGroup(groupId: string) {
    setGroups((current) => current.filter((group) => group.id !== groupId));
  }

  async function handleCalculate() {
    if (!workbookFile) {
      setError("Upload a completed workbook before calculating.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    const formData = new FormData();
    formData.append("file", workbookFile);
    formData.append("plot_area_ha", String(plotAreaHa));
    formData.append("rai_per_hectare", String(raiPerHectare));
    formData.append("sheet_groups", JSON.stringify(normaliseGroupPayload(groups)));

    try {
      const response = await fetch(`${API_BASE_URL}/api/calculate`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ detail: "Calculation failed." }));
        throw new Error(data.detail ?? "Calculation failed.");
      }
      const data = (await response.json()) as CalculationResponse;
      setResult(data);
      setActiveTab("summaryAll");
      setMessage("Calculation completed. Review the preview tabs and download the generated workbooks.");
    } catch (calcError) {
      setResult(null);
      setError(calcError instanceof Error ? calcError.message : "Calculation failed.");
    } finally {
      setBusy(false);
    }
  }

  const currentRows = result?.previews[activeTab] ?? [];
  const currentColumns = currentRows.length > 0 ? Object.keys(currentRows[0]) : [];

  return (
    <main className="page-shell">
      <section className="hero">
        <nav className="top-nav">
          <div className="brand">
            <span className="brand-mark" />
            <span>Forest Field Studio</span>
          </div>
          <a className="ghost-link" href={`${API_BASE_URL}/api/template`}>
            Download template
          </a>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Public-facing forest workflow</span>
            <h1>Bring your survey workbook into a calmer, richer experience.</h1>
            <p>
              This version separates the frontend from the Python engine, giving you more room for public-facing layout,
              motion, and storytelling while still using the same forest calculation logic underneath.
            </p>
            <div className="hero-actions">
              <a className="primary-link" href="#calculator">
                Open the calculator
              </a>
              <a className="secondary-link" href="#results">
                See the result flow
              </a>
            </div>
            <div className="hero-stats">
              <div>
                <strong>Next.js</strong>
                <span>Public UX layer</span>
              </div>
              <div>
                <strong>FastAPI</strong>
                <span>Python bridge</span>
              </div>
              <div>
                <strong>Same engine</strong>
                <span>Reuse existing formulas</span>
              </div>
            </div>
          </div>

          <div className="hero-card">
            <div className="mini-card">
              <h3>Guided flow</h3>
              <ol>
                <li>Inspect workbook sheets before processing.</li>
                <li>Combine worksheets into named components when needed.</li>
                <li>Preview summaries and download generated outputs.</li>
              </ol>
            </div>
            <div className="mini-card soft">
              <h3>Why this stack</h3>
              <p>
                Next.js gives you stronger layout control, better motion, and a more brand-ready public experience than
                Streamlit, while FastAPI keeps the Python workflow intact.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="feature-band">
        <article className="feature-card">
          <span className="feature-kicker">Presentation</span>
          <h2>Marketing-grade structure</h2>
          <p>Hero sections, richer section rhythm, softer depth, and storytelling blocks fit public visitors better.</p>
        </article>
        <article className="feature-card">
          <span className="feature-kicker">Control</span>
          <h2>Animation and state freedom</h2>
          <p>Client-side React state makes upload, grouping, tabs, and download experiences far more flexible.</p>
        </article>
        <article className="feature-card">
          <span className="feature-kicker">Reuse</span>
          <h2>Existing formulas stay trusted</h2>
          <p>The backend still delegates the calculation to your current Python workflow and output writers.</p>
        </article>
      </section>

      <section className="calculator-grid" id="calculator">
        <div className="panel story-panel">
          <span className="section-tag">Step 1</span>
          <h3>Prepare the workbook</h3>
          <p>Start from the official template so the field layout and downstream calculations stay aligned.</p>
          <a className="primary-link inline" href={`${API_BASE_URL}/api/template`}>
            Download the official template
          </a>
        </div>

        <div className="panel upload-panel">
          <span className="section-tag">Step 2</span>
          <h3>Upload and inspect</h3>
          <p>Bring in the finished workbook. The API will inspect it first so you can build component groups before the run.</p>
          <label className="upload-drop">
            <input type="file" accept=".xlsx" onChange={handleFileChange} />
            <span>{workbookFile ? workbookFile.name : "Choose an .xlsx workbook"}</span>
          </label>
          {inspectBusy && <p className="status-text">Inspecting workbook…</p>}
          {sheetNames.length > 0 && (
            <div className="sheet-cloud">
              {sheetNames.map((sheet) => (
                <span key={sheet} className="sheet-pill">
                  {sheet}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="component-section panel">
        <div className="component-header">
          <div>
            <span className="section-tag">Step 3</span>
            <h3>Build named components</h3>
            <p>Combine multiple worksheets into one output component without losing the normal per-sheet results.</p>
          </div>
          <button className="secondary-button" type="button" onClick={addGroup} disabled={sheetNames.length === 0}>
            Add component
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="empty-note">No components yet. Add one if you want combined outputs in addition to the normal sheet-level calculations.</p>
        ) : (
          <div className="group-list">
            {groups.map((group) => {
              const availableOptions = sheetNames.filter((sheet) => !groupedSheets.has(sheet) || group.sheetNames.includes(sheet));
              return (
                <article className="group-card" key={group.id}>
                  <div className="group-top">
                    <input
                      className="text-input"
                      value={group.name}
                      onChange={(event) => updateGroup(group.id, { name: event.target.value })}
                    />
                    <button className="ghost-button" type="button" onClick={() => removeGroup(group.id)}>
                      Remove
                    </button>
                  </div>
                  <select
                    className="multi-select"
                    multiple
                    value={group.sheetNames}
                    onChange={(event) =>
                      updateGroup(group.id, {
                        sheetNames: Array.from(event.target.selectedOptions).map((option) => option.value),
                      })
                    }
                  >
                    {availableOptions.map((sheet) => (
                      <option key={sheet} value={sheet}>
                        {sheet}
                      </option>
                    ))}
                  </select>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel run-panel">
        <span className="section-tag">Step 4</span>
        <h3>Run the calculation workflow</h3>
        <p>The backend calls the existing Python formulas, output writers, and grouped-component logic from your current codebase.</p>
        <div className="field-grid">
          <label>
            <span>Plot area (ha)</span>
            <input
              className="number-input"
              type="number"
              min="0.0001"
              step="0.0001"
              value={plotAreaHa}
              onChange={(event) => setPlotAreaHa(Number(event.target.value))}
            />
          </label>
          <label>
            <span>Rai per hectare</span>
            <input
              className="number-input"
              type="number"
              min="0.0001"
              step="0.01"
              value={raiPerHectare}
              onChange={(event) => setRaiPerHectare(Number(event.target.value))}
            />
          </label>
        </div>
        <button className="primary-button" type="button" onClick={handleCalculate} disabled={busy || !workbookFile}>
          {busy ? "Calculating..." : "Calculate with Python backend"}
        </button>
      </section>

      {(message || error) && (
        <section className={`notice ${error ? "error" : "success"}`}>
          {error ?? message}
        </section>
      )}

      <section className="results-grid" id="results">
        <div className="panel results-panel">
          <span className="section-tag">Step 5</span>
          <h3>Preview the generated canopy</h3>
          <p>Metrics and preview tables are returned by the API so visitors can review the run before downloading the Excel outputs.</p>
          {result ? (
            <>
              <div className="metric-grid">
                {result.metrics.map((metric) => (
                  <article className="metric-card" key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <small>{metric.help_text}</small>
                  </article>
                ))}
              </div>

              <div className="tab-row">
                {tabOrder.map((tabKey) => (
                  <button
                    key={tabKey}
                    className={`tab-button ${activeTab === tabKey ? "active" : ""}`}
                    onClick={() => setActiveTab(tabKey)}
                    type="button"
                  >
                    {tabLabels[tabKey]}
                  </button>
                ))}
              </div>

              <div className="table-shell">
                {currentRows.length === 0 ? (
                  <p className="empty-note">No rows are available for this preview tab.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        {currentColumns.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {currentRows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {currentColumns.map((column) => (
                            <td key={column}>{String(row[column] ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <p className="empty-note">Run a calculation to unlock metrics, previews, and workbook downloads.</p>
          )}
        </div>

        <aside className="panel download-panel">
          <span className="section-tag">Outputs</span>
          <h3>Download workbooks</h3>
          <p>Each generated workbook is streamed back through the API as soon as the processing run finishes.</p>
          <div className="download-stack">
            <button className="primary-button" type="button" disabled={!result} onClick={() => result && downloadWorkbook(result.downloads.summary)}>
              Download summary-by-site workbook
            </button>
            <button className="secondary-button" type="button" disabled={!result} onClick={() => result && downloadWorkbook(result.downloads.detail)}>
              Download detail workbook
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!result?.downloads.component}
              onClick={() => result?.downloads.component && downloadWorkbook(result.downloads.component)}
            >
              Download component workbook
            </button>
          </div>
        </aside>
      </section>
    </main>
  );
}
