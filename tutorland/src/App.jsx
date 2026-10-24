import { useEffect, useMemo, useState } from 'react'
import { api, formatDate, formatTime } from './api.js'
import './App.css'

const LEVELS = [
  { id: 'primary', label: 'Szkoła Podstawowa' },
  { id: 'secondary', label: 'Szkoła Średnia' },
  { id: 'tertiary', label: 'Studia' },
]
const SUBJECTS = [
  'Matematyka', 'Fizyka', 'Chemia', 'Informatyka', 'Angielski', 'Biologia',
  'Polski', 'Historia', 'Geografia', 'WOS', 'Filozofia', 'Ekonomia',
]
const WEEKDAYS = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota']
const CURRENT_YEAR = new Date().getFullYear()
const FILTER_BOUNDS = {
  price: [0, 1000],
  experience: [0, 30],
}
const DEFAULT_TUTOR_IMAGE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 128 128%22%3E%3Crect width=%22128%22 height=%22128%22 fill=%22%23e8e6df%22/%3E%3Ccircle cx=%2264%22 cy=%2246%22 r=%2224%22 fill=%22%23989a9a%22/%3E%3Cpath d=%22M20 128c2-28 20-43 44-43s42 15 44 43%22 fill=%22%23989a9a%22/%3E%3C/svg%3E'

function imageSource(path) {
  return /^https:\/\//i.test(path ?? '') ? path : DEFAULT_TUTOR_IMAGE
}

function getMonth(offset = 0) {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function useCurrentTime() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(interval)
  }, [])
  return now
}

function getMonthDates(month) {
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(year, monthNumber - 1, 1, 12)
  const offset = first.getDay()
  const days = new Date(year, monthNumber, 0).getDate()
  return [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: days }, (_, index) => (
      `${year}-${String(monthNumber).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`
    )),
  ]
}

function monthName(month) {
  return new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' })
    .format(new Date(`${month}-15T12:00:00`))
}

function timeMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function tutorClasses(tutor) {
  return (tutor.levels ?? []).slice().sort((a, b) => (
    LEVELS.findIndex((level) => level.id === a) - LEVELS.findIndex((level) => level.id === b)
  )).join('-') || 'primary'
}

