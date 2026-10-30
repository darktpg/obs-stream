<?php
declare(strict_types=1);

// MediaMTX asks here for every publish and read attempt: 2xx allows, anything else denies.
require __DIR__ . '/lib/bootstrap.php';

function deny(): never
{
    http_response_code(403);
    exit;
}

if (!hash_equals(Store::settings()['secret'], (string) ($_GET['secret'] ?? ''))) {
    deny();
}
$req = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($req) || !License::unlocked()) {
    deny();
}

$action = (string) ($req['action'] ?? '');
$protocol = (string) ($req['protocol'] ?? '');
$path = (string) ($req['path'] ?? '');

if ($action === 'read' && $protocol === 'hls' && in_array($req['ip'] ?? '', ['127.0.0.1', '::1'], true)) {
    http_response_code(204);
    exit;
}

if ($action === 'publish' && $protocol === 'rtmp' && str_starts_with($path, Mtx::PATH_PREFIX)) {
    parse_str((string) ($req['query'] ?? ''), $query);
    if (Streams::canPublish(substr($path, strlen(Mtx::PATH_PREFIX)), (string) ($query['key'] ?? ''))) {
        http_response_code(204);
        exit;
    }
}

deny();
