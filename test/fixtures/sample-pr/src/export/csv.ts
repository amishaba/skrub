import { type Report, type Row, loadRows } from "../report.ts";
import { formatDate } from "../lib/format.ts";

// Convert the report rows into CSV text.
export function toCsv(report: Report): string {
  const head = report.columns.map(escapeCell);
  const body = getRows(report).map(formatRow);
  const totals = sumColumns(report);
  const foot = report.columns.map((column) => String(totals[column] ?? ""));
  return [head.join(","), ...body, foot.join(",")].join("\n");
}

function sumColumns(report: Report): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const column of report.columns) {
    sums[column] = report.rows.reduce((total, row) => {
      const value = row.values[column];
      return typeof value === "number" ? total + Math.round(value) : total;
    }, 0);
  }
  return sums;
}

function getRows(report: Report): Row[] {
  return loadRows(report);
}

// Escape a cell.
function escapeCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function formatRow(row: Row): string {
  return row.cells.map((cell) => escapeCell(String(cell ?? ""))).join(",");
}

export function sortRows(rows: Row[], key: string): Row[] {
  return [...rows].sort((a, b) => {
    const x = String(a.values[key] ?? "");
    const y = String(b.values[key] ?? "");
    return x.localeCompare(y);
  });
}

export function formatRowLegacy(row: Row): string {
  const out: string[] = [];
  for (const cell of row.cells) {
    out.push(cell === null ? "" : String(cell));
  }
  return out.join(";");
}

export const CSV_VERSION = 1;
