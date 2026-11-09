import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, ImagePlus, RotateCcw } from "lucide-react";
import { editPhoto } from "@/lib/edit-photo";
import {
  HAIR_COLORS,
  LIMITS,
  PRESETS,
  ZERO,
  buildBrief,
  bustLabel,
  hasChange,
  hipLabel,
  noteRejection,
  shoulderLabel,
  thighLabel,
  waistLabel,
  type Adjustments,
  type Shape,
} from "@/lib/edit-brief";

type View = "edit" | "original" | "split";

const NOTES = [
  "Keep my face and expression exactly the same.",
  "No beauty filter. Keep skin texture.",
  "Same outfit, only adjust how the fabric sits.",
  "Slightly straighter posture, nothing else.",
];

async function prepareImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a photo file.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Couldn't read that photo.");
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (!blob) throw new Error("Couldn't read that photo.");
    return await blobToDataUrl(blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Couldn't read that photo. Try a JPEG or PNG."));
    image.src = url;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that photo."));
    reader.readAsDataURL(blob);
  });
}

function downloadImage(dataUrl: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = dataUrl.startsWith("data:image/jpeg") ? "forme-preview.jpg" : "forme-preview.png";
  anchor.click();
}

export function Studio() {
  const renderEdit = useServerFn(editPhoto);
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [view, setView] = useState<View>("edit");
  const [split, setSplit] = useState(58);
  const [bust, setBust] = useState(0);
  const [waist, setWaist] = useState(0);
  const [hips, setHips] = useState(0);
  const [shoulders, setShoulders] = useState(0);
  const [thighs, setThighs] = useState(0);
  const [hair, setHair] = useState("keep");
  const [customHair, setCustomHair] = useState("#c4232c");
  const [note, setNote] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const adjustments: Adjustments = useMemo(
    () => ({ bust, waist, hips, shoulders, thighs, hair, customHair, note }),
    [bust, waist, hips, shoulders, thighs, hair, customHair, note],
  );
  const brief = useMemo(() => buildBrief(adjustments), [adjustments]);
  const ready = Boolean(photo) && attested && hasChange(adjustments) && !busy;
  const noteError = noteRejection(note);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const next = await prepareImage(file);
      setPhoto(next);
      setResult(null);
      setView("edit");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't read that photo.");
    }
  }

  function applyPreset(values: Shape) {
    setBust(values.bust);
    setWaist(values.waist);
    setHips(values.hips);
    setShoulders(values.shoulders);
    setThighs(values.thighs);
  }

  function resetDials() {
    applyPreset(ZERO);
    setHair("keep");
    setNote("");
  }

  async function renderFrom(source: string) {
    if (!attested || !hasChange(adjustments) || noteError) return;
    setBusy(true);
    setError(null);
    try {
      const response = await renderEdit({
        data: {
          imageDataUrl: source,
          bust,
          waist,
          hips,
          shoulders,
          thighs,
          note: note.trim(),
          hair,
          customHair,
          attested: true,
        },
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setResult(response.image);
      setView("edit");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The render didn't finish.");
    } finally {
      setBusy(false);
    }
  }

  const shown = view === "original" || !result ? photo : result;

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="mx-auto flex max-w-6xl items-end justify-between gap-4 px-4 py-5">
        <div>
          <p className="font-display text-3xl leading-none tracking-tight">Forme</p>
          <p className="mt-1 text-sm text-muted">Proportion studio</p>
        </div>
        <p className="max-w-56 text-right text-sm text-muted">Exaggerated on purpose. Face stays.</p>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 pb-32 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-12">
        <section className="flex flex-col gap-3">
          <div
            className={
              "stage relative overflow-hidden rounded-card bg-surface shadow-[var(--shadow-border)] " +
              (dragging ? "shadow-[var(--shadow-border-hover)]" : "")
            }
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void onFile(event.dataTransfer.files[0]);
            }}
          >
            {shown && view !== "split" ? (
              <img src={shown} alt={view === "original" || !result ? "Uploaded photo" : "Edited preview"} className="photo-frame absolute inset-0 h-full w-full object-contain" />
            ) : null}
            {photo && result && view === "split" ? (
              <div className="absolute inset-0">
                <img src={photo} alt="Original photo" className="photo-frame absolute inset-0 h-full w-full object-contain" />
                <img src={result} alt="Edited preview" className="photo-frame absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
                <div className="pointer-events-none absolute inset-y-0 w-px bg-accent" style={{ left: `${split}%` }} />
                <input aria-label="Drag to compare original and edit" className="absolute inset-0 cursor-ew-resize opacity-0" type="range" min={2} max={98} value={split} onChange={(event) => setSplit(Number(event.target.value))} />
              </div>
            ) : null}
            {!photo ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                <p className="font-display text-4xl leading-none text-fg">See it go too far.</p>
                <p className="max-w-sm text-sm text-muted">Upload a photo. The dials exaggerate the body on purpose and do not stay in proportion. Clothes and face stay as they are.</p>
                <button type="button" className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-accent-ink" onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="size-4" aria-hidden="true" />
                  Upload a photo
                </button>
              </div>
            ) : null}
            {busy ? (
              <div className="absolute inset-x-0 bottom-0">
                <div className="shimmer h-1 bg-surface-2" />
                <p className="bg-bg/80 px-4 py-3 text-sm text-fg">Rendering a careful edit…</p>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="inline-flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-sm text-fg shadow-[var(--shadow-border)]" onClick={() => fileRef.current?.click()}>
              <ImagePlus className="size-4" aria-hidden="true" />
              {photo ? "Replace photo" : "Upload a photo"}
            </button>
            {result ? (
              <>
                <ViewSwitch view={view} onChange={setView} />
                <button type="button" className="inline-flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-sm text-fg shadow-[var(--shadow-border)]" onClick={() => downloadImage(result)}>
                  <Download className="size-4" aria-hidden="true" />
                  Save
                </button>
              </>
            ) : null}
            <input ref={fileRef} className="sr-only" type="file" accept="image/*" onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = ""; }} />
          </div>
          {error ? <p className="rounded-card bg-surface px-4 py-3 text-sm text-accent" role="alert">{error}</p> : null}
        </section>
        <aside className="controls rounded-card bg-surface p-4 shadow-[var(--shadow-border)]">
          <div>
            <h1 className="font-display text-2xl leading-tight">Make it unrealistic</h1>
            <p className="mt-1 text-sm text-muted">High settings are meant to look wild, not like a real body. Dramatic maxes the dials.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button key={preset.id} type="button" className="h-11 rounded-full bg-surface-2 px-4 text-sm text-fg" onClick={() => applyPreset(preset.values)}>{preset.name}</button>
            ))}
            <button type="button" className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm text-muted" onClick={resetDials}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Reset
            </button>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium text-fg">Bust</legend>
            <Dial label="Bust volume" min={LIMITS.bust.min} max={LIMITS.bust.max} value={bust} readout={bustLabel(bust)} onChange={setBust} />
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-fg">Shape</legend>
            <Dial label="Waist" min={LIMITS.waist.min} max={LIMITS.waist.max} value={waist} readout={waistLabel(waist)} onChange={setWaist} />
            <Dial label="Hips" min={LIMITS.hips.min} max={LIMITS.hips.max} value={hips} readout={hipLabel(hips)} onChange={setHips} />
            <Dial label="Shoulders" min={LIMITS.shoulders.min} max={LIMITS.shoulders.max} value={shoulders} readout={shoulderLabel(shoulders)} onChange={setShoulders} />
            <Dial label="Thighs" min={LIMITS.thighs.min} max={LIMITS.thighs.max} value={thighs} readout={thighLabel(thighs)} onChange={setThighs} />
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-fg">Hair color</legend>
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={hair === "keep"} className={"h-11 rounded-full px-4 text-sm " + (hair === "keep" ? "bg-accent text-accent-ink" : "bg-surface-2 text-fg")} onClick={() => setHair("keep")}>Keep</button>
              {HAIR_COLORS.map((color) => (
                <button key={color.id} type="button" aria-pressed={hair === color.id} aria-label={color.name} title={color.name} className={"size-11 rounded-full shadow-[var(--shadow-border)] " + (hair === color.id ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : "")} style={{ backgroundColor: color.hex }} onClick={() => setHair(color.id)} />
              ))}
              <label className="inline-flex h-11 items-center gap-2 rounded-full bg-surface-2 px-3 text-sm text-fg">
                Custom
                <input aria-label="Custom hair color" className="hair-picker" type="color" value={customHair} onChange={(event) => { setCustomHair(event.target.value); setHair("custom"); }} />
              </label>
            </div>
            <p className="text-sm text-accent">{hair === "keep" ? "Hair stays as photographed" : hair === "custom" ? `Custom ${customHair}` : (HAIR_COLORS.find((color) => color.id === hair)?.name ?? "")}</p>
          </fieldset>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-fg" htmlFor="note">Or describe it</label>
            <textarea id="note" value={note} maxLength={400} rows={3} placeholder="Wildly oversized chest, tiny waist, ignore realistic proportion." className="w-full resize-none rounded-2xl bg-surface-2 px-3 py-3 text-sm text-fg placeholder:text-muted" onChange={(event) => setNote(event.target.value)} />
            <div className="flex flex-wrap gap-2">
              {NOTES.map((chip) => (
                <button key={chip} type="button" className="rounded-full bg-surface-2 px-3 py-2 text-left text-sm text-muted" onClick={() => setNote((current) => { const next = current.trim() ? `${current.trim()} ${chip}` : chip; return next.slice(0, 400); })}>{chip}</button>
              ))}
            </div>
            {noteError && note.trim() ? <p className="text-sm text-accent">{noteError}</p> : <p className="text-sm text-muted tabular-nums">{note.trim().length}/400</p>}
          </div>
          <label className="flex items-start gap-3 rounded-2xl bg-surface-2 px-3 py-3">
            <input type="checkbox" className="mt-0.5 size-5" checked={attested} onChange={(event) => setAttested(event.target.checked)} />
            <span className="text-sm text-fg">This photo is of an adult, 18 or older, and I have permission to edit it.</span>
          </label>
          <details className="text-sm text-muted">
            <summary className="cursor-pointer text-fg">Instruction that will be rendered</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-sm text-muted">{brief}</pre>
          </details>
          <div className="controls-action hidden lg:block">
            <button type="button" className="inline-flex h-12 w-full items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-ink disabled:opacity-40" disabled={!ready || Boolean(noteError)} onClick={() => photo && void renderFrom(photo)}>{busy ? "Rendering…" : result ? "Render again from original" : "Render change"}</button>
          </div>
          {result && photo ? (
            <button type="button" className="h-11 text-sm text-muted" disabled={busy || Boolean(noteError) || !hasChange(adjustments)} onClick={() => void renderFrom(result)}>Refine this result instead</button>
          ) : null}
          <p className="text-sm text-muted">Each render uses image credits. Photos stay in this session and are sent only to make the edit. Explicit and underage requests are refused.</p>
        </aside>
      </main>
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-bg px-4 py-3 lg:hidden">
        <button type="button" className="inline-flex h-12 w-full items-center justify-center rounded-full bg-accent text-sm font-medium text-accent-ink disabled:opacity-40" disabled={!ready || Boolean(noteError)} onClick={() => photo && void renderFrom(photo)}>{busy ? "Rendering…" : result ? "Render again" : "Render change"}</button>
      </div>
    </div>
  );
}

function ViewSwitch({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const options: { id: View; label: string }[] = [
    { id: "edit", label: "Edit" },
    { id: "original", label: "Original" },
    { id: "split", label: "Split" },
  ];
  return (
    <div className="flex rounded-full bg-surface p-1 shadow-[var(--shadow-border)]">
      {options.map((option) => (
        <button key={option.id} type="button" aria-pressed={view === option.id} className={"h-9 rounded-full px-3 text-sm " + (view === option.id ? "bg-accent text-accent-ink" : "text-muted")} onClick={() => onChange(option.id)}>{option.label}</button>
      ))}
    </div>
  );
}

function Dial({ label, min, max, value, readout, onChange }: { label: string; min: number; max: number; value: number; readout: string; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-fg">{label}</span>
        <span className="text-sm text-accent tabular-nums">{readout}</span>
      </span>
      <input type="range" min={min} max={max} step={1} value={value} aria-valuetext={readout} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
