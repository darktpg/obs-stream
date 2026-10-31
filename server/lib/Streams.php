<?php
declare(strict_types=1);

final class Streams
{
    private const VIEWER_WINDOW = 20;
    public const LATENCIES = ['instant', 'low', 'balanced', 'quality'];

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
            'latency' => 'low',
            'idle_color' => '',
            'created_at' => time(),
        ];
        Store::update('streams', fn(array $d) => [$id => $stream] + $d);
        return $stream;
    }

    public static function rename(string $id, string $name): void
    {
        self::patch($id, ['name' => $name]);
    }

    public static function configure(string $id, string $latency, string $idleColor): void
    {
        self::patch($id, ['latency' => $latency, 'idle_color' => $idleColor]);
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

    public static function touchViewer(string $id, string $ip, string $agent): void
    {
        $dir = Store::path('viewers/' . $id);
        if (!is_dir($dir)) {
            @mkdir($dir, 0770, true);
        }
        $file = $dir . '/' . hash('sha256', $ip . '|' . $agent);
        if (is_file($file)) {
            @touch($file);
        } else {
            @file_put_contents($file, self::client($agent));
        }
    }

    /** Kind of player behind a user agent, for the statistics. */
    public static function client(string $agent): string
    {
        return match (true) {
            str_contains($agent, 'OBS/') => 'obs_browser',
            str_contains($agent, 'Lavf') => 'obs_media',
            (bool) preg_match('/Mobile|Android|iPhone|iPad/', $agent) => 'mobile',
            default => 'browser',
        };
    }

    /** Viewers currently on HLS: hash => client kind. */
    public static function hlsViewers(string $id): array
    {
        $out = [];
        foreach (glob(Store::path('viewers/' . $id . '/*')) ?: [] as $file) {
            if (time() - (int) @filemtime($file) <= self::VIEWER_WINDOW) {
                $out[basename($file)] = (string) @file_get_contents($file) ?: 'browser';
            } else {
                @unlink($file);
            }
        }
        return $out;
    }

    public static function viewers(string $id): int
    {
        return count(self::hlsViewers($id));
    }

    /** WebRTC viewers do not pass through hls.php; MediaMTX lists them as readers. */
    public static function rtcViewers(array $path): int
    {
        return count(array_filter($path['readers'] ?? [], fn($r) => ($r['type'] ?? '') === 'webRTCSession'));
    }

    /** Sound survives WebRTC only as Opus; AAC from RTMP would silently be dropped. */
    public static function instantReady(array $path): bool
    {
        $codecs = array_column($path['tracks2'] ?? [], 'codec');
        return !in_array('MPEG-4 Audio', $codecs, true) && !in_array('AC3', $codecs, true);
    }

    public static function media(array $path): array
    {
        $video = $audio = null;
        foreach ($path['tracks2'] ?? [] as $track) {
            $props = $track['codecProps'] ?? [];
            if (isset($props['width'])) {
                $video ??= [
                    'codec' => $track['codec'], 'width' => $props['width'], 'height' => $props['height'] ?? 0,
                    'profile' => $props['profile'] ?? null, 'level' => $props['level'] ?? null,
                ];
            } elseif (isset($props['sampleRate']) || isset($props['channelCount'])) {
                $audio ??= [
                    'codec' => $track['codec'], 'sample_rate' => $props['sampleRate'] ?? 48000,
                    'channels' => $props['channelCount'] ?? null,
                ];
            }
        }
        return ['video' => $video, 'audio' => $audio];
    }

    public static function source(array $path): ?string
    {
        return match ($path['source']['type'] ?? null) {
            'rtmpConn', 'rtmpsConn' => 'RTMP',
            'webRTCSession' => 'WHIP',
            default => null,
        };
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
            'whep_url' => $settings['base_url'] . '/hls.php?' . $query . '&f=whep',
            'whip_url' => $settings['base_url'] . '/hls.php?s=' . $stream['id'] . '&key=' . $stream['publish_key'] . '&f=whip',
            'latency' => $stream['latency'] ?? 'low',
            'idle_color' => $stream['idle_color'] ?? '',
            'online' => !empty($path['online']),
            'online_since' => $path['onlineTime'] ?? null,
            'tracks' => array_column($path['tracks2'] ?? [], 'codec'),
            'bytes_in' => $path['inboundBytes'] ?? 0,
            'bytes_out' => $path['outboundBytes'] ?? 0,
            'frames_in_error' => $path['inboundFramesInError'] ?? 0,
            'viewers' => self::viewers($stream['id']) + self::rtcViewers($path),
            'viewers_rtc' => self::rtcViewers($path),
            'instant_ready' => self::instantReady($path),
            'source' => self::source($path),
            'media' => self::media($path),
        ];
    }
}
