<?php
declare(strict_types=1);

/** Updates come exclusively from the License Manager. */
final class Updater
{
    private const CHECK_EVERY = 86400;
    private const RETRY_AFTER = 3600;

    /** Everything the release zip owns; the data directory is never touched. */
    private const ENTRIES = [
        '.htaccess', 'VERSION', 'INSTALL.txt', 'THIRD-PARTY-LICENSES.txt', 'index.php', 'api.php', 'hls.php',
        'watch.php', 'health.php', 'mtx-auth.php', 'cron.php', 'lib', 'bin', 'ui',
    ];
    private const REQUIRED = ['VERSION', 'index.php', 'health.php', 'lib/bootstrap.php'];

    public static function state(): array
    {
        return Store::read('update');
    }

    /** @return string|null German error message, null on success */
    public static function check(): ?string
    {
        $key = License::key();
        if ($key === '') {
            return 'Es ist kein Lizenzcode hinterlegt.';
        }
        Store::update('update', fn(array $d) => ['attempted_at' => time()] + $d);
        $res = License::call('/updates/check', $key, ['current_version' => APP_VERSION]);
        if ($res['payload'] === null) {
            return $res['error'];
        }
        $payload = $res['payload'];
        $code = (string) $payload['code'];
        $available = in_array($code, ['update_available', 'rollback_available'], true) ? ($payload['update'] ?? null) : null;
        Store::write('update', [
            'checked_at' => time(),
            'attempted_at' => time(),
            'code' => $code,
            'update' => $available,
        ]);
        return empty($payload['valid']) && $available === null && $code !== 'up_to_date'
            ? License::message($code)
            : null;
    }

    public static function checkIfDue(): void
    {
        $s = self::state();
        if (time() - ($s['checked_at'] ?? 0) >= self::CHECK_EVERY && time() - ($s['attempted_at'] ?? 0) >= self::RETRY_AFTER) {
            self::check();
        }
    }

    /** @return string|null German error message, null on success */
    public static function install(): ?string
    {
        @set_time_limit(0);
        // Always a fresh, signed answer: download links expire after one hour.
        if (($error = self::check()) !== null) {
            return $error;
        }
        $update = self::state()['update'] ?? null;
        if (!$update) {
            return 'Es ist kein Update verfügbar.';
        }

        $staging = Store::path('staging');
        self::remove($staging);
        mkdir($staging, 0770, true);
        try {
            $zip = $staging . '/update.zip';
            if (($error = self::download($update, $zip)) !== null) {
                return $error;
            }
            $root = $staging . '/files';
            if (($error = self::extract($zip, $root)) !== null) {
                return $error;
            }
            if (trim((string) file_get_contents($root . '/VERSION')) !== ltrim((string) $update['version'], 'v')) {
                return 'Die Versionsnummer im Update passt nicht zur Ankündigung.';
            }
            return self::swap($root, (string) $update['version']);
        } finally {
            self::remove($staging);
        }
    }

    private static function download(array $update, string $target): ?string
    {
        $fh = fopen($target, 'wb');
        $ch = curl_init((string) $update['download_url']);
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fh,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 900,
        ]);
        $ok = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        fclose($fh);
        if (!$ok || $status !== 200) {
            return 'Download fehlgeschlagen (HTTP ' . $status . '). Bitte erneut versuchen.';
        }
        if (isset($update['size']) && filesize($target) !== (int) $update['size']) {
            return 'Die Dateigröße des Updates stimmt nicht.';
        }
        if (!empty($update['sha256']) && !hash_equals(strtolower((string) $update['sha256']), hash_file('sha256', $target))) {
            return 'Die Prüfsumme des Updates stimmt nicht.';
        }
        return null;
    }

    private static function extract(string $zipFile, string &$root): ?string
    {
        $zip = new ZipArchive();
        if ($zip->open($zipFile) !== true) {
            return 'Das Update-Archiv ist beschädigt.';
        }
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = (string) $zip->getNameIndex($i);
            if (str_contains($name, '..') || str_starts_with($name, '/') || str_contains($name, '\\')) {
                $zip->close();
                return 'Das Update-Archiv enthält unzulässige Pfade.';
            }
        }
        $ok = $zip->extractTo($root);
        $zip->close();
        if (!$ok) {
            return 'Das Update konnte nicht entpackt werden.';
        }
        // Tolerate archives wrapped in a single top-level folder.
        $items = array_values(array_diff(scandir($root) ?: [], ['.', '..', '__MACOSX']));
        if (count($items) === 1 && is_dir($root . '/' . $items[0])) {
            $root .= '/' . $items[0];
        }
        foreach (self::REQUIRED as $file) {
            if (!is_file($root . '/' . $file)) {
                return 'Im Update fehlt ' . $file . '.';
            }
        }
        return null;
    }

    private static function swap(string $root, string $version): ?string
    {
        $wasRunning = Mtx::running();
        $backup = Store::path('backup');
        self::remove($backup);
        mkdir($backup, 0770, true);

        $moved = [];
        $restore = function () use (&$moved, $backup): void {
            foreach (self::ENTRIES as $entry) {
                $saved = $backup . '/' . $entry;
                if (file_exists($saved)) {
                    self::remove(APP_ROOT . '/' . $entry);
                    rename($saved, APP_ROOT . '/' . $entry);
                } elseif (in_array($entry, $moved, true)) {
                    // New in this release, nothing to go back to.
                    self::remove(APP_ROOT . '/' . $entry);
                }
            }
            self::resetOpcache();
        };

        foreach (self::ENTRIES as $entry) {
            $target = APP_ROOT . '/' . $entry;
            if ((file_exists($target) && !rename($target, $backup . '/' . $entry))
                || (file_exists($root . '/' . $entry) && !rename($root . '/' . $entry, $target))) {
                $restore();
                return 'Die Dateien konnten nicht ersetzt werden. Die alte Version wurde wiederhergestellt.';
            }
            $moved[] = $entry;
        }
        self::resetOpcache();

        if (!self::healthy(ltrim($version, 'v'))) {
            $restore();
            return 'Die neue Version ist nicht gestartet. Die alte Version wurde wiederhergestellt.';
        }
        if ($wasRunning) {
            if (Mtx::restart() !== null) {
                $restore();
                Mtx::restart();
                return 'Der Medienserver der neuen Version ist nicht gestartet. Die alte Version wurde wiederhergestellt.';
            }
        }
        Store::write('update', ['checked_at' => 0, 'attempted_at' => 0]);
        return null;
    }

    private static function healthy(string $version): bool
    {
        $base = Store::settings()['base_url'];
        for ($i = 0; $i < 5; $i++) {
            $res = Http::request('GET', $base . '/health.php?v=' . time(), ['timeout' => 10]);
            $data = json_decode($res['body'], true);
            if ($res['status'] === 200 && ($data['version'] ?? null) === $version) {
                return true;
            }
            sleep(1);
        }
        return false;
    }

    private static function resetOpcache(): void
    {
        if (function_exists('opcache_reset')) {
            @opcache_reset();
        }
    }

    private static function remove(string $path): void
    {
        if (is_link($path) || is_file($path)) {
            @unlink($path);
            return;
        }
        if (!is_dir($path)) {
            return;
        }
        foreach (array_diff(scandir($path) ?: [], ['.', '..']) as $item) {
            self::remove($path . '/' . $item);
        }
        @rmdir($path);
    }
}
