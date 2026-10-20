// Current weather from Open-Meteo (https://open-meteo.com): free, no account
// or key. Only used when a city is set in Settings; the city name goes to the
// geocoding API, then its coordinates to the forecast API.
const HEADERS = { 'User-Agent': 'dynamic-island (personal project)' };

const places = new Map(); // city -> { name, country, latitude, longitude } | null

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json();
}

async function findPlace(city) {
  const key = city.toLowerCase();
  if (places.has(key)) return places.get(key);
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: city, count: 1 })}`);
  const r = data.results && data.results[0];
  const place = r ? { name: r.name, country: r.country || '', latitude: r.latitude, longitude: r.longitude } : null;
  places.set(key, place);
  return place;
}

// Returns a 'weather' message for the island.
async function getWeather(city, units) {
  const place = await findPlace(city);
  if (!place) return { type: 'weather', status: 'not-found', city };
  const data = await getJson(`https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: 'temperature_2m,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min',
    temperature_unit: units,
    timezone: 'auto',
    forecast_days: 1,
  })}`);
  return {
    type: 'weather',
    status: 'ok',
    place: place.country ? `${place.name}, ${place.country}` : place.name,
    temp: Math.round(data.current.temperature_2m),
    code: data.current.weather_code,  // WMO weather code
    isDay: !!data.current.is_day,
    high: Math.round(data.daily.temperature_2m_max[0]),
    low: Math.round(data.daily.temperature_2m_min[0]),
    unit: units === 'fahrenheit' ? '°F' : '°C',
  };
}

module.exports = { getWeather };
