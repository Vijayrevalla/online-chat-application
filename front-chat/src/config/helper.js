export function timeAgo(date) {
  if (!date) return "";

  const now = new Date();
  let pastLocal;
  let pastUtc;

  if (Array.isArray(date)) {
    // Array format: [year, month, day, hour, minute, second, nanoseconds]
    const [year, month, day, hour = 0, minute = 0, second = 0, nano = 0] = date;
    const ms = Math.floor(nano / 1000000);
    pastLocal = new Date(year, month - 1, day, hour, minute, second, ms);
    pastUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  } else if (typeof date === "string") {
    // Normalize format (spaces to 'T', truncate sub-millisecond nanoseconds)
    let sanitized = date.replace(" ", "T");
    sanitized = sanitized.replace(/\.(\d{3})\d+/, ".$1");

    pastLocal = new Date(sanitized);
    if (sanitized.includes("T") && !sanitized.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(sanitized)) {
      pastUtc = new Date(sanitized + "Z");
    } else {
      pastUtc = pastLocal;
    }
  } else {
    pastLocal = new Date(date);
    pastUtc = pastLocal;
  }

  let past = pastUtc; // Default to UTC interpretation
  if (!Number.isNaN(pastLocal.getTime()) && !Number.isNaN(pastUtc.getTime())) {
    const diffUtc = now - pastUtc;

    // If parsing as UTC puts the date more than 10 minutes into the future,
    // then the server timestamp was likely already in local time, so we fall back to local.
    if (diffUtc < -600000) {
      past = pastLocal;
    }
  } else if (!Number.isNaN(pastLocal.getTime())) {
    past = pastLocal;
  }

  if (Number.isNaN(past.getTime())) {
    return "";
  }

  // Format exactly like WhatsApp: e.g., "5:59 pm"
  let hours = past.getHours();
  const minutes = past.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  
  return `${hours}:${minutes} ${ampm}`;
}
