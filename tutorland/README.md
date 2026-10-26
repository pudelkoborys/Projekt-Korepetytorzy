# Tutorland

Tutorland to aplikacja do wyszukiwania korepetytorów, prezentowania ich ofert i rezerwowania lekcji. Uczniowie i korepetytorzy korzystają z kont o oddzielnych rolach. Korepetytorzy mogą zarządzać profilem, przedmiotami, poziomami nauczania i dostępnością.

Rezerwacja obejmuje 40-minutowe spotkanie Zoom ucznia i korepetytora. Spotkania i powiadomienia są dostępne po zalogowaniu. Aplikacja nie wysyła wiadomości e-mail.

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

## Wdrożenie na tutorland.infinityfreeapp.com

InfinityFree udostępnia PHP i MySQL, dlatego produkcyjne API znajduje się w `public/api/index.php`. Nie uruchamiaj tam `npm start` ani nie wysyłaj `node_modules`. Backend developerski Node.js i pliki CSV pozostają do pracy lokalnej; wdrożenie używa bazy MySQL.

1. **Nie wpisuj komend w panelu hostingu.** Hosting nie potrzebuje terminala: gotowa strona znajduje się już w `dist/`. Jeżeli kiedyś zmienisz kod i trzeba będzie zbudować nową wersję, polecenia `npm install` i `npm run build` uruchom lokalnie w VS Code: otwórz folder `tutorland`, wybierz **Terminal → Nowy terminal** i wpisz je w terminalu na swoim komputerze.
2. W menedżerze plików hostingu albo przez FTP wgraj **zawartość** lokalnego katalogu `tutorland/dist/` do `htdocs` domeny. Włącz pokazywanie ukrytych plików i upewnij się, że wgrały się pliki `.htaccess` z `dist/` i `dist/api/`. Nie wgrywaj `node_modules`, `server/data`, `.env` ani całego repozytorium. Jeżeli `dist/` nie ma na komputerze, lokalnie otwórz terminal VS Code w folderze `tutorland` i uruchom `npm install`, a następnie `npm run build`.
3. W phpMyAdmin wybierz utworzoną bazę danych i zaimportuj zewnętrzny plik `tutorland-database.sql`. Plik nie zawiera hasła ani poleceń tworzących bazę; tabele są tworzone w bazie wybranej w phpMyAdmin.
4. W katalogu `htdocs/api/` skopiuj `config.example.php` jako `config.local.php`. Wypełnij dane MySQL dokładnie z sekcji MySQL Connection Details panelu hostingu: host, nazwę bazy, użytkownika i hasło. Nie wpisuj tych wartości do repozytorium ani nie przesyłaj ich w rozmowie.
5. W `config.local.php` pozostaw `app_origin` jako `https://tutorland.infinityfreeapp.com`. Wprowadź tam Client ID, Client Secret i nowy klucz szyfrowania Zoom. Wygeneruj ten klucz lokalnie poleceniem `openssl rand -hex 32`; nie używaj ponownie hasła do bazy.
6. Po włączeniu HTTPS sprawdź `https://tutorland.infinityfreeapp.com/api/auth/me` — niezalogowany użytkownik powinien otrzymać JSON z `"user":null`. Jeśli API zgłasza brak konfiguracji, sprawdź nazwę i lokalizację `api/config.local.php`; błędy połączenia z bazą wymagają porównania danych z panelem.

### Ustawienia aplikacji Zoom

W aplikacji OAuth w Zoom Marketplace ustaw:

- **App URL:** `https://tutorland.infinityfreeapp.com`
- **Development Redirect URL / OAuth Redirect URL:** `https://tutorland.infinityfreeapp.com/api/zoom/callback`
- **OAuth Allow List:** `https://tutorland.infinityfreeapp.com/api/zoom/callback` (pełny adres callbacku; Zoom dopuszcza też bazowy adres `https://tutorland.infinityfreeapp.com`)
- **Client ID i Client Secret:** wpisz do `api/config.local.php` na hostingu; nigdy nie publikuj ich w repozytorium.
- **Zakresy:** `user:read:user`, `user:read:email` i `meeting:write:meeting`.

Adres redirectu musi być identyczny w Zoom i w `app_origin` konfiguracji hostingu (łącznie z HTTPS, nazwą domeny i ścieżką). Allow List może zawierać pełny adres callbacku lub jego bazowy adres HTTPS. Jeśli Allow List jest wyszarzona, ale zawiera już dokładnie docelowy adres HTTPS, wpis jest poprawny i nie trzeba go zmieniać. Jeżeli wyszarzona lista nadal zawiera `localhost`, sama zmiana OAuth Redirect URL nie gwarantuje dodania domeny produkcyjnej do Allow List. Nie klikaj wtedy „Add App” i nie zakładaj, że lista aktualizuje się automatycznie — sprawdź, czy obok wpisu jest przycisk dodawania; jeśli cała sekcja jest zablokowana, potrzebny jest zrzut ekranu sekcji (bez sekretów) lub pomoc Zoom Support. Kod aplikacji nie może odblokować ustawień w Marketplace. Callback produkcyjny nie zadziała z `localhost`. Można przygotować adresy przed przeniesieniem aplikacji, ale OAuth zacznie działać dopiero po wgraniu strony, włączeniu HTTPS i ustawieniu konfiguracji.

Darmowy hosting może ograniczać połączenia wychodzące z PHP do usług zewnętrznych. Przepływ Zoom wymaga, aby serwer mógł wykonać połączenia HTTPS do `zoom.us` i `api.zoom.us`, a PHP miało rozszerzenie cURL. Po wdrożeniu sprawdź osobno autoryzację Zoom i utworzenie spotkania; same poprawne adresy w Marketplace nie dowodzą, że hosting dopuszcza takie połączenia.

Sekretna konfiguracja PHP jest ignorowana przez Git, a `public/api/.htaccess` blokuje jej pobranie przez HTTP. Zachowaj bezpieczną kopię klucza szyfrowania Zoom: bez tego samego klucza zapisane tokeny Zoom nie będą mogły zostać odszyfrowane.

Schema SQL tworzy puste tabele. Aktualny katalog nie ma migracji danych runtime CSV do MySQL; konta, profile i rezerwacje należy założyć ponownie po wdrożeniu. Nie importuj prywatnego `server/data/` na hosting.
