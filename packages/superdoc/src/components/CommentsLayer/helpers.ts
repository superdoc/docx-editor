/**
 * Comments helper to format dates from timestamp
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const meridiem = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 || 12;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[date.getMonth()];
  const day = date.getDate();
  const formattedTime = `${formattedHours}:${minutes.toString().padStart(2, '0')}${meridiem}`;
  const formattedDate = `${formattedTime} ${month} ${day}`;
  return formattedDate;
}
