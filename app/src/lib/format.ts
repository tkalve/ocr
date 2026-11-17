/** A file size in the largest unit that keeps the number short, e.g. "1.4 MB". */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const text = value >= 10 || unit === 0 ? Math.round(value).toString() : value.toFixed(1)
  return `${text} ${units[unit]}`
}
