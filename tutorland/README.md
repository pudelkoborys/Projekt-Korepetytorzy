# Tutorland

Tutorland to aplikacja do wyszukiwania korepetytorów, prezentowania ich ofert i rezerwowania lekcji. Uczniowie i korepetytorzy korzystają z kont o oddzielnych rolach. Korepetytorzy mogą zarządzać profilem, przedmiotami, poziomami nauczania i dostępnością.

Rezerwacja obejmuje 40-minutowe spotkanie Zoom ucznia i korepetytora. Spotkania i powiadomienia są dostępne po zalogowaniu. Aplikacja nie wysyła wiadomości e-mail. Dane są zapisywane przez lokalne API w prywatnych plikach CSV, bez bazy danych.

## Dokumentacja

- [Mapa stron (PDF)](docs/tutorland-mapa-stron.pdf)
- [Raport stanu prac (PDF)](docs/tutorland-stan-prac.pdf)
- [Dokumentacja produktu (PDF)](docs/tutorland-dokumentacja.pdf)
- [Moodboard projektu (PDF)](../moodBoard.pdf)

## Uruchomienie

W katalogu `tutorland`:

```sh
npm install
npm run dev
npm test
npm run lint
npm run build
```

`npm run dev` uruchamia frontend Vite pod `http://localhost:5173` i lokalne API na porcie `3001`. `npm start` uruchamia samo API. Dane API są zapisywane do `server/data/` i nie są serwowane jako pliki statyczne.

## Zoom OAuth

Połączenie konta Zoom wymaga aplikacji OAuth skonfigurowanej w Zoom Marketplace. Skopiuj `.env.example` do `.env` i uzupełnij identyfikator oraz sekret aplikacji Zoom. Przyznaj aplikacji zakresy `user:read:user`, `user:read:email` oraz `meeting:write:meeting`, potrzebne do odczytu profilu, dopasowania adresu e-mail i tworzenia spotkań. Ustaw adres powrotu aplikacji na `APP_ORIGIN/api/zoom/callback` (domyślnie `http://localhost:5173/api/zoom/callback`). `APP_ORIGIN` musi używać dokładnie tego samego hosta i portu, pod którym otwierasz stronę (`localhost` i `127.0.0.1` są różnymi hostami); ten sam pełny adres callbacku musi być zapisany w konfiguracji Zoom. Jeśli Vite uruchomi się na innym porcie, ustaw odpowiednie `APP_ORIGIN` i ten sam adres w konfiguracji Zoom. Klucz szyfrowania tokenów wygeneruj poleceniem `openssl rand -hex 32` i zapisz jako `ZOOM_TOKEN_ENCRYPTION_KEY`. Nie zapisuj sekretów w CSV ani repozytorium.

Po skonfigurowaniu integracji strona logowania udostępnia „Zaloguj przez Zoom”. Logowanie weryfikuje adres e-mail zwrócony przez Zoom i wpuszcza do istniejącego konta Tutorland o tej samej roli; samo logowanie Zoom nie zakłada kont automatycznie. Podczas rejestracji korepetytora oraz logowania hasłem konto korepetytora bez połączonego Zoom jest przekierowywane do autoryzacji, a połączenie można też uruchomić później z panelu profilu. Dla korepetytorów obraz `pic_url` pobrany z profilu Zoom jest ustawiany jako zdjęcie profilu Tutorland. Tokeny korepetytora są szyfrowane na serwerze; tokeny ucznia nie są zapisywane. Bez identyfikatora i sekretu aplikacji Zoom oraz klucza szyfrowania aplikacja nie może autoryzować kont ani utworzyć spotkań.

Spotkanie jest planowane na 40 minut w strefie `Europe/Warsaw`. Jeżeli korepetytor nie ma połączonego konta Zoom, rezerwacja zostaje zachowana ze statusem oczekującym. Po połączeniu konta serwer spróbuje utworzyć oczekujące i wcześniejsze nieudane spotkania. Uczeń otrzymuje link do dołączenia, a link prowadzący jest dostępny wyłącznie korepetytorowi.

## Dane aplikacji

Pliki CSV w `server/seed/` mają nagłówki, ale nie zawierają kont, demonstracyjnych profili, dostępności ani rezerwacji. Przy pierwszym uruchomieniu API są kopiowane do prywatnego katalogu `server/data/`; katalog pozostaje pusty, dopóki nie zarejestrują się nowi korepetytorzy. Zarejestrowane konta, hashe haseł, sesje, dane prywatne i rezerwacje nie są dostępne przez statyczny adres URL. Hasła są przechowywane jako hashe scrypt, sesja jest w ciasteczku `HttpOnly`, a tokeny Zoom są szyfrowane kluczem lokalnym.

Gdy żaden korepetytor nie ma profilu, katalog wyświetla informację, że nie ma jeszcze dostępnych korepetytorów. Po utworzeniu nowych kont działają rezerwacje terminów, spotkania Zoom oraz opinie. Uczeń może dodać jedną aktywną opinię na korepetytora po odbytej lekcji, edytować ją, usunąć i później dodać ponownie. Korepetytor może edytować własny profil i plan dostępności, oznaczać dni wolne oraz przeglądać spotkania i opinie.
