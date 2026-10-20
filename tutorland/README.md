# Tutorland

Tutorland to aplikacja do wyszukiwania korepetytorów, prezentowania ich ofert i rezerwowania lekcji. Docelowo uczniowie i korepetytorzy będą korzystać z własnych kont. Korepetytorzy ustawią przedmioty, poziomy nauczania, ceny, rok rozpoczęcia nauczania i dostępność.

Rezerwacja planuje 40-minutowe spotkanie Zoom dla korepetytora i jednego ucznia. Szczegóły spotkań i powiadomienia będą dostępne na osobnej podstronie po zalogowaniu. Aplikacja nie wysyła wiadomości e-mail. Dane aplikacji będą przechowywane w plikach CSV przez lokalne API, bez bazy danych.

## Dokumentacja produktu

- [Dokumentacja produktu (PDF)](docs/tutorland-zakres-produktu.pdf)
- [Edytowalne źródło dokumentacji (HTML)](docs/tutorland-zakres-produktu.html)
- [Moodboard projektu (PDF)](../moodBoard.pdf)

## Uruchomienie

W katalogu `tutorland`:

```sh
npm install
npm run dev
npm run build
npm run lint
```

## Pliki z danymi prototypu

Pliki CSV w `public/` zawierają przykładowe dane i można je otwierać w arkuszu kalkulacyjnym:

- `tutors.csv` — dane korepetytorów, adres e-mail, rok rozpoczęcia nauczania, poziomy, przedmioty i ścieżka do zdjęcia. `imagePath` obsługuje adresy `https://`/`http://` albo ścieżki do przykładowych zdjęć w `../assets/`. Każdy korepetytor ma unikalny `tutorId`, niezależny od adresu e-mail.
- `students.csv` — przykładowe dane uczniów.
- `comments.csv` — przykładowe komentarze powiązane przez `tutorId` i adres ucznia.
- `tutor_availability.csv` — cotygodniowa dostępność korepetytora: dzień tygodnia (0 = niedziela, 1 = poniedziałek, …, 6 = sobota) i przedział godzin. Prototyp dzieli przedział na lekcje po 40 minut.
- `bookings.csv` — przykładowe zajęte terminy.

## Zakres prototypu i planowane funkcje

Obecny frontend React/Vite zapisuje rezerwacje w `localStorage` przeglądarki i nie tworzy jeszcze spotkań przez Zoom API. Integracja Zoom, logowanie, API zapisujące CSV oraz podstrona „Spotkania” z powiadomieniami są opisane jako docelowy zakres w dokumentacji. OAuth do Zoom wymaga bezpiecznej konfiguracji lokalnej; tokenów ani sekretów nie należy umieszczać w CSV ani repozytorium.

Przyciski e-mail w potwierdzeniu rezerwacji nie wykonują żadnej akcji i nie otwierają programu pocztowego.
