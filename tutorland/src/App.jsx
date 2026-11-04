import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, formatDate, formatTime } from './api.js'
import { availableSlotsForDate } from './calendar.js'
import { DEFAULT_SUBJECTS, formatSubjectName, subjectKey } from './subjects.js'
import './App.css'

const LEVELS = [
  { id: 'primary', label: 'Szkoła Podstawowa' },
  { id: 'secondary', label: 'Szkoła Średnia' },
  { id: 'tertiary', label: 'Studia' },
]
const WEEKDAYS = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota']
const CURRENT_YEAR = new Date().getFullYear()
const PhotoPreviewContext = createContext(null)
const FILTER_BOUNDS = {
  price: [0, 1000],
  experience: [0, 30],
}
const DEFAULT_TUTOR_IMAGE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 128 128%22%3E%3Crect width=%22128%22 height=%22128%22 fill=%22%23e8e6df%22/%3E%3Ccircle cx=%2264%22 cy=%2246%22 r=%2224%22 fill=%22%23989a9a%22/%3E%3Cpath d=%22M20 128c2-28 20-43 44-43s42 15 44 43%22 fill=%22%23989a9a%22/%3E%3C/svg%3E'

function appPageUrl(page, searchParams = {}) {
  const params = new URLSearchParams({ page, ...searchParams })
  return `/?${params.toString()}`
}

function chatPageUrl(chatId) {
  return appPageUrl('chats', chatId ? { chat: chatId } : {})
}

function routeUrl(route, searchParams = {}) {
  if (route === '/') return '/'
  return appPageUrl(route.replace(/^\//, ''), searchParams)
}

function imageSource(path) {
  return /^https:\/\//i.test(path ?? '') || /^data:image\/(?:webp|png|jpeg);base64,/i.test(path ?? '')
    ? path
    : DEFAULT_TUTOR_IMAGE
}

function PhotoPreviewProvider({ children }) {
  const [photo, setPhoto] = useState(null)
  const openerRef = useRef(null)
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!photo) return undefined

    const previousOverflow = document.body.style.overflow
    function closeOnEscape(event) {
      if (event.key === 'Escape') setPhoto(null)
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    dialogRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
      openerRef.current?.focus()
      openerRef.current = null
    }
  }, [photo])

  function openPhoto(event, src, alt) {
    event.preventDefault()
    event.stopPropagation()
    openerRef.current = event.currentTarget
    setPhoto({ src, alt })
  }

  return (
    <PhotoPreviewContext.Provider value={openPhoto}>
      {children}
      {photo && (
        <div className="photo-preview-backdrop" onClick={() => setPhoto(null)}>
          <section
            className="photo-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={photo.alt}
            tabIndex="-1"
            ref={dialogRef}
            onClick={(event) => event.stopPropagation()}
          >
            <button className="photo-preview-close" type="button" onClick={() => setPhoto(null)} aria-label="Zamknij podgląd zdjęcia">
              <span aria-hidden="true">&times;</span>
            </button>
            <img className="photo-preview-large" src={photo.src} alt={photo.alt} />
          </section>
        </div>
      )}
    </PhotoPreviewContext.Provider>
  )
}

function PreviewableImage({ src, alt, className, triggerClassName = '' }) {
  const openPhoto = useContext(PhotoPreviewContext)
  return (
    <button
      className={`photo-preview-trigger ${triggerClassName}`}
      type="button"
      aria-label={`Powiększ: ${alt}`}
      onClick={(event) => openPhoto(event, src, alt)}
    >
      <img className={className} src={src} alt={alt} />
    </button>
  )
}

async function resizeProfileImage(file) {
  if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) {
    throw new Error('Wybierz zdjęcie o rozmiarze do 8 MB.')
  }
  const image = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 512 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Nie udało się przygotować zdjęcia.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const result = canvas.toDataURL('image/webp', 0.82)
    if (result.length > 700_000) throw new Error('Zdjęcie jest zbyt duże po kompresji. Wybierz inny plik.')
    return result
  } finally {
    image.close()
  }
}

