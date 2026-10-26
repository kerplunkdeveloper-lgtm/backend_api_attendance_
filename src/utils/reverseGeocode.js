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
        "User-Agent": "WorkPluse/1.0 (attendance punch locations)",
      },
      // Punching waits on this lookup when the app sent no place name, so keep it short.
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return formatNominatim(payload);
  } catch {
    return null;
  }
};

const fallbackPunchLocation = ({ workMode, branchName } = {}) => {
  if (branchName) return branchName;
  if (workMode && WORK_MODE_LABELS[workMode]) return WORK_MODE_LABELS[workMode];
  return "Office";
};

/**
 * The label saved with a punch, shown to admins and HR as "where did they punch".
 *
 * `branchName` must only be passed when the punch was really inside that branch's geofence. Passing the
 * employee's home branch for every punch labelled work-from-home and field punches as "Head Office".
 *
 *  1. Inside a branch, in office mode  -> the branch name
 *  2. Anywhere else                    -> the place from the app, else looked up from the coordinates,
 *                                         prefixed with the work mode when it is not the office
 *  3. Nothing known                    -> the work mode, the branch, or "Office"
 */
const resolvePunchLocation = async ({ locationLabel, latitude, longitude, workMode, branchName } = {}) => {
  const modeLabel = workMode && workMode !== "OFFICE" ? WORK_MODE_LABELS[workMode] : null;

  if (branchName && !modeLabel) return branchName;

  // Raw municipal ward strings like "Ward 62, Chennai, Tamil Nadu" are not useful to a reader.
  const provided = typeof locationLabel === "string" ? locationLabel.trim() : "";
  let place = provided && !/^ward\s+\d+/i.test(provided) ? provided : null;
  if (!place) place = await lookupPlaceName(latitude, longitude);

  if (modeLabel) {
    if (!place || place.toLowerCase().startsWith(modeLabel.toLowerCase())) return (place || modeLabel).slice(0, 180);
    return `${modeLabel} · ${place}`.slice(0, 180);
  }
  if (place) return place.slice(0, 180);

  return fallbackPunchLocation({ workMode, branchName });
};

module.exports = {
  WORK_MODE_LABELS,
  lookupPlaceName,
  fallbackPunchLocation,
  resolvePunchLocation,
};
