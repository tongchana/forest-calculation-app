"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { API_BASE_URL, describeApiError } from "@/app/lib/api-base";
import { clearWorkspace, readWorkspace, saveWorkspace } from "@/app/lib/workspace-session";
import { readProfileEditorScene, readProfileResult, readWorkspaceFile, saveProfileEditorRender, saveProfileEditorScene, saveProfileEditorServerScene, saveProfileResult, saveWorkspaceFile, type ProfileEditorScene, type ProfileEditorServerScene, type ProfileEditorTree } from "@/app/lib/workspace-file";
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

type DownloadPayload = {
  filename: string;
  contentBase64: string;
};

type ProfileImage = {
  sheetName: string;
  filename: string;
  contentBase64: string;
};

type ProfileSheetValidation = {
  sheetName: string;
  treeCount: number;
  speciesCount: number;
  species: string[];
};

type RenderMode = "graphic" | "realistic";

type ProfileResponse = {
  sheetNames: string[];
  renderMode: RenderMode;
  images: ProfileImage[];
  validation: ProfileSheetValidation[];
  download: DownloadPayload;
};

type ProfileGenerationJob = {
  status: "queued" | "rendering" | "preparing_editor" | "ready" | "failed";
  detail?: string;
  profile?: ProfileResponse;
  editorScene?: ProfileEditorServerScene;
};

type ProfileWorkspaceState = {
  workbookFile: File | null;
  sheetNames: string[];
  result: ProfileResponse | null;
  renderMode: RenderMode;
  message: string | null;
  error: string | null;
};

const requiredColumns = ["Species", "Height", "Position", "Crown cover"];
const profileSectionIds = [
  "download-template",
  "upload-profile-workbook",
  "validate-profile-sheets",
  "generate-profile-diagrams",
  "profile-gallery",
  "download-profile-outputs",
] as const;

function base64ToBlob(base64: string, mimeType: string) {
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

function fileSize(file: File | null) {
  if (!file) {
    return "No file";
  }
  return `${(file.size / 1024 / 1024).toFixed(2)} MB`;
}

function profileNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function buildProfileEditorScene(file: File): Promise<ProfileEditorScene> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheets = workbook.SheetNames.map((name, sheetIndex) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, blankrows: false, defval: null });
    const trees: ProfileEditorTree[] = rows.slice(2).flatMap((row, rowIndex) => {
      const species = String(row[1] ?? "").trim();
      const x = profileNumber(row[5], NaN), y = profileNumber(row[6], NaN), height = profileNumber(row[3], NaN);
      if (!species || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(height)) return [];
      return [{ id: profileNumber(row[0], rowIndex + 1), species, x, y, height, firstBranch: profileNumber(row[4], height * .55), crownXPlus: Math.max(.5, profileNumber(row[7], 1.5)), crownXMinus: Math.max(.5, profileNumber(row[8], 1.5)), crownYPlus: Math.max(.5, profileNumber(row[9], 1.5)), crownYMinus: Math.max(.5, profileNumber(row[10], 1.5)) }];
    });
    return { name, slug: `upload-${sheetIndex + 1}`, trees };
  }).filter((sheet) => sheet.trees.length > 0);
  if (!sheets.length) throw new Error("No usable profile rows were found for the editor.");
  return { version: 1, fileName: file.name, sheets };
}

