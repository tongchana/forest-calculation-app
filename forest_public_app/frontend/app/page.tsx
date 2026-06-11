"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

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
const PREVIEW_TABS: Array<keyof PreviewMap> = [
  "summaryAll",
  "summaryBiomass",
  "summaryVolume",
  "summaryShannon",
  "unmatchedSpecies",
];
const TAB_LABELS: Record<keyof PreviewMap, string> = {
  summaryAll: "Master Summary",
  summaryBiomass: "Biomass",
  summaryVolume: "Volume",
  summaryShannon: "Shannon + IVI",
  unmatchedSpecies: "QA / Unmatched",
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

function SectionBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/12 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-100/80">
      {children}
    </span>
  );
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

  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14 },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  const groupedSheets = useMemo(() => new Set(groups.flatMap((group) => group.sheetNames)), [groups]);
  const currentRows = result?.previews[activeTab] ?? [];
  const currentColumns = currentRows.length > 0 ? Object.keys(currentRows[0]) : [];

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
      setError(inspectError instanceof Error ? inspectError.message : "Could not inspect workbook.");
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
    const file = event.dataTransfer.files?.[0] ?? null;
    if (file) {
      handleWorkbookFile(file);
    }
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
          sheetNames: alreadySelected
            ? group.sheetNames.filter((name) => name !== sheetName)
            : [...group.sheetNames, sheetName],
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
      setMessage("Calculation completed.");
    } catch (calcError) {
      setResult(null);
      setError(calcError instanceof Error ? calcError.message : "Calculation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(65,169,123,0.18),_transparent_24%),radial-gradient(circle_at_82%_10%,_rgba(255,191,92,0.14),_transparent_18%),linear-gradient(180deg,_#071711_0%,_#091d15_20%,_#eef5ef_20%,_#f8fbf8_100%)] text-slate-900">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 pb-16 pt-4 sm:px-6 lg:px-8">
        <header className="sticky top-4 z-30" data-reveal>
          <div className="rounded-[24px] border border-white/10 bg-[rgba(8,31,22,0.82)] px-4 py-3 shadow-[0_20px_60px_rgba(4,19,12,0.18)] backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
                  <div className="h-5 w-5 rounded-[7px_7px_2px_7px] bg-gradient-to-br from-lime-200 via-emerald-300 to-emerald-500" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.32em] text-emerald-100/70">Forest Calculation Suite</p>
                  <h1 className="font-display text-xl text-white sm:text-2xl">Field-to-report workspace</h1>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
                <details className="group relative">
                  <summary className="list-none rounded-full border border-white/12 bg-white/10 px-4 py-3 text-white transition hover:bg-white/16">
                    <span className="inline-flex items-center gap-2">
                      Resources
                      <span className="transition group-open:rotate-180">v</span>
                    </span>
                  </summary>
                  <div className="absolute right-0 mt-3 min-w-56 rounded-3xl border border-white/10 bg-[#0f2c1f] p-3 text-white shadow-2xl">
                    <a
                      className="block rounded-2xl px-4 py-3 transition hover:bg-white/10"
                      href={`${API_BASE_URL}/api/template`}
                    >
                      Workbook template
                    </a>
                    <Link className="block rounded-2xl px-4 py-3 transition hover:bg-white/10" href="/detail">
                      Calculation detail
                    </Link>
                  </div>
                </details>

                <Link
                  className="rounded-full border border-white/12 bg-white/10 px-4 py-3 text-white transition hover:bg-white/16"
                  href="/detail"
                >
                  Detail
                </Link>
                <a
                  className="rounded-full bg-white px-5 py-3 text-emerald-950 shadow-lg shadow-emerald-950/20 transition hover:-translate-y-0.5"
                  href="#workspace"
                >
                  Open workspace
                </a>
              </div>
            </div>
          </div>
        </header>

        <section className="glass-panel overflow-hidden px-5 py-8 sm:px-8 sm:py-10 reveal-section" data-reveal>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(255,255,255,0.16),transparent_26%),radial-gradient(circle_at_100%_0%,rgba(255,191,92,0.16),transparent_24%)]" />
          <div className="relative z-10 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-7">
              <SectionBadge>Forest survey workflow</SectionBadge>
              <div className="max-w-4xl space-y-5">
                <h2 className="font-display text-5xl leading-[0.92] tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">
                  Upload your field workbook, calculate, and download the results in one place.
                </h2>
                <p className="max-w-2xl text-base leading-8 text-emerald-50/82 sm:text-lg">
                  Review worksheets, group related sheets when needed, run the calculation, and export the output files.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ["Step 1", "Upload", "Upload the completed workbook and let the system detect every worksheet."],
                  ["Step 2", "Calculate", "Set the plot values, optionally group sheets, then run the calculation."],
                  ["Step 3", "Download", "Preview the results on screen and download summary, detail, or component workbooks."],
                ].map(([eyebrow, title, body]) => (
                  <div key={title} className="rounded-[28px] border border-white/10 bg-white/8 p-5 backdrop-blur">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100/60">{eyebrow}</p>
                    <p className="mt-3 font-display text-2xl text-white">{title}</p>
                    <p className="mt-2 text-sm leading-7 text-emerald-50/72">{body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#f5f8f3] p-6 text-slate-900 shadow-2xl shadow-black/20">
                <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-emerald-200/40 blur-3xl" />
                <div className="relative space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Workflow snapshot</p>
                      <h3 className="mt-2 font-display text-2xl text-emerald-950">Simple workflow</h3>
                    </div>
                    <div className="rounded-full bg-emerald-950 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-50">
                      Ready
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {[
                      "Upload a completed field workbook",
                      "Inspect every worksheet before processing",
                      "Create optional grouped components for combined outputs",
                      "Run biomass, volume, IVI, and Shannon calculations",
                      "Preview results and export workbook packages",
                    ].map((step, index) => (
                      <div key={step} className="flex items-start gap-4 rounded-2xl border border-emerald-950/8 bg-white/80 p-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 font-semibold text-emerald-950">
                          0{index + 1}
                        </div>
                        <p className="pt-1 text-sm leading-7 text-slate-700">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-[28px] border border-white/10 bg-white/8 p-5 text-white backdrop-blur">
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-emerald-100/65">Workbook</p>
                  <p className="mt-3 text-sm leading-7 text-emerald-50/78">Use the official template, fill in the field data, then upload the completed file here.</p>
                </div>
                <div className="rounded-[28px] border border-white/10 bg-white/8 p-5 text-white backdrop-blur">
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-emerald-100/65">Output</p>
                  <p className="mt-3 text-sm leading-7 text-emerald-50/78">Review the preview tables first, then download the workbooks you want to keep.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr] reveal-section" data-reveal id="workspace">
          <article className="rounded-[32px] border border-emerald-950/8 bg-white/80 p-6 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Overview</p>
            <h3 className="mt-4 font-display text-3xl text-emerald-950">Everything you need for one calculation run.</h3>
            <p className="mt-4 max-w-xl text-sm leading-8 text-slate-600">
              Upload the workbook, check the detected sheets, adjust the settings, and export the result files from the same page.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[26px] bg-[#f7fbf7] p-5 ring-1 ring-emerald-950/6">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Current workbook</p>
                <p className="mt-3 font-display text-2xl text-emerald-950">{workbookFile ? workbookFile.name : "No file yet"}</p>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  {workbookFile ? "Workbook connected and ready for inspection." : "Upload an .xlsx workbook to start the workspace flow."}
                </p>
              </div>
              <div className="rounded-[26px] bg-[#f7fbf7] p-5 ring-1 ring-emerald-950/6">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Detected sheets</p>
                <p className="mt-3 font-display text-2xl text-emerald-950">{sheetNames.length}</p>
                <p className="mt-2 text-sm leading-7 text-slate-600">All uploaded worksheet names stay visible after inspection.</p>
              </div>
            </div>
          </article>

          <article className="rounded-[32px] border border-emerald-950/8 bg-[linear-gradient(145deg,#11291f,#183729)] p-6 text-white shadow-[0_28px_90px_rgba(9,26,17,0.28)] sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200/70">Before you start</p>
            <h3 className="mt-4 font-display text-3xl">Prepare the workbook first.</h3>
            <p className="mt-4 max-w-xl text-sm leading-8 text-emerald-50/76">
              Fill in the survey data in the template, save the file, and upload the completed workbook here.
            </p>

            <div className="mt-8 grid gap-3">
              {[
                "Use the official template file.",
                "Check worksheet names after upload.",
                "Create grouped components only when needed.",
              ].map((line) => (
                <div key={line} className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm leading-7 text-emerald-50/82">
                  {line}
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr] reveal-section" data-reveal>
          <article className="rounded-[32px] border border-emerald-950/8 bg-white/80 p-6 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Step 1</p>
                <h3 className="mt-3 font-display text-3xl text-emerald-950">Upload and inspect the workbook</h3>
                <p className="mt-3 max-w-2xl text-sm leading-8 text-slate-600">
                  Upload the completed workbook to read the worksheet names before calculation.
                </p>
              </div>
              <a
                className="inline-flex items-center justify-center rounded-full bg-emerald-950 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
                href={`${API_BASE_URL}/api/template`}
              >
                Download template
              </a>
            </div>

            <label
              className={`mt-7 block cursor-pointer rounded-[30px] border border-dashed p-8 text-center transition ${
                dragActive
                  ? "border-emerald-700 bg-emerald-50 shadow-[0_0_0_6px_rgba(16,87,59,0.08)]"
                  : "border-emerald-500/40 bg-[linear-gradient(180deg,#fdfefd,#f3f8f4)] hover:border-emerald-700/45 hover:bg-[#f7fbf8]"
              }`}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <input ref={fileInputRef} className="hidden" type="file" accept=".xlsx" onChange={handleFileChange} />
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-emerald-100 text-emerald-900 shadow-inner">
                <span className="text-2xl">+</span>
              </div>
              <h4 className="mt-5 font-display text-2xl text-emerald-950">
                {workbookFile ? workbookFile.name : "Drop your workbook here or click to browse"}
              </h4>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Drag and drop an .xlsx file here, or click anywhere in this area to choose a workbook.
              </p>
              <button
                className="mt-5 rounded-full bg-white px-5 py-3 text-sm font-semibold text-emerald-950 ring-1 ring-emerald-950/10 transition hover:-translate-y-0.5"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }}
              >
                Choose file
              </button>
            </label>

            {inspectBusy && (
              <div className="mt-5 rounded-2xl border border-emerald-950/8 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                Inspecting workbook structure...
              </div>
            )}

            {sheetNames.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Detected worksheets</p>
                  <p className="text-sm text-slate-500">{sheetNames.length} found</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {sheetNames.map((sheet) => (
                    <span
                      key={sheet}
                      className="rounded-full border border-emerald-950/8 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900"
                    >
                      {sheet}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </article>

          <article className="rounded-[32px] border border-emerald-950/8 bg-[#fbfcfb] p-6 shadow-[0_24px_80px_rgba(12,32,22,0.08)] sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Step 2</p>
            <h3 className="mt-3 font-display text-3xl text-emerald-950">Set run parameters</h3>
            <p className="mt-3 text-sm leading-8 text-slate-600">Leave the defaults as they are, or adjust them before calculating.</p>

            <div className="mt-7 grid gap-4">
              <label className="rounded-[24px] border border-emerald-950/8 bg-white p-4 shadow-sm">
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Plot area (ha)</span>
                <input
                  className="mt-3 w-full border-none bg-transparent p-0 font-display text-4xl text-emerald-950 outline-none"
                  min="0.0001"
                  step="0.0001"
                  type="number"
                  value={plotAreaHa}
                  onChange={(event) => setPlotAreaHa(formatNumberInput(event.target.value))}
                />
              </label>
              <label className="rounded-[24px] border border-emerald-950/8 bg-white p-4 shadow-sm">
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Rai per hectare</span>
                <input
                  className="mt-3 w-full border-none bg-transparent p-0 font-display text-4xl text-emerald-950 outline-none"
                  min="0.0001"
                  step="0.01"
                  type="number"
                  value={raiPerHectare}
                  onChange={(event) => setRaiPerHectare(formatNumberInput(event.target.value))}
                />
              </label>
            </div>

            <div className="mt-7 rounded-[26px] bg-emerald-950 px-5 py-5 text-emerald-50">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200/70">Default values</p>
              <p className="mt-3 text-sm leading-7 text-emerald-50/84">The default plot area is set to 0.100 ha.</p>
            </div>
          </article>
        </section>

        <section className="rounded-[34px] border border-emerald-950/8 bg-white/82 p-6 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur sm:p-8 reveal-section" data-reveal>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Step 3</p>
              <h3 className="mt-3 font-display text-3xl text-emerald-950">Build grouped components</h3>
              <p className="mt-3 max-w-3xl text-sm leading-8 text-slate-600">
                Group multiple worksheets into one named component when you want a combined output workbook. A sheet can only belong to one component at a time.
              </p>
            </div>
            <button
              className="inline-flex items-center justify-center rounded-full bg-emerald-950 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={sheetNames.length === 0}
              type="button"
              onClick={addGroup}
            >
              Add component
            </button>
          </div>

          {groups.length === 0 ? (
            <div className="mt-7 rounded-[28px] border border-dashed border-emerald-950/12 bg-[#f7faf7] p-8 text-center">
              <p className="font-display text-2xl text-emerald-950">No grouped components yet</p>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-8 text-slate-600">
                That is fine. The app will still calculate every uploaded worksheet normally.
              </p>
            </div>
          ) : (
            <div className="mt-7 grid gap-5 xl:grid-cols-2">
              {groups.map((group, groupIndex) => {
                const availableOptions = sheetNames.filter(
                  (sheet) => !groupedSheets.has(sheet) || group.sheetNames.includes(sheet),
                );

                return (
                  <article key={group.id} className="rounded-[30px] border border-emerald-950/8 bg-[#fbfcfb] p-5 shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Component {groupIndex + 1}</p>
                        <input
                          className="mt-3 w-full border-none bg-transparent p-0 font-display text-3xl text-emerald-950 outline-none placeholder:text-slate-400"
                          placeholder="Name this component"
                          value={group.name}
                          onChange={(event) => updateGroup(group.id, { name: event.target.value })}
                        />
                      </div>
                      <button
                        className="inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:-translate-y-0.5"
                        type="button"
                        onClick={() => removeGroup(group.id)}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="mt-6 rounded-[24px] border border-emerald-950/8 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Selected sheets</p>
                      <div className="mt-4 flex min-h-14 flex-wrap gap-2">
                        {group.sheetNames.length > 0 ? (
                          group.sheetNames.map((sheet) => (
                            <button
                              key={sheet}
                              className="rounded-full bg-emerald-950 px-4 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5"
                              type="button"
                              onClick={() => toggleSheet(group.id, sheet)}
                            >
                              {sheet} x
                            </button>
                          ))
                        ) : (
                          <p className="text-sm leading-7 text-slate-500">No sheets selected for this component yet.</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 rounded-[24px] border border-emerald-950/8 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Available sheets</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {availableOptions.length > 0 ? (
                          availableOptions.map((sheet) => {
                            const selected = group.sheetNames.includes(sheet);
                            return (
                              <button
                                key={sheet}
                                className={`rounded-full px-4 py-2 text-sm font-medium transition hover:-translate-y-0.5 ${
                                  selected
                                    ? "bg-emerald-100 text-emerald-950 ring-1 ring-emerald-200"
                                    : "bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-950"
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
                          <p className="text-sm leading-7 text-slate-500">All worksheets are already assigned to other components.</p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr] reveal-section" data-reveal>
          <article className="rounded-[32px] border border-emerald-950/8 bg-[linear-gradient(145deg,#10281d,#173628)] p-6 text-white shadow-[0_28px_90px_rgba(9,26,17,0.28)] sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200/70">Step 4</p>
            <h3 className="mt-3 font-display text-4xl">Run calculation</h3>
            <p className="mt-4 max-w-2xl text-sm leading-8 text-emerald-50/78">
              Start the calculation after the workbook, settings, and grouped components are ready.
            </p>

            <div className="mt-8 grid gap-3">
              {[
                "All uploaded worksheets are included in the run.",
                "Component output is created only when grouped sheets are provided.",
                "Preview tables appear after calculation finishes.",
              ].map((line) => (
                <div key={line} className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm leading-7 text-emerald-50/82">
                  {line}
                </div>
              ))}
            </div>

            <button
              className="mt-8 inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-4 text-sm font-semibold text-emerald-950 shadow-lg shadow-black/20 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={busy || !workbookFile}
              type="button"
              onClick={handleCalculate}
            >
              {busy ? "Calculating..." : "Run calculation"}
            </button>
          </article>

          <article className="rounded-[32px] border border-emerald-950/8 bg-white/82 p-6 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Status</p>
            <h3 className="mt-3 font-display text-3xl text-emerald-950">Run status</h3>
            <p className="mt-3 text-sm leading-8 text-slate-600">Check the current upload and calculation status here.</p>

            <div className="mt-6 grid gap-4">
              <div className="rounded-[26px] border border-emerald-950/8 bg-[#f7faf7] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Inspection</p>
                <p className="mt-2 font-display text-2xl text-emerald-950">
                  {inspectBusy ? "Reading workbook..." : workbookFile ? "Workbook ready" : "Waiting for upload"}
                </p>
              </div>
              <div className="rounded-[26px] border border-emerald-950/8 bg-[#f7faf7] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Calculation</p>
                <p className="mt-2 font-display text-2xl text-emerald-950">
                  {busy ? "Engine is running..." : result ? "Outputs generated" : "Not started yet"}
                </p>
              </div>
            </div>

            {(message || error) && (
              <div
                className={`mt-6 rounded-[26px] border px-5 py-4 text-sm leading-8 ${
                  error
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}
              >
                {error ?? message}
              </div>
            )}
          </article>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr] reveal-section" data-reveal id="results">
          <article className="rounded-[34px] border border-emerald-950/8 bg-white/84 p-6 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur sm:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Step 5</p>
                <h3 className="mt-3 font-display text-3xl text-emerald-950">Preview the results before export</h3>
                <p className="mt-3 max-w-3xl text-sm leading-8 text-slate-600">
                  Review the summary cards and preview tables before downloading the output workbooks.
                </p>
              </div>
            </div>

            {result ? (
              <>
                <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {result.metrics.map((metric) => (
                    <article key={metric.label} className="rounded-[26px] border border-emerald-950/8 bg-[#f8fbf8] p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{metric.label}</p>
                      <p className="mt-3 font-display text-3xl text-emerald-950">{metric.value}</p>
                      <p className="mt-3 text-sm leading-7 text-slate-600">{metric.help_text}</p>
                    </article>
                  ))}
                </div>

                <div className="mt-8 flex flex-wrap gap-3">
                  {PREVIEW_TABS.map((tabKey) => (
                    <button
                      key={tabKey}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 ${
                        activeTab === tabKey
                          ? "bg-emerald-950 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-950"
                      }`}
                      type="button"
                      onClick={() => setActiveTab(tabKey)}
                    >
                      {TAB_LABELS[tabKey]}
                    </button>
                  ))}
                </div>

                <div className="mt-6 overflow-hidden rounded-[28px] border border-emerald-950/8 bg-white">
                  {currentRows.length === 0 ? (
                    <div className="px-6 py-10 text-sm leading-8 text-slate-600">No preview rows are available for this result tab.</div>
                  ) : (
                    <div className="max-h-[540px] overflow-auto">
                      <table className="min-w-full border-collapse text-left text-sm">
                        <thead className="sticky top-0 bg-[#eff6f0] text-slate-700">
                          <tr>
                            {currentColumns.map((column) => (
                              <th key={column} className="border-b border-emerald-950/8 px-4 py-3 font-semibold">
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {currentRows.map((row, rowIndex) => (
                            <tr key={rowIndex} className="odd:bg-white even:bg-[#fafcfb]">
                              {currentColumns.map((column) => (
                                <td key={column} className="border-b border-emerald-950/6 px-4 py-3 align-top text-slate-700">
                                  {String(row[column] ?? "")}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-7 rounded-[28px] border border-dashed border-emerald-950/12 bg-[#f7faf7] p-10 text-center">
                <p className="font-display text-2xl text-emerald-950">No results yet</p>
                <p className="mx-auto mt-3 max-w-2xl text-sm leading-8 text-slate-600">
                  Run the calculation to show summary cards, preview tables, and workbook downloads.
                </p>
              </div>
            )}
          </article>

          <aside className="rounded-[34px] border border-emerald-950/8 bg-[linear-gradient(180deg,#f7fbf8,#eff6f0)] p-6 shadow-[0_24px_80px_rgba(12,32,22,0.08)] sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Outputs</p>
            <h3 className="mt-3 font-display text-3xl text-emerald-950">Download workbook packages</h3>
            <p className="mt-3 text-sm leading-8 text-slate-600">Download the summary, detail, and component workbooks after the calculation is complete.</p>

            <div className="mt-8 space-y-3">
              <button
                className="inline-flex w-full items-center justify-center rounded-[22px] bg-emerald-950 px-5 py-4 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!result}
                type="button"
                onClick={() => result && downloadWorkbook(result.downloads.summary)}
              >
                Download summary-by-site workbook
              </button>
              <button
                className="inline-flex w-full items-center justify-center rounded-[22px] bg-white px-5 py-4 text-sm font-semibold text-emerald-950 ring-1 ring-emerald-950/10 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!result}
                type="button"
                onClick={() => result && downloadWorkbook(result.downloads.detail)}
              >
                Download detail workbook
              </button>
              <button
                className="inline-flex w-full items-center justify-center rounded-[22px] bg-white px-5 py-4 text-sm font-semibold text-emerald-950 ring-1 ring-emerald-950/10 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!result?.downloads.component}
                type="button"
                onClick={() => result?.downloads.component && downloadWorkbook(result.downloads.component)}
              >
                Download component workbook
              </button>
            </div>

            <div className="mt-8 rounded-[28px] border border-emerald-950/8 bg-white/85 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Tip</p>
              <p className="mt-3 text-sm leading-8 text-slate-600">
                Use the preview first if you want to check the results before downloading the workbook files.
              </p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
