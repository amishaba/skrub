export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// helper
export function helper(value: number): string {
  return value.toFixed(2);
}
