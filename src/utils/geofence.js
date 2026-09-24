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
    throw new Error("GPS coordinates (latitude, longitude) are required for check-in");
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

module.exports = {
  calculateDistanceMeters,
  verifyGeofence,
};
