<?php
// Stands in for the MediaMTX API and HLS server, following its v1.21 OpenAPI spec.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
header('Content-Type: application/json');
if ($path === '/v3/paths/list') {
    echo json_encode(['items' => [['name' => 'live/' . getenv('LIVE_ID'), 'online' => true, 'onlineTime' => 'x',
        'inboundBytes' => 1000 + time() * 1000, 'outboundBytes' => 500, 'inboundFramesInError' => 2,
        'source' => ['type' => 'rtmpConn', 'id' => 'conn1'],
        'readers' => [['type' => 'hlsSession', 'id' => 'h'], ['type' => 'webRTCSession', 'id' => 'ws1']],
        'tracks2' => [
            ['codec' => 'H264', 'codecProps' => ['width' => 1920, 'height' => 1080, 'profile' => 'High', 'level' => '4.2']],
            ['codec' => 'MPEG-4 Audio', 'codecProps' => ['sampleRate' => 48000, 'channelCount' => 2]],
        ]]]]);
    exit;
}
if ($path === '/v3/rtmp/conns/list') {
    echo json_encode(['items' => [['id' => 'conn1', 'path' => 'live/x']]]);
    exit;
}
if ($path === '/v3/webrtc/sessions/list') {
    echo json_encode(['items' => [
        ['id' => 'ws1', 'path' => 'live/' . getenv('LIVE_ID'), 'state' => 'read'],
        ['id' => 'ws2', 'path' => 'live/x', 'state' => 'publish'],
    ]]);
    exit;
}
if (str_starts_with($path, '/v3/rtmp/conns/kick/') || str_starts_with($path, '/v3/webrtc/sessions/kick/')) {
    file_put_contents(getenv('KICK_FILE'), $path . "\n", FILE_APPEND);
    exit;
}
if (str_starts_with($path, '/v3/info')) {
    echo json_encode(['version' => 'v1.21.3']);
    exit;
}
$sessionId = '11111111-2222-3333-4444-555555555555';
if (preg_match('#^/live/[^/]+/(whip|whep)$#', $path, $m)) {
    if (($_SERVER['HTTP_CONTENT_TYPE'] ?? $_SERVER['CONTENT_TYPE'] ?? '') !== 'application/sdp') {
        http_response_code(415);
        exit;
    }
    http_response_code(201);
    header('Content-Type: application/sdp');
    header('ETag: *');
    header("Location: $path/$sessionId?" . ($_SERVER['QUERY_STRING'] ?? ''));
    echo 'answer:' . file_get_contents('php://input') . ':' . ($_SERVER['QUERY_STRING'] ?? '');
    exit;
}
if (preg_match('#^/live/[^/]+/(whip|whep)/' . $sessionId . '$#', $path)) {
    file_put_contents(getenv('KICK_FILE') . '.rtc', $_SERVER['REQUEST_METHOD'] . ' ' . $path . "\n", FILE_APPEND);
    http_response_code(200);
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
