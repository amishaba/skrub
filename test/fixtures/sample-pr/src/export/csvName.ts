import type { Report } from "../report.ts";
import { slugify } from "../lib/text.ts";

export default function csvName(report: Report): string {
  return `${slugify(report.title)}.csv`;
}
