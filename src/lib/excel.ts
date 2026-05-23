import * as XLSX from "xlsx";
import { format } from "date-fns";
import { formatHm, ranges, type Session, type Shift } from "@/lib/stats";
import { computeDailyTotals } from "@/lib/notion.functions";

type Period = "day" | "week" | "month" | "year";

function inRange<T extends { start: string }>(rows: T[], period: Period) {
  const r = ranges()[period];
  return rows.filter((row) => {
    const t = new Date(row.start).getTime();
    return t >= r.from.getTime() && t <= r.to.getTime();
  });
}

export function exportToExcel(shifts: Shift[], sessions: Session[], period: Period) {
  const now = Date.now();

  const drivingRows = inRange(
    sessions.map((s) => ({ start: s.start_at, _s: s })),
    period,
  ).map(({ _s: s }) => {
    const start = new Date(s.start_at);
    const end = s.end_at ? new Date(s.end_at) : null;
    const durMs = (end ? end.getTime() : now) - start.getTime();
    const km = s.km_start != null && s.km_end != null
      ? Math.max(0, s.km_end - s.km_start) : null;
    return {
      Date: format(start, "yyyy-MM-dd"),
      Bus: s.bus_reference ?? "",
      Start: format(start, "HH:mm"),
      Stop: end ? format(end, "HH:mm") : "live",
      Duration: formatHm(durMs),
      "Duration (min)": Math.round(durMs / 60000),
      "km start": s.km_start ?? "",
      "km stop": s.km_end ?? "",
      "Distance (km)": km ?? "",
    };
  });

  const dutyRows = inRange(
    shifts.map((s) => ({ start: s.on_duty_at, _s: s })),
    period,
  ).map(({ _s: s }) => {
    const start = new Date(s.on_duty_at);
    const end = s.off_duty_at ? new Date(s.off_duty_at) : null;
    const durMs = (end ? end.getTime() : now) - start.getTime();
    return {
      Date: format(start, "yyyy-MM-dd"),
      "On duty": format(start, "HH:mm"),
      "Off duty": end ? format(end, "HH:mm") : "live",
      Duration: formatHm(durMs),
      "Duration (min)": Math.round(durMs / 60000),
    };
  });

  const totals = computeDailyTotals(
    inRange(shifts.map((s) => ({ start: s.on_duty_at, _s: s })), period).map((x) => x._s),
    inRange(sessions.map((s) => ({ start: s.start_at, _s: s })), period).map((x) => x._s),
  ).map((t) => ({
    Date: t.date,
    "On duty": formatHm(t.onDutyMs),
    "On duty (min)": Math.round(t.onDutyMs / 60000),
    Driving: formatHm(t.drivingMs),
    "Driving (min)": Math.round(t.drivingMs / 60000),
    "Driving %": Math.round(t.percent * 10) / 10,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dutyRows), "On duty");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(drivingRows), "Driving");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(totals), "Daily totals");

  const stamp = format(new Date(), "yyyy-MM-dd_HHmm");
  XLSX.writeFile(wb, `bus-tracker_${period}_${stamp}.xlsx`);
}
