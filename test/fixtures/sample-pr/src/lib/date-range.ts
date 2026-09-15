export interface DateRange {
  from: Date;
  to: Date;
}

export function inRange(date: Date, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}
