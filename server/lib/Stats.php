<?php
declare(strict_types=1);

/**
 * History behind the statistics page, built from periodic MediaMTX samples:
 * short-term samples, hourly and daily rollups, and one record per broadcast.
 */
final class Stats
{
    private const STEP = 8;
    private const GAP = 90;
    private const KEEP_RECENT = 360;
    private const KEEP_HOURS = 168;
    private const KEEP_DAYS = 400;
    private const KEEP_SESSIONS = 500;

    /** Security counters are bumped from request handlers, hence a file of their own. */
    public static function count(string $name, string $who): void
    {
        // A forgotten source with an old password retries every few seconds.
        $dir = Store::path('denied');
        if (!is_dir($dir)) {
            @mkdir($dir, 0770, true);
        }
        $mark = $dir . '/' . hash('sha256', $name . '|' . $who);
        if (time() - (int) @filemtime($mark) < 60) {
            return;
        }
        @touch($mark);
        foreach (glob($dir . '/*') ?: [] as $file) {
            if (time() - (int) @filemtime($file) > 120) {
                @unlink($file);
            }
        }
        $day = date('Y-m-d');
        Store::update('counters', function (array $c) use ($name, $day) {
            $c['total'][$name] = ($c['total'][$name] ?? 0) + 1;
            $c['days'][$day][$name] = ($c['days'][$day][$name] ?? 0) + 1;
            $c['days'] = array_slice($c['days'], -31, null, true);
            return $c;
        });
    }

    public static function sample(?array $live = null): void
    {
        if (time() - (int) (Store::read('stats')['at'] ?? 0) < self::STEP) {
            return;
        }
        $live ??= Mtx::paths();
        $streams = Streams::all();
        $hls = [];
        foreach ($streams as $id => $_) {
            $hls[$id] = Streams::hlsViewers($id);
        }
        Store::update('stats', fn(array $d) => self::apply($d, $streams, $live, $hls, time()));
    }

    private static function apply(array $d, array $streams, array $live, array $hls, int $now): array
    {
        $last = (int) ($d['at'] ?? 0);
        if ($now - $last < self::STEP) {
            return $d;
        }
        // After an outage the byte counters span an unknown time; that sample counts for nothing.
        $dt = $last > 0 && $now - $last <= self::GAP ? $now - $last : 0;
        $row = ['live' => 0, 'in' => 0, 'out' => 0, 'viewer_s' => 0, 'peak_v' => 0, 'peak_kbps' => 0, 'errors' => 0, 'started' => 0];
        $viewers = $kbps = 0;
        $day = date('Y-m-d', $now);
        if (($d['seen_day'] ?? '') !== $day) {
            $d['seen_day'] = $day;
            $d['seen'] = [];
        }

        foreach ($streams as $id => $stream) {
            $path = $live[Mtx::PATH_PREFIX . $id] ?? [];
            $online = !empty($path['online']);
            $prev = $d['last'][$id] ?? ['in' => 0, 'out' => 0, 'errors' => 0];
            $in = (int) ($path['inboundBytes'] ?? 0);
            $out = (int) ($path['outboundBytes'] ?? 0);
            $errors = (int) ($path['inboundFramesInError'] ?? 0);
            // Counters restart with every broadcast.
            $dIn = $dt ? ($in >= $prev['in'] ? $in - $prev['in'] : $in) : 0;
            $dOut = $dt ? ($out >= $prev['out'] ? $out - $prev['out'] : $out) : 0;
            $dErr = $dt ? ($errors >= $prev['errors'] ? $errors - $prev['errors'] : $errors) : 0;
            $d['last'][$id] = ['in' => $in, 'out' => $out, 'errors' => $errors];

            $rtc = Streams::rtcViewers($path);
            $count = count($hls[$id] ?? []) + $rtc;
            $rate = $dt ? (int) round($dIn * 8 / $dt / 1000) : 0;
            foreach ($hls[$id] ?? [] as $hash => $client) {
                $d['seen'][$hash] = 1;
                $d['clients'][$client] = ($d['clients'][$client] ?? 0) + $dt;
            }
            $d['clients']['webrtc'] = ($d['clients']['webrtc'] ?? 0) + $rtc * $dt;

            $session = $d['open'][$id] ?? null;
            if ($session !== null && ($now - $session['last'] > self::GAP || !$online)) {
                self::close($d, $id);
                $session = null;
            }
            if ($online) {
                if ($session === null) {
                    $media = Streams::media($path);
                    $session = [
                        'stream' => $id, 'name' => $stream['name'], 'start' => $now, 'last' => $now, 'bytes' => 0,
                        'peak_v' => 0, 'viewer_s' => 0, 'peak_kbps' => 0, 'errors' => 0,
                        'source' => Streams::source($path), 'video' => $media['video'], 'audio' => $media['audio'],
                    ];
                    $row['started']++;
                }
                $session['last'] = $now;
                $session['bytes'] += $dIn;
                $session['peak_v'] = max($session['peak_v'], $count);
                $session['viewer_s'] += $count * $dt;
                $session['peak_kbps'] = max($session['peak_kbps'], $rate);
                $session['errors'] += $dErr;
                $d['open'][$id] = $session;

                $row['live'] += $dt;
                $weekday = (int) date('N', $now) - 1;
                $hour = (int) date('G', $now);
                $d['heat'][$weekday][$hour] = ($d['heat'][$weekday][$hour] ?? 0) + $dt;
            }
            $row['in'] += $dIn;
            $row['out'] += $dOut;
            $row['errors'] += $dErr;
            $row['viewer_s'] += $count * $dt;
            $viewers += $count;
            $kbps += $rate;
        }
        foreach (array_keys($d['open'] ?? []) as $id) {
            if (!isset($streams[$id])) {
                self::close($d, $id);
            }
        }
        $row['peak_v'] = $viewers;
        $row['peak_kbps'] = $kbps;

        $d['at'] = $now;
        $d['recent'][] = ['t' => $now, 'kbps' => $kbps, 'viewers' => $viewers];
        $d['recent'] = array_slice($d['recent'], -self::KEEP_RECENT);
        self::roll($d, 'hours', $now - $now % 3600, $row, self::KEEP_HOURS);
        self::roll($d, 'days', strtotime('today', $now), $row + ['unique' => count($d['seen'])], self::KEEP_DAYS);
        return $d;
    }

