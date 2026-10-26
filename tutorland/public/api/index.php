<?php
declare(strict_types=1);

const LESSON_MINUTES = 40;
const SUBJECTS = [
    'Matematyka', 'Fizyka', 'Chemia', 'Informatyka', 'Angielski', 'Biologia',
    'Polski', 'Historia', 'Geografia', 'WOS', 'Filozofia', 'Ekonomia',
];
const LEVELS = ['primary', 'secondary', 'tertiary'];
const SESSION_COOKIE = 'tutorland_session';

final class ApiError extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

function config(): array
{
    $file = __DIR__ . '/config.local.php';
    if (!is_file($file)) {
        throw new ApiError(503, 'Brakuje konfiguracji API. Utwórz plik api/config.local.php z ustawieniami hostingu.');
    }
    $config = require $file;
    if (!is_array($config) || !isset($config['database'])) {
        throw new RuntimeException('Nieprawidłowa konfiguracja API.');
    }
    return $config;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $settings = config()['database'];
    foreach (['host', 'name', 'user', 'password'] as $required) {
        if (!isset($settings[$required]) || $settings[$required] === '') {
            throw new ApiError(503, 'Uzupełnij dane połączenia MySQL w api/config.local.php.');
        }
    }
    $charset = $settings['charset'] ?? 'utf8mb4';
    $port = (int)($settings['port'] ?? 3306);
    $pdo = new PDO(
        "mysql:host={$settings['host']};port={$port};dbname={$settings['name']};charset={$charset}",
        $settings['user'],
        $settings['password'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ],
    );
    return $pdo;
}

function sendJson(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

function redirectTo(string $location): never
{
    header('Cache-Control: no-store');
    header('Location: ' . $location, true, 302);
    exit;
}

function body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 1048576) {
        throw new ApiError(413, 'Żądanie jest zbyt duże.');
    }
    if ($raw === '') {
        return [];
    }
    try {
        $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new ApiError(400, 'Treść żądania musi być poprawnym JSON-em.');
    }
    if (!is_array($data)) {
        throw new ApiError(400, 'Treść żądania musi być obiektem JSON.');
    }
    return $data;
}

function assertSameOrigin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') {
        return;
    }
    $expected = rtrim((string)(config()['app_origin'] ?? ''), '/');
    if ($expected !== '' && !hash_equals($expected, rtrim($origin, '/'))) {
        throw new ApiError(403, 'Żądanie pochodzi z innej strony.');
    }
}

function randomId(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4)
        . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
}

function nowInAppZone(): DateTimeImmutable
{
    $zone = (string)(config()['timezone'] ?? 'Europe/Warsaw');
    return new DateTimeImmutable('now', new DateTimeZone($zone));
}

function isDate(string $value): bool
{
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('UTC'));
    return $date !== false && $date->format('Y-m-d') === $value;
}

function timeMinutes(string $value): int|false
{
    if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $value)) {
        return false;
    }
    [$hour, $minute] = array_map('intval', explode(':', $value));
    return $hour * 60 + $minute;
}

function minutesTime(int $value): string
{
    return sprintf('%02d:%02d', intdiv($value, 60), $value % 60);
}

function isBookingPast(array $booking): bool
{
    $now = nowInAppZone();
    $date = (string)$booking['lesson_date'];
    if ($date !== $now->format('Y-m-d')) {
        return $date < $now->format('Y-m-d');
    }
    $end = timeMinutes(substr((string)$booking['end_time'], 0, 5));
    return $end !== false && $end <= ((int)$now->format('G') * 60 + (int)$now->format('i'));
}

function isValidName(mixed $name): bool
{
    return is_string($name) && mb_strlen(trim($name)) >= 2 && mb_strlen(trim($name)) <= 80;
}

function cleanSubjects(mixed $subjects): array
{
    if (!is_array($subjects) || count($subjects) < 1 || count($subjects) > 12) {
        throw new ApiError(400, 'Wybierz od 1 do 12 przedmiotów.');
    }
    foreach ($subjects as $subject) {
        if (!is_string($subject)) {
            throw new ApiError(400, 'Lista zawiera nieobsługiwany przedmiot.');
        }
    }
    $subjects = array_values(array_unique($subjects));
    foreach ($subjects as $subject) {
        if (!is_string($subject) || !in_array($subject, SUBJECTS, true)) {
            throw new ApiError(400, 'Lista zawiera nieobsługiwany przedmiot.');
        }
    }
    return $subjects;
}

function cleanLevels(mixed $levels): array
{
    if (!is_array($levels) || count($levels) < 1) {
        throw new ApiError(400, 'Wybierz co najmniej jeden prawidłowy poziom nauczania.');
    }
    foreach ($levels as $level) {
        if (!is_string($level)) {
            throw new ApiError(400, 'Wybierz co najmniej jeden prawidłowy poziom nauczania.');
        }
    }
    $levels = array_values(array_unique($levels));
    foreach ($levels as $level) {
        if (!is_string($level) || !in_array($level, LEVELS, true)) {
            throw new ApiError(400, 'Wybierz co najmniej jeden prawidłowy poziom nauczania.');
        }
    }
    return $levels;
}

