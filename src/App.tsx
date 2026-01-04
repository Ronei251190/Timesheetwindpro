// App.tsx
// WindPro TimeSheet — monthly pay periods (full month) from now until 2050
// ✅ No pay rates (each person has different rate)
// ✅ Export PDF (selected month period only)
// ✅ Submit = lock period, Unlock = admin password
// ✅ Day editor + Expenses + Vessel/Jack-up + Platform (SOV / Jack-up / CTV / Harbour)
//
// Install deps:
//   npm i jspdf date-fns
//
// NOTE: This is single-file App.tsx for Vite + React + TS.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  endOfMonth,
  format,
  getDaysInMonth,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import jsPDF from "jspdf";

/** --------- TYPES ---------- */

type WorkType =
  | "Offshore (Harbour / CTV) DAY SHIFT"
  | "Offshore (Harbour / CTV) NIGHT SHIFT"
  | "Offshore Day Shift (SOV)"
  | "Offshore Night Shift (SOV)"
  | "Offshore Standby (SOV)"
  | "Port / Harbour"
  | "Standby / On call at home"
  | "Mob / Demob rate"
  | "Overtime"
  | "Travel (8h x 22€ = 176€) one way"
  | "Car allowance"
  | "OFF / Rest"
  | "Onshore Installation Supervisor"
  | "Site Manager"
  | "Service"
  | "Driving to site from home"
  | "Driving from site to home";

type ExpenseType = "Taxi" | "Hotel" | "Food" | "Diesel" | "Extra luggage" | "PPE" | "Other";

type PlatformType = "SOV" | "Jack-up" | "CTV / Harbour" | "N/A";

type DayEntry = {
  dateISO: string; // yyyy-mm-dd

  workType: WorkType;
  hours: number;

  location: string;
  serviceWorker: string;

  workDone: string;
  comment: string;

  // Expenses list (per day)
  expenses: { id: string; type: ExpenseType; amount: number; note: string }[];

  // Vessel / Jack-up section (per day)
  platformType: PlatformType;
  vesselPreset: string;
  vesselManual: string;
};

type Period = {
  id: string; // "2026-02"
  label: string; // "2026 - February"
  year: number;
  monthIndex: number; // 0..11
  startISO: string; // first day
  endISO: string; // last day
  invoiceDateISO: string; // default = endISO (can change later)
};

type AppState = {
  loginEmail: string;
  selectedPeriodId: string;
  selectedDateISO: string;

  // entries keyed by dateISO
  entries: Record<string, DayEntry>;

  // signature data url
  signatureDataUrl: string | null;

  // locked period IDs
  lockedPeriodIds: string[];
};

/** --------- CONFIG ---------- */

const ADMIN_PASSWORD = "1234"; // <-- CHANGE THIS
const LS_KEY = "windpro_timesheet_v1";

const WORK_TYPES: WorkType[] = [
  "Offshore (Harbour / CTV) DAY SHIFT",
  "Offshore (Harbour / CTV) NIGHT SHIFT",
  "Offshore Day Shift (SOV)",
  "Offshore Night Shift (SOV)",
  "Offshore Standby (SOV)",
  "Port / Harbour",
  "Standby / On call at home",
  "Mob / Demob rate",
  "Overtime",
  "Travel (8h x 22€ = 176€) one way",
  "Car allowance",
  "OFF / Rest",
  "Onshore Installation Supervisor",
  "Site Manager",
  "Service",
  "Driving to site from home",
  "Driving from site to home",
];

const EXP_TYPES: ExpenseType[] = ["Taxi", "Hotel", "Food", "Diesel", "Extra luggage", "PPE", "Other"];

const PLATFORM_TYPES: PlatformType[] = ["SOV", "Jack-up", "CTV / Harbour", "N/A"];

const VESSEL_PRESETS = [
  "Blue Tern",
  "Discovery Wind",
  "Apollo Wind",
  "Nobelwind",
  "North Sea Giant",
  "Vidar",
  "Aeolus",
  "Sea Challenger",
  "SOV (Other)",
  "Jack-up (Other)",
];

