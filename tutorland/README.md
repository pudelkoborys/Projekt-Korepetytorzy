# Tutorland

Tutorland to aplikacja do wyszukiwania korepetytorów, prezentowania ich ofert i rezerwowania lekcji. Uczniowie i korepetytorzy korzystają z kont o oddzielnych rolach. Korepetytorzy mogą zarządzać profilem, przedmiotami, poziomami nauczania i dostępnością.

Katalog tagów przedmiotów jest wspólny dla korepetytorów; mogą oni dodawać własne tagi, które są formatowane i dostępne przy edycji innych profili. Rezerwacja obejmuje 40-minutową lekcję i zapisuje poziom nauczania oferowany przez korepetytora. Po pierwszej rezerwacji uczeń i korepetytor otrzymują jeden wspólny chat; kolejne lekcje z tym samym korepetytorem nie tworzą nowych rozmów. Po każdej rezerwacji chat otrzymuje wyróżnioną wiadomość z prośbą o uzgodnienie formy zajęć i płatności. Zwykłe i automatyczne wiadomości są widoczne wyłącznie dla uczestników i wygasają po miesiącu.

## Konta i logowanie

Rejestracja i logowanie odbywają się przez adres e-mail i hasło. Przy rejestracji użytkownik wybiera rolę ucznia albo korepetytora; profil korepetytora powstaje automatycznie i można go później uzupełnić. Logowanie przez zewnętrznych dostawców nie jest skonfigurowane. Konto można trwale usunąć w ustawieniach profilu.

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
3. Ten projekt zakłada wymianę bazy zamiast migracji. Jeśli chcesz zachować dane, zrób ich kopię przed usunięciem bazy. Następnie usuń starą bazę w panelu hostingu, utwórz nową, wybierz ją w phpMyAdmin i zaimportuj kompletny plik `tutorland-database.sql` z folderu projektu nadrzędnego. Plik tworzy wszystkie tabele aplikacji, w tym zdjęcia profilowe, czaty i typ wiadomości; nie wykonuj osobnych poleceń `ALTER TABLE` ani nie importuj go do starej bazy. Plik celowo nie usuwa ani nie tworzy samej bazy — robi się to w panelu hostingu.
4. W katalogu `htdocs/api/` skopiuj `config.example.php` jako `config.local.php`. Wypełnij dane MySQL z sekcji **MySQL Connection Details** bieżącego konta hostingu: host, nazwę bazy, użytkownika i hasło. Nie wpisuj tych wartości do repozytorium ani nie przesyłaj ich w rozmowie.
5. W `config.local.php` ustaw `app_origin` na `https://tutorland.infinityfree.io`. Logowanie e-mail/hasło nie wymaga konfiguracji zewnętrznego dostawcy.
6. Po wgraniu plików sprawdź `https://tutorland.infinityfree.io/api/auth/me` — niezalogowany użytkownik powinien otrzymać JSON z `"user":null`.

Sekretna konfiguracja PHP jest ignorowana przez Git, a `public/api/.htaccess` blokuje jej pobranie przez HTTP.

Po utworzeniu nowej bazy trzeba ponownie założyć konta, profile i rezerwacje — poprzednia baza została usunięta. Aktualny katalog nie importuje danych runtime CSV do MySQL; nie importuj prywatnego `server/data/` na hosting. Wiadomości w czacie są usuwane po miesiącu przy kolejnym odświeżeniu chatów; nie trzeba dodawać zadania cron.
