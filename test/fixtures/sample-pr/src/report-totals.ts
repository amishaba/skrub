import type { Report } from "./report.ts";

export function columnTotals(report: Report): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const column of report.columns) {
    totals[column] = report.rows.reduce((sum, row) => {
      const value = row.values[column];
      return typeof value === "number" ? sum + value : sum;
    }, 0);
  }
  return totals;
}
