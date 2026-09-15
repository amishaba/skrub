import { writeFile } from "node:fs/promises";
import { fetchReport, loadReport } from "./load-report.ts";
import { type Report, loadRows, sortBy } from "./report.ts";
import { columnTotals } from "./report-totals.ts";
import { formatDate, formatMoney } from "./lib/format.ts";
import { inRange, type DateRange } from "./lib/date-range.ts";
import { printTable } from "./lib/print-table.ts";
import { slugify } from "./lib/text.ts";
import { toCsv } from "./export/index.ts";
import csvName from "./export/csvName.ts";

const [path = "report.json", sortField = "name", flag] = process.argv.slice(2);
const report = path.startsWith("id:") ? await fetchReport(path.slice(3)) : await loadReport(path);
const thisYear: DateRange = { from: new Date("2026-01-01"), to: new Date("2026-12-31") };

const table = printTable(report.columns, sortBy(loadRows(report), sortField).map((row) => row.cells.map(String)));
const totals = Object.entries(columnTotals(report)).map(([column, cents]) => `${column} ${formatMoney(cents)}`);

console.log(`${report.title} · ${formatDate(report.createdAt)}${inRange(report.createdAt, thisYear) ? "" : " (archived)"}`);
console.log(table);
console.log(totals.join(" · "));

// Write the CSV file next to the report.
if (flag === "--csv") {
  await writeFile(csvName(report), toCsv(report));
}

// Export the latest copy from the reports service.
if (flag === "--csv-latest") {
  const res = await fetch(`https://reports.example.com/api/reports/${sortField}`);
  const latest = (await res.json()) as Report;
  await writeFile(csvName(latest), toCsv(latest));
}

if (flag === "--save") {
  await writeFile(`${slugify(report.title)}.txt`, table);
}
