/** Geofence inputs. A bad radius or coordinate silently breaks (or disables) check-in rules for the whole branch. */

const MIN_RADIUS_METERS = 20;
const MAX_RADIUS_METERS = 10000;

const fail = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
};

const isBlank = (value) => value === undefined || value === null || value === "";

const parseCoordinate = (label, value, limit) => {
  if (isBlank(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) fail(`${label} must be a number between ${-limit} and ${limit}.`);
  return parsed;
};

/** Returns { latitude, longitude } (both null, or both numbers). */
const parseCoordinates = (latitude, longitude) => {
  const lat = parseCoordinate("Latitude", latitude, 90);
  const lng = parseCoordinate("Longitude", longitude, 180);
  if ((lat === null) !== (lng === null)) fail("Provide both latitude and longitude, or neither.");
  return { latitude: lat, longitude: lng };
};

const parseRadius = (value, fallback = 200) => {
  if (isBlank(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_RADIUS_METERS || parsed > MAX_RADIUS_METERS) {
    fail(`Check-in radius must be a whole number of metres between ${MIN_RADIUS_METERS} and ${MAX_RADIUS_METERS}.`);
  }
  return parsed;
};

module.exports = { parseCoordinates, parseRadius, MIN_RADIUS_METERS, MAX_RADIUS_METERS };
