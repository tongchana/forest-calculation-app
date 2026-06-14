"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, useRef, useState } from "react";
import { API_BASE_URL, describeApiError } from "@/app/lib/api-base";

type DownloadPayload = {
  filename: string;
  contentBase64: string;
};

type ProfileImage = {
  sheetName: string;
  filename: string;
  contentBase64: string;
};

type ProfileResponse = {
  sheetNames: string[];
  images: ProfileImage[];
  download: DownloadPayload;
};

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

function ProfileStep({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[26px] border border-emerald-950/8 bg-white/80 p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-950 font-semibold text-white">
          {number}
        </div>
        <div>
          <p className="font-display text-2xl text-emerald-950">{title}</p>
          <p className="mt-2 text-sm leading-7 text-slate-600">{body}</p>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [result, setResult] = useState<ProfileResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setWorkbookFile(file);
    setResult(null);
    setError(null);
    setMessage(null);
    if (!file) {
      setSheetNames([]);
      return;
    }
    void inspectWorkbook(file);
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

  async function handleCalculate() {
    if (!workbookFile) {
      setError("Upload a completed profile workbook first.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    const formData = new FormData();
    formData.append("file", workbookFile);

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile/calculate`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ detail: "Profile calculation failed." }));
        throw new Error(data.detail ?? "Profile calculation failed.");
      }
      const data = (await response.json()) as ProfileResponse;
      setResult(data);
      setMessage(`Generated ${data.images.length} profile diagram(s).`);
    } catch (calcError) {
      setResult(null);
      setError(describeApiError(calcError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(55,133,84,0.18),_transparent_23%),radial-gradient(circle_at_85%_10%,_rgba(233,164,74,0.17),_transparent_19%),linear-gradient(180deg,_#0b1a12_0%,_#11291e_18%,_#f4f7f1_18%,_#fbfcf8_100%)] text-slate-900">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 pb-16 pt-5 sm:px-6 lg:px-8">
        <header className="rounded-[28px] border border-white/10 bg-[rgba(10,31,22,0.82)] px-5 py-4 shadow-[0_24px_70px_rgba(4,19,12,0.24)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
                <div className="h-6 w-6 rounded-full bg-[radial-gradient(circle_at_40%_35%,#a6e063_0%,#57ae43_45%,#255f33_100%)]" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.32em] text-emerald-100/68">Profile Diagram Studio</p>
                <h1 className="font-display text-2xl text-white sm:text-3xl">Workbook to canopy profile</h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                className="rounded-full border border-white/12 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/16"
                href={`${API_BASE_URL}/api/profile/template`}
              >
                Download profile template
              </a>
              <Link
                className="rounded-full border border-white/12 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/16"
                href="/"
              >
                Biomass workspace
              </Link>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <article className="glass-panel overflow-hidden px-6 py-7 sm:px-8 sm:py-9">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(255,255,255,0.16),transparent_24%),radial-gradient(circle_at_100%_0%,rgba(249,190,92,0.18),transparent_22%)]" />
            <div className="relative z-10">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100/70">Separate from biomass</p>
              <h2 className="mt-4 max-w-4xl font-display text-5xl leading-[0.92] tracking-[-0.05em] text-white sm:text-6xl">
                Fill the template, upload the workbook, and generate one profile diagram per sheet.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-8 text-emerald-50/82">
                This page is only for profile diagrams. It does not run biomass, volume, IVI, or Shannon calculations, so users can stay focused on crown position and height profiles.
              </p>

              <div className="mt-7 grid gap-4 sm:grid-cols-3">
                <ProfileStep
                  number="01"
                  title="Template"
                  body="Download the profile workbook template based on your source file. It keeps only the header rows."
                />
                <ProfileStep
                  number="02"
                  title="Sheets"
                  body="Add or duplicate sheets in Excel as needed. Every sheet with the same template structure will be processed."
                />
                <ProfileStep
                  number="03"
                  title="Render"
                  body="Upload the workbook and the app will generate separate profile diagrams for each sheet."
                />
              </div>
            </div>
          </article>

          <article className="rounded-[32px] border border-emerald-950/8 bg-white/84 p-6 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Profile workflow</p>
            <h3 className="mt-3 font-display text-3xl text-emerald-950">Upload completed profile workbook</h3>
            <p className="mt-3 text-sm leading-8 text-slate-600">
              Use the profile template only. Fill each sheet with `Species`, `Height`, `Position`, and `Crown cover` values, then upload the workbook here.
            </p>

            <label
              className={`mt-7 flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed px-6 text-center transition ${
                dragActive
                  ? "border-emerald-600 bg-emerald-50"
                  : "border-emerald-950/14 bg-[#f8fbf7] hover:border-emerald-400 hover:bg-emerald-50"
              }`}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <input ref={fileInputRef} accept=".xlsx" className="hidden" type="file" onChange={handleFileChange} />
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-950 text-xl text-white">+</div>
              <p className="mt-5 font-display text-3xl text-emerald-950">
                {workbookFile ? workbookFile.name : "Drop profile workbook here"}
              </p>
              <p className="mt-3 max-w-md text-sm leading-7 text-slate-600">
                {workbookFile
                  ? "Workbook connected. We will inspect every sheet before rendering."
                  : "Upload a completed .xlsx file based on the profile template."}
              </p>
              <button
                className="mt-6 rounded-full bg-emerald-950 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }}
              >
                Choose workbook
              </button>
            </label>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[24px] bg-[#f7fbf7] p-5 ring-1 ring-emerald-950/6">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Inspection</p>
                <p className="mt-2 font-display text-2xl text-emerald-950">
                  {inspectBusy ? "Reading sheets..." : workbookFile ? "Workbook ready" : "Waiting for file"}
                </p>
              </div>
              <div className="rounded-[24px] bg-[#f7fbf7] p-5 ring-1 ring-emerald-950/6">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Detected sheets</p>
                <p className="mt-2 font-display text-2xl text-emerald-950">{sheetNames.length}</p>
              </div>
            </div>

            {(message || error) && (
              <div
                className={`mt-6 rounded-[24px] border px-5 py-4 text-sm leading-8 ${
                  error
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}
              >
                {error ?? message}
              </div>
            )}

            {sheetNames.length > 0 && (
              <div className="mt-6 rounded-[24px] border border-emerald-950/8 bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Sheets to render</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {sheetNames.map((sheetName) => (
                    <span
                      key={sheetName}
                      className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-950 ring-1 ring-emerald-100"
                    >
                      {sheetName}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button
              className="mt-7 inline-flex w-full items-center justify-center rounded-full bg-emerald-950 px-6 py-4 text-sm font-semibold text-white shadow-lg shadow-emerald-950/20 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={busy || !workbookFile}
              type="button"
              onClick={handleCalculate}
            >
              {busy ? "Rendering profile diagrams..." : "Generate profile diagrams"}
            </button>
          </article>
        </section>

        <section className="rounded-[34px] border border-emerald-950/8 bg-white/86 p-6 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Result gallery</p>
              <h3 className="mt-3 font-display text-3xl text-emerald-950">One output per worksheet</h3>
              <p className="mt-3 max-w-3xl text-sm leading-8 text-slate-600">
                Every sheet that follows the template will render its own diagram. Download all results together as a zip file after review.
              </p>
            </div>
            <button
              className="inline-flex items-center justify-center rounded-full bg-emerald-950 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!result}
              type="button"
              onClick={() =>
                result &&
                downloadFile(result.download, "application/zip")
              }
            >
              Download all profile diagrams
            </button>
          </div>

          {result ? (
            <div className="mt-8 grid gap-6 xl:grid-cols-2">
              {result.images.map((image) => (
                <article key={image.filename} className="rounded-[30px] border border-emerald-950/8 bg-[#fbfdf9] p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-4 px-2 pb-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Worksheet</p>
                      <h4 className="mt-2 font-display text-2xl text-emerald-950">{image.sheetName}</h4>
                    </div>
                    <button
                      className="rounded-full border border-emerald-950/10 bg-white px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:-translate-y-0.5"
                      type="button"
                      onClick={() =>
                        downloadFile(
                          { filename: image.filename, contentBase64: image.contentBase64 },
                          "image/png",
                        )
                      }
                    >
                      Download PNG
                    </button>
                  </div>
                  <img
                    alt={`Profile diagram for ${image.sheetName}`}
                    className="w-full rounded-[24px] border border-emerald-950/8 bg-white object-cover"
                    src={`data:image/png;base64,${image.contentBase64}`}
                  />
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-8 rounded-[28px] border border-dashed border-emerald-950/12 bg-[#f7faf7] p-10 text-center">
              <p className="font-display text-2xl text-emerald-950">No profile diagrams yet</p>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-8 text-slate-600">
                Upload a completed profile workbook and run the renderer to preview each sheet here.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
