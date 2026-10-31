<?php
declare(strict_types=1);

/**
 * WHIP and WHEP signaling through PHP, so the MediaMTX WebRTC listener stays on localhost
 * and every session passes our own checks. The media itself runs directly over the ICE port.
 */
final class Rtc
{
    private const SESSION = '/^[0-9a-f-]{36}$/';

    public static function whip(string $id, string $key): never
    {
        // The key sits in the URL because Plesk setups often strip Authorization headers.
        if (!Streams::canPublish($id, $key) || !License::unlocked()) {
            Stats::count('publish_denied');
            Http::json(['error' => 'Falscher Streamschlüssel.'], 403);
        }
        $query = 's=' . rawurlencode($id) . '&key=' . rawurlencode($key) . '&f=whip';
        self::proxy($id, 'whip', 'key=' . rawurlencode($key), $query);
    }

    public static function whep(string $id, string $token): never
    {
        self::proxy($id, 'whep', '', 's=' . rawurlencode($id) . '&t=' . rawurlencode($token) . '&f=whep');
    }

    private static function proxy(string $id, string $kind, string $upstreamQuery, string $ownQuery): never
    {
        $settings = Store::settings();
        $base = 'http://127.0.0.1:' . $settings['webrtc_http_port'] . '/' . Mtx::PATH_PREFIX . $id . '/' . $kind;
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $session = (string) ($_GET['session'] ?? '');

        if ($session !== '') {
            if (!preg_match(self::SESSION, $session) || !in_array($method, ['PATCH', 'DELETE'], true)) {
                Http::json(['error' => 'Ungültige Sitzung.'], 400);
            }
            $base .= '/' . $session;
        } elseif ($method === 'OPTIONS') {
            http_response_code(204);
            header('Accept-Post: application/sdp');
            exit;
        } elseif ($method !== 'POST') {
            Http::json(['error' => 'Methode nicht erlaubt.'], 405);
        }

        $headers = [];
        $type = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
        $ch = curl_init($base . ($upstreamQuery !== '' ? '?' . $upstreamQuery : ''));
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_POSTFIELDS => (string) file_get_contents('php://input'),
            CURLOPT_HTTPHEADER => $type !== '' ? ['Content-Type: ' . $type] : [],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$headers): int {
                if (str_contains($line, ':')) {
                    [$name, $value] = explode(':', $line, 2);
                    $headers[strtolower($name)] = trim($value);
                }
                return strlen($line);
            },
        ]);
        $body = curl_exec($ch);
        if ($body === false) {
            Http::json(['error' => 'Der Medienserver antwortet nicht.'], 502);
        }

        http_response_code((int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE));
        header('Cache-Control: no-store');
        foreach (['content-type', 'etag', 'accept-patch', 'link'] as $name) {
            if (isset($headers[$name])) {
                header($name . ': ' . $headers[$name]);
            }
        }
        // MediaMTX answers with its own path; later PATCH and DELETE have to come back here.
        if (isset($headers['location']) && preg_match('#/' . $kind . '/([0-9a-f-]{36})#', $headers['location'], $m)) {
            header('Location: ' . $settings['base_url'] . '/hls.php?' . $ownQuery . '&session=' . $m[1]);
        }
        echo $body;
        exit;
    }
}
