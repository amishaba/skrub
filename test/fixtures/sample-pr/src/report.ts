export interface Row {
  cells: (string | number | null)[];
  values: Record<string, string | number>;
}

export interface Report {
  title: string;
  createdAt: Date;
  columns: string[];
  rows: Row[];
}

export function loadRows(report: Report): Row[] {
  return report.rows.filter((row) => row.cells.length === report.columns.length);
}

export function sortBy(items: Row[], field: string): Row[] {
  return [...items].sort((a, b) => {
    const left = String(a.values[field] ?? "");
    const right = String(b.values[field] ?? "");
    return left.localeCompare(right);
  });
}

import { sortRows } from "./export/csv.ts";
// TODO: implement csv export
export const data = { exportEnabled: true };
