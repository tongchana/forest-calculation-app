import Link from "next/link";
import { ChangeEvent, DragEvent, ReactNode, RefObject } from "react";

export type WorkflowState = "complete" | "active" | "disabled";

export type WorkflowStep = {
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

export function AppHeader({
  eyebrow,
  title,
  subtitle,
  primaryAction,
  links,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryAction?: ResourceLink;
  links: ResourceLink[];
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
            <h1 className="mt-1 font-display text-3xl leading-tight text-[#1F2933] sm:text-4xl">{title}</h1>
            <p className="mt-1 text-sm text-[#667085]">{subtitle}</p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {links.map((link) =>
            link.external ? (
              <a
                key={link.label}
                className="rounded-full border border-[#DDE5D5] bg-[#F6F8F4] px-4 py-2.5 text-[#1F5E3B] transition hover:-translate-y-0.5 hover:border-[#6A8F5D]"
                href={link.href}
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.label}
                className="rounded-full border border-[#DDE5D5] bg-[#F6F8F4] px-4 py-2.5 text-[#1F5E3B] transition hover:-translate-y-0.5 hover:border-[#6A8F5D]"
                href={link.href}
              >
                {link.label}
              </Link>
            ),
          )}
          {primaryAction &&
            (primaryAction.external ? (
              <a className="rounded-full bg-[#1F5E3B] px-5 py-2.5 text-white shadow-lg shadow-[#1F5E3B]/20" href={primaryAction.href}>
                {primaryAction.label}
              </a>
            ) : (
              <Link className="rounded-full bg-[#1F5E3B] px-5 py-2.5 text-white shadow-lg shadow-[#1F5E3B]/20" href={primaryAction.href}>
                {primaryAction.label}
              </Link>
            ))}
        </nav>
      </div>
    </header>
  );
}

export function SidebarWorkflow({ title, steps, resources }: { title: string; steps: WorkflowStep[]; resources: ResourceLink[] }) {
  return (
    <aside className="rounded-[30px] border border-[#DDE5D5] bg-white p-5 shadow-[0_18px_60px_rgba(31,94,59,0.06)] lg:sticky lg:top-5">
      <p className="text-xs font-bold uppercase tracking-[0.26em] text-[#6A8F5D]">{title}</p>
      <div className="mt-5 space-y-3">
        {steps.map((step, index) => (
          <div
            key={step.title}
            className={`rounded-3xl border p-4 ${
              step.state === "complete"
                ? "border-[#BFD5B4] bg-[#F1F7EE]"
                : step.state === "active"
                  ? "border-[#D8A948] bg-[#FFF8E6]"
                  : "border-[#DDE5D5] bg-[#F6F8F4]"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ${
                  step.state === "disabled" ? "bg-white text-[#667085]" : "bg-[#1F5E3B] text-white"
                }`}
              >
                {index + 1}
              </span>
              <div>
                <p className="font-semibold text-[#1F2933]">{step.title}</p>
                <p className="mt-1 text-xs leading-5 text-[#667085]">{step.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-3xl border border-[#DDE5D5] bg-[#F6F8F4] p-4">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#6A8F5D]">Resources</p>
        <div className="mt-3 grid gap-2">
          {resources.map((resource) =>
            resource.external ? (
              <a key={resource.label} className="text-sm font-semibold text-[#1F5E3B] hover:underline" href={resource.href}>
                {resource.label}
              </a>
            ) : (
              <Link key={resource.label} className="text-sm font-semibold text-[#1F5E3B] hover:underline" href={resource.href}>
                {resource.label}
              </Link>
            ),
          )}
        </div>
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
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  dark?: boolean;
}) {
  return (
    <section
      className={`rounded-[34px] border p-6 shadow-[0_22px_70px_rgba(31,94,59,0.07)] sm:p-7 ${
        dark ? "border-[#1F5E3B] bg-[#1F5E3B] text-white" : "border-[#DDE5D5] bg-white text-[#1F2933]"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={`text-xs font-bold uppercase tracking-[0.26em] ${dark ? "text-[#D8E8D1]" : "text-[#6A8F5D]"}`}>{eyebrow}</p>
          <h2 className={`mt-2 font-display text-3xl leading-tight ${dark ? "text-white" : "text-[#1F2933]"}`}>{title}</h2>
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
      <p className="mt-5 font-display text-3xl text-[#1F2933]">{file ? file.name : emptyTitle}</p>
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
    <aside className="rounded-[30px] border border-[#DDE5D5] bg-white p-5 shadow-[0_18px_60px_rgba(31,94,59,0.06)] lg:sticky lg:top-5">
      <p className="text-xs font-bold uppercase tracking-[0.26em] text-[#6A8F5D]">Status</p>
      <h2 className="mt-2 font-display text-3xl text-[#1F2933]">{title}</h2>
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
      <p className="font-display text-2xl text-[#1F2933]">{title}</p>
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

export function MetricTile({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <article className="rounded-3xl border border-[#DDE5D5] bg-[#F6F8F4] p-5">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#667085]">{label}</p>
      <p className="mt-3 font-display text-3xl text-[#1F2933]">{value}</p>
      {help && <p className="mt-2 text-sm leading-6 text-[#667085]">{help}</p>}
    </article>
  );
}
