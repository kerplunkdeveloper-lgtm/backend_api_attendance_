const WORK_MODE_LABELS = {
  OFFICE: "Office",
  WORK_FROM_HOME: "Work from home",
  CLIENT_VISIT: "Client visit",
  TRAVEL: "Travel / field",
  SHOOT: "On-site shoot",
};

const formatNominatim = (payload) => {
  const address = payload?.address || {};
  const locality =
    address.neighbourhood ||
    address.suburb ||
    address.village ||
    address.hamlet ||
    address.city_district ||
    address.road;
  const city = address.city || address.town || address.municipality || address.county;
  const state = address.state;
  const parts = [locality, city, state].filter(Boolean);
  const unique = [...new Set(parts.map((part) => String(part).trim()).filter(Boolean))];
  if (unique.length) return unique.join(", ").slice(0, 180);
  const display = String(payload?.display_name || "")
    .split(",")
    .slice(0, 3)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  return display ? display.slice(0, 180) : null;
};

const lookupPlaceName = async (latitude, longitude) => {
  if (latitude == null || longitude == null || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    return null;
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("zoom", "16");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "WorkPulse/1.0 (attendance punch locations)",
      },
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return formatNominatim(payload);
  } catch {
    return null;
  }
};

const fallbackPunchLocation = ({ workMode, branchName } = {}) => {
  if (workMode && WORK_MODE_LABELS[workMode]) return WORK_MODE_LABELS[workMode];
  if (branchName) return branchName;
  return "Location not shared";
};

const resolvePunchLocation = async ({ locationLabel, latitude, longitude, workMode, branchName } = {}) => {
  const provided = typeof locationLabel === "string" ? locationLabel.trim() : "";
  if (provided) return provided.slice(0, 180);
  const lookedUp = await lookupPlaceName(latitude, longitude);
  if (lookedUp) return lookedUp;
  return fallbackPunchLocation({ workMode, branchName });
};

module.exports = {
  WORK_MODE_LABELS,
  lookupPlaceName,
  fallbackPunchLocation,
  resolvePunchLocation,
};
