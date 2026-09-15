export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
