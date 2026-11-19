/** YYYY-MM-DD in India, `days` from today. */
export function istDate(days = 0) {
  return new Date(Date.now() + 5.5 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}
