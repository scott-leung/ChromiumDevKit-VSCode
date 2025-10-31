/**
 * Format date according to the specified format
 * @param date Date object to format
 * @param format Date format string
 * @returns Formatted date string
 */
export function formatDate(date: Date, format: 'YYYY/MM/DD' | 'YYYY-MM-DD' | 'MM/DD/YYYY'): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  switch (format) {
    case 'YYYY/MM/DD':
      return `${year}/${month}/${day}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
  }
}

/**
 * Get current year as string
 */
export function getCurrentYear(): string {
  return new Date().getFullYear().toString();
}
