/**
 * GPS Geofencing Utility using the Haversine Formula.
 * Calculates great-circle distance between two geographic coordinates on Earth in meters.
 */

const EARTH_RADIUS_METERS = 6371000; // 6,371 km in meters

/**
 * Converts degrees to radians.
 */
const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * Calculates distance in meters between two lat/lng points.
 * @param {number} lat1 Latitude of point 1
 * @param {number} lon1 Longitude of point 1
 * @param {number} lat2 Latitude of point 2
 * @param {number} lon2 Longitude of point 2
 * @returns {number} Distance in meters (rounded to 1 decimal place)
 */
const calculateDistanceMeters = (lat1, lon1, lat2, lon2) => {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = EARTH_RADIUS_METERS * c;
  return Math.round(distance * 10) / 10;
};

/**
 * Validates whether coordinates are within branch geofence boundary.
 * @param {object} userCoords { latitude, longitude }
 * @param {object} branchCoords { latitude, longitude, radiusMeters }
 * @returns {object} { isInside: boolean, distanceMeters: number, allowedRadiusMeters: number }
 */
const verifyGeofence = (userCoords, branchCoords) => {
  if (userCoords?.latitude == null || userCoords?.longitude == null) {
    return {
      isInside: true,
      distanceMeters: 0,
      allowedRadiusMeters: branchCoords?.radiusMeters || 200,
      bypassed: true,
    };
  }

  // If branch doesn't have coordinates configured, permit check-in
  if (!branchCoords?.latitude || !branchCoords?.longitude) {
    return {
      isInside: true,
      distanceMeters: 0,
      allowedRadiusMeters: branchCoords?.radiusMeters || 200,
      bypassed: true,
    };
  }

  const userLat = parseFloat(userCoords.latitude);
  const userLon = parseFloat(userCoords.longitude);
  const branchLat = parseFloat(branchCoords.latitude);
  const branchLon = parseFloat(branchCoords.longitude);
  const radius = branchCoords.radiusMeters || 200;

  const distanceMeters = calculateDistanceMeters(userLat, userLon, branchLat, branchLon);
  const isInside = distanceMeters <= radius;

  return {
    isInside,
    distanceMeters,
    allowedRadiusMeters: radius,
    bypassed: false,
  };
};

const formatDistance = (meters) =>
  meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;

/**
 * Decides whether an "office only" check-in should be refused and, if so, why,
 * in words an employee can act on.
 *
 * @param {object} input
 * @param {number|null} input.latitude
 * @param {number|null} input.longitude
 * @param {number|null} input.accuracy  Reported GPS accuracy radius in metres.
 * @param {Array<{name: string, latitude: any, longitude: any, radiusMeters?: number}>} input.branches
 *   Branches that have coordinates configured.
 * @param {boolean} [input.allowWfh] Whether to suggest Work From Home as an alternative.
 * @returns {null | {code: string, message: string, details: object}} null when allowed.
 */
const officeOnlyRejection = ({ latitude, longitude, accuracy, branches, allowWfh = false }) => {
  if (!branches?.length) return null;

  if (latitude == null || longitude == null) {
    return {
      code: "LOCATION_REQUIRED",
      message:
        "Turn on location to check in. Your company allows check-in only from the office, so we need your location to confirm you're there.",
      details: {},
    };
  }

  const measured = branches.map((b) => ({
    name: b.name,
    radius: b.radiusMeters || 200,
    distance: calculateDistanceMeters(
      parseFloat(latitude),
      parseFloat(longitude),
      parseFloat(b.latitude),
      parseFloat(b.longitude),
    ),
  }));

  if (measured.some((b) => b.distance <= b.radius)) return null;

  // "Nearest" means closest to its boundary, not its centre.
  const nearest = measured.reduce((best, b) => (b.distance - b.radius < best.distance - best.radius ? b : best));
  const details = {
    branchName: nearest.name,
    distanceMeters: Math.round(nearest.distance),
    allowedRadiusMeters: nearest.radius,
    accuracyMeters: accuracy != null ? Math.round(Number(accuracy)) : null,
  };

  // A fuzzy fix whose error circle still reaches the office is not proof the
  // person is away — ask for a better fix instead of calling them "outside".
  const acc = Number(accuracy);
  if (Number.isFinite(acc) && acc > nearest.radius && nearest.distance - acc <= nearest.radius) {
    return {
      code: "LOCATION_IMPRECISE",
      message: `We couldn't pinpoint your location (accurate only to about ${formatDistance(acc)}). Turn on GPS or precise location, move near a window, and try again. On a laptop, checking in from your phone usually works better.`,
      details,
    };
  }

  return {
    code: "OUTSIDE_OFFICE",
    message: `You're about ${formatDistance(nearest.distance)} from ${nearest.name || "your office"}. Check-in is allowed within ${formatDistance(nearest.radius)} of the office. Working somewhere else today? Choose ${allowWfh ? "Work from home, " : ""}Client visit or Travel when you check in.`,
    details,
  };
};

module.exports = {
  calculateDistanceMeters,
  verifyGeofence,
  formatDistance,
  officeOnlyRejection,
};
