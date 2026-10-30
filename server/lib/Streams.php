<?php
declare(strict_types=1);

final class Streams
{
    private const VIEWER_WINDOW = 20;

    public static function all(): array
    {
        return Store::read('streams');
    }

    public static function find(string $id): ?array
    {
        return self::all()[$id] ?? null;
    }

    public static function create(string $name): array
    {
        $id = bin2hex(random_bytes(6));
        $stream = [
            'id' => $id,
            'name' => $name,
            'publish_key' => bin2hex(random_bytes(16)),
            'view_password' => self::password(),
            'created_at' => time(),
        ];
        Store::update('streams', fn(array $d) => [$id => $stream] + $d);
        return $stream;
    }

    public static function rename(string $id, string $name): void
    {
        self::patch($id, ['name' => $name]);
    }

    public static function rotate(string $id, string $what): void
    {
        self::patch($id, $what === 'publish'
            ? ['publish_key' => bin2hex(random_bytes(16))]
            : ['view_password' => self::password()]);
    }

    public static function delete(string $id): void
    {
        Store::update('streams', function (array $d) use ($id) {
            unset($d[$id]);
            return $d;
        });
    }

    private static function patch(string $id, array $fields): void
    {
        Store::update('streams', function (array $d) use ($id, $fields) {
            if (isset($d[$id])) {
                $d[$id] = $fields + $d[$id];
            }
            return $d;
        });
    }

    private static function password(): string
    {
        // Unambiguous characters: the viewer may have to type this.
        $alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
        $out = '';
        for ($i = 0; $i < 16; $i++) {
            $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        return $out;
    }

    public static function canView(string $id, string $token): bool
    {
        $stream = self::find($id);
        return $stream !== null && $token !== '' && hash_equals($stream['view_password'], $token);
    }

    public static function canPublish(string $id, string $key): bool
    {
        $stream = self::find($id);
        return $stream !== null && $key !== '' && hash_equals($stream['publish_key'], $key);
    }

    public static function touchViewer(string $id, string $fingerprint): void
    {
        $dir = Store::path('viewers/' . $id);
        if (!is_dir($dir)) {
            @mkdir($dir, 0770, true);
        }
        @touch($dir . '/' . hash('sha256', $fingerprint));
    }

    public static function viewers(string $id): int
    {
        $count = 0;
        foreach (glob(Store::path('viewers/' . $id . '/*')) ?: [] as $file) {
            if (time() - (int) @filemtime($file) <= self::VIEWER_WINDOW) {
                $count++;
            } else {
                @unlink($file);
            }
        }
        return $count;
    }

    /** Everything the dashboard shows for one stream. */
    public static function present(array $stream, array $live, array $settings): array
    {
        $host = $settings['rtmp_host'] ?: (parse_url($settings['base_url'], PHP_URL_HOST) ?: 'localhost');
        $query = 's=' . $stream['id'] . '&t=' . $stream['view_password'];
        $path = $live['live/' . $stream['id']] ?? [];
        return [
            'id' => $stream['id'],
            'name' => $stream['name'],
            'created_at' => $stream['created_at'],
            'view_password' => $stream['view_password'],
            'rtmp_server' => 'rtmp://' . $host . ':' . $settings['rtmp_port'] . '/live',
            'stream_key' => $stream['id'] . '?key=' . $stream['publish_key'],
            'watch_url' => $settings['base_url'] . '/watch.php?' . $query,
            'hls_url' => $settings['base_url'] . '/hls.php?' . $query . '&f=index.m3u8',
            'online' => !empty($path['online']),
            'online_since' => $path['onlineTime'] ?? null,
            'tracks' => array_column($path['tracks2'] ?? [], 'codec'),
            'bytes_in' => $path['inboundBytes'] ?? 0,
            'viewers' => self::viewers($stream['id']),
        ];
    }
}
