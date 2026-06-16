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

const workflowSectionIds = [
  "upload-workbook",
  "inspect-worksheets",
  "configure-parameters",
  "group-components",
  "run-calculation",
  "export-outputs",
] as const;

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
  const [activeStepId, setActiveStepId] = useState<(typeof workflowSectionIds)[number]>("upload-workbook");
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

  useEffect(() => {
    const sections = workflowSectionIds
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));

    if (sections.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (visibleEntry?.target?.id) {
          setActiveStepId(visibleEntry.target.id as (typeof workflowSectionIds)[number]);
        }
      },
      {
        rootMargin: "-20% 0px -60% 0px",
        threshold: [0.2, 0.5, 0.8],
      },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const templateLinks: ResourceLink[] = useMemo(
    () => [
      { label: "Biomass Template", href: `${API_BASE_URL}/api/template`, external: true },
      { label: "Profile Template", href: `${API_BASE_URL}/api/profile/template`, external: true },
    ],
    [],
  );

  const resources: ResourceLink[] = useMemo(
    () => [
      { label: "Calculation Detail", href: "/detail" },
    ],
    [],
  );

  const groupedSheets = useMemo(() => new Set(groups.flatMap((group) => group.sheetNames)), [groups]);
  const unassignedSheets = useMemo(() => sheetNames.filter((sheet) => !groupedSheets.has(sheet)), [groupedSheets, sheetNames]);
  const validGroups = useMemo(() => normaliseGroupPayload(groups), [groups]);
  const calculationReady = Boolean(workbookFile) && sheetNames.length > 0 && !busy && !inspectBusy;

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
      id: "upload-workbook",
      title: "Upload workbook",
      body: workbookFile ? "Workbook uploaded and ready for inspection." : "Add completed forest survey workbook.",
      state: workbookFile ? "complete" : "active",
    },
    {
      id: "inspect-worksheets",
      title: "Inspect worksheets",
      body: inspectBusy ? "Reading worksheet names and validation status." : "Review detected sheets and validation.",
      state: sheetNames.length > 0 ? "complete" : workbookFile ? "active" : "disabled",
    },
    {
      id: "configure-parameters",
      title: "Configure parameters",
      body: "Set plot area and calculation settings.",
      state: plotAreaHa > 0 && raiPerHectare > 0 ? "complete" : workbookFile ? "active" : "disabled",
    },
    {
      id: "group-components",
      title: "Build grouped components",
      body: "Combine sheets by site or forest type.",
      state: validGroups.length > 0 ? "complete" : sheetNames.length > 0 ? "active" : "disabled",
    },
    {
      id: "run-calculation",
      title: "Run calculation",
      body: busy ? "Calculation is running." : "Generate biomass, volume, IVI, and Shannon outputs.",
      state: result ? "complete" : calculationReady ? "active" : "disabled",
    },
    {
      id: "export-outputs",
      title: "Export outputs",
      body: "Download report-ready Excel files.",
      state: result ? "complete" : "disabled",
    },
  ];

  const statusItems: StatusItem[] = [
    { label: "Worksheets", value: sheetNames.length, tone: sheetNames.length > 0 ? "success" : "warning" },
    { label: "Components", value: validGroups.length > 0 ? validGroups.length : "Optional" },
    { label: "Outputs", value: result ? "Ready" : "Locked", tone: result ? "success" : "warning" },
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
          subtitle="Scientific workflow for forest biomass and inventory metrics."
          links={resources}
          primaryAction={{ label: "Open Profile Diagram Studio", href: "/profile" }}
          templateLinks={templateLinks}
        />

        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px]">
          <SidebarWorkflow activeStepId={activeStepId} steps={workflowSteps} title="Workflow" />

          <div className="space-y-6">
            <section className="overflow-hidden rounded-[36px] border border-[#DDE5D5] bg-white shadow-[0_22px_70px_rgba(31,94,59,0.07)]">
              <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="p-7 sm:p-9">
                  <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#6A8F5D]">Forest inventory metrics</p>
                  <h2 className="mt-3 max-w-3xl text-[2.3rem] font-semibold leading-[1.02] text-[#1F2933] sm:text-[2.8rem]">
                    Biomass Calculation Workspace
                  </h2>
                  <p className="mt-5 max-w-2xl text-[15px] leading-8 text-[#667085] sm:text-base">
                    Upload forest inventory Excel data, calculate biomass, volume, IVI, Shannon index, and export report-ready workbooks.
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
                  <p className="text-xs font-bold uppercase tracking-[0.28em] text-white/70">Workspace Snapshot</p>
                  <div className="mt-6 grid gap-4">
                    <MetricTile label="Worksheets" value={String(sheetNames.length)} help="Detected after workbook inspection." />
                    <MetricTile label="Components" value={String(validGroups.length)} help="Grouped output is optional." />
                    <MetricTile label="Outputs" value={result ? "Ready" : "Waiting"} help="Workbook downloads unlock after calculation." />
                  </div>
                </div>
              </div>
            </section>

            <SectionCard
              description="Drag and drop a completed .xlsx workbook, then confirm the file details before calculation."
              eyebrow="Step 1"
              id="upload-workbook"
              title="Upload workbook"
            >
              <UploadCard
                dragActive={dragActive}
                emptyTitle="Drop biomass workbook here"
                file={workbookFile}
                helper="Upload the completed biomass workbook based on the official template."
                inputRef={fileInputRef}
                inspectBusy={inspectBusy}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onFileChange={handleFileChange}
              />
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <MetricTile label="File name" value={workbookFile?.name ?? "Waiting"} help="Shown after upload." />
                <MetricTile label="File size" value={fileSize(workbookFile)} help="Calculated from the uploaded workbook." />
                <MetricTile
                  label="Upload status"
                  value={inspectBusy ? "Inspecting" : workbookFile ? "Ready" : "Waiting"}
                  help="Inspection starts immediately after upload."
                />
              </div>
              {(message || error) && <Notice tone={error ? "error" : "success"}>{error ?? message}</Notice>}
            </SectionCard>

            <SectionCard
              description="Review worksheet count and detected names before changing parameters or grouping components."
              eyebrow="Step 2"
              id="inspect-worksheets"
              title="Inspect worksheets"
            >
              <div className="grid gap-4 md:grid-cols-3">
                <MetricTile label="Detected worksheets" value={String(sheetNames.length)} help="Count returned by the inspect API." />
                <MetricTile label="Validation status" value={sheetNames.length > 0 ? "Ready" : "Waiting"} help="Workbook can move forward when sheets are detected." />
                <MetricTile
                  label="Missing or invalid"
                  value={error ? "Check warning" : 0}
                  help={error ? "The current workbook needs attention before calculation." : "No UI-level warnings from inspection."}
                />
              </div>
              <div className="mt-5">
                <WorksheetList emptyText="Upload a workbook to inspect detected worksheet names." sheetNames={sheetNames} />
              </div>
              {workbookFile && sheetNames.length === 0 && !inspectBusy && (
                <Notice tone="warning">No worksheets were detected. Check that the uploaded workbook follows the biomass template.</Notice>
              )}
            </SectionCard>

            <SectionCard
              description="Set plot area and local area conversion values before calculation. Labels and inputs stay separated for clearer reading."
              eyebrow="Step 3"
              id="configure-parameters"
              title="Configure parameters"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className="rounded-3xl border border-[#DDE5D5] bg-[#F6F8F4] p-5">
                  <span className="block text-xs font-bold uppercase tracking-[0.22em] text-[#667085]">Plot area (ha)</span>
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
                  <span className="block text-xs font-bold uppercase tracking-[0.22em] text-[#667085]">Rai per hectare</span>
                  <input
                    className="mt-3 w-full rounded-2xl border border-[#DDE5D5] bg-white px-4 py-3 text-lg font-semibold text-[#1F2933] outline-none focus:border-[#1F5E3B]"
                    min="0"
                    step="0.01"
                    type="number"
                    value={raiPerHectare}
                    onChange={(event) => setRaiPerHectare(formatNumberInput(event.target.value))}
                  />
                  <span className="mt-3 block text-sm leading-6 text-[#667085]">Used by the existing calculation flow for hectare and rai conversions.</span>
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
              description="Optionally combine worksheets into named components. Each worksheet can belong to only one component."
              eyebrow="Step 4"
              id="group-components"
              title="Build grouped components"
            >
              {groups.length === 0 ? (
                <EmptyState title="No grouped components yet" body="This step is optional. The app can still calculate every worksheet separately." />
              ) : (
                <div className="grid gap-5 xl:grid-cols-2">
                  {groups.map((group, groupIndex) => {
                    const availableOptions = sheetNames.filter((sheet) => !groupedSheets.has(sheet) || group.sheetNames.includes(sheet));
                    const isInvalid = !group.name.trim() || group.sheetNames.length === 0;

                    return (
                      <article key={group.id} className="rounded-[30px] border border-[#DDE5D5] bg-[#F6F8F4] p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <label className="min-w-0 flex-1">
                            <span className="block text-xs font-bold uppercase tracking-[0.22em] text-[#667085]">Component {groupIndex + 1}</span>
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
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#667085]">Selected worksheets</p>
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
                              <p className="text-sm text-[#667085]">No worksheets selected for this component yet.</p>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 rounded-3xl border border-[#DDE5D5] bg-white p-4">
                          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#667085]">Available worksheets</p>
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
              description="Run the existing backend calculation workflow. This button stays disabled until the workbook is ready."
              eyebrow="Step 5"
              id="run-calculation"
              title="Run calculation"
            >
              <button
                className="inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-4 text-sm font-bold text-[#1F5E3B] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!calculationReady}
                type="button"
                onClick={handleCalculate}
              >
                {busy ? "Running calculation..." : "Run calculation"}
              </button>
              {!calculationReady && <Notice tone="warning">Upload a valid workbook and wait for inspection before calculation.</Notice>}
              {result && <Notice tone="success">Calculation completed successfully. Downloads are now available below.</Notice>}
            </SectionCard>

            <SectionCard
              description="Review summary cards and export report-ready workbooks after the calculation completes."
              eyebrow="Step 6"
              id="export-outputs"
              title="Export outputs"
            >
              {result ? (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <DownloadButton disabled onClick={() => undefined}>
                      Download summary workbook
                    </DownloadButton>
                    <DownloadButton disabled variant="secondary" onClick={() => undefined}>
                      Download detail workbook
                    </DownloadButton>
                    <DownloadButton disabled variant="secondary" onClick={() => undefined}>
                      Download component workbook
                    </DownloadButton>
                  </div>
                  <EmptyState title="No outputs yet" body="Run the calculation to unlock result summary cards and workbook downloads." />
                </div>
              )}
            </SectionCard>
          </div>

          <div className="xl:block">
            <StatusPanel
              description="Short snapshot of workbook readiness and output availability."
              error={error}
              items={statusItems}
              message={message}
              title="Workspace Snapshot"
            />
          </div>
        </div>
      </div>
    </main>
  );
}
