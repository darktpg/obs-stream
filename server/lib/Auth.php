<?php
declare(strict_types=1);

final class Auth
{
    private const MAX_FAILS = 5;
    private const LOCK_SECONDS = 300;

    public static function start(): void
    {
        session_name('OBSSTREAM');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/',
            'secure' => ($_SERVER['HTTPS'] ?? '') === 'on',
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        session_start();
        $_SESSION['csrf'] ??= bin2hex(random_bytes(16));
    }

    public static function setupRequired(): bool
    {
        return empty(Store::read('auth')['hash']);
    }

    public static function setPassword(string $password): void
    {
        Store::write('auth', ['hash' => password_hash($password, PASSWORD_DEFAULT)]);
    }

    public static function authenticated(): bool
    {
        return !empty($_SESSION['admin']);
    }

    public static function grant(): void
    {
        session_regenerate_id(true);
        $_SESSION['admin'] = true;
    }

    public static function checkCsrf(): void
    {
        if (!hash_equals($_SESSION['csrf'] ?? '', $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) {
            Http::json(['error' => 'Sitzung abgelaufen. Bitte Seite neu laden.'], 403);
        }
    }

    /** @return string|null German error message, null on success */
    public static function login(string $password): ?string
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        $key = hash('sha256', $ip);
        $entry = Store::read('login_fails')[$key] ?? ['n' => 0, 't' => 0];
        if ($entry['n'] >= self::MAX_FAILS && time() - $entry['t'] < self::LOCK_SECONDS) {
            return 'Zu viele Fehlversuche. Bitte in 5 Minuten erneut versuchen.';
        }
        if (password_verify($password, Store::read('auth')['hash'] ?? '')) {
            Store::update('login_fails', function (array $d) use ($key) {
                unset($d[$key]);
                return $d;
            });
            self::grant();
            return null;
        }
        Store::update('login_fails', function (array $d) use ($key) {
            $n = time() - ($d[$key]['t'] ?? 0) < self::LOCK_SECONDS ? ($d[$key]['n'] ?? 0) : 0;
            $d[$key] = ['n' => $n + 1, 't' => time()];
            return $d;
        });
        return 'Falsches Passwort.';
    }
}
