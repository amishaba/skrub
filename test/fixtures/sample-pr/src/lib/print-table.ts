import { truncate } from "./text.ts";

export function printTable(columns: string[], rows: string[][]): string {
  const width = 16;
  const line = (cells: string[]) => cells.map((cell) => truncate(cell, width).padEnd(width)).join(" ");
  return [line(columns), ...rows.map(line)].join("\n");
}
