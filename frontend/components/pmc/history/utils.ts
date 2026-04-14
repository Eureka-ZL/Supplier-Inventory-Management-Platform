export const parseUTCEventTime = (timeStr: string) => {
  if (!timeStr) return new Date();
  const safeStr = timeStr.includes('Z') || timeStr.includes('+') ? timeStr : timeStr.replace(' ', 'T') + 'Z';
  return new Date(safeStr);
};
