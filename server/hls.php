<?php
declare(strict_types=1);

// Password-checking pass-through to the MediaMTX HLS server, which only listens on localhost.
require __DIR__ . '/lib/bootstrap.php';

$id = (string) ($_GET['s'] ?? '');
$token = (string) ($_GET['t'] ?? '');
$file = (string) ($_GET['f'] ?? 'index.m3u8');

if (!Streams::canView($id, $token)) {
    Http::json(['error' => 'Falsches Passwort.'], 403);
}
if (!License::unlocked()) {
    Http::json(['error' => 'Die Lizenz ist nicht aktiv.'], 403);
}

$upstream = '/' . Mtx::PATH_PREFIX . $id . '/';
if ($file === 'status') {
    $path = Mtx::paths()[Mtx::PATH_PREFIX . $id] ?? [];
    Http::json(['online' => !empty($path['online']), 'name' => Streams::find($id)['name']]);
}
if (!preg_match('/^[A-Za-z0-9_.-]+\.(m3u8|mp4)$/', $file)) {
    Http::json(['error' => 'Ungültige Datei.'], 400);
}

$settings = Store::settings();
$url = 'http://127.0.0.1:' . $settings['hls_port'] . $upstream . $file;
$auth = ['Authorization: Bearer ' . $settings['secret']];

if (str_ends_with($file, '.m3u8')) {
    // Players fetch index.m3u8 once and then keep polling the media playlist.
    Streams::touchViewer($id, ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . ($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $res = Http::request('GET', $url, ['headers' => $auth, 'timeout' => 8]);
    if ($res['status'] !== 200) {
        http_response_code($res['status'] === 404 ? 404 : 502);
        exit;
    }
    $link = fn(string $name) => 'hls.php?s=' . rawurlencode($id) . '&t=' . rawurlencode($token)
        . '&f=' . rawurlencode(strtok($name, '?'));
    $out = [];
    foreach (preg_split('/\r?\n/', $res['body']) as $line) {
        if ($line !== '' && $line[0] !== '#') {
            $line = $link($line);
        } elseif (str_contains($line, 'URI="')) {
            $line = preg_replace_callback('/URI="([^"]+)"/', fn($m) => 'URI="' . $link($m[1]) . '"', $line);
        }
        $out[] = $line;
    }
    header('Content-Type: application/vnd.apple.mpegurl');
    header('Cache-Control: no-store');
    echo implode("\n", $out);
    exit;
}

// Segments are streamed instead of buffered to keep memory flat.
@ini_set('zlib.output_compression', '0');
while (ob_get_level() > 0) {
    ob_end_clean();
}
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_HTTPHEADER => $auth,
    CURLOPT_CONNECTTIMEOUT => 2,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_HEADERFUNCTION => function ($ch, string $header): int {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', $header, $m)) {
            http_response_code((int) $m[1]);
        } elseif (preg_match('/^(Content-Length|Content-Type):/i', $header)) {
            header(trim($header));
        }
        return strlen($header);
    },
    CURLOPT_WRITEFUNCTION => function ($ch, string $chunk): int {
        echo $chunk;
        flush();
        return strlen($chunk);
    },
]);
header('Cache-Control: private, max-age=30');
if (!curl_exec($ch) && !headers_sent()) {
    http_response_code(502);
}
