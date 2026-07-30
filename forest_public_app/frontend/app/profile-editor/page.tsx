"use client";

import * as XLSX from "xlsx";
import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { readWorkspace } from "@/app/lib/workspace-session";
import { readWorkspaceFile } from "@/app/lib/workspace-file";

type ProfileWorkspace = { workbookFile: File | null };
type Tree = { id: number; species: string; height: number; firstBranch: number; x: number; y: number; crownXPlus: number; crownXMinus: number; crownYPlus: number; crownYMinus: number };
type ProfileSheet = { name: string; trees: Tree[] };
type Transform = { dx: number; dy: number };

const palette = ["#43a047", "#1e88e5", "#8e24aa", "#f4511e", "#00acc1", "#7cb342", "#5e35b1", "#d81b60"];

function numberAt(row: unknown[], index: number) {
  const value = Number(row[index]);
  return Number.isFinite(value) ? value : NaN;
}

function readProfileWorkbook(file: File): Promise<ProfileSheet[]> {
  return file.arrayBuffer().then((buffer) => {
    const workbook = XLSX.read(buffer, { type: "array" });
    return workbook.SheetNames.map((name) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, blankrows: false, defval: null });
      const trees = rows.slice(2).flatMap((row, rowIndex) => {
        const species = String(row[1] ?? "").trim();
        const x = numberAt(row, 5), y = numberAt(row, 6), height = numberAt(row, 3);
        if (!species || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(height)) return [];
        return [{ id: Number(row[0]) || rowIndex + 1, species, height, firstBranch: numberAt(row, 4), x, y, crownXPlus: numberAt(row, 7), crownXMinus: numberAt(row, 8), crownYPlus: numberAt(row, 9), crownYMinus: numberAt(row, 10) }];
      });
      return { name, trees };
    });
  });
}

function finite(value: number, fallback: number) { return Number.isFinite(value) ? value : fallback; }

