const DEFAULT_SUBJECT_NAMES = [
  'Matematyka', 'Fizyka', 'Chemia', 'Informatyka', 'Angielski', 'Biologia',
  'Polski', 'Historia', 'Geografia', 'WOS', 'Filozofia', 'Ekonomia',
  'Język Niemiecki', 'Język Francuski', 'Język Hiszpański', 'Język Włoski',
  'Język Rosyjski', 'Język Polski dla obcokrajowców', 'Przyroda',
  'Edukacja Wczesnoszkolna', 'Wiedza o społeczeństwie', 'Programowanie',
  'Algorytmika', 'Statystyka', 'Rachunek różniczkowy', 'Elektrotechnika',
  'Mechanika', 'Astronomia', 'Muzyka', 'Plastyka', 'Religia', 'Etyka', 'Łacina',
]

export const DEFAULT_SUBJECTS = DEFAULT_SUBJECT_NAMES.map(formatSubjectName)

export function formatSubjectName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').replace(/(^|[\s-])(\p{L})/gu, (_, separator, letter) => (
    `${separator}${letter.toLocaleUpperCase('pl-PL')}`
  ))
}

export function subjectKey(value) {
  return formatSubjectName(value).trim().toLocaleLowerCase('pl-PL')
}
