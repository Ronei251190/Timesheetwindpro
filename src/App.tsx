import React, { useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";

type WorkType =
  | "Offshore Day Shift (SOV)"
  | "Offshore Night Shift (SOV)"
  | "Harbor Day Shift"
  | "Harbor Night Shift"
  | "Travel"
  | "Off"
  | "Other";

type ExpenseCategory =
  | "taxi"
  | "hotel"
  | "food"
  | "diesel"
  | "extra_luggage"
  | "ppe"
  | "other";

type DayEntry = {
  dateISO: string; // YYYY-MM-DD
  workType: WorkType;
  hours: number; // 0..24
  ratePerHour: number; // 0..500 (ex)
  location: string;
  serviceWorker: string; // SW 123...
  workNote: string;

  expenses: Record<ExpenseCategory, number>;
};

type PeriodLock = {
  locked: boolean;
  lockedAtISO?: string;
};

type AppState = {
  loginEmail: string;
  name: string;
  selectedPeriodKey: string; // YYYY-MM
  selectedDateISO: string; // YYYY-MM-DD

  // entries grouped by periodKey
  entriesByPeriod: Record<string, Record<string, DayEntry>>; // periodKey -> dateISO -> entry

  // signature per period
  signatureByPeriod: Record<string, string>; // periodKey -> dataURL (png)

  // lock per period
  lockByPeriod: Record<string, PeriodLock>;
};

const STORAGE_KEY = "windpro_timesheet_state_v3";

// ====== CONFIG ======
const ADMIN_PASSWORD = "1234"; // schimbă aici parola de admin
const DEFAULT_WORK_TYPE: WorkType = "Offshore Night Shift (SOV)";
const DEFAULT_RATE = 0;

// ====== HELPERS ======
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function clampNum(n: any, min: number, max?: number) {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  if (max === undefined) return Math.max(min, x);
  return Math.min(Math.max(min, x), max);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthKeyFromISO(dateISO: string) {
  return dateISO.slice(0, 7); // YYYY-MM
}

function startOfMonthISO(periodKey: string) {
  return `${periodKey}-01`;
}

function endOfMonthISO(periodKey: string) {
  const [y, m] = periodKey.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${pad2(m)}-${pad2(last)}`;
}

function formatMonthLabel(periodKey: string) {
  const [y, m] = periodKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return `${y} - ${d.toLocaleString(undefined, { month: "long" })}`;
}

function daysInMonth(periodKey: string) {
  const [y, m] = periodKey.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function weekdayShort(idx: number) {
  const base = new Date(2024, 0, 7 + idx); // random week
  return base.toLocaleString(undefined, { weekday: "short" });
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("no state");
    const parsed = JSON.parse(raw) as AppState;

    // minimal sanity defaults
    const t = todayISO();
    return {
      loginEmail: parsed.loginEmail ?? "",
      name: parsed.name ?? "",
      selectedPeriodKey: parsed.selectedPeriodKey ?? monthKeyFromISO(t),
      selectedDateISO: parsed.selectedDateISO ?? t,
      entriesByPeriod: parsed.entriesByPeriod ?? {},
      signatureByPeriod: parsed.signatureByPeriod ?? {},
      lockByPeriod: parsed.lockByPeriod ?? {},
    };
  } catch {
    const t = todayISO();
    return {
      loginEmail: "",
      name: "",
      selectedPeriodKey: monthKeyFromISO(t),
      selectedDateISO: t,
      entriesByPeriod: {},
      signatureByPeriod: {},
      lockByPeriod: {},
    };
  }
}

function saveState(s: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function emptyExpenses(): Record<ExpenseCategory, number> {
  return {
    taxi: 0,
    hotel: 0,
    food: 0,
    diesel: 0,
    extra_luggage: 0,
    ppe: 0,
    other: 0,
  };
}

function ensureEntry(periodKey: string, dateISO: string, existing?: DayEntry): DayEntry {
  if (existing) return existing;
  return {
    dateISO,
    workType: DEFAULT_WORK_TYPE,
    hours: 0,
    ratePerHour: DEFAULT_RATE,
    location: "",
    serviceWorker: "",
    workNote: "",
    expenses: emptyExpenses(),
  };
}

function dataUriToBase64(dataUri: string) {
  const idx = dataUri.indexOf("base64,");
  if (idx === -1) return dataUri;
  return dataUri.slice(idx + "base64,".length);
}

// ====== SIGNATURE CANVAS ======
function useSignatureCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  function getPos(e: PointerEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // border guide
    ctx.strokeStyle = "#ddd";
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
  }

  function setFromDataURL(dataURL: string) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#ddd";
      ctx.strokeRect(0, 0, canvas.width, canvas.height);
    };
    img.src = dataURL;
  }

  function toDataURL(): string {
    const canvas = canvasRef.current;
    if (!canvas) return "";
    return canvas.toDataURL("image/png");
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // set size once (devicePixelRatio aware)
    const dpr = window.devicePixelRatio || 1;
    const cssW = 520;
    const cssH = 140;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";

    // initial border
    ctx.strokeStyle = "#ddd";
    ctx.strokeRect(0, 0, cssW, cssH);
    ctx.strokeStyle = "#111";

    const onPointerDown = (e: PointerEvent) => {
      drawingRef.current = true;
      lastRef.current = getPos(e, canvas);
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      const ctx2 = canvas.getContext("2d");
      if (!ctx2) return;
      const pos = getPos(e, canvas);
      const last = lastRef.current;
      if (!last) {
        lastRef.current = pos;
        return;
      }
      ctx2.beginPath();
      ctx2.moveTo(last.x, last.y);
      ctx2.lineTo(pos.x, pos.y);
      ctx2.stroke();
      lastRef.current = pos;
    };

    const onPointerUp = (e: PointerEvent) => {
      drawingRef.current = false;
      lastRef.current = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {}
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  return { canvasRef, clear, toDataURL, setFromDataURL };
}

// ====== APP ======
export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());

  useEffect(() => saveState(state), [state]);

  // periods until 2050
  const periods = useMemo(() => {
    const out: string[] = [];
    const start = new Date(2024, 0, 1);
    const end = new Date(2050, 11, 1);
    const cur = new Date(start.getTime());
    while (cur <= end) {
      out.push(`${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}`);
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }, []);

  const lock = state.lockByPeriod[state.selectedPeriodKey]?.locked ?? false;

  // current entry
  const currentEntry: DayEntry = useMemo(() => {
    const p = state.selectedPeriodKey;
    const d = state.selectedDateISO;
    const existing = state.entriesByPeriod[p]?.[d];
    return ensureEntry(p, d, existing);
  }, [state.entriesByPeriod, state.selectedPeriodKey, state.selectedDateISO]);

  const dayPay = useMemo(() => {
    return round2(clampNum(currentEntry.hours, 0) * clampNum(currentEntry.ratePerHour, 0));
  }, [currentEntry.hours, currentEntry.ratePerHour]);

  const periodTotals = useMemo(() => {
    const p = state.selectedPeriodKey;
    const entries = state.entriesByPeriod[p] ?? {};
    let hours = 0;
    let pay = 0;
    let expenses = 0;

    for (const e of Object.values(entries)) {
      const h = clampNum(e.hours, 0);
      const r = clampNum(e.ratePerHour, 0);
      hours += h;
      pay += h * r;

      for (const v of Object.values(e.expenses ?? emptyExpenses())) {
        expenses += clampNum(v, 0);
      }
    }

    return {
      hours: round2(hours),
      pay: round2(pay),
      expenses: round2(expenses),
    };
  }, [state.entriesByPeriod, state.selectedPeriodKey]);

  // calendar
  const calendar = useMemo(() => {
    const p = state.selectedPeriodKey;
    const [yy, mm] = p.split("-").map(Number);
    const first = new Date(yy, mm - 1, 1);
    const startWeekday = (first.getDay() + 6) % 7; // Monday=0
    const dim = daysInMonth(p);

    const cells: Array<{ day: number | null; dateISO?: string }> = [];

    for (let i = 0; i < startWeekday; i++) cells.push({ day: null });
    for (let day = 1; day <= dim; day++) {
      const dateISO = `${yy}-${pad2(mm)}-${pad2(day)}`;
      cells.push({ day, dateISO });
    }
    while (cells.length % 7 !== 0) cells.push({ day: null });

    return { cells, yy, mm, dim };
  }, [state.selectedPeriodKey]);

  function setEntry(patch: Partial<DayEntry>) {
    if (lock) return;

    setState((prev) => {
      const p = prev.selectedPeriodKey;
      const d = prev.selectedDateISO;
      const periodMap = { ...(prev.entriesByPeriod[p] ?? {}) };
      const base = ensureEntry(p, d, periodMap[d]);
      const next: DayEntry = {
        ...base,
        ...patch,
        expenses: patch.expenses ? patch.expenses : base.expenses,
      };
      periodMap[d] = next;

      return {
        ...prev,
        entriesByPeriod: {
          ...prev.entriesByPeriod,
          [p]: periodMap,
        },
      };
    });
  }

  function setExpense(cat: ExpenseCategory, value: number) {
    if (lock) return;
    const next = { ...(currentEntry.expenses ?? emptyExpenses()), [cat]: clampNum(value, 0) };
    setEntry({ expenses: next });
  }

  function clearDay() {
    if (lock) return;
    if (!confirm("Clear this day entry?")) return;

    setState((prev) => {
      const p = prev.selectedPeriodKey;
      const d = prev.selectedDateISO;
      const periodMap = { ...(prev.entriesByPeriod[p] ?? {}) };
      delete periodMap[d];
      return { ...prev, entriesByPeriod: { ...prev.entriesByPeriod, [p]: periodMap } };
    });
  }

  function copyPreviousDay() {
    if (lock) return;
    const [y, m, dd] = state.selectedDateISO.split("-").map(Number);
    const prevDate = new Date(y, m - 1, dd - 1);
    const prevISO = `${prevDate.getFullYear()}-${pad2(prevDate.getMonth() + 1)}-${pad2(prevDate.getDate())}`;
    const p = state.selectedPeriodKey;
    const prevEntry = state.entriesByPeriod[p]?.[prevISO];
    if (!prevEntry) {
      alert("No previous day entry to copy.");
      return;
    }
    const { dateISO, ...rest } = prevEntry;
    setEntry({ ...rest, dateISO: state.selectedDateISO });
  }

  // ===== SIGNATURE =====
  const sig = useSignatureCanvas();

  useEffect(() => {
    // whenever period changes, load saved signature
    const saved = state.signatureByPeriod[state.selectedPeriodKey];
    if (saved) sig.setFromDataURL(saved);
    else sig.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedPeriodKey]);

  function saveSignature() {
    if (lock) return;
    const dataURL = sig.toDataURL();
    setState((prev) => ({
      ...prev,
      signatureByPeriod: { ...prev.signatureByPeriod, [prev.selectedPeriodKey]: dataURL },
    }));
    alert("Signature saved for this period.");
  }

  function clearSignature() {
    if (lock) return;
    sig.clear();
    setState((prev) => {
      const next = { ...prev.signatureByPeriod };
      delete next[prev.selectedPeriodKey];
      return { ...prev, signatureByPeriod: next };
    });
  }

  // ===== PDF =====
  function buildPdfBase64ForPeriod(periodKey: string) {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40;
    let y = 50;

    const periodStart = startOfMonthISO(periodKey);
    const periodEnd = endOfMonthISO(periodKey);

    doc.setFont("times", "bold");
    doc.setFontSize(18);
    doc.text("WindPro TimeSheet", margin, y);
    y += 18;

    doc.setFont("times", "normal");
    doc.setFontSize(11);
    doc.text(`Name: ${state.name || "-"}`, margin, y);
    y += 14;
    doc.text(`Login email: ${state.loginEmail || "-"}`, margin, y);
    y += 14;
    doc.text(`Period: ${formatMonthLabel(periodKey)} (${periodStart} -> ${periodEnd})`, margin, y);
    y += 16;

    doc.setDrawColor(220);
    doc.line(margin, y, 555, y);
    y += 16;

    // totals
    doc.setFont("times", "bold");
    doc.text(`Hours (period): ${periodTotals.hours.toFixed(2)}`, margin, y);
    y += 14;
    doc.text(`Expenses (period): € ${periodTotals.expenses.toFixed(2)}`, margin, y);
    y += 14;
    doc.text(`Pay (period): € ${periodTotals.pay.toFixed(2)}`, margin, y);
    y += 18;

    doc.setFont("times", "bold");
    doc.text("Entries", margin, y);
    y += 12;

    doc.setFont("times", "normal");
    doc.setFontSize(9);

    const entries = Object.values(state.entriesByPeriod[periodKey] ?? {}).sort((a, b) =>
      a.dateISO.localeCompare(b.dateISO)
    );

    const header = "Date | Work type | Hours | Rate | Day pay | Location | SW | Expenses | Note";
    doc.text(header, margin, y);
    y += 10;
    doc.setDrawColor(220);
    doc.line(margin, y, 555, y);
    y += 12;

    function entryExpensesSum(e: DayEntry) {
      let s = 0;
      for (const v of Object.values(e.expenses ?? emptyExpenses())) s += clampNum(v, 0);
      return round2(s);
    }

    for (const e of entries) {
      const h = clampNum(e.hours, 0);
      const r = clampNum(e.ratePerHour, 0);
      const dp = round2(h * r);
      const ex = entryExpensesSum(e);

      const row = `${e.dateISO} | ${e.workType} | ${h} | ${r} | ${dp} | ${e.location || "-"} | ${
        e.serviceWorker || "-"
      } | €${ex} | ${e.workNote || "-"}`;

      const lines = doc.splitTextToSize(row, 520);
      for (const ln of lines) {
        if (y > 740) {
          doc.addPage();
          y = 50;
        }
        doc.text(ln, margin, y);
        y += 12;
      }
      y += 4;
    }

    // signature
    const sigData = state.signatureByPeriod[periodKey];
    if (sigData) {
      if (y > 650) {
        doc.addPage();
        y = 50;
      }
      y += 10;
      doc.setFont("times", "bold");
      doc.setFontSize(12);
      doc.text("Signature", margin, y);
      y += 10;

      // add signature image
      try {
        doc.addImage(sigData, "PNG", margin, y, 220, 60);
        y += 70;
      } catch {
        // ignore image errors
      }
    }

    const dataUri = doc.output("datauristring");
    return dataUriToBase64(dataUri);
  }

  function downloadPdfForPeriod() {
    const p = state.selectedPeriodKey;
    const base64 = buildPdfBase64ForPeriod(p);
    const dataUri = `data:application/pdf;base64,${base64}`;

    const a = document.createElement("a");
    a.href = dataUri;
    a.download = `Timesheet_${state.name || "user"}_${p}.pdf`;
    a.click();
  }

  // ===== SUBMIT / LOCK =====
  function lockPeriodNow() {
    setState((prev) => ({
      ...prev,
      lockByPeriod: {
        ...prev.lockByPeriod,
        [prev.selectedPeriodKey]: { locked: true, lockedAtISO: new Date().toISOString() },
      },
    }));
  }

  function unlockPeriodAdmin() {
    const pass = prompt("Admin password:");
    if (pass !== ADMIN_PASSWORD) {
      alert("Wrong password.");
      return;
    }
    setState((prev) => ({
      ...prev,
      lockByPeriod: {
        ...prev.lockByPeriod,
        [prev.selectedPeriodKey]: { locked: false },
      },
    }));
    alert("Period unlocked.");
  }

  async function submitPeriod() {
    if (!state.loginEmail) {
      alert("Add Login email first.");
      return;
    }
    if (!state.name) {
      alert("Add Name first.");
      return;
    }
    if (lock) {
      alert("This period is locked.");
      return;
    }

    // while Resend is in testing mode, it must be YOUR email
    const to = state.loginEmail.trim();

    const pdfBase64 = buildPdfBase64ForPeriod(state.selectedPeriodKey);

    const subject = `Timesheet ${formatMonthLabel(state.selectedPeriodKey)} - ${state.name}`;
    const html = `
      <div style="font-family: Arial, sans-serif;">
        <h2 style="margin:0;">Timesheet</h2>
        <p><b>Name:</b> ${state.name}</p>
        <p><b>Period:</b> ${formatMonthLabel(state.selectedPeriodKey)}</p>
        <p><b>Hours:</b> ${periodTotals.hours.toFixed(2)}</p>
        <p><b>Expenses:</b> € ${periodTotals.expenses.toFixed(2)}</p>
        <p><b>Pay:</b> € ${periodTotals.pay.toFixed(2)}</p>
        <p>PDF attached.</p>
      </div>
    `;

    try {
      const r = await fetch("/api/send-timesheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject,
          html,
          pdfBase64,
          pdfFileName: `Timesheet_${state.name}_${state.selectedPeriodKey}.pdf`,
        }),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok || data?.ok !== true) {
        alert(`Submit failed (${r.status}): ${JSON.stringify(data)}`);
        return;
      }

      lockPeriodNow();
      alert("Submitted successfully. Period locked.");
    } catch (e: any) {
      alert(`Submit error: ${e?.message || "unknown"}`);
    }
  }

  // ===== UI =====
  return (
    <div
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: 18,
        fontFamily: "Georgia, 'Times New Roman', serif",
        color: "#111",
      }}
    >
      <h1 style={{ margin: "0 0 4px 0" }}>WindPro TimeSheet</h1>
      <div style={{ opacity: 0.75, marginBottom: 12 }}>
        PDF doar pe perioada selectată (luna). Submit = email + lock. Unlock = admin.
      </div>

      {/* TOP BAR */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "540px 1fr auto",
          gap: 12,
          alignItems: "center",
          padding: 14,
          borderRadius: 14,
          border: "1px solid #eee",
          background: "white",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
          <div style={{ opacity: 0.8 }}>Login email:</div>
          <input
            value={state.loginEmail}
            onChange={(e) => setState((p) => ({ ...p, loginEmail: e.target.value }))}
            placeholder="ex: bogdan.bitzy@yahoo.com"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />

          <div style={{ opacity: 0.8 }}>Name:</div>
          <input
            value={state.name}
            onChange={(e) => setState((p) => ({ ...p, name: e.target.value }))}
            placeholder="ex: Bogdan Rotariu"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-start" }}>
          <div style={{ opacity: 0.8 }}>Pay period:</div>
          <select
            value={state.selectedPeriodKey}
            onChange={(e) => {
              const periodKey = e.target.value;
              // keep selected day within that month
              const d = startOfMonthISO(periodKey);
              setState((p) => ({
                ...p,
                selectedPeriodKey: periodKey,
                selectedDateISO: d,
              }));
            }}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", minWidth: 220 }}
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {formatMonthLabel(p)}
              </option>
            ))}
          </select>

          {lock ? (
            <span style={{ padding: "6px 10px", borderRadius: 999, background: "#ffe7e7", border: "1px solid #ffb3b3" }}>
              Locked
            </span>
          ) : (
            <span style={{ padding: "6px 10px", borderRadius: 999, background: "#e9fff0", border: "1px solid #b7f0c8" }}>
              Editable
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={downloadPdfForPeriod}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #1a5fff",
              background: "#1a5fff",
              color: "white",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Export PDF (Period)
          </button>

          <button
            onClick={submitPeriod}
            disabled={lock}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #16803a",
              background: lock ? "#b9b9b9" : "#16803a",
              color: "white",
              fontWeight: 800,
              cursor: lock ? "not-allowed" : "pointer",
            }}
          >
            Submit
          </button>

          <button
            onClick={unlockPeriodAdmin}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #ddd",
              background: "white",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Unlock period (Admin)
          </button>
        </div>
      </div>

      {/* SUMMARY CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <Card title="Selected period" big={formatMonthLabel(state.selectedPeriodKey)}>
          <div style={{ marginTop: 4 }}>
            {startOfMonthISO(state.selectedPeriodKey)} → {endOfMonthISO(state.selectedPeriodKey)}
          </div>
        </Card>
        <Card title="Hours (period)" big={periodTotals.hours.toFixed(2)}>
          <div />
        </Card>
        <Card title="Expenses (period)" big={`€ ${periodTotals.expenses.toFixed(2)}`}>
          <div />
        </Card>
        <Card title="Pay (period)" big={`€ ${periodTotals.pay.toFixed(2)}`}>
          <div style={{ opacity: 0.85 }}>Rate varies by day</div>
        </Card>
      </div>

      {/* MAIN GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 12, alignItems: "start" }}>
        {/* Calendar */}
        <div style={{ border: "1px solid #eee", borderRadius: 14, background: "white", padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{formatMonthLabel(state.selectedPeriodKey)}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  const idx = periods.indexOf(state.selectedPeriodKey);
                  const prev = periods[Math.max(0, idx - 1)];
                  setState((p) => ({
                    ...p,
                    selectedPeriodKey: prev,
                    selectedDateISO: startOfMonthISO(prev),
                  }));
                }}
                style={{ borderRadius: 999, border: "1px solid #ddd", background: "white", padding: "8px 12px" }}
              >
                ‹
              </button>
              <button
                onClick={() => {
                  const idx = periods.indexOf(state.selectedPeriodKey);
                  const next = periods[Math.min(periods.length - 1, idx + 1)];
                  setState((p) => ({
                    ...p,
                    selectedPeriodKey: next,
                    selectedDateISO: startOfMonthISO(next),
                  }));
                }}
                style={{ borderRadius: 999, border: "1px solid #ddd", background: "white", padding: "8px 12px" }}
              >
                ›
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginTop: 10 }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} style={{ textAlign: "center", opacity: 0.7, fontWeight: 700 }}>
                {weekdayShort(i)}
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginTop: 8 }}>
            {calendar.cells.map((c, idx) => {
              const isSelected = c.dateISO === state.selectedDateISO;
              const hasEntry = c.dateISO ? !!state.entriesByPeriod[state.selectedPeriodKey]?.[c.dateISO] : false;

              return (
                <button
                  key={idx}
                  disabled={!c.day}
                  onClick={() => c.dateISO && setState((p) => ({ ...p, selectedDateISO: c.dateISO! }))}
                  style={{
                    height: 44,
                    borderRadius: 12,
                    border: isSelected ? "2px solid #1a5fff" : "1px solid #eee",
                    background: !c.day ? "transparent" : isSelected ? "#edf3ff" : "white",
                    cursor: c.day ? "pointer" : "default",
                    fontWeight: 800,
                    position: "relative",
                  }}
                >
                  {c.day ?? ""}
                  {hasEntry && (
                    <span
                      style={{
                        position: "absolute",
                        bottom: 6,
                        left: "50%",
                        transform: "translateX(-50%)",
                        width: 8,
                        height: 8,
                        borderRadius: 99,
                        background: "#16803a",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button
              onClick={copyPreviousDay}
              disabled={lock}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #ddd",
                background: lock ? "#f2f2f2" : "white",
                cursor: lock ? "not-allowed" : "pointer",
                fontWeight: 700,
              }}
            >
              Copy previous day
            </button>
            <button
              onClick={clearDay}
              disabled={lock}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #ffb3b3",
                background: lock ? "#f2f2f2" : "#ffe7e7",
                cursor: lock ? "not-allowed" : "pointer",
                fontWeight: 800,
                color: "#b00020",
              }}
            >
              Clear day
            </button>
          </div>
        </div>

        {/* Day editor */}
        <div style={{ border: "1px solid #eee", borderRadius: 14, background: "white", padding: 14 }}>
          <div style={{ fontSize: 34, fontWeight: 900, marginBottom: 4 }}>
            {new Date(state.selectedDateISO).toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "2-digit",
            })}
          </div>
          <div style={{ opacity: 0.75, marginBottom: 14 }}>
            Date: <b>{state.selectedDateISO}</b> | Period: <b>{formatMonthLabel(state.selectedPeriodKey)}</b>
          </div>

          <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 10 }}>Work</div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 140px 180px", gap: 12, alignItems: "end" }}>
            <div>
              <div style={{ opacity: 0.8, marginBottom: 6 }}>Work type</div>
              <select
                value={currentEntry.workType}
                disabled={lock}
                onChange={(e) => setEntry({ workType: e.target.value as WorkType })}
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
              >
                <option>Offshore Day Shift (SOV)</option>
                <option>Offshore Night Shift (SOV)</option>
                <option>Harbor Day Shift</option>
                <option>Harbor Night Shift</option>
                <option>Travel</option>
                <option>Off</option>
                <option>Other</option>
              </select>

              <div style={{ marginTop: 8, opacity: 0.85 }}>
                Day pay: <b>€ {dayPay.toFixed(2)}</b>
              </div>
            </div>

            <div>
              <div style={{ opacity: 0.8, marginBottom: 6 }}>Hours</div>
              <input
                type="number"
                value={currentEntry.hours}
                disabled={lock}
                onChange={(e) => setEntry({ hours: clampNum(e.target.value, 0, 24) })}
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
              />
            </div>

            <div>
              <div style={{ opacity: 0.8, marginBottom: 6 }}>Payment rate (€ / hour)</div>
              <input
                type="number"
                value={currentEntry.ratePerHour}
                disabled={lock}
                onChange={(e) => setEntry({ ratePerHour: clampNum(e.target.value, 0, 1000) })}
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div>
              <div style={{ opacity: 0.8, marginBottom: 6 }}>Location</div>
              <input
                value={currentEntry.location}
                disabled={lock}
                onChange={(e) => setEntry({ location: e.target.value })}
                placeholder="ex: Borssele / Hornsea / Port"
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
              />
            </div>
            <div>
              <div style={{ opacity: 0.8, marginBottom: 6 }}>Service Worker (SW)</div>
              <input
                value={currentEntry.serviceWorker}
                disabled={lock}
                onChange={(e) => setEntry({ serviceWorker: e.target.value })}
                placeholder="ex: SW 6231482"
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ opacity: 0.8, marginBottom: 6 }}>Work note</div>
            <textarea
              value={currentEntry.workNote}
              disabled={lock}
              onChange={(e) => setEntry({ workNote: e.target.value })}
              placeholder="ex: Main component exchange / Maintenance / Troubleshooting"
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd", minHeight: 72 }}
            />
          </div>

          <div style={{ fontSize: 20, fontWeight: 900, marginTop: 18, marginBottom: 10 }}>Expenses (day)</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <ExpenseInput label="Taxi" value={currentEntry.expenses.taxi} disabled={lock} onChange={(v) => setExpense("taxi", v)} />
            <ExpenseInput label="Hotel" value={currentEntry.expenses.hotel} disabled={lock} onChange={(v) => setExpense("hotel", v)} />
            <ExpenseInput label="Food" value={currentEntry.expenses.food} disabled={lock} onChange={(v) => setExpense("food", v)} />
            <ExpenseInput label="Diesel" value={currentEntry.expenses.diesel} disabled={lock} onChange={(v) => setExpense("diesel", v)} />
            <ExpenseInput label="Extra luggage" value={currentEntry.expenses.extra_luggage} disabled={lock} onChange={(v) => setExpense("extra_luggage", v)} />
            <ExpenseInput label="PPE" value={currentEntry.expenses.ppe} disabled={lock} onChange={(v) => setExpense("ppe", v)} />
            <ExpenseInput label="Other" value={currentEntry.expenses.other} disabled={lock} onChange={(v) => setExpense("other", v)} />
          </div>

          <div style={{ fontSize: 20, fontWeight: 900, marginTop: 18, marginBottom: 10 }}>Signature (period)</div>

          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div>
              <canvas ref={sig.canvasRef} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={saveSignature}
                  disabled={lock}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    background: lock ? "#f2f2f2" : "white",
                    cursor: lock ? "not-allowed" : "pointer",
                    fontWeight: 800,
                  }}
                >
                  Save signature
                </button>
                <button
                  onClick={clearSignature}
                  disabled={lock}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #ffb3b3",
                    background: lock ? "#f2f2f2" : "#ffe7e7",
                    cursor: lock ? "not-allowed" : "pointer",
                    fontWeight: 800,
                    color: "#b00020",
                  }}
                >
                  Clear signature
                </button>
              </div>
              <div style={{ opacity: 0.7, marginTop: 8 }}>Tip: sign with mouse/finger, then press “Save signature”.</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ opacity: 0.7, marginTop: 16 }}>
        Note: In Resend testing mode you can only send to your own email until you verify a domain.
      </div>
    </div>
  );
}

// ====== UI components ======
function Card({ title, big, children }: { title: string; big: string; children?: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #eee", background: "white", borderRadius: 14, padding: 16 }}>
      <div style={{ opacity: 0.75, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 8 }}>{big}</div>
      <div style={{ opacity: 0.85 }}>{children}</div>
    </div>
  );
}

function ExpenseInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div style={{ opacity: 0.8, marginBottom: 6 }}>{label} (€)</div>
      <input
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clampNum(e.target.value, 0, 100000))}
        style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
      />
    </div>
  );
}
