import Link from "next/link";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "workflow", label: "Workflow" },
  { id: "inputs", label: "Inputs" },
  { id: "biomass", label: "Biomass" },
  { id: "volume", label: "Volume" },
  { id: "ba", label: "BA" },
  { id: "tq", label: "TQ" },
  { id: "ivi", label: "IVI" },
  { id: "shannon", label: "Shannon" },
  { id: "components", label: "Components" },
  { id: "outputs", label: "Outputs" },
  { id: "notes", label: "Notes" },
] as const;

function SectionTitle({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">{kicker}</p>
      <h2 className="font-display text-4xl text-emerald-950">{title}</h2>
      <p className="max-w-3xl text-sm leading-8 text-slate-600">{body}</p>
    </div>
  );
}

function FormulaCard({
  title,
  formula,
  notes,
  unit,
}: {
  title: string;
  formula: string;
  notes: string;
  unit: string;
}) {
  return (
    <article className="rounded-[28px] border border-emerald-950/8 bg-[linear-gradient(180deg,#fbfefb,#f3f8f4)] p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{title}</p>
      <div className="mt-4 rounded-[22px] bg-[#0f2c1f] px-5 py-4 font-display text-2xl text-emerald-50">
        {formula}
      </div>
      <p className="mt-4 text-sm leading-8 text-slate-600">{notes}</p>
      <div className="mt-4 inline-flex rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900 ring-1 ring-emerald-950/8">
        Unit: {unit}
      </div>
    </article>
  );
}

