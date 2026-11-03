# Tutorland

Tutorland to aplikacja do wyszukiwania korepetytorów, prezentowania ich ofert i rezerwowania lekcji. Uczniowie i korepetytorzy korzystają z kont o oddzielnych rolach. Korepetytorzy mogą zarządzać profilem, przedmiotami, poziomami nauczania i dostępnością.

Katalog tagów przedmiotów jest wspólny dla korepetytorów; mogą oni dodawać własne tagi, które są formatowane i dostępne przy edycji innych profili. Rezerwacja obejmuje 40-minutową lekcję i zapisuje poziom nauczania oferowany przez korepetytora. Aplikacja nie tworzy obecnie linków do spotkań. Rezerwacje i powiadomienia są dostępne po zalogowaniu; aplikacja nie wysyła wiadomości e-mail.

## Konta i logowanie

Rejestracja i logowanie odbywają się przez adres e-mail i hasło. Przy rejestracji użytkownik wybiera rolę ucznia albo korepetytora; profil korepetytora powstaje automatycznie i można go później uzupełnić. Logowanie przez Google nie jest obecnie skonfigurowane. Konta utworzone wcześniej wyłącznie przez Zoom nie mają hasła i wymagają osobnego przeniesienia przez administratora. Konto można trwale usunąć w ustawieniach profilu.

## Dokumentacja

- [Mapa stron (PDF)](../docs/tutorland/tutorland-mapa-stron.pdf)
- [Raport stanu prac (PDF)](../docs/tutorland/tutorland-stan-prac.pdf)
- [Dokumentacja produktu (PDF)](../docs/tutorland/tutorland-dokumentacja.pdf)
- [Przekazanie projektu dla kolejnego asystenta (TXT)](../PRZEKAZANIE_PROJEKTU.txt)
- [Moodboard projektu (PDF)](../moodBoard.pdf)

## Rozwój lokalny

W katalogu `tutorland`:

```sh
npm install
npm run dev
npm test
npm run lint
npm run build
```

`npm run dev` uruchamia frontend Vite pod `http://localhost:5173` i lokalne API na porcie `3001`. `npm start` uruchamia samo API. Dane API są zapisywane do `server/data/` i nie są serwowane jako pliki statyczne.

Lokalne API Node.js nadal używa CSV i służy do pracy developerskiej. Wdrożona wersja używa PHP i MySQL; oba backendy udostępniają frontendowi te same ścieżki `/api/...`.

## Wdrożenie na tutorland.infinityfree.io

InfinityFree udostępnia PHP i MySQL, dlatego produkcyjne API znajduje się w `public/api/index.php`. Nie uruchamiaj tam `npm start` ani nie wysyłaj `node_modules`. Backend developerski Node.js i pliki CSV pozostają do pracy lokalnej; wdrożenie używa bazy MySQL.

### Wdrożenie

Docelowy adres działa przez HTTPS: `https://tutorland.infinityfree.io`. Używaj adresu HTTPS (nie HTTP) przy testach logowania; ciasteczko sesji jest oznaczone jako `Secure`. Jeśli przeglądarka pokaże błąd certyfikatu, zatrzymaj testy logowania i napraw SSL w panelu hostingu.

1. **Nie wpisuj komend w panelu hostingu.** Hosting nie potrzebuje terminala: gotowa strona znajduje się już w `dist/`. Jeżeli kiedyś zmienisz kod i trzeba będzie zbudować nową wersję, polecenia `npm install` i `npm run build` uruchom lokalnie w VS Code: otwórz folder `tutorland`, wybierz **Terminal → Nowy terminal** i wpisz je w terminalu na swoim komputerze.
2. W menedżerze plików hostingu albo przez FTP wgraj **zawartość** lokalnego katalogu `tutorland/dist/` do `htdocs` przypisanego do domeny `tutorland.infinityfree.io`. Włącz pokazywanie ukrytych plików i upewnij się, że wgrały się pliki `.htaccess` z `dist/` i `dist/api/`. Nie wgrywaj `node_modules`, `server/data`, `.env` ani całego repozytorium. Jeżeli `dist/` nie ma na komputerze, lokalnie otwórz terminal VS Code w folderze `tutorland` i uruchom `npm install`, a następnie `npm run build`.
3. W phpMyAdmin wybierz bazę utworzoną na koncie hostingu i zaimportuj kompletny plik `tutorland-database.sql` z folderu projektu nadrzędnego. Jeśli zmieni się schemat bazy, usuń stare tabele i zaimportuj ponownie aktualny, kompletny plik SQL zamiast wykonywać osobną migrację. Usunięcie tabel skasuje wszystkie konta, profile, rezerwacje i pozostałe dane. Plik zawiera tylko schemat, nie dane logowania do hostingu.
4. W katalogu `htdocs/api/` skopiuj `config.example.php` jako `config.local.php`. Wypełnij dane MySQL z sekcji **MySQL Connection Details** bieżącego konta hostingu: host, nazwę bazy, użytkownika i hasło. Nie wpisuj tych wartości do repozytorium ani nie przesyłaj ich w rozmowie.
5. W `config.local.php` ustaw `app_origin` na `https://tutorland.infinityfree.io`. Logowanie e-mail/hasło nie wymaga konfiguracji zewnętrznego dostawcy.
6. Po wgraniu plików sprawdź `https://tutorland.infinityfree.io/api/auth/me` — niezalogowany użytkownik powinien otrzymać JSON z `"user":null`.

Sekretna konfiguracja PHP jest ignorowana przez Git, a `public/api/.htaccess` blokuje jej pobranie przez HTTP. Integracja Zoom jest wyłączona; endpointy `/api/zoom/...` zwracają HTTP 410.

Schema SQL tworzy puste tabele. Aktualny katalog nie ma migracji danych runtime CSV do MySQL; konta, profile i rezerwacje należy założyć ponownie po wdrożeniu. Nie importuj prywatnego `server/data/` na hosting.
