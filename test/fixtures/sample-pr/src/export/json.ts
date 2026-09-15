import type { Report } from "../report.ts";

export function toJson(report: Report): string {
  const rows = report.rows.map((row) => row.cells);
  return JSON.stringify({ title: report.title, columns: report.columns, rows }, null, 2);
}
