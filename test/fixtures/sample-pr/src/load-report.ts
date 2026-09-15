import { readFile } from "node:fs/promises";
import type { Report, Row } from "./report.ts";

interface ReportFile {
  title: string;
  createdAt: string;
  columns: string[];
  rows: Row[];
}

function toReport(raw: ReportFile): Report {
  return { ...raw, createdAt: new Date(raw.createdAt) };
}

export async function loadReport(path: string): Promise<Report> {
  return toReport(JSON.parse(await readFile(path, "utf8")) as ReportFile);
}

export async function fetchReport(id: string): Promise<Report> {
  const res = await fetch(`https://reports.example.com/api/reports/${id}`);
  return toReport((await res.json()) as ReportFile);
}