function ProfileAvatar({ image, name, className = 'student-avatar' }) {
  return image
    ? <PreviewableImage
        className="profile-avatar-image"
        triggerClassName={`profile-avatar-trigger ${className}`}
        src={imageSource(image)}
        alt={`Zdjęcie ${name}`}
      />
    : <span className={className} aria-label={`Inicjały ${name}`} aria-hidden="true">{name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span>
}

function ProfilePhotoEditor({ image, onChange, disabled = false }) {
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)

  async function selectPhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setProcessing(true)
    try {
      onChange(await resizeProfileImage(file))
    } catch (failure) {
      setError(failure.message)
    } finally {
      setProcessing(false)
      event.target.value = ''
    }
  }

  return (
    <div className="profile-photo-editor">
      {image && <PreviewableImage className="profile-photo-preview" src={imageSource(image)} alt="Zdjęcie profilowe" />}
      <label className="photo-upload-label">
        {processing ? 'Przygotowywanie zdjęcia…' : 'Wybierz zdjęcie'}
        <input type="file" accept="image/*" disabled={disabled || processing} onChange={selectPhoto} />
      </label>
      {image && <button className="text-button text-button--danger" type="button" disabled={disabled || processing} onClick={() => onChange('')}>Usuń zdjęcie</button>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="form-hint">Zdjęcie zostanie zmniejszone przed zapisaniem. Maksymalny rozmiar pliku: 8 MB.</p>
    </div>
  )
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

function levelLabel(id) {
  return LEVELS.find((level) => level.id === id)?.label ?? 'Poziom nieokreślony'
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

function SiteHeader({ user, onLogout, route }) {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return undefined

    function closeOnEscape(event) {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  function closeMenu() {
    setMenuOpen(false)
  }

  return (
    <header className="page-header">
      <a className="brand" href="/" aria-label="Tutorland — strona główna">
        Tutor<span>land</span><span className="brand-dot">.</span>
      </a>
      <button
        className="header-menu-toggle"
        type="button"
        aria-label={menuOpen ? 'Zamknij menu' : 'Otwórz menu'}
        aria-expanded={menuOpen}
        aria-controls="account-navigation"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span />
        <span />
        <span />
      </button>
      {user ? (
        <nav id="account-navigation" className={`header-actions${menuOpen ? ' is-open' : ''}`} aria-label="Menu konta">
          <span className="header-user">
            <ProfileAvatar image={user.profileImage} name={`${user.firstName} ${user.lastName}`} />
            {user.firstName} {user.lastName}
          </span>
          {user.role === 'tutor'
            ? <><a className="header-link" href={routeUrl('/profile')} aria-current={route === '/profile' ? 'page' : undefined} onClick={closeMenu}>Mój profil</a><a className="header-link" href={routeUrl('/lessons')} aria-current={route === '/lessons' ? 'page' : undefined} onClick={closeMenu}>Moje lekcje</a><a className="header-link" href={chatPageUrl()} aria-current={route === '/chats' ? 'page' : undefined} onClick={closeMenu}>Wiadomości</a><a className="header-link" href={routeUrl('/notifications')} aria-current={route === '/notifications' ? 'page' : undefined} onClick={closeMenu}>Powiadomienia</a></>
            : <><a className="header-link" href={routeUrl('/profile')} aria-current={route === '/profile' ? 'page' : undefined} onClick={closeMenu}>Mój profil</a><a className="header-link" href={chatPageUrl()} aria-current={route === '/chats' ? 'page' : undefined} onClick={closeMenu}>Wiadomości</a><a className="header-link" href={routeUrl('/notifications')} aria-current={route === '/notifications' ? 'page' : undefined} onClick={closeMenu}>Powiadomienia</a></>}
          <button className="header-button" type="button" onClick={() => { closeMenu(); onLogout() }}>Wyloguj</button>
        </nav>
      ) : (
        <nav id="account-navigation" className={`header-actions${menuOpen ? ' is-open' : ''}`} aria-label="Konto użytkownika">
          <a className="header-button header-button--quiet" href={routeUrl('/login')} onClick={closeMenu}>Zaloguj</a>
          <a className="header-button" href={routeUrl('/register')} onClick={closeMenu}>Zarejestruj</a>
        </nav>
      )}
    </header>
  )
}

function TutorCard({ tutor }) {
  const experience = Math.max(0, CURRENT_YEAR - tutor.teachingSinceYear)
  return (
    <article
      className={`tutor-card tutor-card--${tutorClasses(tutor)}`}
    >
      <div className="tutor-card-inner">
        <div className="photo-wrap">
          <PreviewableImage
            className="tutor-photo"
            triggerClassName="photo-preview-trigger--fill"
            src={imageSource(tutor.imagePath)}
            alt={`Zdjęcie ${tutor.firstName} ${tutor.lastName}`}
          />
          <span className="experience-badge">{experience} lat doświadczenia</span>
        </div>
        <a className="tutor-details tutor-details-link" href={`/?tutor=${encodeURIComponent(tutor.tutorId)}`}>
          <div className="tutor-topline">
            <h2 className="tutor-name">{tutor.firstName} {tutor.lastName}</h2>
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
          <span className="card-profile-link">Zobacz profil →</span>
        </a>
      </div>
    </article>
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
                {level.label}
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
  const [level, setLevel] = useState(tutor.levels[0] ?? '')
  const [message, setMessage] = useState('')
  const [chatId, setChatId] = useState('')
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
  const slots = selectedDate ? availableSlotsForDate(selectedDate, data, now) : []

  async function book() {
    setError('')
    setMessage('')
    setChatId('')
    if (!user) {
      window.location.assign(routeUrl('/login', {
        returnTo: window.location.pathname + window.location.search,
      }))
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
        body: { tutorId: tutor.tutorId, date: selectedDate, startTime: selectedTime, subject, level },
      })
      setChatId(result.booking.chatId)
      setMessage('Termin został zapisany. Możesz teraz napisać do korepetytora.')
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
    setChatId('')
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
              const isFree = availableSlotsForDate(date, data, now).length > 0
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
                    setChatId('')
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
                  <label className="booking-form-label" htmlFor="booking-level">Poziom nauczania</label>
                  <select id="booking-level" value={level} onChange={(event) => setLevel(event.target.value)} required>
                    <option value="">Wybierz poziom</option>
                    {tutor.levels.map((item) => <option key={item} value={item}>{levelLabel(item)}</option>)}
                  </select>
                  {user?.role === 'student'
                    ? <button className="book-button" type="button" disabled={saving || !level} onClick={book}>{saving ? 'Zapisywanie…' : 'Zarezerwuj lekcję'}</button>
                    : <button className="book-button" type="button" onClick={book}>{user ? 'Konto ucznia jest wymagane' : 'Zaloguj się, aby zarezerwować'}</button>}
                </div>
              )}
            </>
          ) : (
            <p className="slots-hint">{selectedDate ? 'Brak wolnych lekcji w tym dniu.' : 'Wybierz oznaczony dzień w kalendarzu.'}</p>
          )}
          {error && <p className="booking-error" role="alert">{error}</p>}
          {message && <p className="booking-confirmation" role="status">{message}</p>}
          {chatId && <a className="booking-chat-link" href={chatPageUrl(chatId)}>Otwórz chat z korepetytorem</a>}
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
  const { tutor } = data
  return (
    <main className="main-content tutor-detail-page">
      <div className="detail-back-row"><a className="back-link" href="/">← Wszyscy korepetytorzy</a></div>
      <div className="tutor-profile-layout">
        <aside className="tutor-profile-column">
          <div className={`profile-card tutor-card--${tutorClasses(tutor)}`}>
            <PreviewableImage
              className="profile-photo"
              triggerClassName="photo-preview-trigger--profile"
              src={imageSource(tutor.imagePath)}
              alt={`Zdjęcie ${tutor.firstName} ${tutor.lastName}`}
            />
            <div className="profile-details">
              <h1>{tutor.firstName} {tutor.lastName}</h1>
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
        </div>
      </div>
    </main>
  )
}

