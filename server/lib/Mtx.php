<?php
declare(strict_types=1);

/** Supervises the bundled MediaMTX process and talks to its local API. */
final class Mtx
{
    public const PATH_PREFIX = 'live/';

    public static function binary(): ?string
    {
        $arch = match (php_uname('m')) {
            'x86_64', 'amd64' => 'amd64',
            'aarch64', 'arm64' => 'arm64',
            default => null,
        };
        return $arch ? APP_ROOT . '/bin/mediamtx-linux-' . $arch : null;
    }

    public static function config(array $s, string $log): string
    {
        $auth = rtrim($s['base_url'], '/') . '/mtx-auth.php?secret=' . $s['secret'];
        // Browsers need to learn the public address; interface IPs are wrong behind NAT.
        $host = $s['rtmp_host'] ?: (string) parse_url($s['base_url'], PHP_URL_HOST);
        $hosts = $host !== '' ? '["' . $host . '"]' : '[]';
        return <<<YAML
        logLevel: warn
        logDestinations: [file]
        logFile: "{$log}"
        authMethod: http
        authHTTPAddress: "{$auth}"
        authHTTPExclude:
          - action: api
        api: true
        apiAddress: 127.0.0.1:{$s['api_port']}
        rtsp: false
        webrtc: true
        webrtcAddress: 127.0.0.1:{$s['webrtc_http_port']}
        webrtcLocalUDPAddress: :{$s['webrtc_port']}
        webrtcLocalTCPAddress: :{$s['webrtc_port']}
        webrtcAdditionalHosts: {$hosts}
        srt: false
        moq: false
        rtmp: true
        rtmpAddress: :{$s['rtmp_port']}
        hls: true
        hlsAddress: 127.0.0.1:{$s['hls_port']}
        hlsVariant: fmp4
        hlsAlwaysRemux: true
        hlsSegmentCount: 7
        hlsSegmentDuration: 1s
        hlsCDNSecret: "{$s['secret']}"
        paths:
          all_others:

        YAML;
    }

    public static function writeConfig(): bool
    {
        $file = Store::path('mediamtx.yml');
        $yaml = self::config(Store::settings(), Store::path('mediamtx.log'));
        if (@file_get_contents($file) === $yaml) {
            return false;
        }
        file_put_contents($file, $yaml);
        chmod($file, 0660);
        return true;
    }

    public static function canExec(): bool
    {
        $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
        return function_exists('exec') && !in_array('exec', $disabled, true);
    }

    public static function running(): bool
    {
        $port = (int) Store::settings()['api_port'];
        $sock = @fsockopen('127.0.0.1', $port, $errno, $error, 0.3);
        if ($sock) {
            fclose($sock);
            return true;
        }
        return false;
    }

    /** @return string|null German error message, null on success */
    public static function start(): ?string
    {
        if (self::running()) {
            return null;
        }
        if (empty(Store::settings()['base_url'])) {
            return 'Das Dashboard muss einmal im Browser geöffnet werden, bevor der Medienserver starten kann.';
        }
        $bin = self::binary();
        if ($bin === null || !is_file($bin)) {
            return 'Für diese Server-Architektur (' . php_uname('m') . ') ist kein Medienserver enthalten.';
        }
        if (!self::canExec()) {
            return 'PHP darf hier keine Programme starten (exec ist deaktiviert).';
        }
        @chmod($bin, 0755);
        self::writeConfig();
        $cmd = 'nohup ' . escapeshellarg($bin) . ' ' . escapeshellarg(Store::path('mediamtx.yml'))
            . ' >/dev/null 2>&1 & echo $!';
        $out = [];
        exec($cmd, $out);
        file_put_contents(Store::path('mediamtx.pid'), trim($out[0] ?? ''));
        return self::waitUntilUp(5) ? null : 'Der Medienserver ist nicht gestartet. Siehe Protokoll.';
    }

    public static function waitUntilUp(int $seconds): bool
    {
        $until = microtime(true) + $seconds;
        do {
            if (self::running()) {
                return true;
            }
            usleep(200000);
        } while (microtime(true) < $until);
        return false;
    }

