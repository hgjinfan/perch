function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))
    throw new Error('Invalid weather time');
  const result = Date.parse(value + 'Z');
  if (
    !Number.isFinite(result) ||
    new Date(result).toISOString().slice(0, 16) !== value.slice(0, 16)
  )
    throw new Error('Invalid weather time');
  return result;
}
const code = (value) => (Number.isInteger(value) && value >= 0 && value <= 99 ? value : null);
const day = (value) => (value === 0 || value === 1 ? value : null);
export function normalizeForecast(data) {
  const current = data?.current,
    hourly = data?.hourly;
  if (
    !current ||
    !Number.isFinite(current.temperature_2m) ||
    !Number.isFinite(current.apparent_temperature)
  )
    throw new Error('Invalid current weather');
  const now = timestamp(current.time),
    horizon = now + 12 * 60 * 60 * 1000;
  if (
    !Array.isArray(hourly?.time) ||
    !Array.isArray(hourly.temperature_2m) ||
    hourly.time.length !== hourly.temperature_2m.length ||
    !hourly.time.length
  )
    throw new Error('Invalid hourly weather');
  const hours = hourly.time
    .map((time, index) => ({
      time,
      epoch: timestamp(time),
      temperature: hourly.temperature_2m[index],
      code: code(hourly.weather_code?.[index]),
      rain:
        Number.isFinite(hourly.precipitation_probability?.[index]) &&
        hourly.precipitation_probability[index] >= 0 &&
        hourly.precipitation_probability[index] <= 100
          ? hourly.precipitation_probability[index]
          : null,
      isDay: day(hourly.is_day?.[index]),
    }))
    .filter(
      (hour) => hour.epoch > now && hour.epoch <= horizon && Number.isFinite(hour.temperature),
    )
    .slice(0, 12)
    .map(({ epoch, ...hour }) => hour);
  if (!hours.length) throw new Error('No valid hourly weather');
  return {
    current: {
      time: current.time,
      temperature_2m: current.temperature_2m,
      apparent_temperature: current.apparent_temperature,
      weather_code: code(current.weather_code),
      is_day: day(current.is_day),
    },
    hours,
  };
}
