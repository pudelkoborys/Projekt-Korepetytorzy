import { useEffect, useMemo, useState } from 'react'
import portrait1 from '../../assets/placeholder_person.png'
import portrait2 from '../../assets/placeholder_person2.png'
import portrait3 from '../../assets/placeholder_person3.png'
import portrait4 from '../../assets/placeholder_person4.png'
import portrait5 from '../../assets/placeholder_person5.png'
import './App.css'

const levels = [
  { id: 'primary', label: 'Podstawówka' },
  { id: 'secondary', label: 'Szkoła Średnia' },
  { id: 'tertiary', label: 'Studia' },
]

const loggedInStudent = {
  firstName: 'Borys',
  lastName: 'Pudełko',
  birthDate: '2008-08-03',
  email: 'pudelkoborys@gmail.com',
}

const portraits = {
  '../../assets/placeholder_person.png': portrait1,
  '../../assets/placeholder_person2.png': portrait2,
  '../../assets/placeholder_person3.png': portrait3,
  '../../assets/placeholder_person4.png': portrait4,
  '../../assets/placeholder_person5.png': portrait5,
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (character === '"' && quoted && text[index + 1] === '"') {
      cell += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }

  if (quoted) throw new Error('Plik CSV zawiera niedomknięty cudzysłów.')
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }

  const [headers, ...records] = rows
  if (!headers) return []
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

function parseTutors(text) {
  const requiredHeaders = [
    'tutorId',
    'firstName',
    'lastName',
    'age',
    'teachingSinceYear',
    'description',
    'rating',
    'pricePerLesson',
    'levels',
    'subjects',
    'imagePath',
    'email',
  ]
  const rows = parseCsv(text)
  if (!rows.length || requiredHeaders.some((header) => !(header in rows[0]))) {
    throw new Error('Plik tutors.csv ma nieprawidłowe nagłówki.')
  }

  return rows.map((row) => {
    const imagePath = row.imagePath
    const imageUrl = portraits[imagePath] ?? (() => {
      try {
        const url = new URL(imagePath)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
        return url.href
      } catch {
        throw new Error(`Nieprawidłowa ścieżka zdjęcia korepetytora: ${imagePath}`)
      }
    })()
    const teachingSinceYear = Number(row.teachingSinceYear)
    const age = Number(row.age)
    const rating = Number(row.rating)
    const pricePerLesson = Number(row.pricePerLesson)

    if (![teachingSinceYear, age, rating, pricePerLesson].every(Number.isFinite)) {
      throw new Error(`Nieprawidłowe dane liczbowe korepetytora: ${row.tutorId}`)
    }

    return {
      ...row,
      imagePath,
      imageUrl,
      teachingSinceYear,
      experience: new Date().getFullYear() - teachingSinceYear,
      age,
      rating,
      pricePerLesson,
      levels: row.levels.split('|').filter(Boolean),
      subjects: row.subjects.split('|').filter(Boolean),
    }
  })
}

function formatYears(value) {
  const lastTwoDigits = value % 100
  const lastDigit = value % 10
  const unit = value === 1
    ? 'rok'
    : lastTwoDigits >= 12 && lastTwoDigits <= 14
      ? 'lat'
      : lastDigit >= 2 && lastDigit <= 4
        ? 'lata'
        : 'lat'

  return `${value} ${unit}`
}

function tutorLevelClass(tutor) {
  return tutor.levels
    .slice()
    .sort((first, second) => (
      levels.findIndex((level) => level.id === first)
      - levels.findIndex((level) => level.id === second)
    ))
    .join('-')
}

function formatDate(date, options = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Intl.DateTimeFormat('pl-PL', options).format(new Date(`${date}T12:00:00`))
}

