<?php
declare(strict_types=1);

const LESSON_MINUTES = 40;
const LEVELS = ['primary', 'secondary', 'tertiary'];
const SESSION_COOKIE = 'tutorland_session';

final class ApiError extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

function cleanProfileImage(mixed $value): string
{
    if ($value === '') {
        return '';
    }
    if (!is_string($value) || strlen($value) > 700000
        || preg_match('#^data:image/webp;base64,([A-Za-z0-9+/]+={0,2})$#D', $value, $match) !== 1) {
        throw new ApiError(400, 'Wybierz prawidłowe zdjęcie profilowe.');
    }
    $image = base64_decode($match[1], true);
    if ($image === false || strlen($image) > 500000) {
        throw new ApiError(400, 'Zdjęcie profilowe jest zbyt duże.');
    }
    return $value;
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
    $pdo->exec("SET time_zone = '+00:00'");
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

function makePasswordHash(string $password): string
{
    $iterations = 310000;
    $salt = random_bytes(16);
    $derivedKey = hash_pbkdf2('sha256', $password, $salt, $iterations, 32, true);
    return 'pbkdf2-sha256$' . $iterations . '$' . base64_encode($salt) . '$' . base64_encode($derivedKey);
}

function verifyPassword(string $password, string $storedHash): bool
{
    $parts = explode('$', $storedHash);
    $valid = count($parts) === 4 && $parts[0] === 'pbkdf2-sha256'
        && (int)$parts[1] === 310000;
    $salt = $valid ? base64_decode($parts[2], true) : false;
    $expected = $valid ? base64_decode($parts[3], true) : false;
    $valid = $valid && is_string($salt) && strlen($salt) === 16
        && is_string($expected) && strlen($expected) === 32;
    $selectedSalt = $valid ? $salt : str_repeat("\0", 16);
    $selectedExpected = $valid ? $expected : str_repeat("\0", 32);
    $derivedKey = hash_pbkdf2('sha256', $password, $selectedSalt, 310000, 32, true);
    return $valid && hash_equals($selectedExpected, $derivedKey);
}

function cleanSubjects(mixed $subjects): array
{
    if (!is_array($subjects) || count($subjects) < 1 || count($subjects) > 20) {
        throw new ApiError(400, 'Wybierz od 1 do 20 przedmiotów.');
    }
    foreach ($subjects as $subject) {
        if (!is_string($subject)) {
            throw new ApiError(400, 'Lista zawiera nieprawidłowy tag.');
        }
    }
    $subjects = array_values(array_unique(array_map('formatSubjectName', $subjects)));
    $statement = db()->prepare(
        'SELECT name FROM subject_tags WHERE name IN (' . implode(', ', array_fill(0, count($subjects), '?')) . ')',
    );
    $statement->execute($subjects);
    $available = [];
    foreach ($statement->fetchAll() as $row) {
        $available[mb_strtolower($row['name'], 'UTF-8')] = $row['name'];
    }
    foreach ($subjects as $subject) {
        if (!isset($available[mb_strtolower($subject, 'UTF-8')])) {
            throw new ApiError(400, 'Utwórz nowy tag przed dodaniem go do profilu.');
        }
    }
    return array_values(array_map(
        static fn(string $subject): string => $available[mb_strtolower($subject, 'UTF-8')],
        $subjects,
    ));
}

function formatSubjectName(mixed $subject): string
{
    if (!is_string($subject)) {
        throw new ApiError(400, 'Podaj nazwę tagu.');
    }
    $name = preg_replace('/\s+/u', ' ', trim($subject));
    if (!is_string($name)) {
        throw new ApiError(400, 'Nazwa tagu zawiera nieprawidłowe znaki.');
    }
    $name = preg_replace_callback('/(^|[\s-])(\p{L})/u', static fn(array $matches): string => (
        $matches[1] . mb_strtoupper($matches[2], 'UTF-8')
    ), $name);
    if (!is_string($name) || mb_strlen($name, 'UTF-8') > 80
        || !preg_match('/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,\'’+\/#()&-]*$/u', $name)) {
        throw new ApiError(400, 'Nazwa tagu może zawierać litery, cyfry i podstawowe znaki interpunkcyjne.');
    }
    return $name;
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
        'profileImage' => $user['profile_image'] ?? '',
    ];
}