export default function ProfileEditorPage() {
  const workspace = readWorkspace<ProfileWorkspace>("profile");
  const [workbookFile, setWorkbookFile] = useState<File | null>(workspace?.workbookFile ?? null);
  const [fileLookupComplete, setFileLookupComplete] = useState(Boolean(workspace?.workbookFile));
  const [sheets, setSheets] = useState<ProfileSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [transforms, setTransforms] = useState<Record<number, Transform>>({});
  const dragRef = useRef<{ id: number; x: number; y: number; transform: Transform } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (workbookFile) {
      void readProfileWorkbook(workbookFile).then(setSheets).catch(() => setError("Unable to read the current profile workbook."));
      return;
    }
    void readWorkspaceFile("profile").then((file) => { setWorkbookFile(file); setFileLookupComplete(true); }).catch(() => { setError("Unable to load the current profile workbook."); setFileLookupComplete(true); });
  }, [workbookFile]);

  const sheet = sheets[sheetIndex];
  const speciesColors = useMemo(() => {
    const names = [...new Set(sheet?.trees.map((tree) => tree.species) ?? [])].sort();
    return new Map(names.map((name, index) => [name, palette[index % palette.length]]));
  }, [sheet]);
  const limits = useMemo(() => {
    const trees = sheet?.trees ?? [];
    const maxX = Math.max(40, ...trees.map((tree) => tree.x + finite(tree.crownXPlus, 2) + 3));
    const maxY = Math.max(20, ...trees.map((tree) => tree.height + 3));
    return { maxX, maxY };
  }, [sheet]);

  function onPointerDown(event: PointerEvent<SVGGElement>, id: number) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id, x: event.clientX, y: event.clientY, transform: transforms[id] ?? { dx: 0, dy: 0 } };
    setSelectedId(id);
  }
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || !svgRef.current) return;
    const box = svgRef.current.getBoundingClientRect();
    setTransforms((current) => ({ ...current, [drag.id]: { dx: drag.transform.dx + ((event.clientX - drag.x) / box.width) * limits.maxX, dy: drag.transform.dy - ((event.clientY - drag.y) / box.height) * (limits.maxY * 1.65) } }));
  }
  function endDrag() { dragRef.current = null; }
  function resetLayout() { setTransforms({}); setSelectedId(null); }
  async function exportPng() {
    if (!svgRef.current || !sheet) return;
    const xml = new XMLSerializer().serializeToString(svgRef.current);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = 1800; canvas.height = 2100;
      const context = canvas.getContext("2d"); if (!context) return;
      context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const link = document.createElement("a"); link.download = `${sheet.name}_profile_editor.png`; link.href = canvas.toDataURL("image/png"); link.click(); URL.revokeObjectURL(image.src);
    };
    image.src = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  }

  if (!workbookFile && !fileLookupComplete && !error) {
    return <main className="min-h-screen bg-[#F6F8F4] p-6 text-[#1F2933]"><div className="mx-auto max-w-2xl rounded-[30px] border border-[#DDE5D5] bg-white p-8 shadow-sm"><h1 className="text-3xl font-semibold">Profile Editor</h1><p className="mt-4 leading-7 text-[#667085]">Loading the current profile workbook…</p></div></main>;
  }

  if (!workbookFile) {
    return <main className="min-h-screen bg-[#F6F8F4] p-6 text-[#1F2933]"><div className="mx-auto max-w-2xl rounded-[30px] border border-[#DDE5D5] bg-white p-8 shadow-sm"><h1 className="text-3xl font-semibold">Profile Editor</h1><p className="mt-4 leading-7 text-[#667085]">Upload and generate a profile first, then open the editor from the Profile Studio. The editor will use that workbook only.</p><a className="mt-6 inline-flex rounded-full bg-[#1F5E3B] px-5 py-3 font-semibold text-white" href="/profile">Go to Profile Studio</a></div></main>;
  }

  return <main className="min-h-screen bg-[#F6F8F4] p-4 text-[#1F2933] sm:p-6"><div className="mx-auto max-w-[1540px]"><header className="mb-4 flex flex-wrap items-center gap-3"><h1 className="mr-auto text-2xl font-semibold">Profile Diagram Editor</h1><a className="rounded-full border border-[#DDE5D5] bg-white px-4 py-2 font-semibold text-[#1F5E3B]" href="/profile">Back to Profile Studio</a><select aria-label="Select profile sheet" className="rounded-full border border-[#DDE5D5] bg-white px-4 py-2" value={sheetIndex} onChange={(event) => { setSheetIndex(Number(event.target.value)); resetLayout(); }}>{sheets.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}</select><button className="rounded-full bg-[#1F5E3B] px-4 py-2 font-semibold text-white" type="button" onClick={resetLayout}>Reset layout</button><button className="rounded-full bg-[#1F5E3B] px-4 py-2 font-semibold text-white" type="button" onClick={() => void exportPng()}>Export PNG</button></header>
  {error && <p className="rounded-2xl bg-red-50 p-4 text-red-700">{error}</p>}
  {!sheet ? <p className="rounded-3xl bg-white p-8 text-[#667085]">Loading the uploaded profile workbook…</p> : <div className="overflow-auto rounded-[28px] border border-[#DDE5D5] bg-white p-3 shadow-sm"><svg ref={svgRef} className="min-w-[960px]" viewBox={`0 0 ${limits.maxX} ${limits.maxY * 1.65 + 9}`} xmlns="http://www.w3.org/2000/svg" onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
    <rect width={limits.maxX} height={limits.maxY * 1.65 + 9} fill="white" />
    <text x="0" y="2" fontSize="1.2" fontWeight="700">Plan view</text><rect x="1" y="3" width={limits.maxX - 2} height={limits.maxY * .48} fill="#fbfdf9" stroke="#1F2933" strokeWidth=".18" />
    {sheet.trees.map((tree) => { const move = transforms[tree.id] ?? { dx: 0, dy: 0 }; const color = speciesColors.get(tree.species) ?? palette[0]; return <g key={`top-${tree.id}`} transform={`translate(${move.dx} ${-move.dy})`}><ellipse cx={tree.x} cy={3 + tree.y} rx={Math.max(0.7, finite(tree.crownXPlus, 1.2) + finite(tree.crownXMinus, 1.2)) / 2} ry={Math.max(0.7, finite(tree.crownYPlus, 1.2) + finite(tree.crownYMinus, 1.2)) / 2} fill={color} fillOpacity=".55" /><circle cx={tree.x} cy={3 + tree.y} r=".18" /></g>; })}
    <text x="0" y={limits.maxY * .58 + 4} fontSize="1.2" fontWeight="700">Profile view — drag any tree to adjust its position</text><line x1="1" x2={limits.maxX - 1} y1={limits.maxY * 1.52 + 4} y2={limits.maxY * 1.52 + 4} stroke="#667085" strokeWidth=".18" />
    {sheet.trees.map((tree) => { const move = transforms[tree.id] ?? { dx: 0, dy: 0 }; const color = speciesColors.get(tree.species) ?? palette[0]; const crownHeight = Math.max(1, tree.height - finite(tree.firstBranch, tree.height * .55)); const baseY = limits.maxY * 1.52 + 4; const crownY = baseY - tree.height + crownHeight / 2; const selected = selectedId === tree.id; return <g key={tree.id} transform={`translate(${move.dx} ${-move.dy})`} onPointerDown={(event) => onPointerDown(event, tree.id)} style={{ cursor: "grab" }}><rect x={tree.x - .12} y={baseY - tree.height + crownHeight * .22} width=".24" height={tree.height - crownHeight * .22} fill="#6b4f40" /><ellipse cx={tree.x} cy={crownY} rx={Math.max(.75, (finite(tree.crownXPlus, 1.3) + finite(tree.crownXMinus, 1.3)) / 2)} ry={crownHeight / 2} fill={color} fillOpacity=".84" stroke={selected ? "#ef6c32" : color} strokeWidth={selected ? ".35" : ".1"} /><text x={tree.x} y={baseY + 1.1} fontSize=".75" textAnchor="middle">{tree.species}</text></g>; })}
    <g transform={`translate(1 ${limits.maxY * 1.58 + 7})`}>{[...speciesColors].map(([name, color], index) => <g key={name} transform={`translate(${index * (limits.maxX / Math.max(speciesColors.size, 1))} 0)`}><rect width=".8" height=".8" fill={color} /><text x="1.1" y=".72" fontSize=".8">{name}</text></g>)}</g>
  </svg></div>}</div></main>;
}