/** --------- HELPERS ---------- */

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function clampNum(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}
function safeParse<T>(raw: string | null, fallback: T): T {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function trim1(s: string) {
  return (s || "-").replace(/\s+/g, " ").trim();
}
function inRangeISO(dateISO: string, startISO: string, endISO: string) {
  return dateISO >= startISO && dateISO <= endISO;
}

function makeDefaultEntry(dateISO: string): DayEntry {
  return {
    dateISO,
    workType: "Offshore Night Shift (SOV)",
    hours: 0,
    location: "",
    serviceWorker: "",
    workDone: "",
    comment: "",
    expenses: [],
    platformType: "SOV",
    vesselPreset: "Blue Tern",
    vesselManual: "Blue Tern",
  };
}

function generateMonthlyPeriodsUntil2050(): Period[] {
  const start = new Date(2025, 0, 1); // Jan 2025
  const end = new Date(2050, 11, 1);  // Dec 2050

  const periods: Period[] = [];
  let cur = startOfMonth(start);

  while (cur <= end) {
    const y = cur.getFullYear();
    const m = cur.getMonth();
    const s = startOfMonth(cur);
    const e = endOfMonth(cur);

    const startISO = format(s, "yyyy-MM-dd");
    const endISO = format(e, "yyyy-MM-dd");

    periods.push({
      id: `${y}-${String(m + 1).padStart(2, "0")}`,
      label: `${y} - ${format(cur, "MMMM")}`,
      year: y,
      monthIndex: m,
      startISO,
      endISO,
      invoiceDateISO: endISO, // default invoice date = last day of month
    });

    cur = addMonths(cur, 1);
  }

  return periods;
}

/** --------- DEFAULT STATE ---------- */

const DEFAULT_STATE: AppState = {
  loginEmail: "",
  selectedPeriodId: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
  selectedDateISO: todayISO(),
  entries: {},
  signatureDataUrl: null,
  lockedPeriodIds: [],
};

function loadState(): AppState {
  const s = safeParse<AppState>(localStorage.getItem(LS_KEY), DEFAULT_STATE);

  // Ensure selectedPeriodId exists even if user has older data
  if (!s.selectedPeriodId) s.selectedPeriodId = DEFAULT_STATE.selectedPeriodId;
  if (!s.selectedDateISO) s.selectedDateISO = DEFAULT_STATE.selectedDateISO;
  if (!s.entries) s.entries = {};
  if (!s.lockedPeriodIds) s.lockedPeriodIds = [];
  return s;
}

function saveState(s: AppState) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

/** --------- APP ---------- */

export default function App() {
  const periods = useMemo(() => generateMonthlyPeriodsUntil2050(), []);
  const [state, setState] = useState<AppState>(() => loadState());

  useEffect(() => {
    saveState(state);
  }, [state]);

  const selectedPeriod = useMemo(() => {
    const found = periods.find((p) => p.id === state.selectedPeriodId);
    return found || periods[0];
  }, [periods, state.selectedPeriodId]);

  // If selected date is outside selected period, keep it but show correct month calendar from selected date.
  const selectedDate = useMemo(() => parseISO(state.selectedDateISO), [state.selectedDateISO]);

  const monthStart = useMemo(() => startOfMonth(selectedDate), [selectedDate]);
  const monthLabel = useMemo(() => format(monthStart, "MMMM yyyy"), [monthStart]);

  const isLocked = useMemo(
    () => state.lockedPeriodIds.includes(selectedPeriod.id),
    [state.lockedPeriodIds, selectedPeriod.id]
  );

  // Current day entry
  const currentEntry: DayEntry = useMemo(() => {
    return state.entries[state.selectedDateISO] || makeDefaultEntry(state.selectedDateISO);
  }, [state.entries, state.selectedDateISO]);

  const setEntry = (patch: Partial<DayEntry>) => {
    if (isLocked) return;
    setState((prev) => {
      const existing = prev.entries[prev.selectedDateISO] || makeDefaultEntry(prev.selectedDateISO);
      const nextEntry: DayEntry = { ...existing, ...patch };
      return { ...prev, entries: { ...prev.entries, [prev.selectedDateISO]: nextEntry } };
    });
  };

  const clearDay = () => {
    if (isLocked) return;
    setState((prev) => {
      const copy = { ...prev.entries };
      delete copy[prev.selectedDateISO];
      return { ...prev, entries: copy };
    });
  };

  // Saved dots for month view (any entry saved that month)
  const savedDatesInMonth = useMemo(() => {
    const all = Object.keys(state.entries);
    const monthStr = format(monthStart, "yyyy-MM");
    return new Set(all.filter((d) => d.startsWith(monthStr)));
  }, [state.entries, monthStart]);

  // Entries inside selected period for totals/pdf
  const periodEntries = useMemo(() => {
    const out: DayEntry[] = [];
    for (const [dateISO, entry] of Object.entries(state.entries)) {
      if (inRangeISO(dateISO, selectedPeriod.startISO, selectedPeriod.endISO)) out.push(entry);
    }
    out.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
    return out;
  }, [state.entries, selectedPeriod.startISO, selectedPeriod.endISO]);

  const totals = useMemo(() => {
    const hours = periodEntries.reduce((acc, e) => acc + clampNum(e.hours, 0), 0);
    const expenses = periodEntries.reduce((acc, e) => {
      const sum = (e.expenses || []).reduce((a, x) => a + clampNum(x.amount, 0), 0);
      return acc + sum;
    }, 0);

    // Pay is not calculated
    return { hours: round2(hours), expenses: round2(expenses), pay: 0 };
  }, [periodEntries]);

  /** ---------- Calendar grid (month) ---------- */
  const days = useMemo(() => {
    const count = getDaysInMonth(monthStart);
    const firstDay = monthStart.getDay(); // 0 Sun .. 6 Sat
    const leading = firstDay; // Sunday-start grid

    const cells: { date: Date | null; iso?: string }[] = [];
    for (let i = 0; i < leading; i++) cells.push({ date: null });

    for (let d = 1; d <= count; d++) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
      const iso = format(date, "yyyy-MM-dd");
      cells.push({ date, iso });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null });
    return cells;
  }, [monthStart]);

  /** ---------- Expenses helpers ---------- */
  const addExpense = () => {
    if (isLocked) return;
    const ex = currentEntry.expenses || [];
    setEntry({ expenses: [...ex, { id: uid("exp"), type: "Taxi", amount: 0, note: "" }] });
  };
  const updateExpense = (id: string, patch: Partial<{ type: ExpenseType; amount: number; note: string }>) => {
    if (isLocked) return;
    const ex = (currentEntry.expenses || []).map((e) => (e.id === id ? { ...e, ...patch } : e));
    setEntry({ expenses: ex });
  };
  const removeExpense = (id: string) => {
    if (isLocked) return;
    const ex = (currentEntry.expenses || []).filter((e) => e.id !== id);
    setEntry({ expenses: ex });
  };

  /** ---------- Lock / Unlock ---------- */
  const submitLock = () => {
    setState((prev) => {
      if (prev.lockedPeriodIds.includes(selectedPeriod.id)) return prev;
      return { ...prev, lockedPeriodIds: [...prev.lockedPeriodIds, selectedPeriod.id] };
    });
  };
  const unlockAdmin = () => {
    const pass = window.prompt("Admin password:");
    if (pass !== ADMIN_PASSWORD) {
      alert("Wrong password.");
      return;
    }
    setState((prev) => ({
      ...prev,
      lockedPeriodIds: prev.lockedPeriodIds.filter((id) => id !== selectedPeriod.id),
    }));
  };

  /** ---------- PDF Export (selected period only) ---------- */
  const exportPdfPeriod = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40;
    let y = margin;

    doc.setFontSize(18);
    doc.text("WindPro TimeSheet", margin, y);
    y += 18;

    doc.setFontSize(10);
    doc.text(`Login email: ${state.loginEmail || "-"}`, margin, y);
    y += 14;

    doc.text(`Period: ${selectedPeriod.label}`, margin, y);
    y += 14;

    doc.text(`Range: ${selectedPeriod.startISO} → ${selectedPeriod.endISO}`, margin, y);
    y += 14;

    doc.text(`Invoice date: ${selectedPeriod.invoiceDateISO}`, margin, y);
    y += 16;

    doc.text(`Hours (period): ${totals.hours}`, margin, y);
    y += 12;

    doc.text(`Expenses (period): € ${totals.expenses}`, margin, y);
    y += 12;

    doc.text(`Pay (period): € ${totals.pay} (rates are individual, not calculated)`, margin, y);
    y += 18;

    doc.setFontSize(11);
    doc.text("Entries:", margin, y);
    y += 10;

    doc.setFontSize(9);
    const header =
      "Date | Work type | Hours | Location | Service Worker | Platform | Vessel | Work done | Comment | Expenses";
    doc.text(header, margin, y);
    y += 10;

    doc.setDrawColor(200);
    doc.line(margin, y, 555, y);
    y += 12;

    for (const e of periodEntries) {
      const expSum = round2((e.expenses || []).reduce((a, x) => a + clampNum(x.amount, 0), 0));
      const vesselName = (e.vesselManual || e.vesselPreset || "-").trim();

      const row =
        `${e.dateISO} | ${e.workType} | ${round2(e.hours)} | ${trim1(e.location)} | ${trim1(e.serviceWorker)} | ` +
        `${e.platformType} | ${trim1(vesselName)} | ${trim1(e.workDone)} | ${trim1(e.comment)} | € ${expSum}`;

      const lines = doc.splitTextToSize(row, 555 - margin);
      for (const line of lines) {
        if (y > 780) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += 11;
      }
      y += 4;
    }

    y += 10;
    doc.setFontSize(11);
    doc.text("Signature:", margin, y);
    y += 8;

    if (state.signatureDataUrl) {
      try {
        doc.addImage(state.signatureDataUrl, "PNG", margin, y, 250, 70);
        y += 80;
      } catch {
        doc.setFontSize(9);
        doc.text("(Signature image could not be embedded)", margin, y);
      }
    } else {
      doc.setFontSize(9);
      doc.text("(No signature saved)", margin, y);
    }

    doc.save(`WindPro_TimeSheet_${selectedPeriod.id}.pdf`);
  };

  /** ---------- Signature (canvas) ---------- */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const sigPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const yy = e.clientY - rect.top;

    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, yy);
  };

  const sigPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const yy = e.clientY - rect.top;

    ctx.lineTo(x, yy);
    ctx.stroke();
  };

  const sigPointerUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
  };

  const signatureSave = () => {
    if (isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    setState((prev) => ({ ...prev, signatureDataUrl: url }));
  };

  const signatureClear = () => {
    if (isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setState((prev) => ({ ...prev, signatureDataUrl: null }));
  };

  /** ---------- UI ---------- */

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: 18, fontFamily: "Georgia, 'Times New Roman', serif" }}>
      {/* Header (changed) */}
      <h1 style={{ margin: "0 0 4px 0" }}>WindPro TimeSheet</h1>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>
        PDF doar pe perioada selectată (luna). Submit = export + lock. Unlock = admin.
      </div>

      {/* Top bar */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr auto auto auto",
          gap: 12,
          alignItems: "center",
          padding: 14,
          borderRadius: 14,
          border: "1px solid #eee",
          background: "white",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
          <div style={{ opacity: 0.8 }}>Login email:</div>
          <input
            value={state.loginEmail}
            onChange={(e) => setState((p) => ({ ...p, loginEmail: e.target.value }))}
            placeholder="ex: borot@windpro.pl"
            style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
          <div style={{ opacity: 0.8 }}>Pay period:</div>
          <select
            value={state.selectedPeriodId}
            onChange={(e) => setState((p) => ({ ...p, selectedPeriodId: e.target.value }))}
            style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={exportPdfPeriod}
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #1f5eff",
            background: "#1f5eff",
            color: "white",
            fontWeight: 700,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Export PDF (Period)
        </button>

        <button
          onClick={() => {
            exportPdfPeriod();
            submitLock();
          }}
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #178a3a",
            background: "#178a3a",
            color: "white",
            fontWeight: 700,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Submit (Lock Period)
        </button>

        <button
          onClick={unlockAdmin}
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #f0bcbc",
            background: "white",
            color: "#b55",
            fontWeight: 700,
            cursor: "pointer",
            whiteSpace: "nowrap",
            opacity: 0.85,
          }}
        >
          Unlock (Admin)
        </button>
      </div>

      {/* Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr", gap: 14, marginTop: 14 }}>
        <Card title="Selected period" big={selectedPeriod.label}>
          <div>
            {selectedPeriod.startISO} → {selectedPeriod.endISO} | Invoice {selectedPeriod.invoiceDateISO}
          </div>
          <div style={{ marginTop: 6, color: isLocked ? "#b55" : "#1f5eff", fontWeight: 700 }}>
            {isLocked ? "Locked" : "Editable"}
          </div>
        </Card>

        <Card title="Hours (period)" big={totals.hours.toFixed(2)}>
          <div style={{ opacity: 0.7 }}>Sum of hours inside selected month</div>
        </Card>

        <Card title="Expenses (period)" big={`€ ${totals.expenses.toFixed(2)}`}>
          <div style={{ opacity: 0.7 }}>Sum of expenses inside selected month</div>
        </Card>

        <Card title="Pay (period)" big={`€ ${totals.pay.toFixed(2)}`}>
          <div style={{ opacity: 0.7 }}>Not calculated (individual rates)</div>
        </Card>
      </div>

      {/* Main area */}
      <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 16, marginTop: 16 }}>
        {/* LEFT: Month Calendar + Signature */}
        <div style={{ borderRadius: 14, border: "1px solid #eee", padding: 16, background: "white" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{monthLabel}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() =>
                  setState((p) => ({ ...p, selectedDateISO: format(subMonths(selectedDate, 1), "yyyy-MM-dd") }))
                }
                style={iconBtn}
                title="Prev month"
              >
                ‹
              </button>
              <button
                onClick={() =>
                  setState((p) => ({ ...p, selectedDateISO: format(addMonths(selectedDate, 1), "yyyy-MM-dd") }))
                }
                style={iconBtn}
                title="Next month"
              >
                ›
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 12, opacity: 0.75 }}>
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <div key={d} style={{ textAlign: "center" }}>
                {d}
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 10 }}>
            {days.map((cell, idx) => {
              if (!cell.date || !cell.iso) return <div key={idx} style={{ height: 44 }} />;
              const isSelected = cell.iso === state.selectedDateISO;
              const saved = savedDatesInMonth.has(cell.iso);

              return (
                <button
                  key={cell.iso}
                  onClick={() => setState((p) => ({ ...p, selectedDateISO: cell.iso! }))}
                  style={{
                    height: 44,
                    borderRadius: 999,
                    border: isSelected ? "3px solid #1f5eff" : "1px solid transparent",
                    background: "white",
                    cursor: "pointer",
                    position: "relative",
                    fontWeight: 700,
                  }}
                >
                  {format(cell.date, "d")}
                  {saved && (
                    <>
                      <span style={dotStyle(-5)} />
                      <span style={dotStyle(5)} />
                    </>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, opacity: 0.7 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#1f5eff", display: "inline-block" }} />
            <span>days with saved entry</span>
          </div>

          {/* Signature */}
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Signature</div>

            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button onClick={signatureSave} style={smallBtn} disabled={isLocked}>
                Save
              </button>
              <button onClick={signatureClear} style={smallBtn} disabled={isLocked}>
                Clear
              </button>
            </div>

            <div style={{ opacity: 0.7, marginBottom: 10 }}>Semnează aici. Pentru PDF trebuie să dai Save.</div>

            <canvas
              ref={canvasRef}
              width={360}
              height={150}
              onPointerDown={sigPointerDown}
              onPointerMove={sigPointerMove}
              onPointerUp={sigPointerUp}
              onPointerLeave={sigPointerUp}
              style={{
                width: "100%",
                height: 150,
                borderRadius: 12,
                border: "1px solid #ddd",
                background: "white",
                touchAction: "none",
                opacity: isLocked ? 0.6 : 1,
              }}
            />

            {state.signatureDataUrl && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#178a3a", fontWeight: 700 }}>Signature saved ✅</div>
            )}
          </div>
        </div>

        {/* RIGHT: Day Editor */}
        <div style={{ borderRadius: 14, border: "1px solid #eee", padding: 16, background: "white" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{format(selectedDate, "EEEE, MMMM dd, yyyy")}</div>
              <div style={{ marginTop: 6, opacity: 0.8 }}>
                <div>
                  Date: <b>{state.selectedDateISO}</b>
                </div>
                <div>
                  Pay Period: <b>{selectedPeriod.label}</b>
                </div>
                <div>
                  Range: {selectedPeriod.startISO} → {selectedPeriod.endISO}
                </div>
                <div>Invoice date: {selectedPeriod.invoiceDateISO}</div>
              </div>
            </div>

            <button onClick={clearDay} style={{ ...smallBtn, borderColor: "#f0bcbc", color: "#b55" }} disabled={isLocked}>
              Clear day
            </button>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Work</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12 }}>
              <label>
                <div style={lbl}>Work type</div>
                <select
                  value={currentEntry.workType}
                  disabled={isLocked}
                  onChange={(e) => setEntry({ workType: e.target.value as WorkType })}
                  style={input}
                >
                  {WORK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={lbl}>Hours</div>
                <input
                  value={currentEntry.hours}
                  disabled={isLocked}
                  onChange={(e) => setEntry({ hours: clampNum(e.target.value, 0) })}
                  type="number"
                  min={0}
                  step="0.25"
                  style={input}
                />
              </label>
            </div>

            <div style={{ marginTop: 10, opacity: 0.6 }}>Rate/Pay are not calculated (each person has different rate).</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
              <label>
                <div style={lbl}>Location</div>
                <input
                  value={currentEntry.location}
                  disabled={isLocked}
                  onChange={(e) => setEntry({ location: e.target.value })}
                  placeholder="ex: Borssele"
                  style={input}
                />
              </label>

              <label>
                <div style={lbl}>Service Worker</div>
                <input
                  value={currentEntry.serviceWorker}
                  disabled={isLocked}
                  onChange={(e) => setEntry({ serviceWorker: e.target.value })}
                  placeholder="ex: 67008943"
                  style={input}
                />
              </label>
            </div>

            <label style={{ display: "block", marginTop: 14 }}>
              <div style={lbl}>How / Work done</div>
              <input
                value={currentEntry.workDone}
                disabled={isLocked}
                onChange={(e) => setEntry({ workDone: e.target.value })}
                placeholder="HV test, torque check..."
                style={input}
              />
            </label>

            <label style={{ display: "block", marginTop: 14 }}>
              <div style={lbl}>Comment</div>
              <input
                value={currentEntry.comment}
                disabled={isLocked}
                onChange={(e) => setEntry({ comment: e.target.value })}
                placeholder="notes..."
                style={input}
              />
            </label>

            {/* Expenses */}
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Expenses</div>
                <button onClick={addExpense} style={smallBtn} disabled={isLocked}>
                  + Add
                </button>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {(currentEntry.expenses || []).map((ex) => (
                  <div
                    key={ex.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "220px 140px 1fr 80px",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <select
                      value={ex.type}
                      disabled={isLocked}
                      onChange={(e) => updateExpense(ex.id, { type: e.target.value as ExpenseType })}
                      style={input}
                    >
                      {EXP_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={ex.amount}
                      disabled={isLocked}
                      onChange={(e) => updateExpense(ex.id, { amount: clampNum(e.target.value, 0) })}
                      style={input}
                      placeholder="Amount"
                    />

                    <input
                      value={ex.note}
                      disabled={isLocked}
                      onChange={(e) => updateExpense(ex.id, { note: e.target.value })}
                      style={input}
                      placeholder="note..."
                    />

                    <button onClick={() => removeExpense(ex.id)} style={{ ...smallBtn, borderColor: "#eee" }} disabled={isLocked}>
                      ✕
                    </button>
                  </div>
                ))}

                {(currentEntry.expenses || []).length === 0 && <div style={{ opacity: 0.65 }}>No expenses for this day.</div>}
              </div>

              {/* Vessel / Jack-up (under Expenses) */}
              <div style={{ marginTop: 16, padding: 14, borderRadius: 14, border: "1px solid #eee" }}>
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Vessel / Jack-up</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label>
                    <div style={lbl}>Platform</div>
                    <select
                      value={currentEntry.platformType}
                      disabled={isLocked}
                      onChange={(e) => setEntry({ platformType: e.target.value as PlatformType })}
                      style={input}
                    >
                      {PLATFORM_TYPES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                  <label>
                    <div style={lbl}>Vessel (preset)</div>
                    <select
                      value={currentEntry.vesselPreset}
                      disabled={isLocked}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEntry({ vesselPreset: v, vesselManual: currentEntry.vesselManual?.trim() ? currentEntry.vesselManual : v });
                      }}
                      style={input}
                    >
                      {VESSEL_PRESETS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <div style={lbl}>Vessel (manual)</div>
                    <input
                      value={currentEntry.vesselManual}
                      disabled={isLocked}
                      onChange={(e) => setEntry({ vesselManual: e.target.value })}
                      placeholder="ex: Blue Tern"
                      style={input}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          {isLocked && (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #f0bcbc", color: "#b55" }}>
              This month is locked. Use “Unlock (Admin)” to edit.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** --------- SMALL UI COMPONENTS / STYLES ---------- */

function Card({ title, big, children }: { title: string; big: string; children?: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #eee", background: "white", borderRadius: 14, padding: 16 }}>
      <div style={{ opacity: 0.75, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{big}</div>
      <div style={{ opacity: 0.85 }}>{children}</div>
    </div>
  );
}

const input: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 12,
  border: "1px solid #ddd",
  fontFamily: "inherit",
  fontSize: 16,
};

const lbl: React.CSSProperties = {
  opacity: 0.8,
  marginBottom: 6,
};

const smallBtn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
  fontWeight: 700,
};

const iconBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 999,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
  fontSize: 22,
  lineHeight: "40px",
  textAlign: "center",
};

function dotStyle(xOffset: number): React.CSSProperties {
  return {
    position: "absolute",
    bottom: 6,
    left: "50%",
    transform: `translateX(calc(-50% + ${xOffset}px))`,
    width: 6,
    height: 6,
    borderRadius: 999,
    background: "#1f5eff",
  };
}
