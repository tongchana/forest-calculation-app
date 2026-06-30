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

type BiomassComponentSummary = {
  componentName: string;
  internalName: string;
  includedSheets: string[];
  forestTypes: string[];
  plotCount: number;
  sampleAreaRai: number | null;
  totalBiomass: number | null;
  totalWoodVolume: number | null;
  treeCount: number | null;
  saplingCount: number | null;
  shannonIndex: number | null;
};

type EconomicComponentSummary = {
  componentId: string;
  componentName: string;
  componentAreaRai: number | null;
  estimatedTreeCount: number | null;
  estimatedSaplingCount: number | null;
  estimatedSeedlingCount: number | null;
  forestTypes: string[];
  tqs: string[];
  totalWoodLossM3: number | null;
  totalAnnualIncrementM3PerYear: number | null;
  totalAnnualWoodValueBaht: number | null;
  totalWoodValueBaht: number | null;
  totalRegenerationLossBaht: number | null;
  totalEcosystemLossBahtPerYear: number | null;
  moduleEcosystemLossBahtPerYear: number | null;
  totalReportLossBaht: number | null;
  warnings: string[];
};

type EconomicImpactDetail = {
  componentId: string;
  componentName: string;
  forestType: string | null;
  impactKey: string;
  impactNameTh: string;
  quantity: number | null;
  quantityUnit: string;
  unitPrice: number | null;
  unitPriceUnit: string;
  valueBahtPerRaiPerYear: number | null;
};

type FutureValueRow = {
  period_years: number | null;
  annual_wood_value_baht: number | null;
  future_value_baht: number | null;
  present_value_baht: number | null;
};

type DownloadPayload = {
  filename: string;
  contentBase64: string;
};

type CalculationResponse = {
  calculationScope: CalculationScope;
  biomass: {
    metrics: MetricCard[];
    componentSummaries: BiomassComponentSummary[];
    previews: PreviewMap;
  } | null;
  economic: {
    metrics: MetricCard[];
    componentSummaries: EconomicComponentSummary[];
    woodDetails: Record<string, unknown>[];
    ecosystemSummaries: Record<string, unknown>[];
    ecosystemImpactDetails: EconomicImpactDetail[];
    futureValueRows: FutureValueRow[];
    warnings: string[];
  } | null;
  downloads: {
    biomassSummary: DownloadPayload | null;
    biomassDetail: DownloadPayload | null;
    biomassComponent: DownloadPayload | null;
    economicReport: DownloadPayload | null;
    economicJson: DownloadPayload | null;
  };
};

type SheetGroup = {
  id: string;
  name: string;
  sheetNames: string[];
};

type CalculationScope = "biomass_only" | "economic_only" | "biomass_and_economic";

type EconomicInputState = {
  componentAreaRai: number;
  canopyCoverPercent: number;
  canopyLayerCount: number;
  soilDepthM: number;
  annualRainfallMm: number;
  topographyScore: number;
};

const workflowSectionIds = [
  "upload-workbook",
  "inspect-worksheets",
  "configure-parameters",
  "group-components",
  "run-calculation",
  "export-outputs",
] as const;

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

