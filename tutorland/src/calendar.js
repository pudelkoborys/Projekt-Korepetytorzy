import { formatTime } from './api.js'

function timeMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function availableSlotsForDate(date, data, now) {
  const dayOff = data.daysOff.find((item) => (typeof item === 'string' ? item : item.date) === date)
  if (dayOff && (!dayOff.startTime || !dayOff.endTime)) return []
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const slots = []
  const ranges = dayOff
    ? [dayOff]
    : data.availability.filter((item) => Number(item.weekday) === weekday)
  for (const range of ranges) {
    const from = timeMinutes(range.startTime)
    const until = timeMinutes(range.endTime)
    for (let start = from; start + 40 <= until; start += 40) {
      const busy = data.busy.some((booking) => (
        booking.date === date
        && start < timeMinutes(booking.endTime)
        && timeMinutes(booking.startTime) < start + 40
      ))
      const past = date < today || date === today && start <= currentMinutes
      if (!busy && !past) slots.push(formatTime(start))
    }
  }
  return [...new Set(slots)]
}
