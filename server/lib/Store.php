<?php
declare(strict_types=1);

/**
 * JSON state in a randomly named data directory. The random name matters:
 * Plesk's nginx may serve static files directly and skip .htaccess.
 */
final class Store
{
    private static ?string $dir = null;

    public static function dir(): string
    {
        if (self::$dir !== null) {
            return self::$dir;
        }
        $found = glob(APP_ROOT . '/data-*', GLOB_ONLYDIR) ?: [];
        if ($found) {
            return self::$dir = $found[0];
        }
        $dir = APP_ROOT . '/data-' . bin2hex(random_bytes(16));
        if (!mkdir($dir, 0770, true)) {
            throw new RuntimeException('Datenordner konnte nicht angelegt werden: ' . $dir);
        }
        file_put_contents($dir . '/.htaccess', "Require all denied\n");
        file_put_contents($dir . '/index.html', '');
        return self::$dir = $dir;
    }

    public static function path(string $name): string
    {
        return self::dir() . '/' . $name;
    }

    public static function read(string $name, array $default = []): array
    {
        $raw = @file_get_contents(self::path($name . '.json'));
        $data = $raw === false ? null : json_decode($raw, true);
        return is_array($data) ? $data : $default;
    }

    public static function write(string $name, array $data): void
    {
        $file = self::path($name . '.json');
        $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
        file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        chmod($tmp, 0660);
        rename($tmp, $file);
    }

    /** Read-modify-write under an exclusive lock. */
    public static function update(string $name, callable $fn): array
    {
        $lock = fopen(self::path($name . '.lock'), 'c');
        flock($lock, LOCK_EX);
        try {
            $data = $fn(self::read($name));
            self::write($name, $data);
            return $data;
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    public static function settings(): array
    {
        $s = self::read('settings');
        if (isset($s['instance_id'], $s['secret'])) {
            return $s + self::settingDefaults();
        }
        return self::update('settings', fn(array $cur) => $cur + [
            'instance_id' => bin2hex(random_bytes(16)),
            'secret' => bin2hex(random_bytes(24)),
        ] + self::settingDefaults());
    }

    private static function settingDefaults(): array
    {
        return ['base_url' => '', 'rtmp_host' => '', 'rtmp_port' => 1935, 'hls_port' => 18888, 'api_port' => 19997];
    }
}
