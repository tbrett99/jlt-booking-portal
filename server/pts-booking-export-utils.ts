export const PTS_BOOKING_EXPORT_HEADERS = [
  "Title",
  "First Name - Mandatory",
  "Last Name",
  "Email - Mandatory",
  "Phone - Mandatory",
  "Enquiry Type - Mandatory",
  "Address",
  "Assigned User - Mandatory",
  "Country - Mandatory",
  "City/Resort",
  "Destination - Mandatory",
  "Travel Date - Mandatory",
  "No of Passengers - Mandatory",
  "No of Nights - Mandatory",
  "Booking Type - Mandatory",
  "Payment Reference",
] as const;

/** These are the same operational columns counted as awaiting addition to PTS. */
export const PTS_EXPORT_ELIGIBLE_STAGES = [
  "New Booking",
  "Incomplete Booking",
  "Query",
  "Reimb Docs Missing",
  "Urgent/Reimb",
  "T/O Package",
  "DP",
] as const;

export function isPtsExportEligibleStage(stage: string): boolean {
  return (PTS_EXPORT_ELIGIBLE_STAGES as readonly string[]).includes(stage);
}

export type PtsBookingExportSource = {
  bookingId: number;
  clientName: string;
  agentName: string | null;
  agentEmail: string | null;
  country: string | null;
  departureDate: Date | string;
  passengers: number | null;
  numberOfNights: number | null;
  orbitRef: string | null;
  ptsRef?: string | null;
};

/** A saved PTS reference means the booking has already been created in PTS. */
export function hasExistingPtsReference(ptsRef: string | null | undefined): boolean {
  return typeof ptsRef === "string" && ptsRef.trim().length > 0;
}

/** Defence in depth for callers in addition to the database eligibility filter. */
export function canExportPtsBooking(row: Pick<PtsBookingExportSource, "ptsRef">): boolean {
  return !hasExistingPtsReference(row.ptsRef);
}

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "mx"]);

function protectCsvCell(value: unknown): string {
  const text = String(value ?? "");
  // Prevent spreadsheet formula interpretation when data is opened in Excel.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function splitClientName(clientName: string): { title: string; firstName: string; lastName: string } {
  const parts = clientName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { title: "Mr", firstName: "", lastName: "" };

  const possibleTitle = parts[0].replace(/\.$/, "").toLowerCase();
  const title = TITLES.has(possibleTitle) ? parts.shift()!.replace(/\.$/, "") : "Mr";
  const firstName = parts.shift() ?? "";
  return { title, firstName, lastName: parts.join(" ") };
}

function formatTravelDate(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

export function buildPtsBookingCsv(rows: PtsBookingExportSource[]): string {
  const dataRows = rows.map((row) => {
    const name = splitClientName(row.clientName);
    return [
      name.title,
      name.firstName,
      name.lastName,
      row.agentEmail ?? "",
      "000000000000",
      "Website",
      "",
      "aaa JLT Admin",
      row.country ?? "",
      "",
      row.agentName ?? "",
      formatTravelDate(row.departureDate),
      row.passengers ?? "",
      row.numberOfNights ?? "",
      "Flight Only",
      row.orbitRef ?? "",
    ].map(protectCsvCell).join(",");
  });

  return [PTS_BOOKING_EXPORT_HEADERS.map(protectCsvCell).join(","), ...dataRows].join("\r\n");
}
