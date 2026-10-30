<?php
// Stands in for the MediaMTX API and HLS server, following its v1.21 OpenAPI spec.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
header('Content-Type: application/json');
if ($path === '/v3/paths/list') {
    echo json_encode(['items' => [['name' => 'live/' . getenv('LIVE_ID'), 'online' => true, 'onlineTime' => 'x',
        'inboundBytes' => 1000, 'tracks2' => [['codec' => 'H264'], ['codec' => 'MPEG-4 Audio']]]]]);
    exit;
}
if ($path === '/v3/rtmp/conns/list') {
    echo json_encode(['items' => [['id' => 'conn1', 'path' => 'live/x']]]);
    exit;
}
if (str_starts_with($path, '/v3/rtmp/conns/kick/')) {
    file_put_contents(getenv('KICK_FILE'), $path . "\n", FILE_APPEND);
    exit;
}
if (str_starts_with($path, '/v3/info')) {
    echo json_encode(['version' => 'v1.21.3']);
    exit;
}
if (($_SERVER['HTTP_AUTHORIZATION'] ?? '') === '' ) {
    http_response_code(302);
    header('Location: ' . $path . '?cookieCheck=1');
    exit;
}
if (str_ends_with($path, '/index.m3u8')) {
    header('Content-Type: application/vnd.apple.mpegurl');
    echo "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmain_stream.m3u8?x=1\n";
} elseif (str_ends_with($path, '/main_stream.m3u8')) {
    echo "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:1,\nseg1.mp4\n";
} elseif (str_ends_with($path, '/seg1.mp4')) {
    header('Content-Type: video/mp4');
    echo str_repeat('M', 70000);
} else {
    http_response_code(404);
}