function currentUser(): ?array
{
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (!is_string($token) || $token === '') {
        return null;
    }
    $statement = db()->prepare(
        'SELECT u.id, u.role, u.first_name, u.last_name, u.email, u.tutor_id, p.image_data AS profile_image
         FROM sessions s JOIN users u ON u.id = s.user_id
         LEFT JOIN user_profile_photos p ON p.user_id = u.id
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

function tutorLevels(string $tutorId): array
{
    $statement = db()->prepare(
        'SELECT level FROM tutor_levels WHERE tutor_id = ? ORDER BY level',
    );
    $statement->execute([$tutorId]);
    return array_map(
        static fn(array $row): string => (string)$row['level'],
        $statement->fetchAll(),
    );
}

function tutorSubjects(string $tutorId): array
{
    $statement = db()->prepare(
        'SELECT subject FROM tutor_subjects WHERE tutor_id = ? ORDER BY subject',
    );
    $statement->execute([$tutorId]);
    return array_map(
        static fn(array $row): string => (string)$row['subject'],
        $statement->fetchAll(),
    );
}

function tutorPublic(array $tutor): array
{
    return [
        'tutorId' => $tutor['tutor_id'],
        'firstName' => $tutor['first_name'],
        'lastName' => $tutor['last_name'],
        'age' => (int)($tutor['age'] ?? 0),
        'teachingSinceYear' => (int)$tutor['teaching_since_year'],
        'description' => $tutor['description'],
        'pricePerLesson' => (int)$tutor['price_per_lesson'],
        'levels' => tutorLevels((string)$tutor['tutor_id']),
        'subjects' => tutorSubjects((string)$tutor['tutor_id']),
        'imagePath' => profileImageForUser((string)$tutor['user_id']) ?: $tutor['image_path'],
    ];
}

function profileImageForUser(string $userId): string
{
    $statement = db()->prepare('SELECT image_data FROM user_profile_photos WHERE user_id = ? LIMIT 1');
    $statement->execute([$userId]);
    $image = $statement->fetchColumn();
    return is_string($image) ? $image : '';
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

function requireChat(string $chatId, array $user): array
{
    $statement = db()->prepare(
        'SELECT c.*, s.first_name AS student_first, s.last_name AS student_last,
         sp.image_data AS student_image, t.first_name AS tutor_first, t.last_name AS tutor_last,
         tp.image_path AS tutor_image, tp.user_id AS tutor_user_id, tphoto.image_data AS tutor_profile_image
         FROM chat_conversations c
         JOIN users s ON s.id = c.student_id
         JOIN tutor_profiles tp ON tp.tutor_id = c.tutor_id
         JOIN users t ON t.id = tp.user_id
         LEFT JOIN user_profile_photos sp ON sp.user_id = s.id
         LEFT JOIN user_profile_photos tphoto ON tphoto.user_id = t.id
         WHERE c.id = ? AND ((? = \'student\' AND c.student_id = ?)
         OR (? = \'tutor\' AND c.tutor_id = ?)) LIMIT 1',
    );
    $statement->execute([$chatId, $user['role'], $user['id'], $user['role'], $user['tutor_id'] ?? '']);
    return $statement->fetch() ?: throw new ApiError(404, 'Nie znaleziono rozmowy.');
}

function purgeExpiredChatMessages(): void
{
    db()->exec('DELETE FROM chat_messages WHERE created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MONTH)');
}

function publicChat(array $chat, ?array $latestMessage = null): array
{
    return [
        'id' => $chat['id'],
        'tutorId' => $chat['tutor_id'],
        'studentName' => $chat['student_first'] . ' ' . $chat['student_last'],
        'studentImage' => $chat['student_image'] ?? '',
        'tutorName' => $chat['tutor_first'] . ' ' . $chat['tutor_last'],
        'tutorImage' => ($chat['tutor_profile_image'] ?? '') ?: $chat['tutor_image'],
        'latestMessage' => $latestMessage['content'] ?? '',
        'lastActivity' => $latestMessage['created_at'] ?? $chat['created_at'],
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
    $daysOffByDate = [];
    foreach ($daysOff as $item) {
        $dayOff = is_string($item) ? ['date' => $item] : $item;
        if (!is_array($dayOff) || !is_string($dayOff['date'] ?? null)
            || !isDate($dayOff['date']) || $dayOff['date'] < $today) {
            throw new ApiError(400, 'Dni wolne muszą być prawidłowymi datami bieżącymi lub przyszłymi.');
        }
        $startTime = $dayOff['startTime'] ?? '';
        $endTime = $dayOff['endTime'] ?? '';
        if (!is_string($startTime) || !is_string($endTime)
            || (($startTime !== '' || $endTime !== '')
                && (timeMinutes($startTime) === false || timeMinutes($endTime) === false
                    || timeMinutes($endTime) - timeMinutes($startTime) < LESSON_MINUTES))) {
            throw new ApiError(400, 'Dostępność w dniu wolnym musi obejmować co najmniej jedną lekcję 40-minutową.');
        }
        $daysOffByDate[$dayOff['date']] = [
            'date' => $dayOff['date'],
            'startTime' => $startTime,
            'endTime' => $endTime,
        ];
    }
    return [$normalized, array_values($daysOffByDate)];
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
    $dayOff = null;
    foreach ($daysOff as $item) {
        if (($item['date'] ?? '') === $date) {
            $dayOff = $item;
            break;
        }
    }
    if ($dayOff !== null && ($dayOff['startTime'] === '' || $dayOff['endTime'] === '')) {
        throw new ApiError(409, 'Korepetytor oznaczył ten dzień jako wolny.');
    }
    $weekday = (int)(new DateTimeImmutable($date, new DateTimeZone('UTC')))->format('w');
    if ($dayOff !== null) {
        $availability = [[
            'weekday' => $weekday,
            'start_time' => $dayOff['startTime'],
            'end_time' => $dayOff['endTime'],
        ]];
    }
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

function handleApi(): never
{
    db();
    $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $path = is_string($uriPath) ? rtrim($uriPath, '/') : '';
    $path = $path === '' ? '/' : $path;
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    if (in_array($method, ['POST', 'PUT', 'DELETE'], true)) {
        assertSameOrigin();
    }

    if ($method === 'GET' && $path === '/api/auth/me') {
        sendJson(200, ['user' => publicUser(currentUser())]);
    }
    if ($method === 'GET' && $path === '/api/auth/providers') {
        sendJson(200, ['password' => true, 'google' => false]);
    }
    if ($method === 'GET' && $path === '/api/subjects') {
        $statement = db()->query('SELECT name FROM subject_tags ORDER BY name');
        sendJson(200, ['subjects' => array_column($statement->fetchAll(), 'name')]);
    }
    if ($method === 'POST' && $path === '/api/subjects') {
        $user = requireUser();
        requireRole($user, 'tutor');
        $name = formatSubjectName(body()['name'] ?? null);
        $statement = db()->prepare('INSERT IGNORE INTO subject_tags (name) VALUES (?)');
        $statement->execute([$name]);
        $statement = db()->prepare('SELECT name FROM subject_tags WHERE name = ? LIMIT 1');
        $statement->execute([$name]);
        $subject = $statement->fetchColumn();
        if (!is_string($subject)) {
            throw new RuntimeException('Nie udało się odczytać zapisanego tagu.');
        }
        sendJson(201, ['subject' => $subject]);
    }
    if ($method === 'POST' && $path === '/api/auth/register') {
        $input = body();
        $role = $input['role'] ?? '';
        $firstName = is_string($input['firstName'] ?? null) ? trim($input['firstName']) : '';
        $lastName = is_string($input['lastName'] ?? null) ? trim($input['lastName']) : '';
        $email = is_string($input['email'] ?? null) ? strtolower(trim($input['email'])) : '';
        $password = $input['password'] ?? null;
        if (!in_array($role, ['student', 'tutor'], true)
            || !isValidName($firstName) || !isValidName($lastName)
            || strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false
            || !is_string($password) || strlen($password) < 8 || strlen($password) > 256) {
            throw new ApiError(400, 'Sprawdź imię, nazwisko, adres e-mail, rolę i hasło (co najmniej 8 znaków).');
        }
        if (($input['passwordConfirmation'] ?? null) !== $password) {
            throw new ApiError(400, 'Wpisane hasła nie są takie same.');
        }

        $id = randomId();
        $tutorId = $role === 'tutor'
            ? trim((string)preg_replace('/[^a-z0-9]+/', '-', strtolower($firstName)), '-') . '-' . bin2hex(random_bytes(5))
            : null;
        $pdo = db();
        try {
            $pdo->beginTransaction();
            $statement = $pdo->prepare(
                'INSERT INTO users (id, role, first_name, last_name, email, password_hash, tutor_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
            );
            $statement->execute([$id, $role, $firstName, $lastName, $email, makePasswordHash($password), $tutorId]);
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
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
        $statement = $pdo->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
        $statement->execute([$id]);
        $user = $statement->fetch();
        if (!$user) {
            throw new RuntimeException('Nie udało się odczytać utworzonego konta.');
        }
        createSession((string)$user['id']);
        sendJson(201, ['user' => publicUser($user)]);
    }
    if ($method === 'POST' && $path === '/api/auth/login') {
        $input = body();
        $email = is_string($input['email'] ?? null) ? strtolower(trim($input['email'])) : '';
        $password = $input['password'] ?? '';
        $statement = db()->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
        $statement->execute([$email]);
        $user = $statement->fetch() ?: null;
        $passwordMatches = verifyPassword(
            is_string($password) && strlen($password) <= 256 ? $password : '',
            (string)($user['password_hash'] ?? ''),
        );
        if (!$user || !is_string($password) || strlen($password) > 256 || !$passwordMatches) {
            throw new ApiError(401, 'Nieprawidłowy adres e-mail lub hasło.');
        }
        createSession((string)$user['id']);
        sendJson(200, ['user' => publicUser($user)]);
    }
    if ($method === 'GET' && $path === '/api/student/profile') {
        $user = requireUser();
        requireRole($user, 'student');
        sendJson(200, ['profile' => publicUser($user)]);
    }
    if ($method === 'PUT' && $path === '/api/student/profile') {
        $user = requireUser();
        requireRole($user, 'student');
        $input = body();
        if (!isValidName($input['firstName'] ?? null) || !isValidName($input['lastName'] ?? null)) {
            throw new ApiError(400, 'Podaj prawidłowe imię i nazwisko.');
        }
        $statement = db()->prepare("UPDATE users SET first_name = ?, last_name = ? WHERE id = ? AND role = 'student'");
        $statement->execute([trim($input['firstName']), trim($input['lastName']), $user['id']]);
        sendJson(200, ['success' => true]);
    }
    if ($method === 'PUT' && $path === '/api/profile/photo') {
        $user = requireUser();
        $profileImage = cleanProfileImage(body()['profileImage'] ?? null);
        if ($profileImage === '') {
            $statement = db()->prepare('DELETE FROM user_profile_photos WHERE user_id = ?');
            $statement->execute([$user['id']]);
        } else {
            $statement = db()->prepare(
                'INSERT INTO user_profile_photos (user_id, image_data) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE image_data = VALUES(image_data)',
            );
            $statement->execute([$user['id'], $profileImage]);
        }
        sendJson(200, ['success' => true]);
    }
    if ($method === 'POST' && $path === '/api/auth/delete-account') {
        $user = requireUser();
        $pdo = db();
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare('DELETE FROM users WHERE id = ?');
            $statement->execute([$user['id']]);
            if ($statement->rowCount() !== 1) {
                throw new ApiError(404, 'Nie znaleziono konta do usunięcia.');
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
        clearSessionCookie();
        sendJson(200, ['success' => true]);
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
            'SELECT day_off AS date, NULL AS start_time, NULL AS end_time FROM tutor_days_off
             WHERE tutor_id = ? AND (? = \'\' OR day_off LIKE ?)
             UNION ALL
             SELECT lesson_date AS date, start_time, end_time FROM tutor_day_availability
             WHERE tutor_id = ? AND (? = \'\' OR lesson_date LIKE ?) ORDER BY date',
        );
        $statement->execute([$tutorId, $prefix, $prefix . '%', $tutorId, $prefix, $prefix . '%']);
        $daysOff = array_map(static fn(array $row): array => [
            'tutorId' => $tutorId,
            'date' => $row['date'],
            'startTime' => $row['start_time'] === null ? '' : substr((string)$row['start_time'], 0, 5),
            'endTime' => $row['end_time'] === null ? '' : substr((string)$row['end_time'], 0, 5),
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
        sendJson(200, ['tutor' => tutorPublic($tutor)]);
    }

    if ($method === 'GET' && (
        $path === '/api/chats'
        || ($path === '/api/messages' && !array_key_exists('chatId', $_GET))
    )) {
        $user = requireUser();
        purgeExpiredChatMessages();
        $statement = db()->prepare(
            'SELECT c.*, s.first_name AS student_first, s.last_name AS student_last,
             sp.image_data AS student_image, t.first_name AS tutor_first, t.last_name AS tutor_last,
             tp.image_path AS tutor_image, tphoto.image_data AS tutor_profile_image,
             (SELECT m.content FROM chat_messages m WHERE m.conversation_id = c.id
              AND m.created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MONTH)
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS latest_content,
             COALESCE((SELECT m.created_at FROM chat_messages m WHERE m.conversation_id = c.id
              AND m.created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MONTH)
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1), c.created_at) AS last_activity
             FROM chat_conversations c
             JOIN users s ON s.id = c.student_id
             JOIN tutor_profiles tp ON tp.tutor_id = c.tutor_id
             JOIN users t ON t.id = tp.user_id
             LEFT JOIN user_profile_photos sp ON sp.user_id = s.id
             LEFT JOIN user_profile_photos tphoto ON tphoto.user_id = t.id
             WHERE (? = \'student\' AND c.student_id = ?) OR (? = \'tutor\' AND c.tutor_id = ?)
             ORDER BY last_activity DESC',
        );
        $statement->execute([$user['role'], $user['id'], $user['role'], $user['tutor_id'] ?? '']);
        $chats = array_map(static fn(array $chat): array => publicChat($chat, [
            'content' => $chat['latest_content'] ?? '',
            'created_at' => $chat['last_activity'],
        ]), $statement->fetchAll());
        sendJson(200, ['chats' => $chats]);
    }

    $chatMessagesMatch = preg_match('#^/api/chats/([^/]+)/messages$#', $path, $match) === 1;
    if (($chatMessagesMatch || $path === '/api/messages')
        && ($method === 'POST' || ($method === 'GET' && array_key_exists('chatId', $_GET)))) {
        $user = requireUser();
        $input = $method === 'POST' ? body() : [];
        $chatId = $chatMessagesMatch
            ? rawurldecode($match[1])
            : ($method === 'GET' ? ($_GET['chatId'] ?? '') : ($input['chatId'] ?? ''));
        if (!is_string($chatId) || $chatId === '') {
            throw new ApiError(400, 'Wybierz prawidłową rozmowę.');
        }
        purgeExpiredChatMessages();
        $chat = requireChat($chatId, $user);
        if ($method === 'GET') {
            $statement = db()->prepare(
                'SELECT m.id, m.conversation_id, m.sender_id, m.message_type, m.content, m.created_at,
                 u.first_name, u.last_name, p.image_data AS sender_image
                 FROM chat_messages m JOIN users u ON u.id = m.sender_id
                 LEFT JOIN user_profile_photos p ON p.user_id = u.id
                 WHERE m.conversation_id = ? ORDER BY m.created_at, m.id',
            );
            $statement->execute([$chat['id']]);
            $messages = array_map(static fn(array $message): array => [
                'id' => $message['id'],
                'chatId' => $message['conversation_id'],
                'senderId' => $message['sender_id'],
                'senderName' => $message['message_type'] === 'booking_notice'
                    ? 'Informacja o rezerwacji'
                    : $message['first_name'] . ' ' . $message['last_name'],
                'senderImage' => $message['sender_image'] ?? '',
                'messageType' => $message['message_type'],
                'content' => $message['content'],
                'createdAt' => (new DateTimeImmutable($message['created_at'], new DateTimeZone('UTC')))->format('Y-m-d\\TH:i:s\\Z'),
            ], $statement->fetchAll());
            sendJson(200, ['messages' => $messages]);
        }

        $content = is_string($input['content'] ?? null) ? trim($input['content']) : '';
        if ($content === '' || mb_strlen($content) > 4000) {
            throw new ApiError(400, 'Wiadomość musi zawierać od 1 do 4000 znaków.');
        }
        $messageId = randomId();
        $statement = db()->prepare(
            'INSERT INTO chat_messages (id, conversation_id, sender_id, message_type, content) VALUES (?, ?, ?, \'user\', ?)',
        );
        $statement->execute([$messageId, $chat['id'], $user['id'], $content]);
        $statement = db()->prepare(
            'SELECT m.id, m.conversation_id, m.sender_id, m.message_type, m.content, m.created_at,
             u.first_name, u.last_name, p.image_data AS sender_image
             FROM chat_messages m JOIN users u ON u.id = m.sender_id
             LEFT JOIN user_profile_photos p ON p.user_id = u.id WHERE m.id = ?',
        );
        $statement->execute([$messageId]);
        $message = $statement->fetch();
        sendJson(201, ['message' => [
            'id' => $message['id'],
            'chatId' => $message['conversation_id'],
            'senderId' => $message['sender_id'],
            'senderName' => $message['first_name'] . ' ' . $message['last_name'],
            'senderImage' => $message['sender_image'] ?? '',
            'messageType' => $message['message_type'],
            'content' => $message['content'],
            'createdAt' => (new DateTimeImmutable($message['created_at'], new DateTimeZone('UTC')))->format('Y-m-d\\TH:i:s\\Z'),
        ]]);
    }

    if ($method === 'GET' && $path === '/api/bookings') {
        $user = requireUser();
        if ($user['role'] === 'student') {
            $statement = db()->prepare(
                'SELECT b.*, cc.id AS chat_id, u.first_name AS student_first, u.last_name AS student_last, sp.image_data AS student_image,
                 t.first_name AS tutor_first, t.last_name AS tutor_last
                 FROM bookings b JOIN users u ON u.id = b.student_id
                 LEFT JOIN user_profile_photos sp ON sp.user_id = u.id
                 LEFT JOIN chat_conversations cc ON cc.student_id = b.student_id AND cc.tutor_id = b.tutor_id
                 JOIN tutor_profiles p ON p.tutor_id = b.tutor_id
                 JOIN users t ON t.id = p.user_id WHERE b.student_id = ? ORDER BY b.lesson_date, b.start_time',
            );
        } else {
            $statement = db()->prepare(
                'SELECT b.*, cc.id AS chat_id, u.first_name AS student_first, u.last_name AS student_last, sp.image_data AS student_image,
                 t.first_name AS tutor_first, t.last_name AS tutor_last
                 FROM bookings b JOIN users u ON u.id = b.student_id
                 LEFT JOIN user_profile_photos sp ON sp.user_id = u.id
                 LEFT JOIN chat_conversations cc ON cc.student_id = b.student_id AND cc.tutor_id = b.tutor_id
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
                'level' => $row['education_level'],
                'chatId' => $row['chat_id'] ?? '',
                'studentName' => $row['student_first'] . ' ' . $row['student_last'],
                'tutorName' => $row['tutor_first'] . ' ' . $row['tutor_last'],
                'isPast' => isBookingPast($row),
            ];
            if ($user['role'] === 'tutor') {
                $item['studentImage'] = $row['student_image'] ?? '';
            }
            $bookings[] = $item;
        }
        sendJson(200, ['bookings' => $bookings]);
    }

    if ($method === 'POST' && $path === '/api/bookings') {
        $user = requireUser();
        requireRole($user, 'student');
        purgeExpiredChatMessages();
        $input = body();
        $tutorId = (string)($input['tutorId'] ?? '');
        $date = (string)($input['date'] ?? '');
        $startTime = (string)($input['startTime'] ?? '');
        $subject = (string)($input['subject'] ?? '');
        $level = is_string($input['level'] ?? null) ? $input['level'] : '';
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
            if (!in_array($level, LEVELS, true)) {
                throw new ApiError(400, 'Wybierz prawidłowy poziom nauczania.');
            }
            $statement = $pdo->prepare('SELECT level FROM tutor_levels WHERE tutor_id = ?');
            $statement->execute([$tutorId]);
            if (!in_array($level, $statement->fetchAll(PDO::FETCH_COLUMN), true)) {
                throw new ApiError(400, 'Wybierz poziom nauczania z oferty korepetytora.');
            }
            $statement = $pdo->prepare(
                'SELECT start_time, end_time FROM bookings WHERE tutor_id = ? AND lesson_date = ? FOR UPDATE',
            );
            $statement->execute([$tutorId, $date]);
            $bookings = $statement->fetchAll();
            $statement = $pdo->prepare('SELECT day_off AS date, \'\' AS startTime, \'\' AS endTime FROM tutor_days_off WHERE tutor_id = ? AND day_off = ?');
            $statement->execute([$tutorId, $date]);
            $daysOff = $statement->fetchAll();
            $statement = $pdo->prepare(
                'SELECT lesson_date AS date, start_time AS startTime, end_time AS endTime
                 FROM tutor_day_availability WHERE tutor_id = ? AND lesson_date = ?',
            );
            $statement->execute([$tutorId, $date]);
            $daysOff = [
                ...$daysOff,
                ...array_map(static fn(array $row): array => [
                    'date' => $row['date'],
                    'startTime' => substr((string)$row['startTime'], 0, 5),
                    'endTime' => substr((string)$row['endTime'], 0, 5),
                ], $statement->fetchAll()),
            ];
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
                "INSERT INTO bookings (id, tutor_id, student_id, lesson_date, start_time, end_time, subject, education_level)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            );
            $insert->execute([$id, $tutorId, $user['id'], $date, $startTime, $endTime, $subject, $level]);
            $chatId = randomId();
            $pdo->prepare(
                'INSERT IGNORE INTO chat_conversations (id, student_id, tutor_id) VALUES (?, ?, ?)',
            )->execute([$chatId, $user['id'], $tutorId]);
            $chat = $pdo->prepare('SELECT id FROM chat_conversations WHERE student_id = ? AND tutor_id = ? LIMIT 1');
            $chat->execute([$user['id'], $tutorId]);
            $chatId = (string)$chat->fetchColumn();
            $notice = 'Nowa rezerwacja lekcji: ' . $date . ', ' . substr($startTime, 0, 5) . '–' . substr($endTime, 0, 5)
                . '; ' . $subject . ' (' . $level . '). Uczniu, napisz proszę do korepetytora, aby ustalić sposób przeprowadzenia zajęć oraz sposób i termin płatności.';
            $pdo->prepare(
                'INSERT INTO chat_messages (id, conversation_id, sender_id, message_type, content) VALUES (?, ?, ?, \'booking_notice\', ?)',
            )->execute([randomId(), $chatId, $user['id'], $notice]);
            $pdo->commit();
            $booking = [
                'id' => $id,
                'tutor_id' => $tutorId,
                'student_id' => $user['id'],
                'lesson_date' => $date,
                'start_time' => $startTime,
                'end_time' => $endTime,
                'subject' => $subject,
                'education_level' => $level,
                'chat_id' => $chatId,
            ];
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
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
                'level' => $booking['education_level'],
                'chatId' => $booking['chat_id'],
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
        $daysOff = array_map(static fn(array $row): array => [
            'date' => $row['day_off'],
            'startTime' => '',
            'endTime' => '',
        ], $statement->fetchAll());
        $statement = db()->prepare('SELECT lesson_date, start_time, end_time FROM tutor_day_availability WHERE tutor_id = ? ORDER BY lesson_date');
        $statement->execute([$tutor['tutor_id']]);
        $specialHours = array_map(static fn(array $row): array => [
            'date' => $row['lesson_date'],
            'startTime' => substr((string)$row['start_time'], 0, 5),
            'endTime' => substr((string)$row['end_time'], 0, 5),
        ], $statement->fetchAll());
        sendJson(200, ['weekly' => $weekly, 'daysOff' => [...$daysOff, ...$specialHours]]);
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
            $pdo->prepare('DELETE FROM tutor_day_availability WHERE tutor_id = ?')->execute([$tutor['tutor_id']]);
            $insert = $pdo->prepare('INSERT INTO tutor_days_off (tutor_id, day_off) VALUES (?, ?)');
            $insertHours = $pdo->prepare(
                'INSERT INTO tutor_day_availability (tutor_id, lesson_date, start_time, end_time) VALUES (?, ?, ?, ?)',
            );
            foreach ($daysOff as $dayOff) {
                if ($dayOff['startTime'] !== '' && $dayOff['endTime'] !== '') {
                    $insertHours->execute([$tutor['tutor_id'], $dayOff['date'], $dayOff['startTime'], $dayOff['endTime']]);
                } else {
                    $insert->execute([$tutor['tutor_id'], $dayOff['date']]);
                }
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
            'SELECT b.*, c.id AS chat_id, u.first_name, u.last_name, p.image_data AS student_image FROM bookings b
             JOIN users u ON u.id = b.student_id
             LEFT JOIN user_profile_photos p ON p.user_id = u.id
             LEFT JOIN chat_conversations c ON c.student_id = b.student_id AND c.tutor_id = b.tutor_id
             WHERE b.tutor_id = ? ORDER BY b.lesson_date, b.start_time',
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
                'level' => $row['education_level'],
                'chatId' => $row['chat_id'] ?? '',
                'studentName' => $row['first_name'] . ' ' . $row['last_name'],
                'studentImage' => $row['student_image'] ?? '',
                'isPast' => isBookingPast($row),
            ];
        }
        sendJson(200, ['bookings' => $bookings]);
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
    if (in_array((string)$error->getCode(), ['42S02', '42S22'], true)) {
        sendJson(503, ['error' => 'Schemat bazy danych jest niekompletny. Utwórz nową bazę i zaimportuj kompletny plik tutorland-database.sql.']);
    }
    sendJson(500, ['error' => 'Wystąpił błąd bazy danych. Sprawdź konfigurację i schemat MySQL.']);
} catch (Throwable $error) {
    error_log('Błąd API Tutorland: ' . $error->getMessage());
    sendJson(500, ['error' => 'Wystąpił błąd serwera. Spróbuj ponownie później.']);
}
