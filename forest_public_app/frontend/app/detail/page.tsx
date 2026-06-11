import Link from "next/link";

export default function DetailPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#0a1f17_0%,#10281d_35%,#eef5ef_35%,#f8fbf8_100%)] text-slate-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <div className="rounded-[28px] border border-white/10 bg-[rgba(8,31,22,0.88)] px-5 py-4 text-white shadow-[0_20px_60px_rgba(4,19,12,0.18)] backdrop-blur">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-100/70">Calculation detail</p>
              <h1 className="font-display text-3xl">Calculation notes</h1>
            </div>
            <Link
              className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-emerald-950 transition hover:-translate-y-0.5"
              href="/"
            >
              Back to workspace
            </Link>
          </div>
        </div>

        <section className="rounded-[32px] border border-emerald-950/8 bg-white/88 p-8 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Placeholder</p>
          <h2 className="mt-4 font-display text-4xl text-emerald-950">Calculation explanation will go here.</h2>
          <p className="mt-4 max-w-3xl text-sm leading-8 text-slate-600">
            This page is reserved for explaining the calculation workflow, formulas, and result interpretation. Content can be added later.
          </p>
        </section>
      </div>
    </main>
  );
}