function AuthPage({ type, initialError = '' }) {
  const isRegister = type === 'register'
  const [role, setRole] = useState('student')
  const [error, setError] = useState(initialError)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false)
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const returnTo = params.get('returnTo')
  const safeReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'

  async function submitAuth(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const body = Object.fromEntries(formData.entries())
    if (isRegister && body.password !== body.passwordConfirmation) {
      setError('Wpisane hasła nie są takie same.')
      return
    }
    if (isRegister) body.role = role
    setIsSubmitting(true)
    setError('')
    try {
      const result = await api(`/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        body,
      })
      const destination = isRegister && result.user.role === 'tutor'
        ? routeUrl('/profile', { complete: '1' })
        : safeReturnTo
      window.location.assign(destination)
    } catch (failure) {
      setError(failure.message)
      setIsSubmitting(false)
    }
  }

  return (
    <main className="main-content auth-page">
      <section className="auth-card">
        <p className="eyebrow">Tutorland</p>
        <h1>{isRegister ? 'Załóż konto' : 'Zaloguj się'}</h1>
        <p className="auth-intro">
          {isRegister
            ? 'Utwórz konto za pomocą adresu e-mail i hasła.'
            : 'Zaloguj się za pomocą adresu e-mail i hasła.'}
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <form className="auth-form" onSubmit={submitAuth}>
          {isRegister && (
            <>
              <fieldset className="role-choice">
                <legend>Dołącz jako</legend>
                <label><input type="radio" name="role-choice" checked={role === 'student'} onChange={() => setRole('student')} /> Uczeń</label>
                <label><input type="radio" name="role-choice" checked={role === 'tutor'} onChange={() => setRole('tutor')} /> Korepetytor</label>
              </fieldset>
              <label>Imię
                <input name="firstName" required minLength="2" maxLength="80" autoComplete="given-name" />
              </label>
              <label>Nazwisko
                <input name="lastName" required minLength="2" maxLength="80" autoComplete="family-name" />
              </label>
            </>
          )}
          <label>Adres e-mail
            <input name="email" type="email" required maxLength="254" autoComplete="email" />
          </label>
          <label>Hasło
            <span className="password-field">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength="8"
                maxLength="256"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
              <button className="password-toggle" type="button" aria-label={showPassword ? 'Ukryj hasło' : 'Pokaż hasło'} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{showPassword && <path d="m4 4 16 16" />}</svg>
              </button>
            </span>
          </label>
          {isRegister && (
            <label>Powtórz hasło
              <span className="password-field">
                <input
                  name="passwordConfirmation"
                  type={showPasswordConfirmation ? 'text' : 'password'}
                  required
                  minLength="8"
                  maxLength="256"
                  autoComplete="new-password"
                />
                <button className="password-toggle" type="button" aria-label={showPasswordConfirmation ? 'Ukryj powtórzone hasło' : 'Pokaż powtórzone hasło'} aria-pressed={showPasswordConfirmation} onClick={() => setShowPasswordConfirmation((value) => !value)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{showPasswordConfirmation && <path d="m4 4 16 16" />}</svg>
                </button>
              </span>
            </label>
          )}
          <button className="book-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Trwa logowanie…' : isRegister ? 'Utwórz konto' : 'Zaloguj się'}
          </button>
        </form>
        <p className="auth-switch">
          {isRegister ? 'Masz już konto? ' : 'Nie masz jeszcze konta? '}
          <a href={routeUrl(isRegister ? '/login' : '/register', returnTo ? { returnTo: safeReturnTo } : {})}>
            {isRegister ? 'Zaloguj się' : 'Zarejestruj się'}
          </a>
        </p>
      </section>
    </main>
  )
}

function DeleteAccountSection({ role }) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function deleteAccount() {
    const dataDescription = role === 'tutor'
      ? 'Twój profil korepetytora, dostępność i rezerwacje zostaną trwale usunięte.'
      : 'Twoje rezerwacje zostaną trwale usunięte.'
    const confirmed = window.confirm(
      `${dataDescription}\n\nTej operacji nie można cofnąć. Spotkania w zewnętrznych kalendarzach nie zostaną odwołane automatycznie. Czy na pewno usunąć konto?`,
    )
    if (!confirmed) return

    setDeleting(true)
    setError('')
    try {
      await api('/auth/delete-account', { method: 'POST' })
      window.location.assign(routeUrl('/'))
    } catch (failure) {
      setError(failure.message)
      setDeleting(false)
    }
  }

  return (
    <div className="delete-account">
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="text-button text-button--danger" type="button" disabled={deleting} onClick={deleteAccount}>
        {deleting ? 'Usuwanie konta…' : 'Usuń konto'}
      </button>
    </div>
  )
}

function StudentProfile({ onUserChanged }) {
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingPhoto, setSavingPhoto] = useState(false)

  useEffect(() => {
    let active = true
    api('/student/profile')
      .then((result) => { if (active) setProfile(result.profile) })
      .catch((failure) => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [])

  async function saveProfile(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    const values = new FormData(event.currentTarget)
    try {
      await api('/student/profile', {
        method: 'PUT',
        body: { firstName: values.get('firstName'), lastName: values.get('lastName') },
      })
      await onUserChanged()
      setMessage('Profil został zapisany.')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSaving(false)
    }
  }

  async function savePhoto(profileImage) {
    setSavingPhoto(true)
    setError('')
    setMessage('')
    try {
      await api('/profile/photo', { method: 'PUT', body: { profileImage } })
      setProfile((current) => ({ ...current, profileImage }))
      await onUserChanged()
      setMessage(profileImage ? 'Zdjęcie profilowe zostało zapisane.' : 'Zdjęcie profilowe zostało usunięte.')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSavingPhoto(false)
    }
  }

  if (!profile) return <main className="main-content"><div className={error ? 'message-state message-state--error' : 'message-state'} role={error ? 'alert' : 'status'}>{error || 'Wczytywanie profilu…'}</div></main>
  return (
    <main className="main-content dashboard-page">
      <div className="section-heading"><div><p className="eyebrow">Twoje konto ucznia</p><h1>Mój profil</h1></div></div>
      <section className="dashboard-panel profile-editor">
        <p className="form-hint">Uzupełnij lub zmień dane wyświetlane na Twoim profilu.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="booking-confirmation" role="status">{message}</p>}
        <ProfilePhotoEditor image={profile.profileImage} onChange={savePhoto} disabled={savingPhoto} />
        <form className="auth-form" onSubmit={saveProfile}>
          <label>Imię<input name="firstName" defaultValue={profile.firstName} autoComplete="given-name" required minLength="2" maxLength="80" /></label>
          <label>Nazwisko<input name="lastName" defaultValue={profile.lastName} autoComplete="family-name" required minLength="2" maxLength="80" /></label>
          <button className="book-button" type="submit" disabled={saving}>{saving ? 'Zapisywanie…' : 'Zapisz profil'}</button>
        </form>
      </section>
      <section className="dashboard-panel">
        <h2>Usuwanie konta</h2>
        <DeleteAccountSection role="student" />
      </section>
    </main>
  )
}

function StudentDashboard() {
  const [bookings, setBookings] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api('/bookings')
      .then((bookingResult) => {
        if (!active) return
        setBookings(bookingResult.bookings)
      })
      .catch((failure) => {
        if (active) setError(failure.message)
      })
    return () => { active = false }
  }, [])

  const orderedBookings = bookings.slice().sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
  return (
    <main className="main-content dashboard-page">
      <div className="section-heading"><div><p className="eyebrow">Twoje konto</p><h1>Powiadomienia i lekcje</h1></div></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="dashboard-panel">
        <h2>Zaplanowane lekcje</h2>
        {orderedBookings.length ? (
          <div className="notification-list">
            {orderedBookings.map((booking) => (
              <article className="notification-card" key={booking.id}>
                <div>
                  <p className="eyebrow">{booking.isPast ? 'Zakończona lekcja' : 'Zaplanowana lekcja'}</p>
                  <h3>{booking.subject} · {levelLabel(booking.level)} · {formatDate(booking.date)} o {booking.startTime}</h3>
                  <p>Korepetytor: <a href={`/?tutor=${encodeURIComponent(booking.tutorId)}`}>{booking.tutorName || 'Zobacz profil'}</a></p>
                  {booking.chatId && <a className="text-button chat-open-link" href={chatPageUrl(booking.chatId)}>Otwórz chat z korepetytorem</a>}
                </div>
              </article>
            ))}
          </div>
        ) : <p className="empty-note">Nie masz jeszcze zaplanowanych lekcji.</p>}
      </section>
    </main>
  )
}

function ChatPage({ user }) {
  const [chats, setChats] = useState([])
  const [selectedChatId, setSelectedChatId] = useState(() => new URLSearchParams(window.location.search).get('chat') ?? '')
  const [messages, setMessages] = useState([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const messagesRef = useRef(null)
  const selectedChat = chats.find((chat) => chat.id === selectedChatId)
  const otherName = user.role === 'tutor' ? selectedChat?.studentName : selectedChat?.tutorName
  const otherImage = user.role === 'tutor' ? selectedChat?.studentImage : selectedChat?.tutorImage

  useEffect(() => {
    let active = true
    async function refreshChats() {
      try {
        const result = await api('/messages')
        if (active) {
          setChats(result.chats)
          setError('')
        }
      } catch (failure) {
        if (active) setError(failure.message)
      }
    }
    refreshChats()
    const interval = setInterval(refreshChats, 8000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!selectedChatId) return undefined

    let active = true
    async function refreshMessages() {
      try {
        const chatId = encodeURIComponent(selectedChatId)
        const result = await api(`/messages?chatId=${chatId}`)
        if (active) {
          setMessages(result.messages)
          setError('')
        }
      } catch (failure) {
        if (active) setError(failure.message)
      }
    }
    refreshMessages()
    const interval = setInterval(refreshMessages, 5000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [selectedChatId])

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messages, selectedChatId])

  async function sendMessage(event) {
    event.preventDefault()
    if (!selectedChatId || !content.trim()) return
    setSending(true)
    setError('')
    try {
      const result = await api('/messages', {
        method: 'POST',
        body: { chatId: selectedChatId, content },
      })
      setMessages((current) => current.some((message) => message.id === result.message.id)
        ? current
        : [...current, result.message])
      setContent('')
      setChats((current) => current.map((chat) => chat.id === selectedChatId
        ? { ...chat, latestMessage: result.message.content, lastActivity: result.message.createdAt }
        : chat).sort((a, b) => b.lastActivity.localeCompare(a.lastActivity)))
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="main-content dashboard-page">
      <div className="section-heading"><div><p className="eyebrow">Kontakt z uczniem i korepetytorem</p><h1>Wiadomości</h1></div></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="chat-layout">
        <aside className="chat-list-panel" aria-label="Lista rozmów">
          <h2>Twoje rozmowy</h2>
          {chats.length ? chats.map((chat) => {
            const name = user.role === 'tutor' ? chat.studentName : chat.tutorName
            const image = user.role === 'tutor' ? chat.studentImage : chat.tutorImage
            return (
              <button
                className={`chat-list-item${selectedChatId === chat.id ? ' is-active' : ''}`}
                type="button"
                key={chat.id}
                aria-pressed={selectedChatId === chat.id}
                onClick={() => {
                  setMessages([])
                  setSelectedChatId(chat.id)
                }}
              >
                <ProfileAvatar image={image} name={name} className="chat-list-avatar" />
                <span className="chat-list-copy">
                  <strong>{name}</strong>
                  <span>{chat.latestMessage || 'Rozpocznij rozmowę'}</span>
                </span>
              </button>
            )
          }) : <p className="chat-empty">Rozmowa pojawi się tutaj po pierwszej rezerwacji lekcji.</p>}
        </aside>
        <section className="chat-thread-panel" aria-label="Wiadomości">
          {selectedChat ? (
            <>
              <header className="chat-thread-header">
                <ProfileAvatar image={otherImage} name={otherName} className="chat-list-avatar" />
                <h2>{otherName}</h2>
              </header>
              <div className="chat-message-list" ref={messagesRef} aria-live="polite">
                {messages.length ? messages.map((message) => (
                  <article
                    className={`chat-message${message.senderId === user.id ? ' is-own' : ''}${message.messageType === 'booking_notice' ? ' is-booking-notice' : ''}`}
                    key={message.id}
                  >
                    {message.messageType === 'booking_notice' && <strong>Informacja o rezerwacji</strong>}
                    <p>{message.content}</p>
                    <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</time>
                  </article>
                )) : <p className="chat-empty">Nie ma jeszcze wiadomości. Napisz pierwszą.</p>}
              </div>
              <form className="chat-compose" onSubmit={sendMessage}>
                <label className="visually-hidden" htmlFor="chat-message">Treść wiadomości</label>
                <textarea
                  id="chat-message"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="Napisz wiadomość…"
                  maxLength="4000"
                  rows="2"
                  required
                />
                <button className="book-button" type="submit" disabled={sending || !content.trim()}>
                  {sending ? 'Wysyłanie…' : 'Wyślij'}
                </button>
              </form>
            </>
          ) : <p className="chat-empty chat-thread-placeholder">{chats.length ? 'Wybierz rozmowę z listy.' : 'Nie masz jeszcze rozmów.'}</p>}
        </section>
      </section>
    </main>
  )
}

function TutorLessonsPage() {
  const [bookings, setBookings] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api('/bookings')
      .then((result) => { if (active) setBookings(result.bookings) })
      .catch((failure) => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [])

  const orderedBookings = bookings.slice().sort((a, b) => (
    `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)
  ))

  return (
    <main className="main-content dashboard-page">
      <div className="section-heading">
        <div><p className="eyebrow">Panel korepetytora</p><h1>Moje lekcje</h1></div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="dashboard-panel">
        <h2>Harmonogram lekcji</h2>
        {orderedBookings.length ? (
          <div className="tutor-lesson-list">
            {orderedBookings.map((booking) => (
              <article className="tutor-lesson-card" key={booking.id}>
                <ProfileAvatar
                  image={booking.studentImage}
                  name={booking.studentName}
                  className="tutor-lesson-avatar"
                />
                <div className="tutor-lesson-details">
                  <p className="eyebrow">{booking.isPast ? 'Zakończona lekcja' : 'Zaplanowana lekcja'}</p>
                  <h3>{formatDate(booking.date)} · {booking.startTime}–{booking.endTime}</h3>
                  <p>{booking.studentName}</p>
                  <p>{booking.subject} · {levelLabel(booking.level)}</p>
                  {booking.chatId && <a className="text-button chat-open-link" href={chatPageUrl(booking.chatId)}>Otwórz chat z uczniem</a>}
                </div>
              </article>
            ))}
          </div>
        ) : <p className="empty-note">Nie masz jeszcze zaplanowanych lekcji.</p>}
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
  const [availableSubjects, setAvailableSubjects] = useState(DEFAULT_SUBJECTS)
  const [profileSubjects, setProfileSubjects] = useState([])
  const [subjectSearch, setSubjectSearch] = useState('')
  const [savingSubject, setSavingSubject] = useState(false)
  const [savingPhoto, setSavingPhoto] = useState(false)
  const [days, setDays] = useState(defaultSchedule)
  const [daysOff, setDaysOff] = useState([])
  const [bookings, setBookings] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [offMonth, setOffMonth] = useState(() => getMonth(1))
  const [currentMonth] = useState(getMonth)
  const [savingDaysOff, setSavingDaysOff] = useState(false)
  const [editingDayOff, setEditingDayOff] = useState('')
  const [dayOffType, setDayOffType] = useState('full')
  const [dayOffStartTime, setDayOffStartTime] = useState('09:00')
  const [dayOffEndTime, setDayOffEndTime] = useState('13:00')

  async function loadDashboard() {
    try {
      const [profileResult, scheduleResult, subjectResult] = await Promise.all([
        api('/tutor/profile'),
        api('/tutor/availability'),
        api('/subjects'),
      ])
      setProfile(profileResult.tutor)
      setProfileSubjects(profileResult.tutor.subjects)
      setAvailableSubjects(subjectResult.subjects)
      setDays(defaultSchedule().map((day) => {
        const range = daySchedule(scheduleResult.weekly, day.weekday)
        return range
          ? { weekday: day.weekday, enabled: true, startTime: range.startTime, endTime: range.endTime }
          : day
      }))
      setDaysOff(scheduleResult.daysOff)
      try {
        const notifications = await api('/tutor/notifications')
        setBookings(notifications.bookings)
        setError('')
      } catch (failure) {
        setError(`Nie udało się wczytać lekcji i powiadomień. ${failure.message}`)
      }
    } catch (failure) {
      setError(failure.message)
    }
  }

  useEffect(() => {
    let active = true
    Promise.all([
      api('/tutor/profile'),
      api('/tutor/availability'),
      api('/subjects'),
    ])
      .then(async ([profileResult, scheduleResult, subjectResult]) => {
        if (!active) return
        setProfile(profileResult.tutor)
        setProfileSubjects(profileResult.tutor.subjects)
        setAvailableSubjects(subjectResult.subjects)
        setDays(defaultSchedule().map((day) => {
          const range = daySchedule(scheduleResult.weekly, day.weekday)
          return range
            ? { weekday: day.weekday, enabled: true, startTime: range.startTime, endTime: range.endTime }
            : day
        }))
        setDaysOff(scheduleResult.daysOff)
        try {
          const notifications = await api('/tutor/notifications')
          if (!active) return
          setBookings(notifications.bookings)
        } catch (failure) {
          if (active) setError(`Nie udało się wczytać lekcji i powiadomień. ${failure.message}`)
        }
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
          subjects: profileSubjects,
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

  async function savePhoto(profileImage) {
    setSavingPhoto(true)
    setError('')
    setMessage('')
    try {
      await api('/profile/photo', { method: 'PUT', body: { profileImage } })
      setProfile((current) => ({ ...current, imagePath: profileImage }))
      await onUserChanged()
      setMessage(profileImage ? 'Zdjęcie profilowe zostało zapisane.' : 'Zdjęcie profilowe zostało usunięte.')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSavingPhoto(false)
    }
  }

  async function addProfileSubject(event) {
    event.preventDefault()
    const name = formatSubjectName(subjectSearch)
    if (!name) return
    const existing = availableSubjects.find((subject) => subjectKey(subject) === subjectKey(name))
    if (profileSubjects.some((subject) => subjectKey(subject) === subjectKey(name))) {
      setSubjectSearch('')
      return
    }

    setSavingSubject(true)
    setError('')
    try {
      const result = existing
        ? { subject: existing }
        : await api('/subjects', { method: 'POST', body: { name } })
      setAvailableSubjects((current) => [...current.filter((subject) => subjectKey(subject) !== subjectKey(result.subject)), result.subject])
      setProfileSubjects((current) => [...current, result.subject])
      setSubjectSearch('')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSavingSubject(false)
    }
  }

  function updateDay(weekday, changes) {
    setDays((current) => current.map((day) => day.weekday === weekday ? { ...day, ...changes } : day))
  }

  function shiftOffMonth(amount) {
    const [year, monthNumber] = offMonth.split('-').map(Number)
    const next = new Date(year, monthNumber - 1 + amount, 1, 12)
    setOffMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
    setEditingDayOff('')
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

  function editDayOff(date) {
    const existing = daysOff.find((day) => day.date === date)
    const weekday = new Date(`${date}T12:00:00`).getDay()
    const regularHours = daySchedule(days.filter((day) => day.enabled), weekday)
    setEditingDayOff(date)
    setDayOffType(existing?.startTime && existing?.endTime ? 'hours' : 'full')
    setDayOffStartTime(existing?.startTime || regularHours?.startTime || '09:00')
    setDayOffEndTime(existing?.endTime || regularHours?.endTime || '13:00')
  }

  async function saveDayOff() {
    if (dayOffType === 'hours' && timeMinutes(dayOffEndTime) - timeMinutes(dayOffStartTime) < 40) {
      setError('Przedział godzin musi obejmować co najmniej jedną lekcję 40-minutową.')
      return
    }
    const updatedDay = dayOffType === 'hours'
      ? { date: editingDayOff, startTime: dayOffStartTime, endTime: dayOffEndTime }
      : { date: editingDayOff, startTime: '', endTime: '' }
    const next = [...daysOff.filter((day) => day.date !== editingDayOff), updatedDay]
    setSavingDaysOff(true)
    setError('')
    try {
      const weekly = days.filter((day) => day.enabled).map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime }))
      await api('/tutor/availability', { method: 'PUT', body: { weekly, daysOff: next } })
      setDaysOff(next)
      setEditingDayOff('')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSavingDaysOff(false)
    }
  }

  async function removeDayOff() {
    const next = daysOff.filter((day) => day.date !== editingDayOff)
    setSavingDaysOff(true)
    setError('')
    try {
      const weekly = days.filter((day) => day.enabled).map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime }))
      await api('/tutor/availability', { method: 'PUT', body: { weekly, daysOff: next } })
      setDaysOff(next)
      setEditingDayOff('')
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
        <div className="section-heading"><div><p className="eyebrow">Panel korepetytora</p><h1>Powiadomienia i lekcje</h1></div></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <section className="dashboard-panel">
          <h2>Zaplanowane lekcje</h2>
          {sortedBookings.length ? <div className="notification-list">{sortedBookings.map((booking) => (
            <article className="notification-card" key={booking.id}>
              <p className="eyebrow">{booking.isPast ? 'Zakończona lekcja' : 'Zaplanowana lekcja'}</p>
              <h3>{booking.subject} · {levelLabel(booking.level)} · {formatDate(booking.date)} o {booking.startTime}</h3>
              <p>Uczeń: {booking.studentName}</p>
              {booking.chatId && <a className="text-button chat-open-link" href={chatPageUrl(booking.chatId)}>Otwórz chat z uczniem</a>}
            </article>
          ))}</div> : <p className="empty-note">Nie masz jeszcze rezerwacji.</p>}
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
            <PreviewableImage
              className="profile-photo"
              triggerClassName="photo-preview-trigger--profile"
              src={imageSource(profile.imagePath)}
              alt={`Zdjęcie ${profile.firstName} ${profile.lastName}`}
            />
            <div><h2>{profile.firstName} {profile.lastName}</h2></div>
          </div>
          <ProfilePhotoEditor image={profile.imagePath} onChange={savePhoto} disabled={savingPhoto} />
          <form className="auth-form" onSubmit={saveProfile}>
            <label>Imię<input name="firstName" defaultValue={profile.firstName} required minLength="2" /></label>
            <label>Nazwisko<input name="lastName" defaultValue={profile.lastName} required minLength="2" /></label>
            <label>Opis<textarea name="description" defaultValue={profile.description} required minLength="20" maxLength="2000" rows="4" /></label>
            <label>Cena za 40-minutową lekcję (zł)<input name="pricePerLesson" type="number" min="20" max="1000" defaultValue={profile.pricePerLesson} required /></label>
            <label>Uczę od roku<input name="teachingSinceYear" type="number" min="1950" max={CURRENT_YEAR} defaultValue={profile.teachingSinceYear} required /></label>
            <fieldset className="selection-fieldset subject-editor">
              <legend>Przedmioty</legend>
              <ul className="subject-tags subject-editor-tags">
                {profileSubjects.map((subject) => (
                  <li key={subject}>
                    <span className="subject-tag">{subject}</span>
                    <button
                      type="button"
                      className="subject-remove"
                      aria-label={`Usuń tag ${subject}`}
                      onClick={() => setProfileSubjects((current) => current.filter((value) => value !== subject))}
                    >×</button>
                  </li>
                ))}
              </ul>
              <label htmlFor="subject-search">Wyszukaj lub utwórz tag</label>
              <div className="subject-search-row">
                <input
                  id="subject-search"
                  list="subject-catalog"
                  value={subjectSearch}
                  maxLength="80"
                  onChange={(event) => setSubjectSearch(formatSubjectName(event.target.value))}
                  placeholder="np. Język angielski"
                />
                <datalist id="subject-catalog">
                  {availableSubjects
                    .filter((subject) => !profileSubjects.some((selected) => subjectKey(selected) === subjectKey(subject)))
                    .map((subject) => <option key={subject} value={subject} />)}
                </datalist>
                <button className="text-button" type="button" disabled={!subjectSearch.trim() || savingSubject} onClick={addProfileSubject}>
                  {savingSubject ? 'Dodawanie…' : 'Dodaj'}
                </button>
              </div>
              <p className="form-hint">Nowy tag będzie dostępny dla wszystkich korepetytorów.</p>
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
          <div className="account-delete-divider">
            <h3>Usuwanie konta</h3>
            <DeleteAccountSection role="tutor" />
          </div>
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
                ? (() => {
                  const dayOff = daysOff.find((day) => day.date === date)
                  const hasSpecialHours = dayOff?.startTime && dayOff?.endTime
                  const hasRegularHours = days.some((day) => (
                    day.enabled && day.weekday === new Date(`${date}T12:00:00`).getDay()
                  ))
                  const dayStatus = dayOff
                    ? hasSpecialHours ? 'dostępność' : 'cały dzień wolny'
                    : hasRegularHours ? 'normalny grafik' : 'brak zwykłej dostępności'
                  return <button
                    className={`calendar-day${dayOff ? hasSpecialHours ? ' is-special-hours' : ' is-day-off' : hasRegularHours ? ' is-available' : ' is-unavailable'}${editingDayOff === date ? ' is-active' : ''}`}
                    key={date}
                    type="button"
                    disabled={savingDaysOff}
                    aria-label={`${formatDate(date)}, ${hasSpecialHours ? `${dayOff.startTime}–${dayOff.endTime}` : dayStatus}`}
                    aria-pressed={Boolean(dayOff)}
                    onClick={() => editDayOff(date)}
                  >{Number(date.slice(-2))}</button>
                })()
                : <span className="calendar-empty" key={`next-month-${index}`} />)}
            </div>
            <div className="calendar-legend calendar-legend--availability">
              <span className="calendar-legend-item"><i className="calendar-legend-dot calendar-legend-dot--regular" /> Normalny grafik</span>
              <span className="calendar-legend-item"><i className="calendar-legend-dot calendar-legend-dot--off" /> Cały dzień wolny</span>
              <span className="calendar-legend-item"><i className="calendar-legend-dot calendar-legend-dot--special" /> Inne godziny</span>
              <span className="calendar-legend-item"><i className="calendar-legend-dot calendar-legend-dot--unavailable" /> Bez zwykłej dostępności</span>
            </div>
            <p className="calendar-note">Kliknij datę, aby ustawić cały dzień wolny albo godziny dostępności inne niż zwykle.</p>
            {editingDayOff && (
              <div className="day-off-editor">
                <h3>{formatDate(editingDayOff)}</h3>
                <label className="check-option">
                  <input type="radio" name="day-off-type" value="full" checked={dayOffType === 'full'} onChange={() => setDayOffType('full')} />
                  Cały dzień wolny
                </label>
                <label className="check-option">
                  <input type="radio" name="day-off-type" value="hours" checked={dayOffType === 'hours'} onChange={() => setDayOffType('hours')} />
                  Lekcje tylko w wybranym przedziale
                </label>
                {dayOffType === 'hours' && (
                  <div className="schedule-slider-row day-off-slider-row">
                    <label>Od <output>{dayOffStartTime}</output>
                      <input
                        type="range"
                        min="360"
                        max={timeMinutes(dayOffEndTime) - 40}
                        step="20"
                        value={timeMinutes(dayOffStartTime)}
                        aria-label="Początek niestandardowej dostępności"
                        onChange={(event) => setDayOffStartTime(formatTime(Number(event.target.value)))}
                      />
                    </label>
                    <label>Do <output>{dayOffEndTime}</output>
                      <input
                        type="range"
                        min={timeMinutes(dayOffStartTime) + 40}
                        max="1320"
                        step="20"
                        value={timeMinutes(dayOffEndTime)}
                        aria-label="Koniec niestandardowej dostępności"
                        onChange={(event) => setDayOffEndTime(formatTime(Number(event.target.value)))}
                      />
                    </label>
                  </div>
                )}
                <div className="form-actions">
                  <button className="book-button" type="button" disabled={savingDaysOff} onClick={saveDayOff}>
                    {savingDaysOff ? 'Zapisywanie…' : 'Zapisz dzień'}
                  </button>
                  {daysOff.some((day) => day.date === editingDayOff) && (
                    <button className="text-button text-button--danger" type="button" disabled={savingDaysOff} onClick={removeDayOff}>Usuń oznaczenie</button>
                  )}
                  <button className="header-button header-button--quiet" type="button" onClick={() => setEditingDayOff('')}>Anuluj</button>
                </div>
              </div>
            )}
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
  const requestedPage = params.get('page')
  const route = requestedPage
    ? (requestedPage.startsWith('/') ? requestedPage : `/${requestedPage}`)
    : window.location.pathname
  const isAuthRoute = ['/login', '/logowanie', '/register', '/rejestracja'].includes(route)

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

  if (user === undefined && !isAuthRoute) {
    return <main className="main-content"><div className={authError ? 'message-state message-state--error' : 'message-state'} role={authError ? 'alert' : 'status'}>{authError || 'Wczytywanie Tutorland…'}</div></main>
  }

  const isTutorHome = user?.role === 'tutor' && !selectedTutorId && (route === '/' || route === '/profile')
  return (
    <PhotoPreviewProvider>
      <div className={selectedTutorId ? 'app-shell app-shell--detail' : 'app-shell'}>
        <div className="main-column">
          <SiteHeader user={user} onLogout={logout} route={route} />
          {route === '/login' || route === '/logowanie'
            ? <AuthPage type="login" initialError={authError} />
            : route === '/register' || route === '/rejestracja'
              ? <AuthPage type="register" initialError={authError} />
              : isTutorHome
                ? <TutorDashboard onUserChanged={refreshUser} />
                : route === '/lessons' && user?.role === 'tutor'
                  ? <TutorLessonsPage />
                  : route === '/chats'
                    ? user
                      ? <ChatPage user={user} />
                      : <main className="main-content"><div className="message-state" role="status">Zaloguj się, aby otworzyć wiadomości.</div></main>
                : route === '/profile' && user?.role !== 'tutor'
                    ? user?.role === 'student'
                      ? <StudentProfile onUserChanged={refreshUser} />
                      : <main className="main-content"><div className="message-state" role="status">Zaloguj się, aby edytować profil.</div></main>
                  : route === '/notifications' && user?.role === 'student'
                    ? <StudentDashboard />
                    : route === '/notifications' && user?.role === 'tutor'
                      ? <TutorDashboard onUserChanged={refreshUser} notificationsOnly />
                      : selectedTutorId
                        ? <TutorProfile key={selectedTutorId} tutorId={selectedTutorId} user={user} />
                        : <Directory tutors={tutors} error={tutorError} isLoading={isTutorsLoading} />}
        </div>
      </div>
    </PhotoPreviewProvider>
  )
}

export default App