    private static function roll(array &$d, string $key, int $bucket, array $row, int $keep): void
    {
        $rows = $d[$key] ?? [];
        $tail = count($rows) - 1;
        if ($tail >= 0 && $rows[$tail]['t'] === $bucket) {
            foreach (['live', 'in', 'out', 'viewer_s', 'errors', 'started'] as $f) {
                $rows[$tail][$f] += $row[$f];
            }
            foreach (['peak_v', 'peak_kbps', 'unique'] as $f) {
                if (isset($row[$f])) {
                    $rows[$tail][$f] = max($rows[$tail][$f], $row[$f]);
                }
            }
        } else {
            $rows[] = ['t' => $bucket] + $row;
        }
        $d[$key] = array_slice($rows, -$keep);
    }

    private static function close(array &$d, string $id): void
    {
        $s = $d['open'][$id];
        unset($d['open'][$id]);
        $s['end'] = $s['last'];
        unset($s['last']);
        $d['sessions'][] = $s;
        $d['sessions'] = array_slice($d['sessions'], -self::KEEP_SESSIONS);
    }

    public static function report(array $settings): array
    {
        self::sample();
        $d = Store::read('stats');
        $license = License::status();
        $info = Mtx::info();
        $open = array_values($d['open'] ?? []);
        $root = APP_ROOT;
        $dataBytes = 0;
        foreach (glob(Store::path('*')) ?: [] as $file) {
            $dataBytes += is_file($file) ? (int) filesize($file) : 0;
        }
        $counters = Store::read('counters');
        return [
            'now' => time(),
            'collecting_since' => $d['days'][0]['t'] ?? null,
            'recent' => $d['recent'] ?? [],
            'hours' => $d['hours'] ?? [],
            'days' => $d['days'] ?? [],
            'heat' => $d['heat'] ?? [],
            'clients' => $d['clients'] ?? [],
            'sessions' => array_reverse($d['sessions'] ?? []),
            'open' => $open,
            'streams' => array_map(fn($s) => ['id' => $s['id'], 'name' => $s['name'], 'created_at' => $s['created_at'], 'latency' => $s['latency'] ?? 'low'], array_values(Streams::all())),
            'counters' => ['total' => $counters['total'] ?? [], 'days' => $counters['days'] ?? []],
            'server' => [
                'running' => Mtx::running(),
                'mtx_version' => $info['version'] ?? null,
                'mtx_started' => $info['started'] ?? null,
                'load' => function_exists('sys_getloadavg') ? (sys_getloadavg() ?: null) : null,
                'cpus' => self::cpus(),
                'memory' => self::memory(),
                'disk_free' => @disk_free_space($root) ?: null,
                'disk_total' => @disk_total_space($root) ?: null,
                'data_bytes' => $dataBytes,
                'php_version' => PHP_VERSION,
                'app_version' => APP_VERSION,
                'cron_ran_at' => Store::read('maintenance')['ran_at'] ?? null,
                'update_available' => (Updater::state()['update']['version'] ?? null),
            ],
            'license' => [
                'expires_at' => $license['expires_at'] ?? null,
                'activations' => $license['activations'] ?? null,
                'max_activations' => $license['max_activations'] ?? null,
                'checked_at' => $license['checked_at'] ?? null,
            ],
        ];
    }

    private static function cpus(): ?int
    {
        $data = @file_get_contents('/proc/cpuinfo');
        return $data === false ? null : (substr_count($data, "processor\t") ?: null);
    }

    private static function memory(): ?array
    {
        $data = @file_get_contents('/proc/meminfo');
        if ($data === false || !preg_match('/MemTotal:\s+(\d+)/', $data, $t) || !preg_match('/MemAvailable:\s+(\d+)/', $data, $a)) {
            return null;
        }
        return ['total' => (int) $t[1] * 1024, 'available' => (int) $a[1] * 1024];
    }
}