    public static function stop(): void
    {
        $pid = (int) @file_get_contents(Store::path('mediamtx.pid'));
        if ($pid <= 1) {
            return;
        }
        if (function_exists('posix_kill')) {
            @posix_kill($pid, 15);
        } elseif (self::canExec()) {
            exec('kill ' . $pid);
        }
        $until = microtime(true) + 3;
        while (self::running() && microtime(true) < $until) {
            usleep(100000);
        }
        @unlink(Store::path('mediamtx.pid'));
    }

    /** True when the config changed after the running process was started. */
    public static function configStale(): bool
    {
        $pid = Store::path('mediamtx.pid');
        return is_file($pid) && (int) @filemtime(Store::path('mediamtx.yml')) > (int) filemtime($pid);
    }

    public static function restart(): ?string
    {
        self::stop();
        return self::start();
    }

    private static function api(string $method, string $path): ?array
    {
        $port = Store::settings()['api_port'];
        $res = Http::request($method, "http://127.0.0.1:{$port}/v3/{$path}", ['connect_timeout' => 1, 'timeout' => 2]);
        return $res['status'] >= 200 && $res['status'] < 300 ? (json_decode($res['body'], true) ?: []) : null;
    }

    /** Live path info keyed by path name; empty while the server is down. */
    public static function paths(): array
    {
        $out = [];
        foreach (self::api('GET', 'paths/list?itemsPerPage=1000')['items'] ?? [] as $item) {
            $out[$item['name']] = $item;
        }
        return $out;
    }

    public static function info(): array
    {
        return self::api('GET', 'info') ?? [];
    }

    public static function version(): ?string
    {
        return self::info()['version'] ?? null;
    }

    /**
     * Disconnect RTMP publishers and WebRTC sessions, used when the license locks or
     * credentials change. WebRTC media bypasses hls.php, so it has to be cut off here.
     *
     * @param string|null $role 'publish', 'read' or null for both
     */
    public static function kick(?string $path = null, ?string $role = null): void
    {
        if ($role !== 'read') {
            foreach (self::api('GET', 'rtmp/conns/list?itemsPerPage=1000')['items'] ?? [] as $conn) {
                if ($path === null || ($conn['path'] ?? '') === $path) {
                    self::api('POST', 'rtmp/conns/kick/' . rawurlencode($conn['id']));
                }
            }
        }
        foreach (self::api('GET', 'webrtc/sessions/list?itemsPerPage=1000')['items'] ?? [] as $session) {
            if (($path === null || ($session['path'] ?? '') === $path)
                && ($role === null || ($session['state'] ?? '') === $role)) {
                self::api('POST', 'webrtc/sessions/kick/' . rawurlencode($session['id']));
            }
        }
    }

    public static function logTail(int $lines = 30): string
    {
        $data = @file(Store::path('mediamtx.log'), FILE_IGNORE_NEW_LINES);
        return $data ? implode("\n", array_slice($data, -$lines)) : '';
    }

    public static function trimLog(): void
    {
        $file = Store::path('mediamtx.log');
        if (@filesize($file) > 1048576) {
            file_put_contents($file, self::logTail(200) . "\n");
        }
    }

    public static function diagnostics(): array
    {
        $bin = self::binary();
        $cronPhp = PHP_BINDIR . '/php';
        return [
            'running' => self::running(),
            'version' => self::version(),
            'arch' => php_uname('m'),
            'binary_found' => $bin !== null && is_file($bin),
            'exec_available' => self::canExec(),
            'extensions' => array_map(fn($e) => ['name' => $e, 'ok' => extension_loaded($e)], ['curl', 'sodium', 'zip']),
            'php_version' => PHP_VERSION,
            'cron_command' => $cronPhp . ' ' . APP_ROOT . '/cron.php',
            'cron_file' => APP_ROOT . '/cron.php',
            'webrtc_port' => (int) Store::settings()['webrtc_port'],
            'cron_ok' => time() - (int) (Store::read('maintenance')['ran_at'] ?? 0) < 180,
            'log' => self::logTail(),
        ];
    }
}
