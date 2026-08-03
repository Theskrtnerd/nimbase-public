export type NimbaseEdition = "cloud" | "community";

export function nimbaseEdition(): NimbaseEdition {
  const value = process.env.NIMBASE_EDITION ?? "cloud";
  if (value === "cloud" || value === "community") return value;
  throw new Error(
    `Invalid NIMBASE_EDITION: expected "cloud" or "community", received "${value}"`,
  );
}

export function isCommunityEdition(): boolean {
  return nimbaseEdition() === "community";
}