export default function ProfilePage() {
  const savedWorkspace = readWorkspace<ProfileWorkspaceState>("profile");
  const [workbookFile, setWorkbookFile] = useState<File | null>(savedWorkspace?.workbookFile ?? null);
  const [sheetNames, setSheetNames] = useState<string[]>(savedWorkspace?.sheetNames ?? []);
  const [result, setResult] = useState<ProfileResponse | null>(savedWorkspace?.result ?? null);
  const [renderMode, setRenderMode] = useState<RenderMode>(savedWorkspace?.renderMode ?? "graphic");
  const [busy, setBusy] = useState(false);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState<string | null>(savedWorkspace?.message ?? null);
  const [error, setError] = useState<string | null>(savedWorkspace?.error ?? null);
  const [activeStepId, setActiveStepId] = useState<(typeof profileSectionIds)[number]>("download-template");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    saveWorkspace<ProfileWorkspaceState>("profile", { workbookFile, sheetNames, result, renderMode, message, error });
  }, [workbookFile, sheetNames, result, renderMode, message, error]);

  useEffect(() => {
    if (workbookFile) return;
    void Promise.all([readWorkspaceFile("profile"), readProfileEditorScene(), readProfileResult<ProfileResponse>()]).then(([file, scene, storedResult]) => {
      if (!file) return;
      setWorkbookFile(file);
      if (storedResult) {
        setResult(storedResult);
        setRenderMode(storedResult.renderMode);
      }
      if (scene) {
        setSheetNames(scene.sheets.map((sheet) => sheet.name));
        setMessage(`Restored ${scene.sheets.length} sheet(s) from the current Profile workspace.`);
      } else {
        void inspectWorkbook(file);
      }
    });
  }, []);

  useEffect(() => {
    const sections = profileSectionIds
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
          setActiveStepId(visibleEntry.target.id as (typeof profileSectionIds)[number]);
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

  const canRender = Boolean(workbookFile) && sheetNames.length > 0 && !busy && !inspectBusy;

  const workflowSteps: WorkflowStep[] = [
    { id: "download-template", title: "Download template", body: "Use the official profile format.", state: "complete" },
    {
      id: "upload-profile-workbook",
      title: "Upload profile workbook",
      body: workbookFile ? "Completed profile workbook uploaded." : "Add completed profile Excel file.",
      state: workbookFile ? "complete" : "active",
    },
    {
      id: "validate-profile-sheets",
      title: "Validate profile sheets",
      body: "Check Species, Height, Position, and Crown cover.",
      state: sheetNames.length > 0 ? "complete" : workbookFile ? "active" : "disabled",
    },
    {
      id: "generate-profile-diagrams",
      title: "Generate diagrams",
      body: "Render canopy profile diagrams.",
      state: result ? "complete" : canRender ? "active" : "disabled",
    },
    {
      id: "profile-gallery",
      title: "Review gallery",
      body: "Preview diagrams by worksheet.",
      state: result ? "complete" : "disabled",
    },
    {
      id: "download-profile-outputs",
      title: "Download outputs",
      body: "Export images or ZIP package.",
      state: result ? "complete" : "disabled",
    },
  ];

  const statusItems: StatusItem[] = [
    { label: "Worksheets", value: sheetNames.length, tone: sheetNames.length > 0 ? "success" : "warning" },
    { label: "Valid sheets", value: sheetNames.length, tone: sheetNames.length > 0 ? "success" : "warning" },
    { label: "Outputs", value: result ? "Ready" : "Locked", tone: result ? "success" : "warning" },
  ];

  async function inspectWorkbook(file: File) {
    setInspectBusy(true);
    setError(null);
    setMessage(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile/inspect`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ detail: "Could not inspect workbook." }));
        throw new Error(data.detail ?? "Could not inspect workbook.");
      }
      const data = (await response.json()) as { sheetNames: string[] };
      setSheetNames(data.sheetNames ?? []);
      setMessage(`Detected ${data.sheetNames.length} sheet(s) ready for profile rendering.`);
    } catch (inspectError) {
      setSheetNames([]);
      setError(describeApiError(inspectError));
    } finally {
      setInspectBusy(false);
    }
  }

  function handleWorkbookFile(file: File | null) {
    if (file && !file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Please upload a .xlsx profile workbook.");
      return;
    }
    setWorkbookFile(file);
    void saveWorkspaceFile("profile", file);
    void saveProfileEditorRender(null);
    void saveProfileEditorServerScene(null);
    void saveProfileResult<ProfileResponse>(null);
    if (file) void buildProfileEditorScene(file).then((scene) => saveProfileEditorScene(scene)).catch(() => saveProfileEditorScene(null));
    else void saveProfileEditorScene(null);
    setResult(null);
    setError(null);
    setMessage(null);
    if (!file) {
      setSheetNames([]);
      return;
    }
    void inspectWorkbook(file);
  }

  function clearCurrentWorkspace() {
    if (!window.confirm("Clear the uploaded workbook and rendered profile outputs from this Profile workspace?")) return;
    clearWorkspace("profile");
    void saveWorkspaceFile("profile", null);
    void saveProfileEditorScene(null);
    void saveProfileEditorRender(null);
    void saveProfileEditorServerScene(null);
    void saveProfileResult<ProfileResponse>(null);
    setWorkbookFile(null);
    setSheetNames([]);
    setResult(null);
    setRenderMode("graphic");
    setMessage(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
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

  function handleRenderModeChange(mode: RenderMode) {
    setRenderMode(mode);
    setResult(null);
    setMessage(null);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
  }

  async function handleCalculate() {
    if (!workbookFile) {
      setError("Upload a completed profile workbook first.");
      return;
    }

    if (sheetNames.length === 0) {
      setError("No valid profile sheets were detected. Check that the workbook uses the profile template.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    setResult(null);
    void saveProfileResult<ProfileResponse>(null);

    const formData = new FormData();
    formData.append("file", workbookFile);
    formData.append("render_mode", renderMode);

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile/generation-job`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ detail: "Profile calculation failed." }));
        throw new Error(data.detail ?? "Profile calculation failed.");
      }
      const startedJob = (await response.json()) as { jobId: string };
      let job: ProfileGenerationJob | null = null;
      let previousStatus = "";
      for (let attempt = 0; attempt < 450; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const jobResponse = await fetch(`${API_BASE_URL}/api/profile/generation-job/${startedJob.jobId}`, { cache: "no-store" });
        if (!jobResponse.ok) {
          const jobError = await jobResponse.json().catch(() => ({ detail: "Could not read profile generation status." }));
          throw new Error(jobError.detail ?? "Could not read profile generation status.");
        }
        job = (await jobResponse.json()) as ProfileGenerationJob;
        if (job.status !== previousStatus) {
          previousStatus = job.status;
          if (job.status === "queued") setMessage("Profile render queued…");
          if (job.status === "rendering") setMessage("Rendering current workbook diagrams…");
          if (job.status === "preparing_editor") setMessage("Rendered diagrams. Preparing editable tree layers…");
        }
        if (job.status === "failed") throw new Error(job.detail ?? "Profile generation failed.");
        if (job.status === "ready") break;
      }
      if (!job || job.status !== "ready" || !job.profile || !job.editorScene) {
        throw new Error("Profile generation timed out.");
      }
      const data = job.profile;
      setResult(data);
      const scene = job.editorScene;
      const assetDataUrls = new Map<string, string>();
      const assetUrls = [
        ...scene.sheets.map((sheet) => sheet.base),
        ...scene.sheets.flatMap((sheet) => sheet.trees.flatMap((tree) => Object.values(tree.parts).map((part) => part.file))),
      ];
      await Promise.all([...new Set(assetUrls)].map(async (assetUrl) => {
        const assetResponse = await fetch(assetUrl);
        if (!assetResponse.ok) throw new Error("Could not download an editable profile layer.");
        const blob = await assetResponse.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        assetDataUrls.set(assetUrl, dataUrl);
      }));
      const persistentScene: ProfileEditorServerScene = {
        ...scene,
        sheets: scene.sheets.map((sheet) => ({
          ...sheet,
          base: assetDataUrls.get(sheet.base) ?? sheet.base,
          trees: sheet.trees.map((tree) => ({
            ...tree,
            parts: Object.fromEntries(Object.entries(tree.parts).map(([partName, part]) => [
              partName,
              { ...part, file: assetDataUrls.get(part.file) ?? part.file },
            ])),
          })),
        })),
      };
      await saveProfileEditorServerScene(persistentScene);
      await saveProfileEditorRender(null);
      await saveProfileResult(data);
      const auditSummary = data.validation
        .map((sheet) => `${sheet.sheetName}: ${sheet.treeCount} trees, ${sheet.speciesCount} species`)
        .join(" | ");
      setMessage(`Generated ${data.images.length} ${data.renderMode} profile diagram(s). Verified ${auditSummary}.`);
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
          title="Profile Diagram Studio"
          subtitle="Dedicated workflow for canopy profile diagrams."
          links={resources}
          primaryAction={{ label: "Back to Biomass Workspace", href: "/" }}
          templateLinks={templateLinks}
        />

        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px]">
          <SidebarWorkflow activeStepId={activeStepId} steps={workflowSteps} title="Profile Workflow" />

          <div className="space-y-6">
            <section className="overflow-hidden rounded-[36px] border border-[#DDE5D5] bg-white shadow-[0_22px_70px_rgba(31,94,59,0.07)]">
              <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="p-7 sm:p-9">
                  <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#6A8F5D]">Canopy profile rendering</p>
                  <h2 className="mt-3 max-w-3xl text-[2.3rem] font-semibold leading-[1.02] text-[#1F2933] sm:text-[2.8rem]">
                    Profile Diagram Studio
                  </h2>
                  <p className="mt-5 max-w-2xl text-[15px] leading-8 text-[#667085] sm:text-base">
                    Upload profile Excel data, validate tree structure fields, generate canopy profile diagrams, and download image outputs. The editor keeps the approved 20 m minimum vertical scale and lets you refine profile assets directly on canvas.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {["Template", "Upload", "Validate", "Generate", "Edit", "Download"].map((chip) => (
                      <span key={chip} className="rounded-full border border-[#DDE5D5] bg-[#F6F8F4] px-4 py-2 text-sm font-semibold text-[#1F5E3B]">
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="bg-[#1F5E3B] p-7 text-white sm:p-9">
                  <p className="text-xs font-bold uppercase tracking-[0.28em] text-white/70">Profile Snapshot</p>
                  <div className="mt-6 grid gap-4">
                    <MetricTile label="Worksheets" value={String(sheetNames.length)} help="Detected after workbook inspection." />
                    <MetricTile label="Valid sheets" value={String(sheetNames.length)} help="Current UI treats detected sheets as render-ready." />
                    <MetricTile label="Outputs" value={result ? "Ready" : "Waiting"} help="ZIP output unlocks after rendering." />
                  </div>
                </div>
              </div>
            </section>

            <SectionCard
              description="Download and use the official profile workbook format before preparing canopy profile data."
              eyebrow="Step 1"
              id="download-template"
              title="Download profile template"
            >
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="rounded-[28px] border border-[#DDE5D5] bg-[#F6F8F4] p-5">
                  <p className="text-sm leading-7 text-[#667085]">
                    Use the Profile Template when preparing profile diagram worksheets. This page focuses only on profile rendering outputs.
                  </p>
                </div>
                <DownloadButton onClick={() => window.open(`${API_BASE_URL}/api/profile/template`, "_blank", "noopener,noreferrer")}>
                  Download Profile Template
                </DownloadButton>
              </div>
            </SectionCard>

            <SectionCard
              description="Upload a completed profile workbook in .xlsx format. File details appear immediately after upload."
              eyebrow="Step 2"
              id="upload-profile-workbook"
              title="Upload profile workbook"
            >
              <UploadCard
                dragActive={dragActive}
                emptyTitle="Drop profile workbook here"
                file={workbookFile}
                helper="Upload a completed .xlsx file based on the profile template."
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
              {workbookFile && (
                <button className="mt-5 rounded-full border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-100" type="button" onClick={clearCurrentWorkspace}>
                  Clear Profile workspace
                </button>
              )}
              {(message || error) && <Notice tone={error ? "error" : "success"}>{error ?? message}</Notice>}
            </SectionCard>

            <SectionCard
              description="Review worksheet count and required structure fields before starting the rendering step."
              eyebrow="Step 3"
              id="validate-profile-sheets"
              title="Validate profile sheets"
            >
              <div className="grid gap-4 md:grid-cols-3">
                <MetricTile label="Detected worksheets" value={String(sheetNames.length)} help="Count returned by the inspect API." />
                <MetricTile label="Valid sheets" value={String(sheetNames.length)} help="Detected sheets are treated as valid at the UI layer." />
                <MetricTile
                  label="Invalid sheets"
                  value={error ? "Check warning" : 0}
                  help={error ? "Review the current workbook warning before rendering." : "No per-sheet invalid list is returned by the current API."}
                />
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-[30px] border border-[#DDE5D5] bg-[#F6F8F4] p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#667085]">Required columns</p>
                  <div className="mt-4 grid gap-2">
                    {requiredColumns.map((column) => (
                      <div key={column} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-[#DDE5D5]">
                        <span className="font-semibold text-[#1F2933]">{column}</span>
                        <span className="rounded-full bg-[#F1F7EE] px-3 py-1 text-xs font-bold text-[#1F5E3B]">required</span>
                      </div>
                    ))}
                  </div>
                </div>
                <WorksheetList emptyText="Upload a profile workbook to inspect worksheet names." sheetNames={sheetNames} />
              </div>

              {workbookFile && sheetNames.length === 0 && !inspectBusy && (
                <Notice tone="warning">No valid worksheet names were detected. Confirm that the workbook follows the official profile template.</Notice>
              )}
            </SectionCard>

            <SectionCard
              dark
              description="Rendering uses the existing profile API and stays focused on canopy profile diagrams only."
              eyebrow="Step 4"
              id="generate-profile-diagrams"
              title="Generate profile diagrams"
            >
              <div className="mb-5 grid gap-3 md:grid-cols-2">
                <button
                  className={`rounded-3xl border p-5 text-left transition ${
                    renderMode === "graphic"
                      ? "border-white bg-white text-[#1F5E3B] shadow-[0_12px_30px_rgba(0,0,0,0.16)]"
                      : "border-white/30 bg-white/10 text-white hover:bg-white/15"
                  }`}
                  type="button"
                  onClick={() => handleRenderModeChange("graphic")}
                >
                  <span className="block text-sm font-bold">Data graphic</span>
                  <span className={`mt-1 block text-sm leading-6 ${renderMode === "graphic" ? "text-[#55705F]" : "text-white/75"}`}>
                    Color-coded canopies make species, crown size, and surveyed positions easy to compare.
                  </span>
                </button>
                <button
                  className={`rounded-3xl border p-5 text-left transition ${
                    renderMode === "realistic"
                      ? "border-white bg-white text-[#1F5E3B] shadow-[0_12px_30px_rgba(0,0,0,0.16)]"
                      : "border-white/30 bg-white/10 text-white hover:bg-white/15"
                  }`}
                  type="button"
                  onClick={() => handleRenderModeChange("realistic")}
                >
                  <span className="block text-sm font-bold">Illustrated forest</span>
                  <span className={`mt-1 block text-sm leading-6 ${renderMode === "realistic" ? "text-[#55705F]" : "text-white/75"}`}>
                    Tree crowns, trunks, branches, and a measurement grid create a report-ready forest scene.
                  </span>
                </button>
              </div>
              <button
                className="inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-4 text-sm font-bold text-[#1F5E3B] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!canRender}
                type="button"
                onClick={handleCalculate}
              >
                {busy ? "Creating profile diagrams..." : `Create ${renderMode === "graphic" ? "data graphic" : "illustrated forest"} diagrams`}
              </button>
              {!canRender && <Notice tone="warning">Upload a valid profile workbook and wait for inspection before rendering diagrams.</Notice>}
              {result && <Notice tone="success">Profile diagrams generated successfully. Review them below or download the ZIP package.</Notice>}
            </SectionCard>

            <SectionCard
              description="Preview one rendered diagram per worksheet. Use the PNG button on each card if you want a single image."
              eyebrow="Step 5"
              id="profile-gallery"
              title="Review profile gallery"
            >
              {result ? (
                <div className="grid gap-6 xl:grid-cols-2">
                  {result.images.map((image) => (
                    <article key={image.filename} className="rounded-[30px] border border-[#DDE5D5] bg-[#F6F8F4] p-4">
                      <div className="flex flex-col gap-3 px-2 pb-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#667085]">Worksheet</p>
                          <h3 className="mt-1 text-[1.3rem] font-semibold text-[#1F2933]">{image.sheetName}</h3>
                        </div>
                        <button
                          className="rounded-full border border-[#DDE5D5] bg-white px-4 py-2 text-sm font-semibold text-[#1F5E3B]"
                          type="button"
                          onClick={() => downloadFile({ filename: image.filename, contentBase64: image.contentBase64 }, "image/png")}
                        >
                          Download PNG
                        </button>
                      </div>
                      <img
                        alt={`Profile diagram for ${image.sheetName}`}
                        className="w-full rounded-[24px] border border-[#DDE5D5] bg-white object-cover"
                        src={`data:image/png;base64,${image.contentBase64}`}
                      />
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState title="No diagrams generated yet" body="Generate profile diagrams to preview one image card per worksheet." />
              )}
              {result && (
                <section className="mt-6 rounded-[28px] border border-[#DDE5D5] bg-[#F1F7EE] p-6">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#6A8F5D]">Direct canvas editing</p>
                      <h3 className="mt-2 text-xl font-semibold text-[#1F2933]">Refine the first branch and crown</h3>
                      <p className="mt-2 max-w-3xl text-sm leading-7 text-[#55705F]">
                        Open the editor after reviewing the rendered diagrams. Drag a crown or first branch, resize from a corner, rotate the branch, undo with Ctrl+Z, then export a clean JPEG.
                      </p>
                    </div>
                    <a
                      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#1F5E3B] px-6 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5"
                        href="/profile-editor/index.html"
                    >
                      Open Profile Editor
                    </a>
                  </div>
                </section>
              )}
            </SectionCard>

            <SectionCard
              action={
                <div className="w-full sm:w-72">
                  <DownloadButton disabled={!result} onClick={() => result && downloadFile(result.download, "application/zip")}>
                    Download all profile diagrams as ZIP
                  </DownloadButton>
                </div>
              }
              description="Export all rendered diagrams as one ZIP package after generation completes."
              eyebrow="Step 6"
              id="download-profile-outputs"
              title="Download profile outputs"
            >
              {result ? (
                <div className="grid gap-4 md:grid-cols-3">
                  <MetricTile label="Worksheet outputs" value={String(result.images.length)} help="One rendered image per worksheet." />
                  <MetricTile label="ZIP package" value="Ready" help="Includes all generated profile diagrams." />
                  <MetricTile label="Current workbook" value={workbookFile?.name ?? "Ready"} help="Source workbook used for this render." />
                </div>
              ) : (
                <div className="space-y-4">
                  <DownloadButton disabled onClick={() => undefined}>
                    Download all profile diagrams as ZIP
                  </DownloadButton>
                  <EmptyState title="No profile outputs yet" body="Generate profile diagrams first to unlock the ZIP download." />
                </div>
              )}
            </SectionCard>
          </div>

          <div className="xl:block">
            <StatusPanel
              description="Short snapshot of profile worksheet readiness and rendered output availability."
              error={error}
              items={statusItems}
              message={message}
              title="Profile Snapshot"
            />
          </div>
        </div>
      </div>
    </main>
  );
}
