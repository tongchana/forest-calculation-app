"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, describeApiError } from "@/app/lib/api-base";
import {
  AppHeader,
  DownloadButton,
  EmptyState,
  MetricTile,
  Notice,
  SectionCard,
  SidebarWorkflow,
  StatusPanel,
  UploadCard,
  WorksheetList,
  type ResourceLink,
  type StatusItem,
  type WorkflowStep,
} from "@/app/components/workspace";

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

function formatNumberInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatMetricValue(value: unknown, decimals = 2) {
  const num = toNumber(value);
  return num.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fileSize(file: File | null) {
  if (!file) {
    return "No file";
  }
  return `${(file.size / 1024 / 1024).toFixed(2)} MB`;
}

export default function Page() {
  const [plotAreaHa, setPlotAreaHa] = useState(0.1);
  const [raiPerHectare, setRaiPerHectare] = useState(6.25);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [groups, setGroups] = useState<SheetGroup[]>([]);
  const [result, setResult] = useState<CalculationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/config`);
        const data = await response.json();
        if (typeof data.plotAreaHa === "number") {
          setPlotAreaHa(data.plotAreaHa);
        }
        if (typeof data.raiPerHectare === "number") {
          setRaiPerHectare(data.raiPerHectare);
        }
      } catch {
        // Keep defaults when config is not available on first load.
      }
    }
    void loadConfig();
  }, []);

  const resources: ResourceLink[] = useMemo(
    () => [
      { label: "Workbook Template", href: `${API_BASE_URL}/api/template`, external: true },
      { label: "Profile Template", href: `${API_BASE_URL}/api/profile/template`, external: true },
      { label: "Profile Workspace", href: "/profile" },
      { label: "Calculation Detail", href: "/detail" },
    ],
    [],
  );

  const groupedSheets = useMemo(() => new Set(groups.flatMap((group) => group.sheetNames)), [groups]);
  const unassignedSheets = useMemo(() => sheetNames.filter((sheet) => !groupedSheets.has(sheet)), [groupedSheets, sheetNames]);
  const validGroups = useMemo(() => normaliseGroupPayload(groups), [groups]);
  const calculationReady = Boolean(workbookFile) && !busy && !inspectBusy;

  const dashboardRows = useMemo(() => {
    if (!result) {
      return [];
    }
    const componentNames = new Set(groups.map((group) => group.name.trim()).filter(Boolean));
    const summaryRows = result.previews.summaryAll ?? [];

    return summaryRows
      .map((row) => {
        const name = String(row.sheet_name ?? "Unknown");
        return {
          name,
          isComponent: componentNames.has(name),
          nTree: toNumber(row.n_tree),
          nSapling: toNumber(row.n_sapling),
          biomass: toNumber(row.total_tree_biomass),
          treeVolume: toNumber(row.total_tree_volume_m3),
          saplingVolume: toNumber(row.total_sapling_volume_m3),
          shannon: toNumber(row.shannon_index),
          unmatchedTree: toNumber(row.n_unmatched_tree_species),
          unmatchedSapling: toNumber(row.n_unmatched_sapling_species),
        };
      })
      .sort((left, right) => {
        if (left.isComponent !== right.isComponent) {
          return left.isComponent ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });
  }, [groups, result]);

  const workflowSteps: WorkflowStep[] = [
    {
      title: "Upload workbook",
      body: workbookFile ? workbookFile.name : "Add the completed survey workbook.",
      state: workbookFile ? "complete" : "active",
    },
    {
      title: "Inspect worksheets",
      body: inspectBusy ? "Reading worksheet names." : `${sheetNames.length} worksheet(s) detected.`,
      state: sheetNames.length > 0 ? "complete" : workbookFile ? "active" : "disabled",
    },
    {
      title: "Configure parameters",
      body: `Plot area ${plotAreaHa || 0} ha, ${raiPerHectare || 0} rai/ha.`,
      state: plotAreaHa > 0 && raiPerHectare > 0 ? "complete" : workbookFile ? "active" : "disabled",
    },
    {
      title: "Build grouped components",
      body: validGroups.length > 0 ? `${validGroups.length} component(s) ready.` : "Optional combined outputs.",
      state: validGroups.length > 0 ? "complete" : sheetNames.length > 0 ? "active" : "disabled",
    },
    {
      title: "Run calculation",
      body: result ? "Calculation completed." : "Generate biomass, volume, IVI, and Shannon outputs.",
      state: result ? "complete" : calculationReady ? "active" : "disabled",
    },
    {
      title: "Export outputs",
      body: result ? "Summary and detail workbooks are available." : "Download buttons unlock after calculation.",
      state: result ? "complete" : "disabled",
    },
  ];

  const statusItems: StatusItem[] = [
    { label: "Current workbook", value: workbookFile?.name ?? "Not uploaded", tone: workbookFile ? "success" : "warning" },
    { label: "File size", value: fileSize(workbookFile) },
    { label: "Upload status", value: inspectBusy ? "Inspecting" : workbookFile ? "Ready" : "Waiting", tone: workbookFile ? "success" : "warning" },
    { label: "Detected worksheets", value: sheetNames.length },
    { label: "Valid worksheets", value: sheetNames.length, tone: sheetNames.length > 0 ? "success" : "warning" },
    { label: "Invalid worksheets", value: error ? "Check error" : 0, tone: error ? "danger" : "success" },
    { label: "Parameters", value: plotAreaHa > 0 && raiPerHectare > 0 ? "Ready" : "Needs values", tone: plotAreaHa > 0 && raiPerHectare > 0 ? "success" : "warning" },
    { label: "Components", value: validGroups.length > 0 ? `${validGroups.length} ready` : "Optional" },
    { label: "Calculation", value: busy ? "Running" : result ? "Complete" : "Not started", tone: result ? "success" : "default" },
    { label: "Outputs", value: result ? "Available" : "Locked", tone: result ? "success" : "warning" },
  ];

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
      setMessage(`Detected ${data.sheetNames.length} worksheet(s).`);
    } catch (inspectError) {
      setSheetNames([]);
      setGroups([]);
      setError(describeApiError(inspectError));
    } finally {
      setInspectBusy(false);
    }
  }

  function resetFileState() {
    setSheetNames([]);
    setGroups([]);
    setResult(null);
    setMessage(null);
    setError(null);
  }

  function handleWorkbookFile(file: File | null) {
    if (file && !file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Please upload a .xlsx workbook.");
      return;
    }
    setWorkbookFile(file);
    if (file) {
      void handleInspect(file);
      return;
    }
    resetFileState();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    handleWorkbookFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    handleWorkbookFile(event.dataTransfer.files?.[0] ?? null);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
  }

  function addGroup() {
    setGroups((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `Component ${current.length + 1}`,
        sheetNames: [],
      },
    ]);
  }

  function updateGroup(groupId: string, patch: Partial<SheetGroup>) {
    setGroups((current) => current.map((group) => (group.id === groupId ? { ...group, ...patch } : group)));
  }

  function removeGroup(groupId: string) {
    setGroups((current) => current.filter((group) => group.id !== groupId));
  }

  function toggleSheet(groupId: string, sheetName: string) {
    setGroups((current) =>
      current.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        const alreadySelected = group.sheetNames.includes(sheetName);
        return {
          ...group,
          sheetNames: alreadySelected ? group.sheetNames.filter((name) => name !== sheetName) : [...group.sheetNames, sheetName],
        };
      }),
    );
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
    formData.append("sheet_groups", JSON.stringify(validGroups));

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
      setMessage("Calculation completed.");
    } catch (calcError) {
      setResult(null);
      setError(describeApiError(calcError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F6F8F4] text-[#1F2933]">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <AppHeader
          eyebrow="Forest Calculation Suite"
          title="Forest Calculation Workspace"
          subtitle="Field workbook to report-ready forest metrics"
          primaryAction={{ label: "Open Profile Diagram Studio", href: "/profile" }}
          links={resources}
        />

        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_330px]">
          <SidebarWorkflow resources={resources} steps={workflowSteps} title="Workflow" />

          <div className="space-y-6">
            <section className="overflow-hidden rounded-[36px] border border-[#DDE5D5] bg-white shadow-[0_22px_70px_rgba(31,94,59,0.07)]">
              <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="p-7 sm:p-9">
                  <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#6A8F5D]">Scientific inventory dashboard</p>
                  <h2 className="mt-3 max-w-3xl font-display text-5xl leading-[0.96] text-[#1F2933] sm:text-6xl">
                    Upload, inspect, calculate, and export without losing the field context.
                  </h2>
                  <p className="mt-5 max-w-2xl text-base leading-8 text-[#667085]">
                    Upload a completed field workbook, inspect worksheets, configure plot settings, run calculations, and export report-ready Excel outputs.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {["Upload", "Inspect", "Configure", "Calculate", "Export"].map((chip) => (
                      <span key={chip} className="rounded-full border border-[#DDE5D5] bg-[#F6F8F4] px-4 py-2 text-sm font-semibold text-[#1F5E3B]">
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="bg-[#1F5E3B] p-7 text-white sm:p-9">
                  <p className="text-xs font-bold uppercase tracking-[0.28em] text-white/70">Workspace snapshot</p>
                  <div className="mt-6 grid gap-4">
                    <MetricTile label="Worksheets" value={String(sheetNames.length)} help="Detected after workbook inspection." />
                    <MetricTile label="Components" value={String(validGroups.length)} help="Optional grouped component outputs." />
                    <MetricTile label="Outputs" value={result ? "Ready" : "Waiting"} help="Unlocks after the calculation run." />
                  </div>
                </div>
              </div>
            </section>

            <SectionCard
              eyebrow="Step 1"
              title="Upload workbook"
              description="Use the official workbook template for best results. The app accepts completed .xlsx survey workbooks."
            >
              <UploadCard
                dragActive={dragActive}
                emptyTitle="Drop forest workbook here"
                file={workbookFile}
                helper="Upload a completed .xlsx file to inspect worksheet names before calculation."
                inputRef={fileInputRef}
                inspectBusy={inspectBusy}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onFileChange={handleFileChange}
              />
              {(message || error) && <Notice tone={error ? "error" : "success"}>{error ?? message}</Notice>}
            </SectionCard>

            <SectionCard
              eyebrow="Step 2"
              title="Detected worksheets"
              description="Worksheet names stay visible so you can confirm the workbook structure before calculating."
            >
              <WorksheetList emptyText="Upload a workbook to inspect worksheet names." sheetNames={sheetNames} />
            </SectionCard>

            <SectionCard
              eyebrow="Step 3"
              title="Run parameters"
              description="These values affect per-hectare estimates and workbook summaries."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className="rounded-3xl border border-[#DDE5D5] bg-[#F6F8F4] p-5">
                  <span className="text-xs font-bold uppercase tracking-[0.22em] text-[#667085]">Plot area (ha)</span>
                  <input
                    className="mt-3 w-full rounded-2xl border border-[#DDE5D5] bg-white px-4 py-3 text-lg font-semibold text-[#1F2933] outline-none focus:border-[#1F5E3B]"
                    min="0"
                    step="0.001"
                    type="number"
                    value={plotAreaHa}
                    onChange={(event) => setPlotAreaHa(formatNumberInput(event.target.value))}
                  />
                  <span className="mt-3 block text-sm leading-6 text-[#667085]">Default is 0.100 ha unless the backend config provides another value.</span>
                </label>
                <label className="rounded-3xl border border-[#DDE5D5] bg-[#F6F8F4] p-5">
                  <span className="text-xs font-bold uppercase tracking-[0.22em] text-[#667085]">Rai per hectare</span>
                  <input
                    className="mt-3 w-full rounded-2xl border border-[#DDE5D5] bg-white px-4 py-3 text-lg font-semibold text-[#1F2933] outline-none focus:border-[#1F5E3B]"
                    min="0"
                    step="0.01"
                    type="number"
                    value={raiPerHectare}
                    onChange={(event) => setRaiPerHectare(formatNumberInput(event.target.value))}
                  />
                  <span className="mt-3 block text-sm leading-6 text-[#667085]">Used by the current calculation flow for local area conversion.</span>
                </label>
              </div>
            </SectionCard>

            <SectionCard
              action={
                <button
                  className="rounded-full bg-[#1F5E3B] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={sheetNames.length === 0}
                  type="button"
                  onClick={addGroup}
                >
                  Add component
                </button>
              }
              eyebrow="Step 4"
              title="Grouped components"
              description="Combine worksheets into named components such as survey site, forest type, project section, or management zone."
            >
              {groups.length === 0 ? (
                <EmptyState title="No grouped components yet" body="This is optional. The app will still calculate every worksheet normally." />
              ) : (
                <div className="grid gap-5 xl:grid-cols-2">
                  {groups.map((group, groupIndex) => {
                    const availableOptions = sheetNames.filter((sheet) => !groupedSheets.has(sheet) || group.sheetNames.includes(sheet));
                    const isInvalid = !group.name.trim() || group.sheetNames.length === 0;

                    return (
                      <article key={group.id} className="rounded-[30px] border border-[#DDE5D5] bg-[#F6F8F4] p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <label className="min-w-0 flex-1">
                            <span className="text-xs font-bold uppercase tracking-[0.22em] text-[#667085]">Component {groupIndex + 1}</span>
                            <input
                              className="mt-3 w-full rounded-2xl border border-[#DDE5D5] bg-white px-4 py-3 font-semibold text-[#1F2933] outline-none focus:border-[#1F5E3B]"
                              placeholder="Name this component"
                              value={group.name}
                              onChange={(event) => updateGroup(group.id, { name: event.target.value })}
                            />
                          </label>
                          <button
                            className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700"
                            type="button"
                            onClick={() => removeGroup(group.id)}
                          >
                            Remove
                          </button>
                        </div>

                        {isInvalid && <Notice tone="warning">Add a component name and at least one worksheet before this component is included.</Notice>}

                        <div className="mt-5 rounded-3xl border border-[#DDE5D5] bg-white p-4">
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#667085]">Selected sheets</p>
                          <div className="mt-3 flex min-h-12 flex-wrap gap-2">
                            {group.sheetNames.length > 0 ? (
                              group.sheetNames.map((sheet) => (
                                <button
                                  key={sheet}
                                  className="rounded-full bg-[#1F5E3B] px-4 py-2 text-sm font-semibold text-white"
                                  type="button"
                                  onClick={() => toggleSheet(group.id, sheet)}
                                >
                                  {sheet} x
                                </button>
                              ))
                            ) : (
                              <p className="text-sm text-[#667085]">No sheets selected for this component yet.</p>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 rounded-3xl border border-[#DDE5D5] bg-white p-4">
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#667085]">Available sheets</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {availableOptions.length > 0 ? (
                              availableOptions.map((sheet) => {
                                const selected = group.sheetNames.includes(sheet);
                                return (
                                  <button
                                    key={sheet}
                                    className={`rounded-full px-4 py-2 text-sm font-semibold ${
                                      selected ? "bg-[#FFF8E6] text-[#7A5600]" : "bg-[#F1F7EE] text-[#1F5E3B]"
                                    }`}
                                    type="button"
                                    onClick={() => toggleSheet(group.id, sheet)}
                                  >
                                    {selected ? "Selected: " : "Add: "}
                                    {sheet}
                                  </button>
                                );
                              })
                            ) : (
                              <p className="text-sm text-[#667085]">All worksheets are already assigned to other components.</p>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {unassignedSheets.length > 0 && (
                <div className="mt-5 rounded-3xl border border-[#DDE5D5] bg-[#F6F8F4] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#667085]">Unassigned worksheets</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {unassignedSheets.map((sheet) => (
                      <span key={sheet} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#667085] ring-1 ring-[#DDE5D5]">
                        {sheet}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </SectionCard>

            <SectionCard
              dark
              eyebrow="Step 5"
              title="Run calculation"
              description="Run the backend calculation without changing formulas or output workbook structure."
            >
              <button
                className="inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-4 text-sm font-bold text-[#1F5E3B] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!calculationReady}
                type="button"
                onClick={handleCalculate}
              >
                {busy ? "Running calculation..." : "Run calculation"}
              </button>
            </SectionCard>

            <SectionCard
              eyebrow="Results"
              title="Result dashboard"
              description="Preview summary metrics and download workbook outputs after calculation completes."
            >
              {result ? (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <MetricTile label="Total worksheets" value={String(sheetNames.length)} help="From the inspected workbook." />
                    <MetricTile label="Grouped components" value={String(validGroups.length)} help="Component workbook is created when groups exist." />
                    {result.metrics.map((metric) => (
                      <MetricTile key={metric.label} help={metric.help_text} label={metric.label} value={metric.value} />
                    ))}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <DownloadButton disabled={!result} onClick={() => downloadWorkbook(result.downloads.summary)}>
                      Download summary workbook
                    </DownloadButton>
                    <DownloadButton disabled={!result} variant="secondary" onClick={() => downloadWorkbook(result.downloads.detail)}>
                      Download detail workbook
                    </DownloadButton>
                    <DownloadButton
                      disabled={!result.downloads.component}
                      variant="secondary"
                      onClick={() => result.downloads.component && downloadWorkbook(result.downloads.component)}
                    >
                      Download component workbook
                    </DownloadButton>
                  </div>

                  {dashboardRows.length > 0 ? (
                    <div className="overflow-hidden rounded-[28px] border border-[#DDE5D5]">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[820px] text-left text-sm">
                          <thead className="bg-[#F6F8F4] text-xs uppercase tracking-[0.18em] text-[#667085]">
                            <tr>
                              <th className="px-4 py-4">Name</th>
                              <th className="px-4 py-4">Type</th>
                              <th className="px-4 py-4">Trees</th>
                              <th className="px-4 py-4">Saplings</th>
                              <th className="px-4 py-4">Biomass</th>
                              <th className="px-4 py-4">Tree volume</th>
                              <th className="px-4 py-4">Shannon</th>
                              <th className="px-4 py-4">Unmatched</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#DDE5D5] bg-white">
                            {dashboardRows.slice(0, 12).map((row) => (
                              <tr key={row.name}>
                                <td className="px-4 py-4 font-semibold text-[#1F2933]">{row.name}</td>
                                <td className="px-4 py-4 text-[#667085]">{row.isComponent ? "Component" : "Worksheet"}</td>
                                <td className="px-4 py-4">{formatMetricValue(row.nTree, 0)}</td>
                                <td className="px-4 py-4">{formatMetricValue(row.nSapling, 0)}</td>
                                <td className="px-4 py-4">{formatMetricValue(row.biomass, 2)}</td>
                                <td className="px-4 py-4">{formatMetricValue(row.treeVolume + row.saplingVolume, 3)}</td>
                                <td className="px-4 py-4">{formatMetricValue(row.shannon, 6)}</td>
                                <td className="px-4 py-4">{formatMetricValue(row.unmatchedTree + row.unmatchedSapling, 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="No preview rows" body="The calculation completed, but no summary preview rows were returned." />
                  )}
                </div>
              ) : (
                <EmptyState title="No results yet" body="Run the calculation to unlock summary cards, preview rows, and workbook downloads." />
              )}
            </SectionCard>
          </div>

          <div className="xl:block">
            <StatusPanel description="Live workbook, validation, parameter, component, and output status." error={error} items={statusItems} message={message} title="Calculation readiness" />
          </div>
        </div>
      </div>
    </main>
  );
}
