# Tutorland

Strona główna i profile korepetytorów Tutorland. Kolory tagów i kart nawiązują do `../moodBoard.html`.

## Uruchomienie

W katalogu `tutorland`:

```sh
npm install
npm run dev
npm run build
npm run lint
```

## Pliki z danymi

Pliki CSV w `public/` można otwierać i edytować w arkuszu kalkulacyjnym:

- `tutors.csv` — dane korepetytorów, adres e-mail, rok rozpoczęcia nauczania, poziomy, przedmioty i ścieżka do zdjęcia. `imagePath` obsługuje adresy `https://`/`http://` albo ścieżki do przykładowych zdjęć w `../assets/`. Każdy korepetytor ma unikalny `tutorId`, niezależny od adresu e-mail.
- `students.csv` — imię, nazwisko, data urodzenia i e-mail ucznia.
- `comments.csv` — komentarze powiązane przez `tutorId` i adres ucznia.
- `tutor_availability.csv` — cotygodniowa dostępność danego korepetytora: dzień tygodnia (0 = niedziela, 1 = poniedziałek, …, 6 = sobota) i przedział godzin. Aplikacja dzieli przedział na lekcje po jednej godzinie.
- `bookings.csv` — przykładowe zajęte terminy.

Rezerwacje dokonane w demonstracyjnej wersji strony są zapisywane w `localStorage` przeglądarki. Przyciski e-mail w potwierdzeniu rezerwacji nie wykonują żadnej akcji i nie otwierają programu pocztowego.

Wartości `email` korepetytorów w przykładowym pliku są demonstracyjne i używają adresu podanego dla projektu. Przed użyciem poza lokalnym prototypem należy zastąpić je właściwymi adresami.