function addHour(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return `${String((hours + 1) % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function RangeFilter({ id, title, unit, bounds, step, value, onChange }) {
  const [minimum, maximum] = bounds
  const start = ((value[0] - minimum) / (maximum - minimum)) * 100
  const end = ((value[1] - minimum) / (maximum - minimum)) * 100
  const format = (amount) => `${amount}${unit}`

  function updateRange(index, nextValue) {
    const next = [...value]
    if (index === 0) next[0] = Math.min(Number(nextValue), value[1] - step)
    else next[1] = Math.max(Number(nextValue), value[0] + step)
    onChange(next)
  }

  return (
    <section className="filter-section" aria-labelledby={`${id}-heading`}>
      <div className="filter-heading">
        <h3 id={`${id}-heading`}>{title}</h3>
        <output className="range-values" aria-live="polite">
          {format(value[0])} – {format(value[1])}
        </output>
      </div>
      <div
        className="range-control"
        style={{ '--range-start': `${start}%`, '--range-end': `${end}%` }}
      >
        <div className="range-track" aria-hidden="true" />
        {value.map((current, index) => (
          <input
            key={`${id}-${index}`}
            className={`range-input range-input--${index === 0 ? 'lower' : 'upper'}`}
            type="range"
            min={minimum}
            max={maximum}
            step={step}
            value={current}
            aria-label={`${index === 0 ? 'Minimalna' : 'Maksymalna'} ${title.toLowerCase()}`}
            aria-valuetext={format(current)}
            onChange={(event) => updateRange(index, event.target.value)}
          />
        ))}
      </div>
    </section>
  )
}

function Rating({ rating }) {
  const roundedRating = Math.round(rating * 2) / 2

  return (
    <div className="tutor-rating">
      <span className="rating-stars" role="img" aria-label={`Ocena: ${rating} na 5`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <span
            key={star}
            className={roundedRating >= star ? 'star--filled' : roundedRating >= star - 0.5 ? 'star--half' : ''}
            aria-hidden="true"
          >
            ★
          </span>
        ))}
      </span>
      <span className="rating-value">{rating.toFixed(1).replace('.', ',')}</span>
    </div>
  )
}

function SiteHeader() {
  return (
    <header className="page-header">
      <a className="brand" href="/" aria-label="Tutorland — strona główna">
        Tutor<span>land</span><span className="brand-dot">.</span>
      </a>
      <div className="student-profile" aria-label="Zalogowany użytkownik">
        <span className="student-avatar" aria-hidden="true">BP</span>
        <span>{loggedInStudent.firstName} {loggedInStudent.lastName}</span>
      </div>
    </header>
  )
}

function TutorCard({ tutor, comments, onOpen }) {
  return (
    <a
      className={`tutor-card tutor-card--${tutorLevelClass(tutor)}`}
      href={`/?tutor=${encodeURIComponent(tutor.tutorId)}`}
      onClick={(event) => {
        event.preventDefault()
        onOpen(tutor.tutorId)
      }}
    >
      <div className="tutor-card-inner">
        <div className="photo-wrap">
          <img
            className="tutor-photo"
            src={tutor.imageUrl}
            alt={`Zdjęcie ${tutor.firstName} ${tutor.lastName}`}
          />
          <span className="experience-badge">{formatYears(tutor.experience)} doświadczenia</span>
        </div>
        <div className="tutor-details">
          <div className="tutor-topline">
            <div>
              <h2 className="tutor-name">{tutor.firstName} {tutor.lastName}</h2>
              <p className="tutor-age">{formatYears(tutor.age)}</p>
            </div>
            <Rating rating={tutor.rating} />
          </div>
          <p className="tutor-description">{tutor.description}</p>
          <ul className="subject-tags" aria-label="Nauczane przedmioty">
            {tutor.subjects.slice(0, 4).map((subject) => (
              <li key={subject}><span className="subject-tag">{subject}</span></li>
            ))}
            {tutor.subjects.length > 4 && (
              <li><span className="subject-tag">+{tutor.subjects.length - 4}</span></li>
            )}
          </ul>
          <div className="tutor-card-footer">
            <span className="tutor-levels">
              {tutor.levels.map((id) => levels.find((level) => level.id === id)?.label).join(' · ')}
            </span>
            <span className="tutor-price">{tutor.pricePerLesson} zł <small>/ lekcja</small></span>
          </div>
          <span className="card-reviews">{comments.length} opinii · Zobacz profil →</span>
        </div>
      </div>
    </a>
  )
}

function getMonthDays(month) {
  const [year, monthNumber] = month.split('-').map(Number)
  const firstDay = new Date(year, monthNumber - 1, 1, 12)
  const offset = (firstDay.getDay() + 6) % 7
  const dayCount = new Date(year, monthNumber, 0).getDate()

  return [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: dayCount }, (_, index) => (
      `${year}-${String(monthNumber).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`
    )),
  ]
}

function getAvailabilitySlots(tutor, date, availability, bookings) {
  const weekday = String(new Date(`${date}T12:00:00`).getDay())
  const ranges = availability.filter((range) => range.tutorId === tutor.tutorId && range.weekday === weekday)
  const bookedTimes = bookings
    .filter((booking) => booking.tutorId === tutor.tutorId && booking.date === date)
    .map((booking) => booking.startTime)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const isPast = new Date(`${date}T12:00:00`) < today
  const freeSlots = []

  for (const range of ranges) {
    let hour = Number(range.startTime.slice(0, 2))
    const endHour = Number(range.endTime.slice(0, 2))
    while (hour < endHour) {
      const startTime = `${String(hour).padStart(2, '0')}:00`
      const now = new Date()
      const isPastToday = date === [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-') && hour <= now.getHours()
      if (!bookedTimes.includes(startTime) && !isPast && !isPastToday) {
        freeSlots.push({ startTime, endTime: addHour(startTime) })
      }
      hour += 1
    }
  }

  return [...new Map(freeSlots.map((slot) => [slot.startTime, slot])).values()]
}

function Calendar({ tutor, availability, bookings, onBookingsChanged }) {
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [bookingError, setBookingError] = useState('')
  const [bookingConfirmation, setBookingConfirmation] = useState(null)
  const days = getMonthDays(month)
  const monthLabel = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' })
    .format(new Date(`${month}-15T12:00:00`))
  const selectedSlots = selectedDate
    ? getAvailabilitySlots(tutor, selectedDate, availability, bookings)
    : []
  const selectedTutorBookings = bookings.filter((booking) => booking.tutorId === tutor.tutorId)

  function changeMonth(amount) {
    const [year, monthNumber] = month.split('-').map(Number)
    const next = new Date(year, monthNumber - 1 + amount, 1, 12)
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
    setSelectedDate('')
    setSelectedTime('')
    setSelectedSubject('')
  }

  function confirmBooking() {
    if (!selectedDate || !selectedTime || !selectedSubject) return
    try {
      const booking = {
        tutorId: tutor.tutorId,
        studentEmail: loggedInStudent.email,
        date: selectedDate,
        startTime: selectedTime,
        subject: selectedSubject,
      }
      const storageKey = 'tutorland-bookings'
      const localBookings = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
      if (!Array.isArray(localBookings)) throw new Error('Dane rezerwacji w przeglądarce są nieprawidłowe.')
      if (localBookings.some((item) => item.tutorId === booking.tutorId
        && item.date === booking.date && item.startTime === booking.startTime)) {
        throw new Error('Ten termin został już zarezerwowany.')
      }
      localStorage.setItem(storageKey, JSON.stringify([...localBookings, booking]))
      onBookingsChanged()
      setBookingConfirmation(booking)
      setBookingError('')
      setSelectedTime('')
      setSelectedSubject('')
    } catch (error) {
      setBookingError(error.message || 'Nie udało się zapisać rezerwacji.')
    }
  }

  return (
    <div className="calendar-panel">
      <div className="calendar-title-row">
        <div>
          <p className="eyebrow">Znajdź dogodny termin</p>
          <h2>Umów lekcję</h2>
        </div>
        <span className="calendar-duration">Lekcja trwa 60 min</span>
      </div>

      <div className="calendar-booking-layout">
        <section className="calendar-widget" aria-label="Kalendarz dostępności">
          <div className="calendar-month-nav">
            <button type="button" aria-label="Poprzedni miesiąc" onClick={() => changeMonth(-1)}>‹</button>
            <h3>{monthLabel}</h3>
            <button type="button" aria-label="Następny miesiąc" onClick={() => changeMonth(1)}>›</button>
          </div>
          <div className="calendar-grid calendar-weekdays" aria-hidden="true">
            {['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="calendar-grid">
            {days.map((date, index) => {
              if (!date) return <span className="calendar-empty" key={`empty-${index}`} />
              const available = getAvailabilitySlots(tutor, date, availability, bookings).length > 0
              return (
                <button
                  className={`calendar-day${available ? ' is-available' : ''}${date === selectedDate ? ' is-active' : ''}`}
                  key={date}
                  type="button"
                  disabled={!available}
                  aria-label={`${formatDate(date)}${available ? ', dostępny termin' : ', brak terminów'}`}
                  aria-pressed={date === selectedDate}
                  onClick={() => {
                    setSelectedDate(date)
                    setSelectedTime('')
                    setSelectedSubject('')
                    setBookingConfirmation(null)
                  }}
                >
                  {Number(date.slice(-2))}
                </button>
              )
            })}
          </div>
          <p className="calendar-legend"><span /> Dostępne terminy</p>
          <p className="calendar-note">
            {selectedTutorBookings.length
              ? `${selectedTutorBookings.length} zarezerwowanych lekcji`
              : 'Dni bez terminów są nieaktywne.'}
          </p>
        </section>

        <section className="slots-panel" aria-label="Wolne godziny">
          <h3>{selectedDate ? formatDate(selectedDate) : 'Wybierz dzień'}</h3>
          {selectedDate ? (
            selectedSlots.length ? (
              <>
                <p className="slots-hint">Wolne lekcje</p>
                <div className="time-slots">
                  {selectedSlots.map((slot) => (
                    <button
                      className={`time-slot${selectedTime === slot.startTime ? ' is-active' : ''}`}
                      type="button"
                      key={slot.startTime}
                      aria-pressed={selectedTime === slot.startTime}
                      onClick={() => {
                        setSelectedTime(slot.startTime)
                        setSelectedSubject('')
                        setBookingConfirmation(null)
                      }}
                    >
                      {slot.startTime}–{slot.endTime}
                    </button>
                  ))}
                </div>
                {selectedTime && (
                  <div className="booking-form">
                    <span id="booking-subject-label" className="booking-form-label">Przedmiot</span>
                    <div
                      className="subject-options booking-subject-options"
                      role="group"
                      aria-label="Wybierz jeden przedmiot"
                    >
                      {tutor.subjects.map((subject) => (
                        <button
                          className={`subject-option${selectedSubject === subject ? ' is-selected' : ''}`}
                          key={subject}
                          type="button"
                          aria-pressed={selectedSubject === subject}
                          onClick={() => {
                            setSelectedSubject(subject)
                            setBookingConfirmation(null)
                          }}
                        >
                          {subject}
                        </button>
                      ))}
                    </div>
                    <button
                      className="book-button"
                      type="button"
                      disabled={!selectedSubject}
                      onClick={confirmBooking}
                    >
                      Zarezerwuj lekcję
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="slots-hint">Brak wolnych lekcji w tym dniu.</p>
            )
          ) : (
            <p className="slots-hint">Kliknij jeden z oznaczonych dni w kalendarzu.</p>
          )}
          {bookingError && <p className="booking-error" role="alert">{bookingError}</p>}
          {bookingConfirmation && (
            <div className="booking-confirmation" role="status">
              <strong>Termin zapisany!</strong>
              <span>
                {formatDate(bookingConfirmation.date)} o {bookingConfirmation.startTime} — {bookingConfirmation.subject}
              </span>
              <p>Rezerwacja jest zapisana w tej przeglądarce.</p>
              <button type="button">
                E-mail do korepetytora
              </button>
              <button type="button">
                E-mail do ucznia
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function TutorDetails({ tutor, comments, students, availability, bookings, onBookingsChanged }) {
  const studentNames = new Map(students.map((student) => [
    student.email,
    `${student.firstName} ${student.lastName}`,
  ]))
  const [localBookings, setLocalBookings] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('tutorland-bookings') ?? '[]')
      return Array.isArray(stored) ? stored : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    const handleStorage = () => {
      try {
        const stored = JSON.parse(localStorage.getItem('tutorland-bookings') ?? '[]')
        setLocalBookings(Array.isArray(stored) ? stored : [])
      } catch {
        setLocalBookings([])
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  function refreshBookings() {
    try {
      const stored = JSON.parse(localStorage.getItem('tutorland-bookings') ?? '[]')
      setLocalBookings(Array.isArray(stored) ? stored : [])
      onBookingsChanged()
    } catch {
      setLocalBookings([])
    }
  }

  const allBookings = [...bookings, ...localBookings]
  const tutorComments = comments.filter((comment) => comment.tutorId === tutor.tutorId)

  return (
    <main className="main-content tutor-detail-page">
      <div className="detail-back-row">
        <a className="back-link" href="/">← Wszyscy korepetytorzy</a>
      </div>
      <div className="tutor-profile-layout">
        <aside className="tutor-profile-column">
          <div className={`profile-card tutor-card--${tutorLevelClass(tutor)}`}>
            <img className="profile-photo" src={tutor.imageUrl} alt={`Zdjęcie ${tutor.firstName} ${tutor.lastName}`} />
            <div className="profile-details">
              <h1>{tutor.firstName} {tutor.lastName}</h1>
              <Rating rating={tutor.rating} />
              <span className="profile-email">{tutor.email}</span>
              <div className="profile-fact"><span>Poziom nauczania</span><strong>{tutor.levels.map((id) => levels.find((level) => level.id === id)?.label).join(' · ')}</strong></div>
              <div className="profile-fact"><span>Cena za lekcję</span><strong>{tutor.pricePerLesson} zł</strong></div>
              <div className="profile-fact"><span>Doświadczenie</span><strong>{formatYears(tutor.experience)}</strong></div>
              <div className="profile-fact"><span>Wiek</span><strong>{formatYears(tutor.age)}</strong></div>
              <div className="profile-subjects">
                <span>Przedmioty</span>
                <ul className="subject-tags" aria-label="Nauczane przedmioty">
                  {tutor.subjects.map((subject) => <li key={subject}><span className="subject-tag">{subject}</span></li>)}
                </ul>
              </div>
              <p className="profile-description">{tutor.description}</p>
            </div>
          </div>
        </aside>

        <div className="tutor-detail-content">
          <Calendar
            tutor={tutor}
            availability={availability}
            bookings={allBookings}
            onBookingsChanged={refreshBookings}
          />
          <section className="reviews-panel" aria-labelledby="reviews-heading">
            <div className="reviews-heading">
              <div>
                <p className="eyebrow">Opinie uczniów</p>
                <h2 id="reviews-heading">Komentarze</h2>
              </div>
              <Rating rating={tutor.rating} />
            </div>
            <div className="reviews-summary">
              <span className="review-score">{tutor.rating.toFixed(1).replace('.', ',')}</span>
              <div><Rating rating={tutor.rating} /><span>Ocena korepetytora</span></div>
            </div>
            {tutorComments.length ? (
              <div className="review-list">
                {tutorComments.map((comment, index) => (
                  <article className="review-card" key={`${comment.studentEmail}-${comment.date}-${index}`}>
                    <div className="review-author">
                      <span className="review-avatar" aria-hidden="true">
                        {(studentNames.get(comment.studentEmail) ?? 'Uczeń').slice(0, 1)}
                      </span>
                      <div>
                        <strong>{studentNames.get(comment.studentEmail) ?? comment.studentEmail}</strong>
                        <time dateTime={comment.date}>{formatDate(comment.date, { day: 'numeric', month: 'long', year: 'numeric' })}</time>
                      </div>
                      <Rating rating={Number(comment.rating)} />
                    </div>
                    <p>{comment.comment}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="no-reviews">Ten korepetytor nie ma jeszcze komentarzy.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

function App() {
  const [tutors, setTutors] = useState([])
  const [students, setStudents] = useState([])
  const [comments, setComments] = useState([])
  const [availability, setAvailability] = useState([])
  const [bookings, setBookings] = useState([])
  const [loadError, setLoadError] = useState('')
  const [selectedTutorId, setSelectedTutorId] = useState(() => new URLSearchParams(window.location.search).get('tutor'))
  const [priceRange, setPriceRange] = useState([0, 1000])
  const [experienceRange, setExperienceRange] = useState([0, 30])
  const [selectedSubjects, setSelectedSubjects] = useState([])
  const [selectedLevels, setSelectedLevels] = useState([])

  useEffect(() => {
    const controller = new AbortController()
    const files = [
      '/tutors.csv',
      '/students.csv',
      '/comments.csv',
      '/tutor_availability.csv',
      '/bookings.csv',
    ]

    Promise.all(files.map(async (file) => {
      const response = await fetch(file, { signal: controller.signal })
      if (!response.ok) throw new Error(`Nie udało się wczytać pliku ${file} (${response.status}).`)
      return response.text()
    }))
      .then(([tutorsCsv, studentsCsv, commentsCsv, availabilityCsv, bookingsCsv]) => {
        setTutors(parseTutors(tutorsCsv))
        setStudents(parseCsv(studentsCsv))
        setComments(parseCsv(commentsCsv))
        setAvailability(parseCsv(availabilityCsv))
        setBookings(parseCsv(bookingsCsv))
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setLoadError(error.message)
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const handlePopState = () => setSelectedTutorId(new URLSearchParams(window.location.search).get('tutor'))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const subjects = useMemo(() => [...new Set(tutors.flatMap((tutor) => tutor.subjects))]
    .sort((a, b) => a.localeCompare(b, 'pl')), [tutors])
  const visibleTutors = tutors.filter((tutor) => (
    tutor.pricePerLesson >= priceRange[0]
    && tutor.pricePerLesson <= priceRange[1]
    && tutor.experience >= experienceRange[0]
    && tutor.experience <= experienceRange[1]
    && (!selectedSubjects.length || selectedSubjects.some((subject) => tutor.subjects.includes(subject)))
    && (!selectedLevels.length || selectedLevels.some((level) => tutor.levels.includes(level)))
  ))

  function openTutor(tutorId) {
    window.history.pushState({}, '', `/?tutor=${encodeURIComponent(tutorId)}`)
    setSelectedTutorId(tutorId)
    window.scrollTo(0, 0)
  }

  function toggleItem(item, selected, setSelected) {
    setSelected(selected.includes(item)
      ? selected.filter((value) => value !== item)
      : [...selected, item])
  }

  function resetFilters() {
    setPriceRange([0, 1000])
    setExperienceRange([0, 30])
    setSelectedSubjects([])
    setSelectedLevels([])
  }

  function refreshBookings() {
    setBookings((current) => [...current])
  }

  const selectedTutor = tutors.find((tutor) => tutor.tutorId === selectedTutorId)

  return (
    <div className={selectedTutorId ? 'app-shell app-shell--detail' : 'app-shell'}>
      {!selectedTutorId && (
        <aside className="filters-panel" aria-labelledby="filters-heading">
          <div className="filters-title-row">
            <div>
              <p className="eyebrow">Znajdź idealne wsparcie</p>
              <h2 id="filters-heading">Filtry</h2>
            </div>
          </div>
          <RangeFilter id="price" title="Cena za lekcję" unit=" zł" bounds={[0, 1000]} step={10} value={priceRange} onChange={setPriceRange} />
          <RangeFilter id="experience" title="Doświadczenie w nauczaniu" unit=" lat" bounds={[0, 30]} step={1} value={experienceRange} onChange={setExperienceRange} />
          <section className="filter-section subjects-filter" aria-labelledby="subjects-heading">
            <div className="filter-heading">
              <h3 id="subjects-heading">Przedmioty</h3>
              {selectedSubjects.length > 0 && (
                <button className="clear-selection" type="button" onClick={() => setSelectedSubjects([])}>Wyczyść</button>
              )}
            </div>
            <div className="subject-options">
              {subjects.map((subject) => (
                <button
                  className={`subject-option${selectedSubjects.includes(subject) ? ' is-selected' : ''}`}
                  key={subject}
                  type="button"
                  aria-pressed={selectedSubjects.includes(subject)}
                  onClick={() => toggleItem(subject, selectedSubjects, setSelectedSubjects)}
                >
                  {subject}
                </button>
              ))}
            </div>
            <p className="filter-hint">Wybierz jeden lub więcej przedmiotów</p>
          </section>
          <div className="filter-footer">
            <span>Wyniki wyszukiwania</span>
            <strong>{visibleTutors.length}</strong>
          </div>
        </aside>
      )}

      <div className="main-column">
        <SiteHeader />
        {selectedTutorId ? (
          loadError ? (
            <main className="main-content"><div className="message-state message-state--error" role="alert">{loadError}</div></main>
          ) : selectedTutor ? (
            <TutorDetails
              key={selectedTutor.tutorId}
              tutor={selectedTutor}
              comments={comments}
              students={students}
              availability={availability}
              bookings={bookings}
              onBookingsChanged={refreshBookings}
            />
          ) : (
            <main className="main-content">
              <div className="message-state" role={loadError ? 'alert' : 'status'}>
                {loadError || 'Wczytywanie profilu korepetytora…'}
              </div>
            </main>
          )
        ) : (
          <main className="main-content">
            <section className="tutor-section" aria-labelledby="tutors-heading">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Nauka na Twoich zasadach</p>
                  <h1 id="tutors-heading">Poznaj swoich tutorów</h1>
                </div>
                <span className="tutor-count">{visibleTutors.length} korepetytorów</span>
              </div>
              <div className="level-tags" aria-label="Poziomy nauczania">
                {levels.map((level) => {
                  const isSelected = selectedLevels.length === 0 || selectedLevels.includes(level.id)
                  return (
                    <button
                      className={`level-tag level-tag--${level.id}${isSelected ? ' is-selected' : ''}`}
                      key={level.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggleItem(level.id, selectedLevels, setSelectedLevels)}
                    >
                      <span className="level-indicator" aria-hidden="true" />
                      {level.label}
                    </button>
                  )
                })}
              </div>
              <p className="level-hint">
                {selectedLevels.length
                  ? 'Kliknij wybrane poziomy ponownie, aby je odznaczyć.'
                  : 'Wszystkie poziomy są wybrane. Wybierz tag, aby zawęzić wyniki.'}
              </p>
              {loadError ? (
                <div className="message-state message-state--error" role="alert">
                  <strong>Nie udało się wczytać danych.</strong><span>{loadError}</span>
                </div>
              ) : tutors.length === 0 ? (
                <div className="message-state" role="status">Wczytywanie korepetytorów…</div>
              ) : visibleTutors.length ? (
                <div className="tutor-grid">
                  {visibleTutors.map((tutor) => (
                    <TutorCard
                      key={tutor.tutorId}
                      tutor={tutor}
                      comments={comments.filter((comment) => comment.tutorId === tutor.tutorId)}
                      onOpen={openTutor}
                    />
                  ))}
                </div>
              ) : (
                <div className="message-state empty-state" role="status">
                  <span className="empty-state-icon" aria-hidden="true">⌕</span>
                  <strong>Nie znaleźliśmy korepetytorów</strong>
                  <span>Zmień filtry, aby zobaczyć więcej wyników.</span>
                  <button className="reset-button" type="button" onClick={resetFilters}>Wyczyść filtry</button>
                </div>
              )}
            </section>
          </main>
        )}
      </div>
    </div>
  )
}

export default App