function setSessionCookie(string $token, int $maxAge): void
{
    setcookie(SESSION_COOKIE, $token, [
        'expires' => time() + $maxAge,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function clearSessionCookie(): void
{
    setcookie(SESSION_COOKIE, '', [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function publicUser(?array $user): ?array
{
    if ($user === null) {
        return null;
    }
    return [
        'id' => $user['id'],
        'role' => $user['role'],
        'firstName' => $user['first_name'],
        'lastName' => $user['last_name'],
        'tutorId' => $user['tutor_id'] ?? '',
    ];
}

function currentUser(): ?array
{
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (!is_string($token) || $token === '') {
        return null;
    }
    $statement = db()->prepare(
        'SELECT u.id, u.role, u.first_name, u.last_name, u.email, u.tutor_id
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() LIMIT 1',
    );
    $statement->execute([hash('sha256', $token)]);
    return $statement->fetch() ?: null;
}

function requireUser(): array
{
    return currentUser() ?? throw new ApiError(401, 'Zaloguj się, aby kontynuować.');
}

function requireRole(array $user, string $role): void
{
    if ($user['role'] !== $role) {
        throw new ApiError(403, 'Ta funkcja jest dostępna dla innej roli konta.');
    }
}

function ownedTutor(array $user): array
{
    requireRole($user, 'tutor');
    $statement = db()->prepare(
        'SELECT p.*, u.first_name, u.last_name, u.email
         FROM tutor_profiles p JOIN users u ON u.id = p.user_id WHERE p.tutor_id = ? LIMIT 1',
    );
    $statement->execute([$user['tutor_id']]);
    return $statement->fetch() ?: throw new ApiError(404, 'Nie znaleziono profilu korepetytora.');
}

function createSession(string $userId): void
{
    $token = bin2hex(random_bytes(32));
    $expiry = (new DateTimeImmutable('+14 days', new DateTimeZone('UTC')))->format('Y-m-d H:i:s');
    $statement = db()->prepare('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()');
    $statement->execute();
    $statement = db()->prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
    $statement->execute([hash('sha256', $token), $userId, $expiry]);
    setSessionCookie($token, 14 * 24 * 60 * 60);
}

function zoomSettings(): array
{
    return config()['zoom'] ?? [];
}

function zoomConfigured(): bool
{
    $zoom = zoomSettings();
    return !empty($zoom['client_id'])
        && !empty($zoom['client_secret'])
        && preg_match('/^[\da-f]{64}$/i', (string)($zoom['token_encryption_key'] ?? '')) === 1;
}

function zoomRedirectUri(): string
{
    return rtrim((string)(config()['app_origin'] ?? ''), '/') . '/api/zoom/callback';
}

function zoomAuthorizationUrl(string $state): string
{
    if (!zoomConfigured()) {
        throw new ApiError(503, 'Uzupełnij konfigurację OAuth Zoom w api/config.local.php.');
    }
    return 'https://zoom.us/oauth/authorize?' . http_build_query([
        'response_type' => 'code',
        'client_id' => zoomSettings()['client_id'],
        'redirect_uri' => zoomRedirectUri(),
        'state' => $state,
    ], '', '&', PHP_QUERY_RFC3986);
}

function zoomRequest(string $url, ?array $post = null, string $accessToken = ''): array
{
    if (!function_exists('curl_init')) {
        throw new ApiError(503, 'Na hostingu brakuje rozszerzenia PHP cURL wymaganego przez Zoom.');
    }
    $handle = curl_init($url);
    $headers = ['Accept: application/json'];
    if ($accessToken !== '') {
        $headers[] = 'Authorization: Bearer ' . $accessToken;
    }
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => $headers,
    ]);
    if ($post !== null) {
        curl_setopt($handle, CURLOPT_POST, true);
        curl_setopt($handle, CURLOPT_POSTFIELDS, json_encode($post, JSON_THROW_ON_ERROR));
        $headers[] = 'Content-Type: application/json';
        curl_setopt($handle, CURLOPT_HTTPHEADER, $headers);
    }
    $response = curl_exec($handle);
    $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_error($handle);
    curl_close($handle);
    if ($response === false) {
        error_log('Tutorland Zoom HTTP request failed: ' . $error);
        throw new ApiError(502, 'Serwer nie może połączyć się z Zoom. Sprawdź, czy hosting zezwala na połączenia wychodzące.');
    }
    try {
        $payload = json_decode($response, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new ApiError(502, 'Zoom zwrócił nieprawidłową odpowiedź.');
    }
    if ($status < 200 || $status >= 300 || !is_array($payload)) {
        $message = $payload['error_description'] ?? $payload['message'] ?? $payload['reason'] ?? 'Błąd usługi Zoom.';
        throw new ApiError(502, 'Żądanie do Zoom nie powiodło się: ' . (string)$message);
    }
    return $payload;
}

function zoomTokenRequest(array $parameters): array
{
    if (!function_exists('curl_init')) {
        throw new ApiError(503, 'Na hostingu brakuje rozszerzenia PHP cURL wymaganego przez Zoom.');
    }
    $zoom = zoomSettings();
    $headers = ['Authorization: Basic ' . base64_encode($zoom['client_id'] . ':' . $zoom['client_secret'])];
    $handle = curl_init('https://zoom.us/oauth/token');
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($parameters),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 20,
    ]);
    $response = curl_exec($handle);
    $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_error($handle);
    curl_close($handle);
    if ($response === false) {
        error_log('Tutorland Zoom token request failed: ' . $error);
        throw new ApiError(502, 'Serwer nie może połączyć się z Zoom. Sprawdź ograniczenia połączeń wychodzących hostingu.');
    }
    try {
        $payload = json_decode($response, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new ApiError(502, 'Zoom zwrócił nieprawidłową odpowiedź tokenu.');
    }
    if ($status < 200 || $status >= 300 || !is_array($payload)) {
        throw new ApiError(502, 'Zoom OAuth nie powiódł się: ' . (string)($payload['error_description'] ?? $payload['reason'] ?? 'błąd odpowiedzi'));
    }
    return $payload;
}

function storeZoomTokens(string $userId, array $tokens): void
{
    $key = hex2bin((string)zoomSettings()['token_encryption_key']);
    $iv = random_bytes(12);
    $tag = '';
    $ciphertext = openssl_encrypt(
        json_encode($tokens, JSON_THROW_ON_ERROR),
        'aes-256-gcm',
        $key,
        OPENSSL_RAW_DATA,
        $iv,
        $tag,
    );
    if ($ciphertext === false) {
        throw new RuntimeException('Nie udało się zaszyfrować tokenów Zoom.');
    }
    $statement = db()->prepare(
        'INSERT INTO zoom_connections (user_id, encrypted_tokens, iv, auth_tag)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE encrypted_tokens = VALUES(encrypted_tokens),
         iv = VALUES(iv), auth_tag = VALUES(auth_tag)',
    );
    $statement->execute([$userId, base64_encode($ciphertext), $iv, $tag]);
}

function readZoomTokens(string $userId): ?array
{
    $statement = db()->prepare('SELECT encrypted_tokens, iv, auth_tag FROM zoom_connections WHERE user_id = ?');
    $statement->execute([$userId]);
    $record = $statement->fetch();
    if (!$record) {
        return null;
    }
    $key = hex2bin((string)zoomSettings()['token_encryption_key']);
    $plain = openssl_decrypt(
        base64_decode($record['encrypted_tokens'], true) ?: '',
        'aes-256-gcm',
        $key,
        OPENSSL_RAW_DATA,
        $record['iv'],
        $record['auth_tag'],
    );
    if ($plain === false) {
        throw new RuntimeException('Nie udało się odszyfrować tokenów Zoom. Sprawdź klucz szyfrowania.');
    }
    $tokens = json_decode($plain, true, 512, JSON_THROW_ON_ERROR);
    return is_array($tokens) ? $tokens : null;
}

function zoomIdentity(string $code): array
{
    $tokens = zoomTokenRequest([
        'grant_type' => 'authorization_code',
        'code' => $code,
        'redirect_uri' => zoomRedirectUri(),
    ]);
    $accessToken = (string)($tokens['access_token'] ?? '');
    if ($accessToken === '') {
        throw new ApiError(502, 'Zoom nie zwrócił tokenu dostępu.');
    }
    $profile = zoomRequest('https://api.zoom.us/v2/users/me', null, $accessToken);
    $email = strtolower(trim((string)($profile['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new ApiError(502, 'Konto Zoom nie udostępniło prawidłowego adresu e-mail.');
    }
    return [
        'email' => $email,
        'imageUrl' => preg_match('/^https:\/\//i', (string)($profile['pic_url'] ?? ''))
            ? (string)$profile['pic_url']
            : '',
        'tokens' => [
            'accessToken' => $accessToken,
            'refreshToken' => (string)($tokens['refresh_token'] ?? ''),
            'expiresAt' => time() + (int)($tokens['expires_in'] ?? 0),
        ],
    ];
}

function zoomAccessToken(string $userId): string
{
    $tokens = readZoomTokens($userId);
    if ($tokens === null) {
        throw new ApiError(409, 'Korepetytor nie połączył jeszcze konta Zoom.');
    }
    if ((int)$tokens['expiresAt'] > time() + 60) {
        return (string)$tokens['accessToken'];
    }
    if (empty($tokens['refreshToken'])) {
        throw new ApiError(409, 'Połączenie z Zoom wygasło. Połącz konto ponownie.');
    }
    $refreshed = zoomTokenRequest([
        'grant_type' => 'refresh_token',
        'refresh_token' => $tokens['refreshToken'],
    ]);
    $tokens = [
        'accessToken' => (string)$refreshed['access_token'],
        'refreshToken' => (string)($refreshed['refresh_token'] ?? $tokens['refreshToken']),
        'expiresAt' => time() + (int)$refreshed['expires_in'],
    ];
    storeZoomTokens($userId, $tokens);
    return $tokens['accessToken'];
}

function createZoomMeeting(array $user, array $booking, array $tutor): array
{
    $accessToken = zoomAccessToken((string)$user['id']);
    $payload = zoomRequest('https://api.zoom.us/v2/users/me/meetings', [
        'topic' => 'Tutorland - ' . $booking['subject'] . ' z ' . $tutor['first_name'] . ' ' . $tutor['last_name'],
        'type' => 2,
        'start_time' => $booking['lesson_date'] . 'T' . substr($booking['start_time'], 0, 5) . ':00',
        'duration' => LESSON_MINUTES,
        'timezone' => (string)(config()['timezone'] ?? 'Europe/Warsaw'),
        'settings' => json_encode(['waiting_room' => true], JSON_THROW_ON_ERROR),
    ], $accessToken);
    if (!is_string($payload['join_url'] ?? null) || !is_string($payload['start_url'] ?? null)) {
        throw new ApiError(502, 'Zoom zwrócił spotkanie bez wymaganych linków.');
    }
    return [
        'id' => (string)($payload['id'] ?? ''),
        'joinUrl' => $payload['join_url'],
        'startUrl' => $payload['start_url'],
    ];
}

function tutorSubjects(string $tutorId): array
{
    $statement = db()->prepare('SELECT subject FROM tutor_subjects WHERE tutor_id = ? ORDER BY subject');
    $statement->execute([$tutorId]);
    return array_column($statement->fetchAll(), 'subject');
}

function tutorLevels(string $tutorId): array
{
    $statement = db()->prepare('SELECT level FROM tutor_levels WHERE tutor_id = ? ORDER BY level');
    $statement->execute([$tutorId]);
    return array_column($statement->fetchAll(), 'level');
}

function tutorPublic(array $tutor): array
{
    $statement = db()->prepare(
        'SELECT COUNT(*) AS review_count, AVG(rating) AS average_rating FROM reviews WHERE tutor_id = ?',
    );
    $statement->execute([$tutor['tutor_id']]);
    $summary = $statement->fetch();
    return [
        'tutorId' => $tutor['tutor_id'],
        'firstName' => $tutor['first_name'],
        'lastName' => $tutor['last_name'],
        'age' => (int)($tutor['age'] ?? 0),
        'teachingSinceYear' => (int)$tutor['teaching_since_year'],
        'description' => $tutor['description'],
        'rating' => round((float)($summary['average_rating'] ?? 0), 1),
        'reviewCount' => (int)($summary['review_count'] ?? 0),
        'pricePerLesson' => (int)$tutor['price_per_lesson'],
        'levels' => tutorLevels((string)$tutor['tutor_id']),
        'subjects' => tutorSubjects((string)$tutor['tutor_id']),
        'imagePath' => $tutor['image_path'],
    ];
}

function findTutor(string $tutorId): ?array
{
    $statement = db()->prepare(
        'SELECT p.*, u.first_name, u.last_name, u.email
         FROM tutor_profiles p JOIN users u ON u.id = p.user_id WHERE p.tutor_id = ? LIMIT 1',
    );
    $statement->execute([$tutorId]);
    return $statement->fetch() ?: null;
}

function cleanReview(array $review, string $studentName = 'Uczeń'): array
{
    return [
        'id' => $review['id'],
        'tutorId' => $review['tutor_id'],
        'bookingId' => $review['booking_id'],
        'rating' => (int)$review['rating'],
        'date' => $review['review_date'],
        'comment' => $review['comment'],
        'studentName' => $studentName,
    ];
}

function validateSchedule(mixed $weekly, mixed $daysOff): array
{
    if (!is_array($weekly) || count($weekly) > 14 || !is_array($daysOff) || count($daysOff) > 400) {
        throw new ApiError(400, 'Plan dostępności ma nieprawidłowy format.');
    }
    $normalized = [];
    foreach ($weekly as $range) {
        if (!is_array($range)) {
            throw new ApiError(400, 'Plan dostępności ma nieprawidłowy format.');
        }
        $weekday = filter_var($range['weekday'] ?? null, FILTER_VALIDATE_INT);
        $start = timeMinutes((string)($range['startTime'] ?? ''));
        $end = timeMinutes((string)($range['endTime'] ?? ''));
        if ($weekday === false || $weekday < 0 || $weekday > 6
            || $start === false || $end === false || $end - $start < LESSON_MINUTES) {
            throw new ApiError(400, 'Zakres godzin musi obejmować co najmniej jedną lekcję 40-minutową.');
        }
        $normalized[] = [
            'weekday' => (int)$weekday,
            'startTime' => (string)$range['startTime'],
            'endTime' => (string)$range['endTime'],
        ];
    }
    foreach ($normalized as $index => $range) {
        foreach (array_slice($normalized, $index + 1) as $other) {
            if ($range['weekday'] === $other['weekday']
                && timeMinutes($range['startTime']) < timeMinutes($other['endTime'])
                && timeMinutes($other['startTime']) < timeMinutes($range['endTime'])) {
                throw new ApiError(400, 'Zakresy godzin w tym samym dniu nie mogą na siebie nachodzić.');
            }
        }
    }
    $today = nowInAppZone()->format('Y-m-d');
    foreach ($daysOff as $date) {
        if (!is_string($date)) {
            throw new ApiError(400, 'Dni wolne muszą być prawidłowymi datami bieżącymi lub przyszłymi.');
        }
    }
    $daysOff = array_values(array_unique($daysOff));
    foreach ($daysOff as $date) {
        if (!is_string($date) || !isDate($date) || $date < $today) {
            throw new ApiError(400, 'Dni wolne muszą być prawidłowymi datami bieżącymi lub przyszłymi.');
        }
    }
    return [$normalized, $daysOff];
}

function validateBookingSlot(
    array $tutor,
    string $date,
    string $startTime,
    string $subject,
    array $bookings,
    array $availability,
    array $daysOff,
): string {
    $now = nowInAppZone();
    if (!isDate($date) || $date < $now->format('Y-m-d')) {
        throw new ApiError(400, 'Wybierz prawidłowy dzień w przyszłości.');
    }
    $start = timeMinutes($startTime);
    if ($start === false || ($date === $now->format('Y-m-d')
        && $start <= ((int)$now->format('G') * 60 + (int)$now->format('i')))) {
        throw new ApiError(400, 'Wybrana godzina już minęła.');
    }
    if (!in_array($subject, tutorSubjects((string)$tutor['tutor_id']), true)) {
        throw new ApiError(400, 'Wybierz przedmiot z oferty korepetytora.');
    }
    if (in_array($date, $daysOff, true)) {
        throw new ApiError(409, 'Korepetytor oznaczył ten dzień jako wolny.');
    }
    $weekday = (int)(new DateTimeImmutable($date, new DateTimeZone('UTC')))->format('w');
    $allowed = false;
    foreach ($availability as $range) {
        $rangeStart = timeMinutes(substr((string)$range['start_time'], 0, 5));
        $rangeEnd = timeMinutes(substr((string)$range['end_time'], 0, 5));
        if ((int)$range['weekday'] === $weekday && $rangeStart !== false && $rangeEnd !== false
            && $start >= $rangeStart && $start + LESSON_MINUTES <= $rangeEnd
            && ($start - $rangeStart) % LESSON_MINUTES === 0) {
            $allowed = true;
            break;
        }
    }
    if (!$allowed) {
        throw new ApiError(409, 'Wybrany termin nie należy już do dostępnych godzin.');
    }
    foreach ($bookings as $booking) {
        $bookingStart = timeMinutes(substr((string)$booking['start_time'], 0, 5));
        $bookingEnd = timeMinutes(substr((string)$booking['end_time'], 0, 5));
        if ($bookingStart !== false && $bookingEnd !== false
            && $start < $bookingEnd && $bookingStart < $start + LESSON_MINUTES) {
            throw new ApiError(409, 'Ten termin został już zarezerwowany.');
        }
    }
    return minutesTime($start + LESSON_MINUTES);
}

function saveZoomIdentity(array $user, array $identity): void
{
    storeZoomTokens((string)$user['id'], $identity['tokens']);
    if ($identity['imageUrl'] !== '' && ($user['tutor_id'] ?? '') !== '') {
        $statement = db()->prepare('UPDATE tutor_profiles SET image_path = ? WHERE tutor_id = ?');
        $statement->execute([$identity['imageUrl'], $user['tutor_id']]);
    }
}

function createZoomForPendingBookings(array $tutor, array $user): void
{
    $statement = db()->prepare(
        "SELECT * FROM bookings WHERE tutor_id = ? AND zoom_status IN ('pending', 'failed') AND zoom_join_url = ''",
    );
    $statement->execute([$tutor['tutor_id']]);
    foreach ($statement->fetchAll() as $booking) {
        try {
            $meeting = createZoomMeeting($user, $booking, $tutor);
            $update = db()->prepare(
                "UPDATE bookings SET zoom_status = 'ready', zoom_meeting_id = ?, zoom_join_url = ?,
                 zoom_start_url = ?, zoom_error = '' WHERE id = ?",
            );
            $update->execute([$meeting['id'], $meeting['joinUrl'], $meeting['startUrl'], $booking['id']]);
        } catch (Throwable $error) {
            error_log('Nie udało się utworzyć spotkania Zoom dla rezerwacji ' . $booking['id'] . ': ' . $error->getMessage());
            $update = db()->prepare("UPDATE bookings SET zoom_status = 'failed', zoom_error = ? WHERE id = ?");
            $update->execute([mb_substr($error->getMessage(), 0, 500), $booking['id']]);
        }
    }
}

function storeOAuthState(string $state, ?string $userId, string $purpose, string $role, string $returnTo): void
{
    $statement = db()->prepare('DELETE FROM oauth_states WHERE expires_at <= UTC_TIMESTAMP()');
    $statement->execute();
    $statement = db()->prepare(
        'INSERT INTO oauth_states (state_hash, user_id, purpose, role, return_to, expires_at)
         VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))',
    );
    $statement->execute([hash('sha256', $state), $userId, $purpose, $role, $returnTo]);
}

function safeReturnTo(mixed $value, string $fallback = '/'): string
{
    if (!is_string($value) || !str_starts_with($value, '/') || str_starts_with($value, '//')
        || str_contains($value, '\\')) {
        return $fallback;
    }
    return $value;
}

function handleOAuthCallback(): never
{
    $state = (string)($_GET['state'] ?? '');
    if ($state === '') {
        throw new ApiError(400, 'Nieprawidłowy lub wygasły powrót z Zoom OAuth.');
    }
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare('SELECT * FROM oauth_states WHERE state_hash = ? AND expires_at > UTC_TIMESTAMP() FOR UPDATE');
        $statement->execute([hash('sha256', $state)]);
        $saved = $statement->fetch();
        if (!$saved) {
            $pdo->rollBack();
            throw new ApiError(400, 'Nieprawidłowy lub wygasły powrót z Zoom OAuth.');
        }
        $delete = $pdo->prepare('DELETE FROM oauth_states WHERE state_hash = ?');
        $delete->execute([hash('sha256', $state)]);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
    if (isset($_GET['error'])) {
        redirectTo($saved['purpose'] === 'login' ? '/login?zoomError=cancelled' : '/profile?zoomError=cancelled');
    }
    $code = (string)($_GET['code'] ?? '');
    if ($code === '') {
        throw new ApiError(400, 'Nieprawidłowy lub wygasły powrót z Zoom OAuth.');
    }
    $identity = zoomIdentity($code);
    if ($saved['purpose'] === 'login') {
        $statement = db()->prepare('SELECT * FROM users WHERE role = ? AND email = ? LIMIT 1');
        $statement->execute([$saved['role'], $identity['email']]);
        $user = $statement->fetch();
        if (!$user) {
            redirectTo('/login?zoomError=account-not-found');
        }
        if ($user['role'] === 'tutor') {
            saveZoomIdentity($user, $identity);
            createZoomForPendingBookings(ownedTutor($user), $user);
        }
    } else {
        $statement = db()->prepare('SELECT * FROM users WHERE id = ? AND role = ? LIMIT 1');
        $statement->execute([$saved['user_id'], 'tutor']);
        $user = $statement->fetch();
        if (!$user) {
            throw new ApiError(403, 'Nie znaleziono konta korepetytora.');
        }
        if (!hash_equals(strtolower((string)$user['email']), $identity['email'])) {
            throw new ApiError(403, 'Adres e-mail konta Zoom musi być zgodny z adresem konta Tutorland.');
        }
        saveZoomIdentity($user, $identity);
        createZoomForPendingBookings(ownedTutor($user), $user);
        redirectTo('/profile?zoom=connected');
    }
    createSession((string)$user['id']);
    redirectTo(safeReturnTo($saved['return_to'], $user['role'] === 'tutor' ? '/profile' : '/'));
}

function handleApi(): never
{
    db();
    $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $path = is_string($uriPath) ? rtrim($uriPath, '/') : '';
    $path = $path === '' ? '/' : $path;
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    if ($method === 'GET' && $path === '/api/zoom/callback') {
        handleOAuthCallback();
    }
    if (in_array($method, ['POST', 'PUT', 'DELETE'], true)) {
        assertSameOrigin();
    }

    if ($method === 'GET' && $path === '/api/auth/me') {
        sendJson(200, ['user' => publicUser(currentUser())]);
    }
    if ($method === 'GET' && $path === '/api/auth/providers') {
        sendJson(200, ['zoom' => zoomConfigured()]);
    }
    if ($method === 'POST' && $path === '/api/auth/register') {
        $input = body();
        $role = $input['role'] ?? '';
        if (!in_array($role, ['student', 'tutor'], true)) {
            throw new ApiError(400, 'Wybierz rolę ucznia lub korepetytora.');
        }
        if (!isValidName($input['firstName'] ?? null) || !isValidName($input['lastName'] ?? null)) {
            throw new ApiError(400, 'Podaj imię i nazwisko.');
        }
        $email = strtolower(trim((string)($input['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 254) {
            throw new ApiError(400, 'Podaj prawidłowy adres e-mail.');
        }
        $password = $input['password'] ?? null;
        if (!is_string($password) || strlen($password) < 10 || strlen($password) > 128) {
            throw new ApiError(400, 'Hasło musi mieć od 10 do 128 znaków.');
        }
        $firstName = trim($input['firstName']);
        $lastName = trim($input['lastName']);
        $id = randomId();
        $tutorId = $role === 'tutor'
            ? trim((string)preg_replace('/[^a-z0-9]+/', '-', strtolower($firstName)), '-') . '-' . bin2hex(random_bytes(5))
            : null;
        $passwordHash = password_hash($password, PASSWORD_DEFAULT);
        if (!is_string($passwordHash)) {
            throw new RuntimeException('Nie udało się zabezpieczyć hasła.');
        }
        $pdo = db();
        try {
            $pdo->beginTransaction();
            $statement = $pdo->prepare(
                'INSERT INTO users (id, role, first_name, last_name, email, password_hash, tutor_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
            );
            $statement->execute([$id, $role, $firstName, $lastName, $email, $passwordHash, $tutorId]);
            if ($role === 'tutor') {
                $statement = $pdo->prepare(
                    'INSERT INTO tutor_profiles (tutor_id, user_id, teaching_since_year, description, price_per_lesson)
                     VALUES (?, ?, ?, ?, 100)',
                );
                $statement->execute([
                    $tutorId,
                    $id,
                    (int)nowInAppZone()->format('Y'),
                    'Dodaj opis swojej oferty i doświadczenia.',
                ]);
                $pdo->prepare('INSERT INTO tutor_subjects (tutor_id, subject) VALUES (?, ?)')
                    ->execute([$tutorId, 'Matematyka']);
                $pdo->prepare('INSERT INTO tutor_levels (tutor_id, level) VALUES (?, ?)')
                    ->execute([$tutorId, 'primary']);
            }
            $pdo->commit();
        } catch (PDOException $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if ($error->getCode() === '23000') {
                throw new ApiError(409, 'Konto z tym adresem e-mail już istnieje.');
            }
            throw $error;
        }
        createSession($id);
        sendJson(201, [
            'user' => [
                'id' => $id,
                'role' => $role,
                'firstName' => $firstName,
                'lastName' => $lastName,
                'tutorId' => $tutorId ?? '',
            ],
            'zoomConfigured' => $role === 'tutor' && zoomConfigured(),
        ]);
    }
    if ($method === 'POST' && $path === '/api/auth/login') {
        $input = body();
        $role = $input['role'] ?? '';
        if (!in_array($role, ['student', 'tutor'], true)) {
            throw new ApiError(400, 'Wybierz rolę ucznia lub korepetytora.');
        }
        $email = strtolower(trim((string)($input['email'] ?? '')));
        $password = is_string($input['password'] ?? null) ? $input['password'] : '';
        $ipHash = hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
        $pdo = db();
        $statement = $pdo->prepare(
            'SELECT COUNT(*) FROM login_attempts WHERE ip_hash = ? AND attempted_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)',
        );
        $statement->execute([$ipHash]);
        if ((int)$statement->fetchColumn() >= 8) {
            throw new ApiError(429, 'Zbyt wiele prób. Spróbuj ponownie za 15 minut.');
        }
        $pdo->prepare('INSERT INTO login_attempts (ip_hash, attempted_at) VALUES (?, UTC_TIMESTAMP())')->execute([$ipHash]);
        $pdo->prepare('DELETE FROM login_attempts WHERE attempted_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)')->execute();
        $statement = $pdo->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
        $statement->execute([$email]);
        $user = $statement->fetch();
        $dummyHash = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
        $validPassword = password_verify($password, $user['password_hash'] ?? $dummyHash);
        if (!$user || $user['role'] !== $role || !$validPassword) {
            throw new ApiError(401, 'Nieprawidłowy adres e-mail lub hasło.');
        }
        $pdo->prepare('DELETE FROM login_attempts WHERE ip_hash = ?')->execute([$ipHash]);
        $zoomOn = $role === 'tutor' && zoomConfigured();
        $statement = $pdo->prepare('SELECT COUNT(*) FROM zoom_connections WHERE user_id = ?');
        $statement->execute([$user['id']]);
        createSession((string)$user['id']);
        sendJson(200, [
            'user' => publicUser($user),
            'zoomConfigured' => $zoomOn,
            'zoomConnected' => $zoomOn && (int)$statement->fetchColumn() > 0,
        ]);
    }
    if ($method === 'POST' && $path === '/api/auth/logout') {
        $token = $_COOKIE[SESSION_COOKIE] ?? '';
        if (is_string($token) && $token !== '') {
            $statement = db()->prepare('DELETE FROM sessions WHERE token_hash = ?');
            $statement->execute([hash('sha256', $token)]);
        }
        clearSessionCookie();
        sendJson(200, ['success' => true]);
    }
    if ($method === 'GET' && $path === '/api/tutors') {
        $rows = db()->query(
            'SELECT p.*, u.first_name, u.last_name FROM tutor_profiles p
             JOIN users u ON u.id = p.user_id ORDER BY u.last_name, u.first_name',
        )->fetchAll();
        sendJson(200, ['tutors' => array_map('tutorPublic', $rows)]);
    }

    if ($method === 'GET' && preg_match('#^/api/tutors/([^/]+)/availability$#', $path, $match)) {
        $tutorId = rawurldecode($match[1]);
        if (!findTutor($tutorId)) {
            throw new ApiError(404, 'Nie znaleziono korepetytora.');
        }
        $month = (string)($_GET['month'] ?? '');
        $prefix = preg_match('/^\d{4}-\d{2}$/', $month) ? $month . '-' : '';
        $statement = db()->prepare('SELECT weekday, start_time, end_time FROM tutor_availability WHERE tutor_id = ?');
        $statement->execute([$tutorId]);
        $availability = array_map(static fn(array $range): array => [
            'tutorId' => $tutorId,
            'weekday' => (string)$range['weekday'],
            'startTime' => substr((string)$range['start_time'], 0, 5),
            'endTime' => substr((string)$range['end_time'], 0, 5),
        ], $statement->fetchAll());
        $statement = db()->prepare(
            'SELECT day_off FROM tutor_days_off WHERE tutor_id = ? AND (? = \'\' OR day_off LIKE ?)',
        );
        $statement->execute([$tutorId, $prefix, $prefix . '%']);
        $daysOff = array_map(static fn(array $row): array => [
            'tutorId' => $tutorId,
            'date' => $row['day_off'],
        ], $statement->fetchAll());
        $statement = db()->prepare(
            'SELECT lesson_date, start_time, end_time FROM bookings WHERE tutor_id = ? ORDER BY lesson_date, start_time',
        );
        $statement->execute([$tutorId]);
        $busy = array_map(static fn(array $row): array => [
            'date' => $row['lesson_date'],
            'startTime' => substr((string)$row['start_time'], 0, 5),
            'endTime' => substr((string)$row['end_time'], 0, 5),
        ], $statement->fetchAll());
        sendJson(200, ['availability' => $availability, 'daysOff' => $daysOff, 'busy' => $busy]);
    }

    if ($method === 'GET' && preg_match('#^/api/tutors/([^/]+)$#', $path, $match)) {
        $tutorId = rawurldecode($match[1]);
        $tutor = findTutor($tutorId);
        if (!$tutor) {
            throw new ApiError(404, 'Nie znaleziono korepetytora.');
        }
        $statement = db()->prepare(
            'SELECT r.*, u.first_name, u.last_name FROM reviews r
             JOIN users u ON u.id = r.student_id WHERE r.tutor_id = ? ORDER BY r.review_date DESC, r.updated_at DESC',
        );
        $statement->execute([$tutorId]);
        $reviews = array_map(static fn(array $review): array => cleanReview(
            $review,
            $review['first_name'] . ' ' . $review['last_name'],
        ), $statement->fetchAll());
        sendJson(200, ['tutor' => tutorPublic($tutor), 'reviews' => $reviews]);
    }

    if ($method === 'GET' && $path === '/api/bookings') {
        $user = requireUser();
        if ($user['role'] === 'student') {
            $statement = db()->prepare(
                'SELECT b.*, u.first_name AS student_first, u.last_name AS student_last,
                 t.first_name AS tutor_first, t.last_name AS tutor_last
                 FROM bookings b JOIN users u ON u.id = b.student_id
                 JOIN tutor_profiles p ON p.tutor_id = b.tutor_id
                 JOIN users t ON t.id = p.user_id WHERE b.student_id = ? ORDER BY b.lesson_date, b.start_time',
            );
        } else {
            $statement = db()->prepare(
                'SELECT b.*, u.first_name AS student_first, u.last_name AS student_last,
                 t.first_name AS tutor_first, t.last_name AS tutor_last
                 FROM bookings b JOIN users u ON u.id = b.student_id
                 JOIN tutor_profiles p ON p.tutor_id = b.tutor_id
                 JOIN users t ON t.id = p.user_id WHERE b.tutor_id = ? ORDER BY b.lesson_date, b.start_time',
            );
        }
        $statement->execute([$user['role'] === 'student' ? $user['id'] : $user['tutor_id']]);
        $bookings = [];
        foreach ($statement->fetchAll() as $row) {
            $item = [
                'id' => $row['id'],
                'tutorId' => $row['tutor_id'],
                'date' => $row['lesson_date'],
                'startTime' => substr((string)$row['start_time'], 0, 5),
                'endTime' => substr((string)$row['end_time'], 0, 5),
                'durationMinutes' => (string)$row['duration_minutes'],
                'subject' => $row['subject'],
                'zoomStatus' => $row['zoom_status'],
                'zoomJoinUrl' => $row['zoom_join_url'],
                'studentName' => $row['student_first'] . ' ' . $row['student_last'],
                'tutorName' => $row['tutor_first'] . ' ' . $row['tutor_last'],
                'isPast' => isBookingPast($row),
            ];
            if ($user['role'] === 'tutor') {
                $item['zoomStartUrl'] = $row['zoom_start_url'];
            }
            $bookings[] = $item;
        }
        sendJson(200, ['bookings' => $bookings]);
    }

    if ($method === 'POST' && $path === '/api/bookings') {
        $user = requireUser();
        requireRole($user, 'student');
        $input = body();
        $tutorId = (string)($input['tutorId'] ?? '');
        $date = (string)($input['date'] ?? '');
        $startTime = (string)($input['startTime'] ?? '');
        $subject = (string)($input['subject'] ?? '');
        $pdo = db();
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare(
                'SELECT p.*, u.first_name, u.last_name FROM tutor_profiles p
                 JOIN users u ON u.id = p.user_id WHERE p.tutor_id = ? FOR UPDATE',
            );
            $statement->execute([$tutorId]);
            $tutor = $statement->fetch();
            if (!$tutor) {
                throw new ApiError(404, 'Nie znaleziono korepetytora.');
            }
            $statement = $pdo->prepare(
                'SELECT start_time, end_time FROM bookings WHERE tutor_id = ? AND lesson_date = ? FOR UPDATE',
            );
            $statement->execute([$tutorId, $date]);
            $bookings = $statement->fetchAll();
            $statement = $pdo->prepare('SELECT day_off FROM tutor_days_off WHERE tutor_id = ? AND day_off = ?');
            $statement->execute([$tutorId, $date]);
            $daysOff = array_column($statement->fetchAll(), 'day_off');
            $statement = $pdo->prepare('SELECT weekday, start_time, end_time FROM tutor_availability WHERE tutor_id = ?');
            $statement->execute([$tutorId]);
            $endTime = validateBookingSlot(
                $tutor,
                $date,
                $startTime,
                $subject,
                $bookings,
                $statement->fetchAll(),
                $daysOff,
            );
            $id = randomId();
            $insert = $pdo->prepare(
                "INSERT INTO bookings (id, tutor_id, student_id, lesson_date, start_time, end_time, subject)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            );
            $insert->execute([$id, $tutorId, $user['id'], $date, $startTime, $endTime, $subject]);
            $pdo->commit();
            $booking = [
                'id' => $id,
                'tutor_id' => $tutorId,
                'student_id' => $user['id'],
                'lesson_date' => $date,
                'start_time' => $startTime,
                'end_time' => $endTime,
                'subject' => $subject,
                'zoom_status' => 'pending',
                'zoom_join_url' => '',
                'zoom_start_url' => '',
            ];
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }

        $statement = $pdo->prepare('SELECT * FROM users WHERE id = ?');
        $statement->execute([$tutor['user_id']]);
        $tutorUser = $statement->fetch();
        $connectionCheck = $pdo->prepare('SELECT COUNT(*) FROM zoom_connections WHERE user_id = ?');
        $connectionCheck->execute([$tutorUser['id'] ?? '']);
        if ($tutorUser && (int)$connectionCheck->fetchColumn() > 0) {
            try {
                $meeting = createZoomMeeting($tutorUser, $booking, $tutor);
                $statement = $pdo->prepare(
                    "UPDATE bookings SET zoom_status = 'ready', zoom_meeting_id = ?, zoom_join_url = ?, zoom_start_url = ? WHERE id = ?",
                );
                $statement->execute([$meeting['id'], $meeting['joinUrl'], $meeting['startUrl'], $id]);
                $booking['zoom_status'] = 'ready';
                $booking['zoom_join_url'] = $meeting['joinUrl'];
            } catch (Throwable $error) {
                error_log('Nie udało się utworzyć spotkania Zoom dla rezerwacji ' . $id . ': ' . $error->getMessage());
                $statement = $pdo->prepare("UPDATE bookings SET zoom_status = 'failed', zoom_error = ? WHERE id = ?");
                $statement->execute([mb_substr($error->getMessage(), 0, 500), $id]);
                $booking['zoom_status'] = 'failed';
                $booking['zoom_error'] = $error->getMessage();
            }
        }
        sendJson(201, [
            'booking' => [
                'id' => $booking['id'],
                'tutorId' => $booking['tutor_id'],
                'date' => $booking['lesson_date'],
                'startTime' => substr($booking['start_time'], 0, 5),
                'endTime' => substr($booking['end_time'], 0, 5),
                'durationMinutes' => (string)LESSON_MINUTES,
                'subject' => $booking['subject'],
                'zoomStatus' => $booking['zoom_status'],
                'zoomJoinUrl' => $booking['zoom_join_url'],
                ...(!empty($booking['zoom_error']) ? ['zoomError' => $booking['zoom_error']] : []),
            ],
        ]);
    }

    if ($method === 'GET' && $path === '/api/tutor/profile') {
        $user = requireUser();
        sendJson(200, ['tutor' => tutorPublic(ownedTutor($user))]);
    }
    if ($method === 'PUT' && $path === '/api/tutor/profile') {
        $user = requireUser();
        $tutor = ownedTutor($user);
        $input = body();
        if (!isValidName($input['firstName'] ?? null) || !isValidName($input['lastName'] ?? null)) {
            throw new ApiError(400, 'Podaj prawidłowe imię i nazwisko.');
        }
        $description = trim((string)($input['description'] ?? ''));
        $price = filter_var($input['pricePerLesson'] ?? null, FILTER_VALIDATE_INT);
        $year = filter_var($input['teachingSinceYear'] ?? null, FILTER_VALIDATE_INT);
        if (mb_strlen($description) < 20 || mb_strlen($description) > 2000
            || $price === false || $price < 20 || $price > 1000
            || $year === false || $year < 1950 || $year > (int)nowInAppZone()->format('Y')) {
            throw new ApiError(400, 'Sprawdź opis, cenę i rok rozpoczęcia nauczania.');
        }
        $subjects = cleanSubjects($input['subjects'] ?? null);
        $levels = cleanLevels($input['levels'] ?? null);
        $pdo = db();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?')
                ->execute([trim($input['firstName']), trim($input['lastName']), $user['id']]);
            $pdo->prepare(
                'UPDATE tutor_profiles SET teaching_since_year = ?, description = ?, price_per_lesson = ? WHERE tutor_id = ?',
            )->execute([$year, $description, $price, $tutor['tutor_id']]);
            $pdo->prepare('DELETE FROM tutor_subjects WHERE tutor_id = ?')->execute([$tutor['tutor_id']]);
            $insertSubject = $pdo->prepare('INSERT INTO tutor_subjects (tutor_id, subject) VALUES (?, ?)');
            foreach ($subjects as $subject) {
                $insertSubject->execute([$tutor['tutor_id'], $subject]);
            }
            $pdo->prepare('DELETE FROM tutor_levels WHERE tutor_id = ?')->execute([$tutor['tutor_id']]);
            $insertLevel = $pdo->prepare('INSERT INTO tutor_levels (tutor_id, level) VALUES (?, ?)');
            foreach ($levels as $level) {
                $insertLevel->execute([$tutor['tutor_id'], $level]);
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
        sendJson(200, ['success' => true]);
    }

    if ($method === 'GET' && $path === '/api/tutor/availability') {
        $tutor = ownedTutor(requireUser());
        $statement = db()->prepare('SELECT weekday, start_time, end_time FROM tutor_availability WHERE tutor_id = ?');
        $statement->execute([$tutor['tutor_id']]);
        $weekly = array_map(static fn(array $row): array => [
            'weekday' => (string)$row['weekday'],
            'startTime' => substr((string)$row['start_time'], 0, 5),
            'endTime' => substr((string)$row['end_time'], 0, 5),
        ], $statement->fetchAll());
        $statement = db()->prepare('SELECT day_off FROM tutor_days_off WHERE tutor_id = ? ORDER BY day_off');
        $statement->execute([$tutor['tutor_id']]);
        sendJson(200, ['weekly' => $weekly, 'daysOff' => array_column($statement->fetchAll(), 'day_off')]);
    }
    if ($method === 'PUT' && $path === '/api/tutor/availability') {
        $tutor = ownedTutor(requireUser());
        $input = body();
        [$weekly, $daysOff] = validateSchedule($input['weekly'] ?? null, $input['daysOff'] ?? null);
        $pdo = db();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM tutor_availability WHERE tutor_id = ?')->execute([$tutor['tutor_id']]);
            $insert = $pdo->prepare(
                'INSERT INTO tutor_availability (tutor_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)',
            );
            foreach ($weekly as $range) {
                $insert->execute([$tutor['tutor_id'], $range['weekday'], $range['startTime'], $range['endTime']]);
            }
            $pdo->prepare('DELETE FROM tutor_days_off WHERE tutor_id = ?')->execute([$tutor['tutor_id']]);
            $insert = $pdo->prepare('INSERT INTO tutor_days_off (tutor_id, day_off) VALUES (?, ?)');
            foreach ($daysOff as $date) {
                $insert->execute([$tutor['tutor_id'], $date]);
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
        sendJson(200, ['success' => true]);
    }

    if ($method === 'GET' && $path === '/api/tutor/notifications') {
        $tutor = ownedTutor(requireUser());
        $statement = db()->prepare(
            'SELECT b.*, u.first_name, u.last_name FROM bookings b
             JOIN users u ON u.id = b.student_id WHERE b.tutor_id = ? ORDER BY b.lesson_date, b.start_time',
        );
        $statement->execute([$tutor['tutor_id']]);
        $bookings = [];
        foreach ($statement->fetchAll() as $row) {
            $bookings[] = [
                'id' => $row['id'],
                'tutorId' => $row['tutor_id'],
                'date' => $row['lesson_date'],
                'startTime' => substr((string)$row['start_time'], 0, 5),
                'endTime' => substr((string)$row['end_time'], 0, 5),
                'durationMinutes' => (string)$row['duration_minutes'],
                'subject' => $row['subject'],
                'zoomStatus' => $row['zoom_status'],
                'zoomStartUrl' => $row['zoom_start_url'],
                'studentName' => $row['first_name'] . ' ' . $row['last_name'],
                'isPast' => isBookingPast($row),
            ];
        }
        $statement = db()->prepare(
            'SELECT r.*, u.first_name, u.last_name FROM reviews r
             JOIN users u ON u.id = r.student_id WHERE r.tutor_id = ? ORDER BY r.review_date DESC',
        );
        $statement->execute([$tutor['tutor_id']]);
        $reviews = array_map(static fn(array $review): array => cleanReview(
            $review,
            $review['first_name'] . ' ' . $review['last_name'],
        ), $statement->fetchAll());
        sendJson(200, ['bookings' => $bookings, 'reviews' => $reviews]);
    }

    if ($method === 'GET' && $path === '/api/reviews/mine') {
        $user = requireUser();
        requireRole($user, 'student');
        $statement = db()->prepare(
            'SELECT r.*, t.first_name AS tutor_first, t.last_name AS tutor_last
             FROM reviews r JOIN tutor_profiles p ON p.tutor_id = r.tutor_id
             JOIN users t ON t.id = p.user_id WHERE r.student_id = ? ORDER BY r.review_date DESC',
        );
        $statement->execute([$user['id']]);
        $reviews = [];
        foreach ($statement->fetchAll() as $review) {
            $item = cleanReview($review, 'Ty');
            $item['tutorName'] = $review['tutor_first'] . ' ' . $review['tutor_last'];
            $reviews[] = $item;
        }
        sendJson(200, ['reviews' => $reviews]);
    }
    if ($method === 'POST' && $path === '/api/reviews') {
        $user = requireUser();
        requireRole($user, 'student');
        $input = body();
        $bookingId = (string)($input['bookingId'] ?? '');
        $rating = filter_var($input['rating'] ?? null, FILTER_VALIDATE_INT);
        $comment = trim((string)($input['comment'] ?? ''));
        if ($rating === false || $rating < 1 || $rating > 5 || mb_strlen($comment) < 3 || mb_strlen($comment) > 2000) {
            throw new ApiError(400, 'Ocena musi wynosić 1–5, a komentarz od 3 do 2000 znaków.');
        }
        $statement = db()->prepare('SELECT * FROM bookings WHERE id = ? AND student_id = ?');
        $statement->execute([$bookingId, $user['id']]);
        $booking = $statement->fetch();
        if (!$booking || !isBookingPast($booking)) {
            throw new ApiError(403, 'Opinię możesz dodać po zakończeniu własnej lekcji.');
        }
        $id = randomId();
        try {
            $statement = db()->prepare(
                'INSERT INTO reviews (id, student_id, tutor_id, booking_id, rating, review_date, comment)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
            );
            $statement->execute([
                $id,
                $user['id'],
                $booking['tutor_id'],
                $bookingId,
                $rating,
                nowInAppZone()->format('Y-m-d'),
                $comment,
            ]);
        } catch (PDOException $error) {
            if ($error->getCode() === '23000') {
                throw new ApiError(409, 'Masz już opinię dla tego korepetytora. Możesz ją edytować lub usunąć.');
            }
            throw $error;
        }
        sendJson(201, [
            'review' => cleanReview([
                'id' => $id,
                'tutor_id' => $booking['tutor_id'],
                'booking_id' => $bookingId,
                'rating' => $rating,
                'review_date' => nowInAppZone()->format('Y-m-d'),
                'comment' => $comment,
            ], 'Ty'),
        ]);
    }
    if (preg_match('#^/api/reviews/([^/]+)$#', $path, $match) && in_array($method, ['PUT', 'DELETE'], true)) {
        $user = requireUser();
        requireRole($user, 'student');
        $reviewId = rawurldecode($match[1]);
        if ($method === 'DELETE') {
            $statement = db()->prepare('DELETE FROM reviews WHERE id = ? AND student_id = ?');
            $statement->execute([$reviewId, $user['id']]);
            if ($statement->rowCount() === 0) {
                throw new ApiError(404, 'Nie znaleziono Twojej opinii.');
            }
            sendJson(200, ['success' => true]);
        }
        $input = body();
        $rating = filter_var($input['rating'] ?? null, FILTER_VALIDATE_INT);
        $comment = trim((string)($input['comment'] ?? ''));
        if ($rating === false || $rating < 1 || $rating > 5 || mb_strlen($comment) < 3 || mb_strlen($comment) > 2000) {
            throw new ApiError(400, 'Ocena musi wynosić 1–5, a komentarz od 3 do 2000 znaków.');
        }
        $statement = db()->prepare(
            'UPDATE reviews SET rating = ?, comment = ? WHERE id = ? AND student_id = ?',
        );
        $statement->execute([$rating, $comment, $reviewId, $user['id']]);
        $select = db()->prepare('SELECT * FROM reviews WHERE id = ? AND student_id = ?');
        $select->execute([$reviewId, $user['id']]);
        $review = $select->fetch();
        if (!$review) {
            throw new ApiError(404, 'Nie znaleziono Twojej opinii.');
        }
        sendJson(200, ['review' => cleanReview($review, 'Ty')]);
    }

    if ($method === 'GET' && $path === '/api/zoom/status') {
        $user = requireUser();
        $tutor = ownedTutor($user);
        $statement = db()->prepare('SELECT COUNT(*) FROM zoom_connections WHERE user_id = ?');
        $statement->execute([$user['id']]);
        sendJson(200, [
            'connected' => (int)$statement->fetchColumn() > 0,
            'configured' => zoomConfigured(),
            'hasProfilePhoto' => (bool)$tutor['image_path'],
        ]);
    }
    if ($method === 'GET' && $path === '/api/zoom/connect') {
        $user = requireUser();
        requireRole($user, 'tutor');
        if (!zoomConfigured()) {
            throw new ApiError(503, 'Uzupełnij konfigurację OAuth Zoom w api/config.local.php.');
        }
        $state = bin2hex(random_bytes(32));
        storeOAuthState($state, (string)$user['id'], 'connect', 'tutor', '/profile?zoom=connected');
        redirectTo(zoomAuthorizationUrl($state));
    }
    if ($method === 'GET' && $path === '/api/zoom/login') {
        $role = (string)($_GET['role'] ?? '');
        if (!in_array($role, ['student', 'tutor'], true)) {
            throw new ApiError(400, 'Wybierz rolę ucznia lub korepetytora.');
        }
        if (!zoomConfigured()) {
            throw new ApiError(503, 'Uzupełnij konfigurację OAuth Zoom w api/config.local.php.');
        }
        $state = bin2hex(random_bytes(32));
        storeOAuthState($state, null, 'login', $role, safeReturnTo($_GET['returnTo'] ?? '/'));
        redirectTo(zoomAuthorizationUrl($state));
    }

    throw new ApiError(404, 'Nie znaleziono endpointu API.');
}

try {
    if (!str_starts_with(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/', '/api/')) {
        throw new ApiError(404, 'Nie znaleziono endpointu API.');
    }
    handleApi();
} catch (ApiError $error) {
    sendJson($error->status, ['error' => $error->getMessage()]);
} catch (PDOException $error) {
    error_log('Błąd bazy danych Tutorland: ' . $error->getMessage());
    sendJson(500, ['error' => 'Wystąpił błąd bazy danych. Sprawdź konfigurację i schemat MySQL.']);
} catch (Throwable $error) {
    error_log('Błąd API Tutorland: ' . $error->getMessage());
    sendJson(500, ['error' => 'Wystąpił błąd serwera. Spróbuj ponownie później.']);
}
