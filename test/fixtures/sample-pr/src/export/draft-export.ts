// First pass at exporting. Replaced by csv.ts.
import type { Report } from "../report.ts";

export function exportReport(report: Report, format: "csv" | "json"): string {
  return format === "csv"
    ? report.rows.map((row) => row.cells.join(",")).join("\n")
    : JSON.stringify(report.rows);
}