function Rating({ value }) {
  return (
    <span className="tutor-rating" aria-label={`Ocena: ${Number(value || 0).toFixed(1)} na 5`}>
      <span className="rating-stars" aria-hidden="true">★</span>
      <span className="rating-value">{Number(value || 0).toFixed(1).replace('.', ',')}</span>
    </span>
  )
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
      <div className="range-control" style={{ '--range-start': `${start}%`, '--range-end': `${end}%` }}>
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

function SiteHeader({ user, onLogout }) {
  return (
    <header className="page-header">
      <a className="brand" href="/" aria-label="Tutorland — strona główna">
        Tutor<span>land</span><span className="brand-dot">.</span>
      </a>
      {user ? (
        <nav className="header-actions" aria-label="Menu konta">
          <span className="header-user">
            <span className="student-avatar" aria-hidden="true">
              {user.firstName[0]}{user.lastName[0]}
            </span>
            {user.firstName} {user.lastName}
          </span>
          {user.role === 'tutor'
            ? <><a className="header-link" href="/profile">Mój profil</a><a className="header-link" href="/notifications">Powiadomienia</a></>
            : <a className="header-link" href="/notifications">Powiadomienia</a>}
          <button className="header-button" type="button" onClick={onLogout}>Wyloguj</button>
        </nav>
      ) : (
        <nav className="header-actions" aria-label="Konto użytkownika">
          <a className="header-button header-button--quiet" href="/login">Zaloguj</a>
          <a className="header-button" href="/register">Zarejestruj</a>
        </nav>
      )}
    </header>
  )
}

function TutorCard({ tutor }) {
  const experience = Math.max(0, CURRENT_YEAR - tutor.teachingSinceYear)
  return (
    <a
      className={`tutor-card tutor-card--${tutorClasses(tutor)}`}
      href={`/?tutor=${encodeURIComponent(tutor.tutorId)}`}
    >
      <div className="tutor-card-inner">
        <div className="photo-wrap">
          <img className="tutor-photo" src={imageSource(tutor.imagePath)} alt={`Zdjęcie ${tutor.firstName} ${tutor.lastName}`} />
          <span className="experience-badge">{experience} lat doświadczenia</span>
        </div>
        <div className="tutor-details">
          <div className="tutor-topline">
            <div><h2 className="tutor-name">{tutor.firstName} {tutor.lastName}</h2></div>
            <Rating value={tutor.rating} />
          </div>
          <p className="tutor-description">{tutor.description}</p>
          <ul className="subject-tags" aria-label="Nauczane przedmioty">
            {tutor.subjects.slice(0, 4).map((subject) => (
              <li key={subject}><span className="subject-tag">{subject}</span></li>
            ))}
            {tutor.subjects.length > 4 && <li><span className="subject-tag">+{tutor.subjects.length - 4}</span></li>}
          </ul>
          <div className="tutor-card-footer">
            <span className="tutor-levels">
              {tutor.levels.map((id) => LEVELS.find((level) => level.id === id)?.label).join(' · ')}
            </span>
            <span className="tutor-price">{tutor.pricePerLesson} zł <small>/ lekcja</small></span>
          </div>
          <span className="card-reviews">{tutor.reviewCount} opinii · Zobacz profil →</span>
        </div>
      </div>
    </a>
  )
}

function Directory({ tutors, error, isLoading }) {
  const [search, setSearch] = useState('')
  const [priceRange, setPriceRange] = useState(FILTER_BOUNDS.price)
  const [experienceRange, setExperienceRange] = useState(FILTER_BOUNDS.experience)
  const [selectedSubjects, setSelectedSubjects] = useState([])
  const [selectedLevels, setSelectedLevels] = useState([])
  const subjects = useMemo(() => [...new Set(tutors.flatMap((tutor) => tutor.subjects))]
    .sort((a, b) => a.localeCompare(b, 'pl')), [tutors])
  const visibleTutors = tutors.filter((tutor) => {
    const name = `${tutor.firstName} ${tutor.lastName}`.toLocaleLowerCase('pl')
    const experience = Math.max(0, CURRENT_YEAR - tutor.teachingSinceYear)
    return name.includes(search.trim().toLocaleLowerCase('pl'))
      && tutor.pricePerLesson >= priceRange[0]
      && tutor.pricePerLesson <= priceRange[1]
      && experience >= experienceRange[0]
      && experience <= experienceRange[1]
      && (!selectedSubjects.length || selectedSubjects.some((subject) => tutor.subjects.includes(subject)))
      && (!selectedLevels.length || selectedLevels.some((level) => tutor.levels.includes(level)))
  })

  function toggleLevel(id) {
    setSelectedLevels((current) => current.includes(id)
      ? current.filter((level) => level !== id)
      : [...current, id])
  }

  function toggleSubject(subject) {
    setSelectedSubjects((current) => current.includes(subject)
      ? current.filter((item) => item !== subject)
      : [...current, subject])
  }

  function resetFilters() {
    setSearch('')
    setPriceRange(FILTER_BOUNDS.price)
    setExperienceRange(FILTER_BOUNDS.experience)
    setSelectedSubjects([])
    setSelectedLevels([])
  }

  return (
    <div className="directory-layout">
      <aside className="filters-panel" aria-labelledby="filters-heading">
        <div className="filters-title-row">
          <div><p className="eyebrow">Znajdź idealne wsparcie</p><h2 id="filters-heading">Filtry</h2></div>
          <button className="clear-selection" type="button" onClick={resetFilters}>Wyczyść</button>
        </div>
        <label className="directory-search-label" htmlFor="tutor-search">Imię i nazwisko</label>
        <input
          className="directory-search"
          id="tutor-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="np. Anna Wiśniewska"
        />
        <RangeFilter id="price" title="Cena za lekcję" unit=" zł" bounds={FILTER_BOUNDS.price} step={10} value={priceRange} onChange={setPriceRange} />
        <RangeFilter id="experience" title="Doświadczenie" unit=" lat" bounds={FILTER_BOUNDS.experience} step={1} value={experienceRange} onChange={setExperienceRange} />
        <section className="filter-section subjects-filter" aria-labelledby="subjects-heading">
          <div className="filter-heading">
            <h3 id="subjects-heading">Przedmioty</h3>
            {selectedSubjects.length > 0 && <button className="clear-selection" type="button" onClick={() => setSelectedSubjects([])}>Wyczyść</button>}
          </div>
          <div className="subject-options">
            {subjects.map((subject) => (
              <button
                className={`subject-option${selectedSubjects.includes(subject) ? ' is-selected' : ''}`}
                key={subject}
                type="button"
                aria-pressed={selectedSubjects.includes(subject)}
                onClick={() => toggleSubject(subject)}
              >
                {subject}
              </button>
            ))}
          </div>
        </section>
        <div className="filter-footer"><span>Wyniki wyszukiwania</span><strong>{visibleTutors.length}</strong></div>
      </aside>
      <main className="main-content directory-content">
        <section className="tutor-section" aria-labelledby="tutors-heading">
          <div className="section-heading">
            <div><p className="eyebrow">Nauka na Twoich zasadach</p><h1 id="tutors-heading">Poznaj swoich korepetytorów</h1></div>
            <span className="tutor-count">{visibleTutors.length} korepetytorów</span>
          </div>
          <div className="level-tags" aria-label="Filtr poziomów nauczania">
            {LEVELS.map((level) => (
              <button
                className={`level-tag level-tag--${level.id}${!selectedLevels.length || selectedLevels.includes(level.id) ? ' is-selected' : ''}`}
                key={level.id}
                type="button"
                aria-pressed={!selectedLevels.length || selectedLevels.includes(level.id)}
                onClick={() => toggleLevel(level.id)}
              >
                <span className="level-indicator" aria-hidden="true" />{level.label}
              </button>
            ))}
          </div>
          <p className="level-hint">Kliknij tag, aby filtrować poziomy nauczania.</p>
          {error ? (
            <div className="message-state message-state--error" role="alert">{error}</div>
          ) : isLoading ? (
            <div className="message-state" role="status">Wczytywanie korepetytorów…</div>
          ) : visibleTutors.length ? (
            <div className="tutor-grid">{visibleTutors.map((tutor) => <TutorCard key={tutor.tutorId} tutor={tutor} />)}</div>
          ) : tutors.length === 0 ? (
            <div className="message-state empty-state" role="status">
              <strong>Nie ma jeszcze korepetytorów</strong>
              <span>Wróć później — nowe profile pojawią się tutaj po rejestracji.</span>
            </div>
          ) : (
            <div className="message-state empty-state" role="status">
              <strong>Nie znaleźliśmy korepetytorów</strong>
              <span>Zmień kryteria wyszukiwania.</span>
              <button className="reset-button" type="button" onClick={resetFilters}>Wyczyść filtry</button>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function Calendar({ tutor, user }) {
  const now = useCurrentTime()
  const [month, setMonth] = useState(getMonth)
  const [data, setData] = useState({ availability: [], daysOff: [], busy: [] })
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [subject, setSubject] = useState(tutor.subjects[0] ?? '')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    api(`/tutors/${encodeURIComponent(tutor.tutorId)}/availability?month=${month}`)
      .then((result) => { if (active) setData(result) })
      .catch((failure) => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [month, tutor.tutorId])

  const days = getMonthDates(month)
  const slots = selectedDate ? (() => {
    if (data.daysOff.some((item) => item.date === selectedDate)) return []
    const weekday = String(new Date(`${selectedDate}T12:00:00`).getDay())
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const currentMinutes = now.getHours() * 60 + now.getMinutes()
    const result = []
    for (const range of data.availability.filter((item) => item.weekday === weekday)) {
      const from = timeMinutes(range.startTime)
      const until = timeMinutes(range.endTime)
      for (let start = from; start + 40 <= until; start += 40) {
        const busy = data.busy.some((booking) => (
          booking.date === selectedDate
          && start < timeMinutes(booking.endTime)
          && timeMinutes(booking.startTime) < start + 40
        ))
        const past = selectedDate < today || selectedDate === today && start <= currentMinutes
        if (!busy && !past) result.push(formatTime(start))
      }
    }
    return [...new Set(result)]
  })() : []

  async function book() {
    setError('')
    setMessage('')
    if (!user) {
      window.location.assign(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`)
      return
    }
    if (user.role !== 'student') {
      setError('Rezerwacji mogą dokonywać wyłącznie uczniowie.')
      return
    }
    setSaving(true)
    try {
      const result = await api('/bookings', {
        method: 'POST',
        body: { tutorId: tutor.tutorId, date: selectedDate, startTime: selectedTime, subject },
      })
      setMessage(result.booking.zoomStatus === 'ready'
        ? `Spotkanie zapisane. Link Zoom jest dostępny w powiadomieniach.`
        : 'Termin zapisany. Link do Zoom pojawi się po połączeniu konta korepetytora.')
      setSelectedTime('')
      const refreshed = await api(`/tutors/${encodeURIComponent(tutor.tutorId)}/availability?month=${month}`)
      setData(refreshed)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSaving(false)
    }
  }

  function changeMonth(amount) {
    const [year, monthNumber] = month.split('-').map(Number)
    const next = new Date(year, monthNumber - 1 + amount, 1, 12)
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
    setSelectedDate('')
    setSelectedTime('')
    setMessage('')
  }

  return (
    <section className="calendar-panel">
      <div className="calendar-title-row">
        <div><p className="eyebrow">Znajdź dogodny termin</p><h2>Umów lekcję</h2></div>
        <span className="calendar-duration">Lekcja trwa 40 min</span>
      </div>
      <div className="calendar-booking-layout">
        <section className="calendar-widget" aria-label="Kalendarz dostępności">
          <div className="calendar-month-nav">
            <button type="button" aria-label="Poprzedni miesiąc" onClick={() => changeMonth(-1)}>‹</button>
            <h3>{monthName(month)}</h3>
            <button type="button" aria-label="Następny miesiąc" onClick={() => changeMonth(1)}>›</button>
          </div>
          <div className="calendar-grid calendar-weekdays" aria-hidden="true">
            {['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="calendar-grid">
            {days.map((date, index) => {
              if (!date) return <span className="calendar-empty" key={`empty-${index}`} />
              const weekday = String(new Date(`${date}T12:00:00`).getDay())
              const hasRange = data.availability.some((range) => range.weekday === weekday)
              const isFree = hasRange
                && !data.daysOff.some((item) => item.date === date)
                && data.busy.filter((booking) => booking.date === date).length < 8
              return (
                <button
                  className={`calendar-day${isFree ? ' is-available' : ''}${selectedDate === date ? ' is-active' : ''}`}
                  key={date}
                  type="button"
                  disabled={!isFree}
                  aria-label={`${formatDate(date)}${isFree ? ', dostępne terminy' : ', brak terminów'}`}
                  aria-pressed={selectedDate === date}
                  onClick={() => {
                    setSelectedDate(date)
                    setSelectedTime('')
                    setMessage('')
                  }}
                >
                  {Number(date.slice(-2))}
                </button>
              )
            })}
          </div>
          <p className="calendar-legend"><span /> Dostępne terminy</p>
          <p className="calendar-note">{data.busy.length} zarezerwowanych lekcji w katalogu</p>
        </section>
        <section className="slots-panel" aria-label="Wolne godziny">
          <h3>{selectedDate ? formatDate(selectedDate) : 'Wybierz dzień'}</h3>
          {selectedDate && slots.length ? (
            <>
              <p className="slots-hint">Wolne lekcje</p>
              <div className="time-slots">
                {slots.map((time) => (
                  <button
                    className={`time-slot${selectedTime === time ? ' is-active' : ''}`}
                    type="button"
                    key={time}
                    aria-pressed={selectedTime === time}
                    onClick={() => setSelectedTime(time)}
                  >
                    {time}–{formatTime(timeMinutes(time) + 40)}
                  </button>
                ))}
              </div>
              {selectedTime && (
                <div className="booking-form">
                  <label className="booking-form-label" htmlFor="booking-subject">Przedmiot</label>
                  <select id="booking-subject" value={subject} onChange={(event) => setSubject(event.target.value)}>
                    {tutor.subjects.map((item) => <option key={item}>{item}</option>)}
                  </select>
                  {user?.role === 'student'
                    ? <button className="book-button" type="button" disabled={saving} onClick={book}>{saving ? 'Zapisywanie…' : 'Zarezerwuj lekcję'}</button>
                    : <button className="book-button" type="button" onClick={book}>{user ? 'Konto ucznia jest wymagane' : 'Zaloguj się, aby zarezerwować'}</button>}
                </div>
              )}
            </>
          ) : (
            <p className="slots-hint">{selectedDate ? 'Brak wolnych lekcji w tym dniu.' : 'Wybierz oznaczony dzień w kalendarzu.'}</p>
          )}
          {error && <p className="booking-error" role="alert">{error}</p>}
          {message && <p className="booking-confirmation" role="status">{message}</p>}
        </section>
      </div>
    </section>
  )
}

function TutorProfile({ tutorId, user }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api(`/tutors/${encodeURIComponent(tutorId)}`)
      .then((result) => { if (active) setData(result) })
      .catch((failure) => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [tutorId])

  if (error) return <main className="main-content"><div className="message-state message-state--error" role="alert">{error}</div></main>
  if (!data) return <main className="main-content"><div className="message-state" role="status">Wczytywanie profilu korepetytora…</div></main>
  const { tutor, reviews } = data
  return (
    <main className="main-content tutor-detail-page">
      <div className="detail-back-row"><a className="back-link" href="/">← Wszyscy korepetytorzy</a></div>
      <div className="tutor-profile-layout">
        <aside className="tutor-profile-column">
          <div className={`profile-card tutor-card--${tutorClasses(tutor)}`}>
            <img className="profile-photo" src={imageSource(tutor.imagePath)} alt={`Zdjęcie ${tutor.firstName} ${tutor.lastName}`} />
            <div className="profile-details">
              <h1>{tutor.firstName} {tutor.lastName}</h1>
              <Rating value={tutor.rating} />
              <div className="profile-fact"><span>Poziom nauczania</span><strong>{tutor.levels.map((id) => LEVELS.find((level) => level.id === id)?.label).join(' · ')}</strong></div>
              <div className="profile-fact"><span>Cena za lekcję</span><strong>{tutor.pricePerLesson} zł</strong></div>
              <div className="profile-fact"><span>Doświadczenie</span><strong>{Math.max(0, CURRENT_YEAR - tutor.teachingSinceYear)} lat</strong></div>
              <div className="profile-subjects">
                <span>Przedmioty</span>
                <ul className="subject-tags">{tutor.subjects.map((subject) => <li key={subject}><span className="subject-tag">{subject}</span></li>)}</ul>
              </div>
              <p className="profile-description">{tutor.description}</p>
            </div>
          </div>
        </aside>
        <div className="tutor-detail-content">
          <Calendar key={tutor.tutorId} tutor={tutor} user={user} />
          <section className="reviews-panel" aria-labelledby="reviews-heading">
            <div className="reviews-heading"><div><p className="eyebrow">Opinie uczniów</p><h2 id="reviews-heading">Komentarze</h2></div><Rating value={tutor.rating} /></div>
            {reviews.length ? (
              <div className="review-list">
                {reviews.map((review) => (
                  <article className="review-card" key={review.id}>
                    <div className="review-author">
                      <span className="review-avatar" aria-hidden="true">{review.studentName[0]}</span>
                      <div><strong>{review.studentName}</strong><time dateTime={review.date}>{formatDate(review.date)}</time></div>
                      <Rating value={review.rating} />
                    </div>
                    <p>{review.comment}</p>
                  </article>
                ))}
              </div>
            ) : <p className="no-reviews">Ten korepetytor nie ma jeszcze komentarzy.</p>}
          </section>
        </div>
      </div>
    </main>
  )
}

function AuthPage({ type, onAuthenticated }) {
  const isRegister = type === 'register'
  const [role, setRole] = useState('student')
  const [error, setError] = useState(() => {
    const zoomError = new URLSearchParams(window.location.search).get('zoomError')
    if (zoomError === 'account-not-found') {
      return 'Nie znaleziono konta Tutorland powiązanego z tym adresem e-mail Zoom. Najpierw załóż konto.'
    }
    if (zoomError === 'cancelled') return 'Logowanie przez Zoom zostało anulowane.'
    return ''
  })
  const [busy, setBusy] = useState(false)
  const [zoomAvailable, setZoomAvailable] = useState(false)
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const returnTo = params.get('returnTo')
  const safeReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'

  useEffect(() => {
    api('/auth/providers')
      .then((providers) => setZoomAvailable(providers.zoom))
      .catch((failure) => setError(failure.message))
  }, [])

  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const values = new FormData(event.currentTarget)
    const body = Object.fromEntries(values.entries())
    body.role = role
    try {
      const result = await api(isRegister ? '/auth/register' : '/auth/login', { method: 'POST', body })
      const shouldConnectZoom = role === 'tutor'
        && result.zoomConfigured
        && !result.zoomConnected
      const nextPath = shouldConnectZoom
        ? '/api/zoom/connect'
        : isRegister && role === 'tutor' ? '/profile' : safeReturnTo
      onAuthenticated(result.user, nextPath)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="main-content auth-page">
      <section className="auth-card">
        <p className="eyebrow">Tutorland</p>
        <h1>{isRegister ? 'Załóż konto' : 'Zaloguj się'}</h1>
        <p className="auth-intro">{isRegister ? 'Dołącz jako uczeń lub korepetytor.' : 'Zaloguj się, aby przejść do swojego konta.'}</p>
        <form className="auth-form" onSubmit={submit}>
          <fieldset className="role-choice">
            <legend>{isRegister ? 'Kim jesteś?' : 'Zaloguj się jako'}</legend>
            <label><input type="radio" name="role-choice" checked={role === 'student'} onChange={() => setRole('student')} /> Uczeń</label>
            <label><input type="radio" name="role-choice" checked={role === 'tutor'} onChange={() => setRole('tutor')} /> Korepetytor</label>
          </fieldset>
          {isRegister && (
            <>
              <label>Imię<input name="firstName" autoComplete="given-name" required minLength="2" maxLength="80" /></label>
              <label>Nazwisko<input name="lastName" autoComplete="family-name" required minLength="2" maxLength="80" /></label>
            </>
          )}
          <label>Adres e-mail<input type="email" name="email" autoComplete="email" required maxLength="254" /></label>
          <label>Hasło<input type="password" name="password" autoComplete={isRegister ? 'new-password' : 'current-password'} required minLength={isRegister ? 10 : 1} maxLength="128" /></label>
          {isRegister && <p className="form-hint">Hasło musi mieć co najmniej 10 znaków.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="book-button" type="submit" disabled={busy}>{busy ? 'Proszę czekać…' : isRegister ? 'Zarejestruj' : 'Zaloguj'}</button>
        </form>
        {!isRegister && (zoomAvailable
          ? <a
            className="zoom-login-button"
            href={`/api/zoom/login?role=${role}&returnTo=${encodeURIComponent(safeReturnTo)}`}
          >Zaloguj przez Zoom</a>
          : <p className="form-hint">Logowanie Zoom będzie dostępne po skonfigurowaniu aplikacji Zoom na serwerze.</p>)}
        <p className="auth-switch">
          {isRegister ? 'Masz już konto? ' : 'Nie masz jeszcze konta? '}
          <a href={`${isRegister ? '/login' : '/register'}${returnTo ? `?returnTo=${encodeURIComponent(safeReturnTo)}` : ''}`}>
            {isRegister ? 'Zaloguj się' : 'Zarejestruj się'}
          </a>
        </p>
      </section>
    </main>
  )
}

function StudentDashboard() {
  const [bookings, setBookings] = useState([])
  const [reviews, setReviews] = useState([])
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try {
      const [bookingResult, reviewResult] = await Promise.all([api('/bookings'), api('/reviews/mine')])
      setBookings(bookingResult.bookings)
      setReviews(reviewResult.reviews)
      setError('')
    } catch (failure) {
      setError(failure.message)
    }
  }

  useEffect(() => {
    let active = true
    Promise.all([api('/bookings'), api('/reviews/mine')])
      .then(([bookingResult, reviewResult]) => {
        if (!active) return
        setBookings(bookingResult.bookings)
        setReviews(reviewResult.reviews)
      })
      .catch((failure) => {
        if (active) setError(failure.message)
      })
    return () => { active = false }
  }, [])
  const reviewByTutor = new Map(reviews.map((review) => [review.tutorId, review]))

  async function saveReview(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const values = new FormData(event.currentTarget)
    const review = { rating: Number(values.get('rating')), comment: values.get('comment') }
    try {
      await api(draft.id ? `/reviews/${encodeURIComponent(draft.id)}` : '/reviews', {
        method: draft.id ? 'PUT' : 'POST',
        body: draft.id ? review : { ...review, bookingId: draft.bookingId },
      })
      setDraft(null)
      await refresh()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function deleteReview(review) {
    if (!window.confirm('Czy na pewno chcesz usunąć tę opinię?')) return
    try {
      await api(`/reviews/${encodeURIComponent(review.id)}`, { method: 'DELETE' })
      await refresh()
    } catch (failure) {
      setError(failure.message)
    }
  }

  const orderedBookings = bookings.slice().sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
  return (
    <main className="main-content dashboard-page">
      <div className="section-heading"><div><p className="eyebrow">Twoje konto</p><h1>Powiadomienia i spotkania</h1></div></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="dashboard-panel">
        <h2>Zaplanowane lekcje</h2>
        {orderedBookings.length ? (
          <div className="notification-list">
            {orderedBookings.map((booking) => {
              const review = reviewByTutor.get(booking.tutorId)
              return (
                <article className="notification-card" key={booking.id}>
                  <div>
                    <p className="eyebrow">{booking.isPast ? 'Zakończona lekcja' : 'Zaplanowana lekcja'}</p>
                    <h3>{booking.subject} · {formatDate(booking.date)} o {booking.startTime}</h3>
                    <p>Korepetytor: <a href={`/?tutor=${encodeURIComponent(booking.tutorId)}`}>{booking.tutorName || 'Zobacz profil'}</a></p>
                    {booking.zoomJoinUrl
                      ? <a className="zoom-link" href={booking.zoomJoinUrl} target="_blank" rel="noreferrer">Dołącz do spotkania Zoom</a>
                      : <p className="form-hint">{booking.zoomStatus === 'failed' ? 'Nie udało się utworzyć spotkania Zoom. Powiadom korepetytora.' : 'Oczekiwanie na połączenie konta Zoom przez korepetytora.'}</p>}
                    {booking.isPast && (review
                      ? <button className="text-button" type="button" onClick={() => setDraft({ ...review })}>Edytuj swoją opinię</button>
                      : <button className="text-button" type="button" onClick={() => setDraft({ bookingId: booking.id, tutorId: booking.tutorId })}>Wystaw opinię</button>)}
                  </div>
                </article>
              )
            })}
          </div>
        ) : <p className="no-reviews">Nie masz jeszcze zaplanowanych lekcji.</p>}
      </section>
      {draft && (
        <section className="dashboard-panel review-editor">
          <h2>{draft.id ? 'Edytuj opinię' : 'Wystaw opinię'}</h2>
          <form className="auth-form" onSubmit={saveReview}>
            <label>Ocena
              <select name="rating" defaultValue={draft.rating ?? 5}>
                {[5, 4, 3, 2, 1].map((value) => <option value={value} key={value}>{value} / 5</option>)}
              </select>
            </label>
            <label>Twój komentarz<textarea name="comment" defaultValue={draft.comment ?? ''} required minLength="3" maxLength="2000" rows="4" /></label>
            <div className="form-actions">
              <button className="book-button" type="submit" disabled={busy}>{busy ? 'Zapisywanie…' : 'Zapisz opinię'}</button>
              <button className="header-button header-button--quiet" type="button" onClick={() => setDraft(null)}>Anuluj</button>
            </div>
          </form>
        </section>
      )}
      <section className="dashboard-panel">
        <h2>Twoje opinie</h2>
        {reviews.length ? (
          <div className="review-list">
            {reviews.map((review) => (
              <article className="review-card" key={review.id}>
                <div className="review-author"><div><strong>{review.tutorName}</strong><time dateTime={review.date}>{formatDate(review.date)}</time></div><Rating value={review.rating} /></div>
                <p>{review.comment}</p>
                <div className="form-actions">
                  <button className="text-button" type="button" onClick={() => setDraft({ ...review })}>Edytuj</button>
                  <button className="text-button text-button--danger" type="button" onClick={() => deleteReview(review)}>Usuń</button>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="no-reviews">Po odbytych lekcjach możesz dodać i edytować swoje opinie.</p>}
      </section>
    </main>
  )
}

function scheduleMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function daySchedule(weekly, weekday) {
  return weekly.find((range) => Number(range.weekday) === weekday)
}

function defaultSchedule() {
  return WEEKDAYS.map((_, weekday) => ({
    weekday,
    enabled: false,
    startTime: '09:00',
    endTime: '17:00',
  }))
}

function TutorDashboard({ onUserChanged, notificationsOnly = false }) {
  const [profile, setProfile] = useState(null)
  const [days, setDays] = useState(defaultSchedule)
  const [daysOff, setDaysOff] = useState([])
  const [bookings, setBookings] = useState([])
  const [reviews, setReviews] = useState([])
  const [zoom, setZoom] = useState({ configured: false, connected: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [offMonth, setOffMonth] = useState(() => getMonth(1))
  const [currentMonth] = useState(getMonth)
  const [savingDaysOff, setSavingDaysOff] = useState(false)

  async function loadDashboard() {
    try {
      const [profileResult, scheduleResult, notifications, zoomStatus] = await Promise.all([
        api('/tutor/profile'),
        api('/tutor/availability'),
        api('/tutor/notifications'),
        api('/zoom/status'),
      ])
      setProfile(profileResult.tutor)
      setDays(defaultSchedule().map((day) => {
        const range = daySchedule(scheduleResult.weekly, day.weekday)
        return range
          ? { weekday: day.weekday, enabled: true, startTime: range.startTime, endTime: range.endTime }
          : day
      }))
      setDaysOff(scheduleResult.daysOff)
      setBookings(notifications.bookings)
      setReviews(notifications.reviews)
      setZoom(zoomStatus)
      setError('')
    } catch (failure) {
      setError(failure.message)
    }
  }

  useEffect(() => {
    let active = true
    Promise.all([
      api('/tutor/profile'),
      api('/tutor/availability'),
      api('/tutor/notifications'),
      api('/zoom/status'),
    ])
      .then(([profileResult, scheduleResult, notifications, zoomStatus]) => {
        if (!active) return
        setProfile(profileResult.tutor)
        setDays(defaultSchedule().map((day) => {
          const range = daySchedule(scheduleResult.weekly, day.weekday)
          return range
            ? { weekday: day.weekday, enabled: true, startTime: range.startTime, endTime: range.endTime }
            : day
        }))
        setDaysOff(scheduleResult.daysOff)
        setBookings(notifications.bookings)
        setReviews(notifications.reviews)
        setZoom(zoomStatus)
      })
      .catch((failure) => {
        if (active) setError(failure.message)
      })
    return () => { active = false }
  }, [])
  if (!profile) return <main className="main-content"><div className={error ? 'message-state message-state--error' : 'message-state'} role={error ? 'alert' : 'status'}>{error || 'Wczytywanie profilu…'}</div></main>

  async function saveProfile(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    const values = new FormData(event.currentTarget)
    const subjectValues = values.getAll('subjects')
    const levelValues = values.getAll('levels')
    try {
      await api('/tutor/profile', {
        method: 'PUT',
        body: {
          firstName: values.get('firstName'),
          lastName: values.get('lastName'),
          description: values.get('description'),
          pricePerLesson: Number(values.get('pricePerLesson')),
          teachingSinceYear: Number(values.get('teachingSinceYear')),
          subjects: subjectValues,
          levels: levelValues,
        },
      })
      await loadDashboard()
      await onUserChanged()
      setMessage('Profil został zapisany.')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSaving(false)
    }
  }

  function updateDay(weekday, changes) {
    setDays((current) => current.map((day) => day.weekday === weekday ? { ...day, ...changes } : day))
  }

  function shiftOffMonth(amount) {
    const [year, monthNumber] = offMonth.split('-').map(Number)
    const next = new Date(year, monthNumber - 1 + amount, 1, 12)
    setOffMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }

  async function saveSchedule() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await api('/tutor/availability', {
        method: 'PUT',
        body: {
          weekly: days.filter((day) => day.enabled).map(({ weekday, startTime, endTime }) => ({
            weekday, startTime, endTime,
          })),
          daysOff,
        },
      })
      setMessage('Godziny dostępności i dni wolne zostały zapisane.')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleDayOff(date) {
    const next = daysOff.includes(date) ? daysOff.filter((value) => value !== date) : [...daysOff, date]
    setSavingDaysOff(true)
    setError('')
    try {
      const weekly = days.filter((day) => day.enabled).map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime }))
      await api('/tutor/availability', { method: 'PUT', body: { weekly, daysOff: next } })
      setDaysOff(next)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSavingDaysOff(false)
    }
  }

  const countForDate = (date) => bookings.filter((booking) => booking.date === date).length
  const nextMonthDates = getMonthDates(offMonth)
  const sortedBookings = bookings.slice().sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))

  if (notificationsOnly) {
    return (
      <main className="main-content dashboard-page">
        <div className="section-heading"><div><p className="eyebrow">Panel korepetytora</p><h1>Powiadomienia i spotkania</h1></div></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <section className="dashboard-panel">
          <h2>Zaplanowane lekcje</h2>
          {sortedBookings.length ? <div className="notification-list">{sortedBookings.map((booking) => (
            <article className="notification-card" key={booking.id}>
              <p className="eyebrow">{booking.isPast ? 'Zakończona lekcja' : 'Zaplanowana lekcja'}</p>
              <h3>{booking.subject} · {formatDate(booking.date)} o {booking.startTime}</h3>
              <p>Uczeń: {booking.studentName}</p>
              {booking.zoomStartUrl && <a className="zoom-link" href={booking.zoomStartUrl} target="_blank" rel="noreferrer">Rozpocznij spotkanie Zoom</a>}
              {booking.zoomStatus === 'pending' && <p className="form-hint">Oczekiwanie na połączenie Zoom; spotkanie zostanie utworzone automatycznie.</p>}
            </article>
          ))}</div> : <p className="no-reviews">Nie masz jeszcze rezerwacji.</p>}
        </section>
        <section className="dashboard-panel">
          <h2>Nowe i wcześniejsze opinie</h2>
          {reviews.length ? <div className="review-list">{reviews.map((review) => (
            <article className="review-card" key={review.id}>
              <div className="review-author"><strong>{review.studentName} · {formatDate(review.date)}</strong><Rating value={review.rating} /></div>
              <p>{review.comment}</p>
            </article>
          ))}</div> : <p className="no-reviews">Nie masz jeszcze opinii.</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="main-content dashboard-page tutor-dashboard">
      <div className="section-heading"><div><p className="eyebrow">Panel korepetytora</p><h1>Mój profil i dostępność</h1></div></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="booking-confirmation" role="status">{message}</p>}
      <div className="tutor-dashboard-grid">
        <section className={`dashboard-panel profile-editor tutor-card--${tutorClasses(profile)}`}>
          <div className="profile-editor-heading">
            <img className="profile-photo" src={imageSource(profile.imagePath)} alt={`Zdjęcie ${profile.firstName} ${profile.lastName}`} />
            <div><h2>{profile.firstName} {profile.lastName}</h2><Rating value={profile.rating} /><p>{profile.reviewCount} opinii</p></div>
          </div>
          <form className="auth-form" onSubmit={saveProfile}>
            <label>Imię<input name="firstName" defaultValue={profile.firstName} required minLength="2" /></label>
            <label>Nazwisko<input name="lastName" defaultValue={profile.lastName} required minLength="2" /></label>
            <label>Opis<textarea name="description" defaultValue={profile.description} required minLength="20" maxLength="2000" rows="4" /></label>
            <label>Cena za 40-minutową lekcję (zł)<input name="pricePerLesson" type="number" min="20" max="1000" defaultValue={profile.pricePerLesson} required /></label>
            <label>Uczę od roku<input name="teachingSinceYear" type="number" min="1950" max={CURRENT_YEAR} defaultValue={profile.teachingSinceYear} required /></label>
            <fieldset className="selection-fieldset"><legend>Przedmioty</legend>
              {SUBJECTS.map((subject) => (
                <label className="check-option" key={subject}>
                  <input type="checkbox" name="subjects" value={subject} defaultChecked={profile.subjects.includes(subject)} />{subject}
                </label>
              ))}
            </fieldset>
            <fieldset className="selection-fieldset"><legend>Poziomy nauczania</legend>
              {LEVELS.map((level) => (
                <label className="check-option" key={level.id}>
                  <input type="checkbox" name="levels" value={level.id} defaultChecked={profile.levels.includes(level.id)} />{level.label}
                </label>
              ))}
            </fieldset>
            <button className="book-button" type="submit" disabled={saving}>{saving ? 'Zapisywanie…' : 'Zapisz profil'}</button>
          </form>
        </section>

        <section className="dashboard-panel schedule-panel">
          <h2>Zakres godzin nauczania</h2>
          <p className="form-hint">Ustaw dostępność na każdy dzień tygodnia. Pojedyncza lekcja trwa 40 minut.</p>
          <div className="weekly-schedule">
            {days.map((day) => (
              <div className="schedule-day" key={day.weekday}>
                <label className="check-option schedule-day-toggle">
                  <input type="checkbox" checked={day.enabled} onChange={(event) => updateDay(day.weekday, { enabled: event.target.checked })} />
                  <strong>{WEEKDAYS[day.weekday]}</strong>
                </label>
                {day.enabled && (
                  <div className="schedule-slider-row">
                    <label>Od <output>{day.startTime}</output>
                      <input
                        type="range" min="360" max={scheduleMinutes(day.endTime) - 40} step="20"
                        value={scheduleMinutes(day.startTime)}
                        aria-label={`${WEEKDAYS[day.weekday]} — początek dostępności`}
                        onChange={(event) => updateDay(day.weekday, { startTime: formatTime(Number(event.target.value)) })}
                      />
                    </label>
                    <label>Do <output>{day.endTime}</output>
                      <input
                        type="range" min={scheduleMinutes(day.startTime) + 40} max="1320" step="20"
                        value={scheduleMinutes(day.endTime)}
                        aria-label={`${WEEKDAYS[day.weekday]} — koniec dostępności`}
                        onChange={(event) => updateDay(day.weekday, { endTime: formatTime(Number(event.target.value)) })}
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="book-button" type="button" disabled={saving} onClick={saveSchedule}>Zapisz dostępność</button>
          <div className="calendar-section">
            <h2>Rezerwacje w tym miesiącu</h2>
            <div className="calendar-grid calendar-weekdays" aria-hidden="true">{['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="calendar-grid">
              {getMonthDates(currentMonth).map((date, index) => date
                ? <span className={`calendar-day${countForDate(date) ? ' is-available' : ''}`} key={date} title={`${countForDate(date)} lekcji`}>
                  {Number(date.slice(-2))}{countForDate(date) > 0 && <small>{countForDate(date)}</small>}
                </span>
                : <span className="calendar-empty" key={`this-month-${index}`} />)}
            </div>
            <p className="calendar-note">Liczba przy dniu oznacza zarezerwowane lekcje.</p>
          </div>
          <div className="calendar-section">
            <div className="calendar-month-nav">
              <button type="button" aria-label="Poprzedni miesiąc" onClick={() => shiftOffMonth(-1)}>‹</button>
              <h2>Dni wolne — {monthName(offMonth)}</h2>
              <button type="button" aria-label="Następny miesiąc" onClick={() => shiftOffMonth(1)}>›</button>
            </div>
            <div className="calendar-grid calendar-weekdays" aria-hidden="true">{['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="calendar-grid">
              {nextMonthDates.map((date, index) => date
                ? <button
                  className={`calendar-day${daysOff.includes(date) ? ' is-day-off' : ''}`}
                  key={date}
                  type="button"
                  disabled={savingDaysOff}
                  aria-pressed={daysOff.includes(date)}
                  onClick={() => toggleDayOff(date)}
                >{Number(date.slice(-2))}</button>
                : <span className="calendar-empty" key={`next-month-${index}`} />)}
            </div>
            <p className="calendar-note">Kliknij dzień, aby oznaczyć lub odwołać „Dzień wolny”.</p>
          </div>
          <div className="zoom-connect">
            <h2>Połącz konto Zoom</h2>
            <p>{zoom.connected ? 'Konto Zoom jest połączone.' : 'Połącz konto Zoom, aby automatycznie tworzyć spotkania i pobrać zdjęcie profilowe.'}</p>
            {zoom.connected
              ? <span className="status-pill">Połączono</span>
              : zoom.configured
                ? <a className="book-button" href="/api/zoom/connect">Połącz z Zoom</a>
                : <p className="form-hint">Administrator serwera musi najpierw skonfigurować dane aplikacji Zoom.</p>}
          </div>
        </section>
      </div>
    </main>
  )
}

function App() {
  const [user, setUser] = useState(undefined)
  const [tutors, setTutors] = useState([])
  const [isTutorsLoading, setIsTutorsLoading] = useState(true)
  const [tutorError, setTutorError] = useState('')
  const [authError, setAuthError] = useState('')
  const params = new URLSearchParams(window.location.search)
  const selectedTutorId = params.get('tutor')
  const route = window.location.pathname

  useEffect(() => {
    api('/auth/me')
      .then((result) => setUser(result.user))
      .catch((error) => setAuthError(error.message))
    api('/tutors')
      .then((result) => {
        setTutors(result.tutors)
        setIsTutorsLoading(false)
      })
      .catch((error) => {
        setTutorError(error.message)
        setIsTutorsLoading(false)
      })
  }, [])

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' })
      setUser(null)
      window.location.assign('/')
    } catch (error) {
      setAuthError(error.message)
    }
  }

  async function refreshUser() {
    const result = await api('/auth/me')
    setUser(result.user)
  }

  function onAuthenticated(nextUser, nextPath) {
    setUser(nextUser)
    window.location.assign(nextPath)
  }

  if (user === undefined) {
    return <main className="main-content"><div className={authError ? 'message-state message-state--error' : 'message-state'} role={authError ? 'alert' : 'status'}>{authError || 'Wczytywanie Tutorland…'}</div></main>
  }

  const isTutorHome = user?.role === 'tutor' && !selectedTutorId && (route === '/' || route === '/profile')
  return (
    <div className={selectedTutorId ? 'app-shell app-shell--detail' : 'app-shell'}>
      <div className="main-column">
        <SiteHeader user={user} onLogout={logout} />
        {route === '/login' || route === '/logowanie'
          ? <AuthPage type="login" onAuthenticated={onAuthenticated} />
          : route === '/register' || route === '/rejestracja'
            ? <AuthPage type="register" onAuthenticated={onAuthenticated} />
            : isTutorHome
              ? <TutorDashboard onUserChanged={refreshUser} />
              : route === '/profile' && user?.role !== 'tutor'
                ? <main className="main-content"><div className="message-state" role="status">Ta strona jest dostępna dla korepetytora.</div></main>
                : route === '/notifications' && user?.role === 'student'
                  ? <StudentDashboard />
                  : route === '/notifications' && user?.role === 'tutor'
                    ? <TutorDashboard onUserChanged={refreshUser} notificationsOnly />
                    : selectedTutorId
                      ? <TutorProfile key={selectedTutorId} tutorId={selectedTutorId} user={user} />
                      : <Directory tutors={tutors} error={tutorError} isLoading={isTutorsLoading} />}
      </div>
    </div>
  )
}

export default App