function downloadFile(file: DownloadPayload, mimeType: string) {
  const blob = base64ToBlob(file.contentBase64, mimeType);
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

const scopeOptions: Array<{ value: CalculationScope; label: string; body: string }> = [
  {
    value: "biomass_only",
    label: "Biomass only",
    body: "Run the existing biomass, volume, IVI, and Shannon workflow only.",
  },
  {
    value: "economic_only",
    label: "Economic only",
    body: "Reuse biomass intermediates internally, but show and export economic outputs only.",
  },
  {
    value: "biomass_and_economic",
    label: "Biomass and economic",
    body: "Run both flows together and unlock both download sets.",
  },
];

export default function Page() {
  const [plotAreaHa, setPlotAreaHa] = useState(0.1);
  const [raiPerHectare, setRaiPerHectare] = useState(6.25);
  const [calculationScope, setCalculationScope] = useState<CalculationScope>("biomass_only");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [groups, setGroups] = useState<SheetGroup[]>([]);
  const [economicInputs, setEconomicInputs] = useState<Record<string, EconomicInputState>>({});
  const [result, setResult] = useState<CalculationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<(typeof workflowSectionIds)[number]>("upload-workbook");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const groupsRef = useRef<SheetGroup[]>([]);
  const economicInputsRef = useRef<Record<string, EconomicInputState>>({});

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

  useEffect(() => {
    replaceEconomicInputs((current) => {
      const next: Record<string, EconomicInputState> = {};
      groups.forEach((group) => {
        next[group.id] = current[group.id] ?? {
          componentAreaRai: 0,
          canopyCoverPercent: 0,
          canopyLayerCount: 0,
          soilDepthM: 0,
          annualRainfallMm: 0,
          topographyScore: 0,
        };
      });
      return next;
    });
  }, [groups]);

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
  const economicModeSelected = calculationScope !== "biomass_only";
  const economicInputGroups = useMemo(
    () => groups.filter((group) => group.name.trim() && group.sheetNames.length > 0),
    [groups],
  );
  const economicInputsReady = useMemo(() => {
    if (!economicModeSelected) {
      return true;
    }
    if (economicInputGroups.length === 0) {
      return false;
    }
    return economicInputGroups.every((group) => {
      const value = economicInputs[group.id];
      return Boolean(
        value &&
          value.componentAreaRai > 0 &&
          value.canopyCoverPercent >= 0 &&
          value.canopyCoverPercent <= 100 &&
          value.canopyLayerCount > 0 &&
          value.soilDepthM > 0 &&
          value.annualRainfallMm >= 0 &&
          value.topographyScore > 0,
      );
    });
  }, [economicInputGroups, economicInputs, economicModeSelected]);
  const calculationReady = Boolean(workbookFile) && sheetNames.length > 0 && !busy && !inspectBusy && economicInputsReady;

  const biomassRows = useMemo(() => result?.biomass?.componentSummaries ?? [], [result]);
  const economicRows = useMemo(() => result?.economic?.componentSummaries ?? [], [result]);

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
      body: busy
        ? "Calculation is running."
        : calculationScope === "biomass_only"
          ? "Generate biomass, volume, IVI, and Shannon outputs."
          : calculationScope === "economic_only"
            ? "Generate the economic report flow using biomass intermediates."
            : "Generate both biomass and economic outputs together.",
      state: result ? "complete" : calculationReady ? "active" : "disabled",
    },
    {
      id: "export-outputs",
      title: "Export outputs",
      body: "Download biomass and economic workbooks according to the selected scope.",
      state: result ? "complete" : "disabled",
    },
  ];

  const statusItems: StatusItem[] = [
    { label: "Worksheets", value: sheetNames.length, tone: sheetNames.length > 0 ? "success" : "warning" },
    { label: "Components", value: validGroups.length > 0 ? validGroups.length : "Optional" },
    { label: "Scope", value: scopeOptions.find((item) => item.value === calculationScope)?.label ?? calculationScope },
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
      replaceGroups([]);
      setMessage(`Detected ${data.sheetNames.length} worksheet(s).`);
    } catch (inspectError) {
      setSheetNames([]);
      replaceGroups([]);
      setError(describeApiError(inspectError));
    } finally {
      setInspectBusy(false);
    }
  }

  function resetFileState() {
    setSheetNames([]);
    replaceGroups([]);
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
    replaceGroups((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `Component ${current.length + 1}`,
        sheetNames: [],
      },
    ]);
  }

  function updateGroup(groupId: string, patch: Partial<SheetGroup>) {
    replaceGroups((current) => current.map((group) => (group.id === groupId ? { ...group, ...patch } : group)));
  }

  function removeGroup(groupId: string) {
    replaceGroups((current) => current.filter((group) => group.id !== groupId));
  }

  function toggleSheet(groupId: string, sheetName: string) {
    replaceGroups((current) =>
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

  function replaceGroups(nextGroupsOrUpdater: SheetGroup[] | ((current: SheetGroup[]) => SheetGroup[])) {
    const nextGroups = typeof nextGroupsOrUpdater === "function" ? nextGroupsOrUpdater(groupsRef.current) : nextGroupsOrUpdater;
    groupsRef.current = nextGroups;
    setGroups(nextGroups);
  }

  function replaceEconomicInputs(
    nextInputsOrUpdater: Record<string, EconomicInputState> | ((current: Record<string, EconomicInputState>) => Record<string, EconomicInputState>),
  ) {
    const nextInputs = typeof nextInputsOrUpdater === "function" ? nextInputsOrUpdater(economicInputsRef.current) : nextInputsOrUpdater;
    economicInputsRef.current = nextInputs;
    setEconomicInputs(nextInputs);
  }

  function updateEconomicInput(groupId: string, patch: Partial<EconomicInputState>) {
    replaceEconomicInputs((current) => ({
      ...current,
      [groupId]: {
        ...(current[groupId] ?? {
          componentAreaRai: 0,
          canopyCoverPercent: 0,
          canopyLayerCount: 0,
          soilDepthM: 0,
          annualRainfallMm: 0,
          topographyScore: 0,
        }),
        ...patch,
      },
    }));
  }

  async function handleCalculate() {
    if (busy) {
      return;
    }
    if (!workbookFile) {
      setError("Upload a completed workbook before calculating.");
      return;
    }

    const currentGroups = groupsRef.current;
    const currentValidGroups = normaliseGroupPayload(currentGroups);
    const currentEconomicInputs = economicInputsRef.current;
    const currentEconomicInputGroups = currentGroups.filter((group) => group.name.trim() && group.sheetNames.length > 0);

    setBusy(true);
    setError(null);
    setMessage(null);

    const formData = new FormData();
    formData.append("file", workbookFile);
    formData.append("plot_area_ha", String(plotAreaHa));
    formData.append("rai_per_hectare", String(raiPerHectare));
    formData.append("sheet_groups", JSON.stringify(currentValidGroups));
    formData.append("calculation_scope", calculationScope);
    if (economicModeSelected) {
      const economicPayload = currentEconomicInputGroups.map((group) => ({
        component_name: group.name.trim(),
        component_area_rai: currentEconomicInputs[group.id]?.componentAreaRai ?? 0,
        canopy_cover_percent: currentEconomicInputs[group.id]?.canopyCoverPercent ?? 0,
        canopy_layer_count: currentEconomicInputs[group.id]?.canopyLayerCount ?? 0,
        soil_depth_m: currentEconomicInputs[group.id]?.soilDepthM ?? 0,
        annual_rainfall_mm: currentEconomicInputs[group.id]?.annualRainfallMm ?? 0,
        topography_score: currentEconomicInputs[group.id]?.topographyScore ?? 0,
      }));
      formData.append("economic_inputs", JSON.stringify(economicPayload));
    }

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
                    Upload forest inventory Excel data, calculate biomass and forest economics, then export report-ready workbooks.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {["Upload", "Inspect", "Configure", "Group", "Calculate", "Export"].map((chip) => (
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
              description="Choose the calculation scope, add economic parameters for grouped components when needed, then run the workflow."
              eyebrow="Step 5"
              id="run-calculation"
              title="Run calculation"
            >
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/70">Calculation scope</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    {scopeOptions.map((option) => {
                      const selected = calculationScope === option.value;
                      return (
                        <button
                          key={option.value}
                          className={`rounded-[26px] border px-5 py-4 text-left transition ${
                            selected
                              ? "border-white bg-white text-[#1F5E3B] shadow-[0_18px_45px_rgba(10,25,15,0.18)]"
                              : "border-white/20 bg-white/8 text-white hover:bg-white/12"
                          }`}
                          type="button"
                          onClick={() => setCalculationScope(option.value)}
                        >
                          <div className="text-sm font-bold">{option.label}</div>
                          <div className={`mt-2 text-sm leading-6 ${selected ? "text-[#4B5B68]" : "text-white/78"}`}>{option.body}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {economicModeSelected && (
                  <div className="space-y-4 rounded-[28px] border border-white/18 bg-white/8 p-5">
                    <div>
                      <p className="text-sm font-bold text-white">Economic parameters</p>
                      <p className="mt-2 text-sm leading-6 text-white/76">
                        Provide ecosystem valuation inputs for each grouped component. Basal area, forest type, and TQ are derived automatically from the biomass workflow.
                      </p>
                    </div>

                    {economicInputGroups.length === 0 ? (
                      <Notice tone="warning">Build at least one grouped component in Step 4 before running an economic scope.</Notice>
                    ) : (
                      <div className="grid gap-4 xl:grid-cols-2">
                        {economicInputGroups.map((group) => {
                          const value = economicInputs[group.id] ?? {
                            componentAreaRai: 0,
                            canopyCoverPercent: 0,
                            canopyLayerCount: 0,
                            soilDepthM: 0,
                            annualRainfallMm: 0,
                            topographyScore: 0,
                          };
                          return (
                            <article key={group.id} className="rounded-[26px] border border-white/18 bg-white p-5 text-[#1F2933]">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#667085]">Grouped component</p>
                                  <h3 className="mt-2 text-lg font-semibold">{group.name}</h3>
                                  <p className="mt-2 text-sm leading-6 text-[#667085]">Worksheets: {group.sheetNames.join(", ")}</p>
                                </div>
                              </div>
                              <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <label className="rounded-2xl border border-[#DDE5D5] bg-[#F6F8F4] p-4">
                                  <span className="block text-xs font-bold uppercase tracking-[0.18em] text-[#667085]">Component area (rai)</span>
                                  <input
                                    className="mt-2 w-full rounded-2xl border border-[#DDE5D5] bg-white px-4 py-3 font-semibold outline-none focus:border-[#1F5E3B]"
                                    min="0"
                                    step="0.01"
                                    type="number"
                                    value={value.componentAreaRai}
                                    onChange={(event) => updateEconomicInput(group.id, { componentAreaRai: formatNumberInput(event.target.value) })}
                                  />
                                </label>
                                <label className="rounded-2xl border border-[#DDE5D5] bg-[#F6F8F4] p-4">
                                  <span className="block text-xs font-bold uppercase tracking-[0.18em] text-[#667085]">Crown cover (%)</span>
                                  <input
                                    className="mt-2 w-full rounded-2xl border border-[#DDE5D5] bg-white px-4 py-3 font-semibold outline-none focus:border-[#1F5E3B]"
                                    min="0"
                                    max="100"
                                    step="0.1"
                                    type="number"
                                    value={value.canopyCoverPercent}
                                    onChange={(event) => updateEconomicInput(group.id, { canopyCoverPercent: formatNumberInput(event.target.value) })}
                                  />
                                </label>
                                <label className="rounded-2xl border border-[#DDE5D5] bg-[#F6F8F4] p-4">
                                  <span className="block text-xs font-bold uppercase tracking-[0.18em] text-[#667085]">Number of canopy layers</span>
                                  <input
                                    className="mt-2 w-full rounded-2xl border border-[#DDE5D5] bg-white px-4 py-3 font-semibold outline-none focus:border-[#1F5E3B]"
                                    min="0"
                                    step="1"
                                    type="number"
                                    value={value.canopyLayerCount}
                                    onChange={(event) => updateEconomicInput(group.id, { canopyLayerCount: formatNumberInput(event.target.value) })}
                                  />
                                </label>
                                <label className="rounded-2xl border border-[#DDE5D5] bg-[#F6F8F4] p-4">
                                  <span className="block text-xs font-bold uppercase tracking-[0.18em] text-[#667085]">Soil depth (m)</span>
                                  <input
                                    className="mt-2 w-full rounded-2xl border border-[#DDE5D5] bg-white px-4 py-3 font-semibold outline-none focus:border-[#1F5E3B]"
                                    min="0"
                                    step="0.01"
                                    type="number"
                                    value={value.soilDepthM}
                                    onChange={(event) => updateEconomicInput(group.id, { soilDepthM: formatNumberInput(event.target.value) })}
                                  />
                                </label>
                                <label className="rounded-2xl border border-[#DDE5D5] bg-[#F6F8F4] p-4">
                                  <span className="block text-xs font-bold uppercase tracking-[0.18em] text-[#667085]">Annual rainfall (mm)</span>
                                  <input
                                    className="mt-2 w-full rounded-2xl border border-[#DDE5D5] bg-white px-4 py-3 font-semibold outline-none focus:border-[#1F5E3B]"
                                    min="0"
                                    step="1"
                                    type="number"
                                    value={value.annualRainfallMm}
                                    onChange={(event) => updateEconomicInput(group.id, { annualRainfallMm: formatNumberInput(event.target.value) })}
                                  />
                                </label>
                                <label className="rounded-2xl border border-[#DDE5D5] bg-[#F6F8F4] p-4">
                                  <span className="block text-xs font-bold uppercase tracking-[0.18em] text-[#667085]">Topographic score</span>
                                  <input
                                    className="mt-2 w-full rounded-2xl border border-[#DDE5D5] bg-white px-4 py-3 font-semibold outline-none focus:border-[#1F5E3B]"
                                    min="0"
                                    step="0.1"
                                    type="number"
                                    value={value.topographyScore}
                                    onChange={(event) => updateEconomicInput(group.id, { topographyScore: formatNumberInput(event.target.value) })}
                                  />
                                </label>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <button
                  className="inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-4 text-sm font-bold text-[#1F5E3B] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!calculationReady}
                  type="button"
                  onClick={handleCalculate}
                >
                  {busy ? "Running calculation..." : "Run calculation"}
                </button>

                {!calculationReady && (
                  <Notice tone="warning">
                    {economicModeSelected
                      ? "Upload a valid workbook, wait for inspection, build grouped components, and complete every economic parameter card before calculation."
                      : "Upload a valid workbook and wait for inspection before calculation."}
                  </Notice>
                )}
                {result && <Notice tone="success">Calculation completed successfully. Downloads are now available below.</Notice>}
              </div>
            </SectionCard>

            <SectionCard
              description="Review summary cards and export report-ready workbooks after the calculation completes."
              eyebrow="Step 6"
              id="export-outputs"
              title="Export outputs"
            >
              {result ? (
                <div className="space-y-6">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <DownloadButton
                      disabled={!result.downloads.biomassSummary}
                      onClick={() => result.downloads.biomassSummary && downloadFile(result.downloads.biomassSummary, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
                    >
                      Download biomass summary
                    </DownloadButton>
                    <DownloadButton
                      disabled={!result.downloads.biomassDetail}
                      variant="secondary"
                      onClick={() => result.downloads.biomassDetail && downloadFile(result.downloads.biomassDetail, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
                    >
                      Download biomass detail
                    </DownloadButton>
                    <DownloadButton
                      disabled={!result.downloads.biomassComponent}
                      variant="secondary"
                      onClick={() => result.downloads.biomassComponent && downloadFile(result.downloads.biomassComponent, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
                    >
                      Download grouped biomass
                    </DownloadButton>
                    <DownloadButton
                      disabled={!result.downloads.economicReport}
                      variant="secondary"
                      onClick={() => result.downloads.economicReport && downloadFile(result.downloads.economicReport, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
                    >
                      Download economic report
                    </DownloadButton>
                    <DownloadButton
                      disabled={!result.downloads.economicJson}
                      variant="secondary"
                      onClick={() => result.downloads.economicJson && downloadFile(result.downloads.economicJson, "application/json")}
                    >
                      Download economic JSON
                    </DownloadButton>
                  </div>

                  {result.biomass && (
                    <div className="space-y-5">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#667085]">Biomass summary</p>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                          {result.biomass.metrics.map((metric) => (
                            <MetricTile key={metric.label} help={metric.help_text} label={metric.label} value={metric.value} />
                          ))}
                        </div>
                      </div>

                      {biomassRows.length > 0 ? (
                        <div className="overflow-hidden rounded-[28px] border border-[#DDE5D5]">
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[920px] text-left text-sm">
                              <thead className="bg-[#F6F8F4] text-xs uppercase tracking-[0.18em] text-[#667085]">
                                <tr>
                                  <th className="px-4 py-4">Component</th>
                                  <th className="px-4 py-4">Included worksheets</th>
                                  <th className="px-4 py-4">Forest types</th>
                                  <th className="px-4 py-4">Plot summary</th>
                                  <th className="px-4 py-4">Total biomass</th>
                                  <th className="px-4 py-4">Total wood volume</th>
                                  <th className="px-4 py-4">Trees</th>
                                  <th className="px-4 py-4">Shannon</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#DDE5D5] bg-white">
                                {biomassRows.map((row) => (
                                  <tr key={row.internalName}>
                                    <td className="px-4 py-4 font-semibold text-[#1F2933]">{row.componentName}</td>
                                    <td className="px-4 py-4 text-[#667085]">{row.includedSheets.join(", ")}</td>
                                    <td className="px-4 py-4 text-[#667085]">{row.forestTypes.join(", ") || "-"}</td>
                                    <td className="px-4 py-4 text-[#667085]">
                                      {row.plotCount > 0 ? `${formatMetricValue(row.plotCount, 0)} plot(s), ${formatMetricValue(row.sampleAreaRai, 2)} rai` : "-"}
                                    </td>
                                    <td className="px-4 py-4">{formatMetricValue(row.totalBiomass, 2)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.totalWoodVolume, 3)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.treeCount, 0)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.shannonIndex, 6)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <EmptyState title="No component biomass summary" body="No grouped biomass summary rows were returned for this run." />
                      )}
                    </div>
                  )}

                  {result.economic && (
                    <div className="space-y-5">
                      <div className="overflow-hidden rounded-[30px] border border-[#C9DDBF] bg-gradient-to-br from-[#F8FBF3] via-white to-[#EEF6EA] p-5 shadow-[0_18px_46px_rgba(31,94,59,0.07)]">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#6A8F5D]">Economic summary</p>
                            <h3 className="mt-2 text-2xl font-semibold text-[#1F2933]">Report-aligned valuation</h3>
                          </div>
                          <p className="max-w-xl text-sm leading-6 text-[#667085]">
                            Report totals scale survey density and TQ volume per rai to the project area, then price wood loss by species.
                          </p>
                        </div>
                        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                          {result.economic.metrics.map((metric) => (
                            <MetricTile key={metric.label} help={metric.help_text} label={metric.label} value={metric.value} />
                          ))}
                        </div>
                      </div>

                      {economicRows.length > 0 && (
                        <div className="overflow-hidden rounded-[28px] border border-[#DDE5D5]">
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[1480px] text-left text-sm">
                              <thead className="bg-[#F6F8F4] text-xs uppercase tracking-[0.18em] text-[#667085]">
                                <tr>
                                  <th className="px-4 py-4">Component</th>
                                  <th className="px-4 py-4">Area (rai)</th>
                                  <th className="px-4 py-4">Trees est.</th>
                                  <th className="px-4 py-4">Saplings est.</th>
                                  <th className="px-4 py-4">Seedlings est.</th>
                                  <th className="px-4 py-4">Forest types</th>
                                  <th className="px-4 py-4">TQs</th>
                                  <th className="px-4 py-4">Wood loss</th>
                                  <th className="px-4 py-4">Annual increment</th>
                                  <th className="px-4 py-4">Annual wood value</th>
                                  <th className="px-4 py-4">Wood loss value</th>
                                  <th className="px-4 py-4">Regeneration loss</th>
                                  <th className="px-4 py-4">Ecosystem loss / year</th>
                                  <th className="px-4 py-4">Total loss (report)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#DDE5D5] bg-white">
                                {economicRows.map((row) => (
                                  <tr key={row.componentId} className="transition hover:bg-[#F8FBF3]">
                                    <td className="px-4 py-4 font-semibold text-[#1F2933]">{row.componentName}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.componentAreaRai, 2)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.estimatedTreeCount, 0)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.estimatedSaplingCount, 0)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.estimatedSeedlingCount, 0)}</td>
                                    <td className="px-4 py-4 text-[#667085]">{row.forestTypes.join(", ") || "-"}</td>
                                    <td className="px-4 py-4 text-[#667085]">{row.tqs.join(", ") || "-"}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.totalWoodLossM3, 3)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.totalAnnualIncrementM3PerYear, 3)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.totalAnnualWoodValueBaht, 2)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.totalWoodValueBaht, 2)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.totalRegenerationLossBaht, 2)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.totalEcosystemLossBahtPerYear, 2)}</td>
                                    <td className="px-4 py-4 font-semibold tabular-nums text-[#1F5E3B]">{formatMetricValue(row.totalReportLossBaht, 2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {result.economic.futureValueRows.length > 0 && (
                        <div className="overflow-hidden rounded-[28px] border border-[#DDE5D5]">
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-left text-sm">
                              <thead className="bg-[#F6F8F4] text-xs uppercase tracking-[0.18em] text-[#667085]">
                                <tr>
                                  <th className="px-4 py-4">Period (N)</th>
                                  <th className="px-4 py-4">Annual wood value</th>
                                  <th className="px-4 py-4">Future value</th>
                                  <th className="px-4 py-4">Present value</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#DDE5D5] bg-white">
                                {result.economic.futureValueRows.map((row, index) => (
                                  <tr key={`${row.period_years ?? index}`}>
                                    <td className="px-4 py-4">{formatMetricValue(row.period_years, 0)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.annual_wood_value_baht, 2)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.future_value_baht, 2)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.present_value_baht, 2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {result.economic.ecosystemImpactDetails.length > 0 && (
                        <div className="overflow-hidden rounded-[28px] border border-[#DDE5D5]">
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[1100px] text-left text-sm">
                              <thead className="bg-[#F6F8F4] text-xs uppercase tracking-[0.18em] text-[#667085]">
                                <tr>
                                  <th className="px-4 py-4">Component</th>
                                  <th className="px-4 py-4">Forest type</th>
                                  <th className="px-4 py-4">Impact</th>
                                  <th className="px-4 py-4">Quantity</th>
                                  <th className="px-4 py-4">Unit</th>
                                  <th className="px-4 py-4">Unit price</th>
                                  <th className="px-4 py-4">Value / rai / year</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#DDE5D5] bg-white">
                                {result.economic.ecosystemImpactDetails.slice(0, 60).map((row, index) => (
                                  <tr key={`${row.componentId}-${row.impactKey}-${index}`}>
                                    <td className="px-4 py-4 font-semibold text-[#1F2933]">{row.componentName}</td>
                                    <td className="px-4 py-4 text-[#667085]">{row.forestType || "-"}</td>
                                    <td className="px-4 py-4">{row.impactNameTh}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.quantity, 3)}</td>
                                    <td className="px-4 py-4">{row.quantityUnit}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.unitPrice, 3)}</td>
                                    <td className="px-4 py-4">{formatMetricValue(row.valueBahtPerRaiPerYear, 2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {result.economic.warnings.length > 0 && (
                        <Notice tone="warning">
                          {result.economic.warnings.slice(0, 5).join(" | ")}
                        </Notice>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <DownloadButton disabled onClick={() => undefined}>
                      Download biomass summary
                    </DownloadButton>
                    <DownloadButton disabled variant="secondary" onClick={() => undefined}>
                      Download biomass detail
                    </DownloadButton>
                    <DownloadButton disabled variant="secondary" onClick={() => undefined}>
                      Download grouped biomass
                    </DownloadButton>
                    <DownloadButton disabled variant="secondary" onClick={() => undefined}>
                      Download economic report
                    </DownloadButton>
                    <DownloadButton disabled variant="secondary" onClick={() => undefined}>
                      Download economic JSON
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
