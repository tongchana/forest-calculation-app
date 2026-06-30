"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, ReactNode, RefObject, useEffect, useRef, useState } from "react";

export type WorkflowState = "complete" | "active" | "disabled";

export type WorkflowStep = {
  id: string;
  title: string;
  body: string;
  state: WorkflowState;
};

export type ResourceLink = {
  label: string;
  href: string;
  external?: boolean;
};

export type StatusItem = {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warning" | "danger";
};

function ResourceAnchor({
  className,
  link,
  onClick,
}: {
  className: string;
  link: ResourceLink;
  onClick?: () => void;
}) {
  if (link.external) {
    return (
      <a className={className} href={link.href} onClick={onClick}>
        {link.label}
      </a>
    );
  }

  return (
    <Link className={className} href={link.href} onClick={onClick}>
      {link.label}
    </Link>
  );
}

function TemplateMenu({ links }: { links: ResourceLink[] }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-2 rounded-full border border-[#DDE5D5] bg-[#F6F8F4] px-4 py-2.5 text-[#1F5E3B] transition hover:-translate-y-0.5 hover:border-[#6A8F5D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F5E3B]"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        Template
        <span className={`text-xs transition ${open ? "rotate-180" : ""}`}>v</span>
      </button>
      {open && (
        <div
          className="absolute right-0 z-30 mt-2 min-w-56 overflow-hidden rounded-3xl border border-[#DDE5D5] bg-white p-2 shadow-[0_22px_60px_rgba(31,94,59,0.14)]"
          role="menu"
        >
          {links.map((link) => (
            <ResourceAnchor
              key={link.label}
              className="flex w-full items-center rounded-2xl px-4 py-3 text-left text-sm font-semibold text-[#1F2933] transition hover:bg-[#F6F8F4] hover:text-[#1F5E3B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F5E3B]"
              link={link}
              onClick={() => setOpen(false)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AppHeader({
  eyebrow,
  title,
  subtitle,
  primaryAction,
  links,
  templateLinks,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryAction?: ResourceLink;
  links: ResourceLink[];
  templateLinks: ResourceLink[];
}) {
  return (
    <header className="rounded-[32px] border border-[#DDE5D5] bg-white px-5 py-4 shadow-[0_18px_60px_rgba(31,94,59,0.08)] sm:px-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-13 w-13 items-center justify-center rounded-3xl bg-[#1F5E3B] shadow-inner">
            <div className="h-7 w-7 rounded-[60%_40%_55%_45%] bg-[#D8A948]" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#6A8F5D]">{eyebrow}</p>
            <h1 className="mt-1 text-[1.85rem] font-semibold leading-tight text-[#1F2933] sm:text-[2.2rem]">{title}</h1>
            <p className="mt-1 text-sm text-[#667085]">{subtitle}</p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <TemplateMenu links={templateLinks} />
          {links.map((link) => (
            <ResourceAnchor
              key={link.label}
              className="rounded-full border border-[#DDE5D5] bg-[#F6F8F4] px-4 py-2.5 text-[#1F5E3B] transition hover:-translate-y-0.5 hover:border-[#6A8F5D]"
              link={link}
            />
          ))}
          {primaryAction && (
            <ResourceAnchor
              className="rounded-full bg-[#1F5E3B] px-5 py-2.5 text-white shadow-lg shadow-[#1F5E3B]/20 transition hover:-translate-y-0.5"
              link={primaryAction}
            />
          )}
        </nav>
      </div>
    </header>
  );
}

export function SidebarWorkflow({
  title,
  steps,
  activeStepId,
}: {
  title: string;
  steps: WorkflowStep[];
  activeStepId: string;
}) {
  function scrollToSection(sectionId: string) {
    const target = document.getElementById(sectionId);
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `#${sectionId}`);
  }

  return (
    <aside className="rounded-[30px] border border-[#DDE5D5] bg-white p-5 shadow-[0_18px_60px_rgba(31,94,59,0.06)] lg:sticky lg:top-6 lg:self-start">
      <p className="text-xs font-bold uppercase tracking-[0.26em] text-[#6A8F5D]">{title}</p>
      <div className="mt-5 space-y-3">
        {steps.map((step, index) => {
          const isActive = step.id === activeStepId;
          const isComplete = step.state === "complete";
          const isDisabled = step.state === "disabled";

          return (
            <button
              key={step.id}
              className={`w-full rounded-3xl border p-4 text-left transition ${
                isActive
                  ? "border-[#1F5E3B] bg-[#EAF2E7] shadow-[0_14px_38px_rgba(31,94,59,0.10)]"
                  : isComplete
                    ? "border-[#BFD5B4] bg-[#F1F7EE]"
                    : isDisabled
                      ? "border-[#DDE5D5] bg-[#F6F8F4] opacity-75"
                      : "border-[#E6D3A4] bg-[#FFF8E6] hover:border-[#D8A948]"
              }`}
              type="button"
              onClick={() => scrollToSection(step.id)}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ${
                    isActive || isComplete ? "bg-[#1F5E3B] text-white" : "bg-white text-[#667085]"
                  }`}
                >
                  {index + 1}
                </span>
                <div>
                  <p className="font-semibold text-[#1F2933]">{step.title}</p>
                  <p className="mt-1 text-xs leading-5 text-[#667085]">{step.body}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export function SectionCard({
  eyebrow,
  title,
  description,
  children,
  action,
  dark = false,
  id,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  dark?: boolean;
  id?: string;
}) {
  return (
    <section
      className={`scroll-mt-28 rounded-[34px] border p-6 shadow-[0_22px_70px_rgba(31,94,59,0.07)] sm:p-7 ${
        dark ? "border-[#1F5E3B] bg-[#1F5E3B] text-white" : "border-[#DDE5D5] bg-white text-[#1F2933]"
      }`}
      id={id}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={`text-xs font-bold uppercase tracking-[0.26em] ${dark ? "text-[#D8E8D1]" : "text-[#6A8F5D]"}`}>{eyebrow}</p>
          <h2 className={`mt-2 text-[1.7rem] font-semibold leading-tight ${dark ? "text-white" : "text-[#1F2933]"} sm:text-[2rem]`}>{title}</h2>
          {description && <p className={`mt-2 max-w-3xl text-sm leading-7 ${dark ? "text-white/78" : "text-[#667085]"}`}>{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function UploadCard({
  file,
  dragActive,
  inspectBusy,
  helper,
  emptyTitle,
  inputRef,
  onFileChange,
  onDrop,
  onDragOver,
  onDragLeave,
}: {
  file: File | null;
  dragActive: boolean;
  inspectBusy: boolean;
  helper: string;
  emptyTitle: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onDragOver: (event: DragEvent<HTMLLabelElement>) => void;
  onDragLeave: (event: DragEvent<HTMLLabelElement>) => void;
}) {
  return (
    <label
      className={`flex min-h-72 cursor-pointer flex-col items-center justify-center rounded-[30px] border border-dashed px-6 py-8 text-center transition ${
        dragActive ? "border-[#1F5E3B] bg-[#F1F7EE]" : "border-[#BFD5B4] bg-[#F6F8F4] hover:border-[#6A8F5D]"
      }`}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <input ref={inputRef} accept=".xlsx" className="hidden" type="file" onChange={onFileChange} />
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1F5E3B] text-2xl font-light text-white">+</div>
      <p className="mt-5 text-[1.35rem] font-semibold text-[#1F2933] sm:text-[1.5rem]">{file ? file.name : emptyTitle}</p>
      <p className="mt-3 max-w-lg text-sm leading-7 text-[#667085]">{file ? "Workbook connected and ready for inspection." : helper}</p>
      {file && (
        <div className="mt-4 rounded-full border border-[#DDE5D5] bg-white px-4 py-2 text-xs font-semibold text-[#667085]">
          {(file.size / 1024 / 1024).toFixed(2)} MB | .xlsx | {inspectBusy ? "Inspecting" : "Uploaded"}
        </div>
      )}
      <button
        className="mt-6 rounded-full bg-[#1F5E3B] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
        type="button"
        onClick={(event) => {
          event.preventDefault();
          inputRef.current?.click();
        }}
      >
        Choose workbook
      </button>
    </label>
  );
}

export function StatusPanel({
  title,
  description,
  items,
  message,
  error,
}: {
  title: string;
  description: string;
  items: StatusItem[];
  message?: string | null;
  error?: string | null;
}) {
  return (
    <aside className="rounded-[30px] border border-[#DDE5D5] bg-white p-5 shadow-[0_18px_60px_rgba(31,94,59,0.06)] xl:sticky xl:top-6 xl:self-start">
      <p className="text-xs font-bold uppercase tracking-[0.26em] text-[#6A8F5D]">Status</p>
      <h2 className="mt-2 text-[1.7rem] font-semibold text-[#1F2933]">{title}</h2>
      <p className="mt-2 text-sm leading-7 text-[#667085]">{description}</p>
      <div className="mt-5 space-y-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-3xl border border-[#DDE5D5] bg-[#F6F8F4] p-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#667085]">{item.label}</p>
            <p
              className={`mt-2 text-xl font-semibold ${
                item.tone === "danger"
                  ? "text-red-700"
                  : item.tone === "warning"
                    ? "text-[#9A6B00]"
                    : item.tone === "success"
                      ? "text-[#1F5E3B]"
                      : "text-[#1F2933]"
              }`}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>
      {(message || error) && <Notice tone={error ? "error" : "success"}>{error ?? message}</Notice>}
    </aside>
  );
}

export function Notice({ children, tone }: { children: ReactNode; tone: "success" | "error" | "warning" }) {
  const classes =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "warning"
        ? "border-[#F3DFA3] bg-[#FFF8E6] text-[#7A5600]"
        : "border-[#BFD5B4] bg-[#F1F7EE] text-[#1F5E3B]";

  return <div className={`mt-5 rounded-3xl border px-5 py-4 text-sm leading-7 ${classes}`}>{children}</div>;
}

export function WorksheetList({ sheetNames, emptyText }: { sheetNames: string[]; emptyText: string }) {
  if (sheetNames.length === 0) {
    return <EmptyState title="No worksheets detected" body={emptyText} />;
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {sheetNames.map((sheetName) => (
        <div key={sheetName} className="flex items-center justify-between gap-3 rounded-2xl border border-[#DDE5D5] bg-[#F6F8F4] px-4 py-3">
          <span className="truncate text-sm font-semibold text-[#1F2933]">{sheetName}</span>
          <span className="shrink-0 rounded-full bg-[#F1F7EE] px-3 py-1 text-xs font-bold text-[#1F5E3B]">ready</span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[28px] border border-dashed border-[#BFD5B4] bg-[#F6F8F4] p-8 text-center">
      <p className="text-2xl font-semibold text-[#1F2933]">{title}</p>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-7 text-[#667085]">{body}</p>
    </div>
  );
}

export function DownloadButton({
  children,
  disabled,
  onClick,
  variant = "primary",
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      className={`inline-flex w-full items-center justify-center rounded-2xl px-5 py-4 text-sm font-semibold transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 ${
        variant === "primary" ? "bg-[#1F5E3B] text-white shadow-lg shadow-[#1F5E3B]/16" : "border border-[#DDE5D5] bg-white text-[#1F5E3B]"
      }`}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function MetricTile({ label, value, help }: { label: string; value: string | number; help?: string }) {
  return (
    <article className="rounded-3xl border border-[#DDE5D5] bg-[#F6F8F4] p-5 shadow-[0_14px_34px_rgba(31,94,59,0.04)]">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#667085]">{label}</p>
      <p className="mt-3 break-words text-[2rem] font-semibold leading-tight tabular-nums text-[#1F2933]">{value}</p>
      {help && <p className="mt-2 text-sm leading-6 text-[#667085]">{help}</p>}
    </article>
  );
}