export default function DetailPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(65,169,123,0.16),_transparent_18%),linear-gradient(180deg,#081a13_0%,#10281d_24%,#edf5ee_24%,#f8fbf8_100%)] text-slate-900">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 pb-20 pt-6 sm:px-6 lg:px-8">
        <section className="glass-panel overflow-hidden px-6 py-7 sm:px-8 sm:py-9">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(255,255,255,0.16),transparent_26%),radial-gradient(circle_at_100%_0%,rgba(255,191,92,0.16),transparent_24%)]" />
          <div className="relative z-10 flex flex-col gap-8">
            <div className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.32em] text-emerald-100/70">Calculation detail</p>
                <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-[-0.05em] text-white sm:text-6xl">
                  Understand how this forest calculation workflow turns workbook data into results.
                </h1>
                <p className="mt-4 max-w-3xl text-sm leading-8 text-emerald-50/82 sm:text-base">
                  This page explains what the tool reads, how each calculation block works, how grouped components are handled,
                  and what each workbook output means.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/16"
                  href="/"
                >
                  Back to workspace
                </Link>
                <a
                  className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-semibold text-emerald-950 transition hover:-translate-y-0.5"
                  href="#overview"
                >
                  Start reading
                </a>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[28px] border border-white/10 bg-white/8 p-5 text-white backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-100/60">What this page covers</p>
                <p className="mt-3 font-display text-2xl">Inputs</p>
                <p className="mt-2 text-sm leading-7 text-emerald-50/76">Workbook structure, plot settings, and grouped component behavior.</p>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-white/8 p-5 text-white backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-100/60">Main formulas</p>
                <p className="mt-3 font-display text-2xl">Biomass, volume, IVI</p>
                <p className="mt-2 text-sm leading-7 text-emerald-50/76">How the app calculates forest metrics and when values are summed.</p>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-white/8 p-5 text-white backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-100/60">Interpretation</p>
                <p className="mt-3 font-display text-2xl">Outputs</p>
                <p className="mt-2 text-sm leading-7 text-emerald-50/76">How to read the dashboard, summary workbook, detail workbook, and component workbook.</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-[30px] border border-emerald-950/8 bg-white/88 p-5 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">On this page</p>
              <nav className="mt-4 flex flex-col gap-2">
                {sections.map((section) => (
                  <a
                    key={section.id}
                    className="rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-950"
                    href={`#${section.id}`}
                  >
                    {section.label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          <div className="flex flex-col gap-6">
            <section id="overview" className="rounded-[32px] border border-emerald-950/8 bg-white/88 p-8 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
              <SectionTitle
                kicker="Overview"
                title="What this tool does"
                body="The tool reads a completed survey workbook, validates worksheet structure, runs biomass, volume, IVI, Shannon, and related summaries, then generates downloadable Excel outputs and a web dashboard."
              />
              <div className="mt-8 grid gap-4 md:grid-cols-3">
                <div className="rounded-[24px] bg-[#f7fbf7] p-5 ring-1 ring-emerald-950/6">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Input</p>
                  <p className="mt-3 text-sm leading-7 text-slate-700">Completed workbook based on the official template, plus plot area settings.</p>
                </div>
                <div className="rounded-[24px] bg-[#f7fbf7] p-5 ring-1 ring-emerald-950/6">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Process</p>
                  <p className="mt-3 text-sm leading-7 text-slate-700">Read tree, sapling, seedling, and bamboo data, then calculate site-level and grouped summaries.</p>
                </div>
                <div className="rounded-[24px] bg-[#f7fbf7] p-5 ring-1 ring-emerald-950/6">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Output</p>
                  <p className="mt-3 text-sm leading-7 text-slate-700">Dashboard cards, summary workbook, detail workbook, and optional component workbook.</p>
                </div>
              </div>
            </section>

            <section id="workflow" className="rounded-[32px] border border-emerald-950/8 bg-white/88 p-8 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
              <SectionTitle
                kicker="Workflow"
                title="How one run moves through the system"
                body="A normal run follows a predictable order, from workbook upload to exported workbooks."
              />
              <div className="mt-8 grid gap-4">
                {[
                  "Upload the completed workbook.",
                  "Inspect worksheet names and workbook structure.",
                  "Create grouped components if some worksheets should be reported together.",
                  "Set plot area and rai-per-hectare values.",
                  "Run the calculation workflow.",
                  "Review the dashboard and preview tables.",
                  "Download the generated workbook files.",
                ].map((step, index) => (
                  <div key={step} className="flex gap-4 rounded-[24px] border border-emerald-950/8 bg-[#f8fbf8] p-5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 font-semibold text-emerald-950">
                      0{index + 1}
                    </div>
                    <p className="pt-1 text-sm leading-8 text-slate-700">{step}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="inputs" className="rounded-[32px] border border-emerald-950/8 bg-white/88 p-8 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
              <SectionTitle
                kicker="Inputs"
                title="What the calculation reads"
                body="The app depends on a completed workbook template and a few run parameters. The quality of these inputs determines the quality of the outputs."
              />
              <div className="mt-8 grid gap-4 md:grid-cols-2">
                <div className="rounded-[26px] bg-[#f7fbf7] p-6 ring-1 ring-emerald-950/6">
                  <h3 className="font-display text-2xl text-emerald-950">Workbook template</h3>
                  <ul className="mt-4 space-y-2 text-sm leading-8 text-slate-700">
                    <li>The workbook should follow the official template layout.</li>
                    <li>Tree, sapling, seedling, and bamboo data are read from the corresponding sheets.</li>
                    <li>Worksheet names stay visible after upload and can be grouped into components.</li>
                  </ul>
                </div>
                <div className="rounded-[26px] bg-[#f7fbf7] p-6 ring-1 ring-emerald-950/6">
                  <h3 className="font-display text-2xl text-emerald-950">Run parameters</h3>
                  <ul className="mt-4 space-y-2 text-sm leading-8 text-slate-700">
                    <li>`Plot area (ha)` controls area-based scaling.</li>
                    <li>`Rai per hectare` converts hectare-based values into rai-based outputs.</li>
                    <li>Default plot area is `0.100 ha`.</li>
                  </ul>
                </div>
              </div>
            </section>

            <section id="biomass" className="rounded-[32px] border border-emerald-950/8 bg-white/88 p-8 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
              <SectionTitle
                kicker="Biomass"
                title="Biomass calculation"
                body="Biomass is calculated at the record level first, then summed at the worksheet or component level."
              />
              <div className="mt-8 grid gap-4 lg:grid-cols-2">
                <FormulaCard
                  title="Per-tree biomass"
                  formula="Calculate each tree record first, then sum Ws, Wb, Wl, Wr, and total biomass."
                  notes="Tree biomass is not computed from a pre-summed worksheet total. Each tree contributes its own biomass values, and the workflow sums those record-level results into site totals."
                  unit="kg or summed biomass output units used in the workbook"
                />
                <FormulaCard
                  title="Belowground and carbon"
                  formula="Belowground biomass and carbon are derived from the biomass totals after tree-level aggregation."
                  notes="The app uses the total aboveground biomass result as the starting point for belowground biomass and carbon stock summaries in the component workbook and summary outputs."
                  unit="biomass / carbon output units"
                />
              </div>
            </section>

            <section id="volume" className="rounded-[32px] border border-emerald-950/8 bg-white/88 p-8 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
              <SectionTitle
                kicker="Volume"
                title="Volume calculation"
                body="Volume is calculated per matching record, then summed into worksheet and component totals."
              />
              <div className="mt-8 grid gap-4 lg:grid-cols-2">
                <FormulaCard
                  title="Tree volume"
                  formula="Apply the selected volume equation to each tree record, then sum total_volume_m3."
                  notes="The workflow does not sum DBH first and then calculate volume. It calculates volume at the tree level and aggregates those volumes afterward."
                  unit="m3"
                />
                <FormulaCard
                  title="Sapling volume"
                  formula="Apply the sapling volume logic per sapling record, then sum total_volume_m3."
                  notes="Sapling volume is handled in the same record-first manner. The total shown in summary outputs is the sum of per-record sapling volumes."
                  unit="m3"
                />
              </div>
            </section>

            <section id="ba" className="rounded-[32px] border border-emerald-950/8 bg-white/88 p-8 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
              <SectionTitle
                kicker="BA"
                title="Basal area (BA)"
                body="Basal area is calculated from tree size at the record level and then used inside the IVI and dominance calculations."
              />
              <div className="mt-8 rounded-[28px] bg-[#f7fbf7] p-6 ring-1 ring-emerald-950/6">
                <div className="rounded-[22px] bg-[#0f2c1f] px-5 py-4 font-display text-2xl text-emerald-50">
                  BA = p x (DBH / 2)^2
                </div>
                <p className="mt-4 text-sm leading-8 text-slate-700">
                  The app derives basal area from DBH, calculates it at the tree level, then sums BA for site-level summaries. That BA total later contributes to dominance and IVI.
                </p>
              </div>
            </section>

            <section id="tq" className="rounded-[32px] border border-emerald-950/8 bg-white/88 p-8 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
              <SectionTitle
                kicker="TQ"
                title="TQ volume summary"
                body="TQ is reported as grouped volume summaries by class after record-level volumes are already available."
              />
              <div className="mt-8 grid gap-4 md:grid-cols-2">
                <div className="rounded-[26px] bg-[#f7fbf7] p-6 ring-1 ring-emerald-950/6">
                  <h3 className="font-display text-2xl text-emerald-950">How it is built</h3>
                  <p className="mt-4 text-sm leading-8 text-slate-700">
                    The workflow first calculates volume per record, then groups those volumes into the TQ summary structure for each worksheet or component.
                  </p>
                </div>
                <div className="rounded-[26px] bg-[#f7fbf7] p-6 ring-1 ring-emerald-950/6">
                  <h3 className="font-display text-2xl text-emerald-950">Unit</h3>
                  <p className="mt-4 text-sm leading-8 text-slate-700">
                    TQ volume summaries are expressed in cubic meters and then scaled to area-based reporting where required by the workbook output.
                  </p>
                </div>
              </div>
            </section>

            <section id="ivi" className="rounded-[32px] border border-emerald-950/8 bg-white/88 p-8 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
              <SectionTitle
                kicker="IVI"
                title="Importance Value Index"
                body="IVI is derived from relative density, relative frequency, and relative dominance."
              />
              <div className="mt-8 grid gap-4 lg:grid-cols-2">
                <FormulaCard
                  title="Core formula"
                  formula="IVI = RDensity + RFrequency + RDominance"
                  notes="The app first summarizes species-level density, frequency, and dominance, converts them into relative values, then combines them into IVI."
                  unit="index value"
                />
                <FormulaCard
                  title="What feeds RDominance"
                  formula="RDominance is based on BA-derived dominance"
                  notes="Because BA is calculated before species-level dominance is summarized, IVI depends on both DBH-derived BA and species distribution in the worksheet."
                  unit="index contribution"
                />
              </div>
            </section>

            <section id="shannon" className="rounded-[32px] border border-emerald-950/8 bg-white/88 p-8 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
              <SectionTitle
                kicker="Shannon"
                title="Shannon index"
                body="The Shannon index summarizes species diversity after species proportions are computed."
              />
              <div className="mt-8 rounded-[28px] bg-[#f7fbf7] p-6 ring-1 ring-emerald-950/6">
                <div className="rounded-[22px] bg-[#0f2c1f] px-5 py-4 font-display text-2xl text-emerald-50">
                  H' = - sum (Pi x ln Pi)
                </div>
                <p className="mt-4 text-sm leading-8 text-slate-700">
                  The workflow calculates species proportions (`Pi`) from the worksheet or component totals, then uses those proportions to build the Shannon contribution and final Shannon index.
                </p>
              </div>
            </section>

            <section id="components" className="rounded-[32px] border border-emerald-950/8 bg-white/88 p-8 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
              <SectionTitle
                kicker="Components"
                title="How grouped components behave"
                body="Components let you combine multiple worksheets into one named reporting unit without losing the normal worksheet-level outputs."
              />
              <div className="mt-8 grid gap-4 md:grid-cols-2">
                <div className="rounded-[26px] bg-[#f7fbf7] p-6 ring-1 ring-emerald-950/6">
                  <h3 className="font-display text-2xl text-emerald-950">Rules</h3>
                  <ul className="mt-4 space-y-2 text-sm leading-8 text-slate-700">
                    <li>One sheet can belong to only one component.</li>
                    <li>Component names may match worksheet names and still calculate correctly.</li>
                    <li>Worksheet-level processing still runs normally.</li>
                  </ul>
                </div>
                <div className="rounded-[26px] bg-[#f7fbf7] p-6 ring-1 ring-emerald-950/6">
                  <h3 className="font-display text-2xl text-emerald-950">What gets added</h3>
                  <ul className="mt-4 space-y-2 text-sm leading-8 text-slate-700">
                    <li>Grouped rows appear in summary outputs.</li>
                    <li>A component workbook can be generated if grouped sheets exist.</li>
                    <li>The dashboard can display component-level cards separately from worksheet cards.</li>
                  </ul>
                </div>
              </div>
            </section>

            <section id="outputs" className="rounded-[32px] border border-emerald-950/8 bg-white/88 p-8 shadow-[0_24px_80px_rgba(12,32,22,0.08)] backdrop-blur">
              <SectionTitle
                kicker="Outputs"
                title="What each output means"
                body="After calculation, the app offers multiple ways to review and export results."
              />
              <div className="mt-8 grid gap-4 lg:grid-cols-2">
                {[
                  ["Dashboard", "Shows top metrics and per-component or per-worksheet summary cards directly in the web app."],
                  ["Summary workbook", "Contains site-level summary sheets and high-level result blocks for review."],
                  ["Detail workbook", "Contains more detailed tables and record-linked outputs used for checking the run."],
                  ["Component workbook", "Appears when grouped components are provided and summarizes grouped component outputs."],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-[26px] bg-[#f7fbf7] p-6 ring-1 ring-emerald-950/6">
                    <h3 className="font-display text-2xl text-emerald-950">{title}</h3>
                    <p className="mt-4 text-sm leading-8 text-slate-700">{body}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="notes" className="rounded-[32px] border border-emerald-950/8 bg-[linear-gradient(145deg,#10281d,#173628)] p-8 text-white shadow-[0_28px_90px_rgba(9,26,17,0.28)]">
              <SectionTitle
                kicker="Notes"
                title="Important behavior and limitations"
                body="These points are useful when validating results or explaining why the output looks a certain way."
              />
              <div className="mt-8 grid gap-3">
                {[
                  "If a species does not match a configured group id for volume, it falls back to the Others group for volume calculation and still appears in unmatched QA review.",
                  "Volume and biomass are calculated per record first, then summed into worksheet or component totals.",
                  "The backend may respond slowly on a free hosting plan because the service can sleep during inactivity.",
                  "A malformed workbook or missing required headers can cause empty or partial summaries.",
                ].map((note) => (
                  <div key={note} className="rounded-2xl border border-white/10 bg-white/8 px-4 py-4 text-sm leading-8 text-emerald-50/84">
                    {note}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
