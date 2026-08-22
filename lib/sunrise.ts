/**
 * Sunrise time for a given date and location, as UTC hours (0..24).
 *
 * The classic US Naval Observatory almanac algorithm — accurate to a minute or
 * two, which is plenty for "sync around sunrise". Returns null on the rare
 * polar day/night where the sun doesn't cross the horizon.
 */
export function sunriseUtcHours(
  year: number,
  month: number,
  day: number,
  lat: number,
  lng: number,
  zenith = 90.833 // official sunrise (accounts for refraction + sun's radius)
): number | null {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const N1 = Math.floor((275 * month) / 9);
  const N2 = Math.floor((month + 9) / 12);
  const N3 = 1 + Math.floor((year - 4 * Math.floor(year / 4) + 2) / 3);
  const N = N1 - N2 * N3 + day - 30; // day of the year

  const lngHour = lng / 15;
  const t = N + (6 - lngHour) / 24; // approximate time of rising

  const M = 0.9856 * t - 3.289; // sun's mean anomaly
  let L = M + 1.916 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 282.634;
  L = ((L % 360) + 360) % 360; // true longitude, normalized

  let RA = deg * Math.atan(0.91764 * Math.tan(L * rad));
  RA = ((RA % 360) + 360) % 360;
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90; // same quadrant as L
  RA /= 15;

  const sinDec = 0.39782 * Math.sin(L * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(zenith * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
  if (cosH > 1 || cosH < -1) return null; // sun never rises / never sets that day

  const H = (360 - deg * Math.acos(cosH)) / 15; // rising
  const T = H + RA - 0.06571 * t - 6.622;
  let UT = T - lngHour;
  UT = ((UT % 24) + 24) % 24;
  return UT;
}

/** Today's sunrise as a UTC Date, for the given day (UTC y/m/d) and location. */
export function sunriseUtcDate(year: number, month: number, day: number, lat: number, lng: number): Date | null {
  const ut = sunriseUtcHours(year, month, day, lat, lng);
  if (ut == null) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCMinutes(Math.round(ut * 60));
  return d;
}
