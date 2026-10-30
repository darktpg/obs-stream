<?php
// Fake License Manager: signs answers with the test key, behaviour comes from a control file.
$ctl = json_decode((string) file_get_contents(getenv('CTL_FILE')), true);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/download') {
    readfile($ctl['zip']);
    exit;
}
if (!empty($ctl['down'])) {
    http_response_code(503);
    exit;
}
$action = basename($path);
$valid = $ctl['valid'] ?? true;
$code = $ctl['code'] ?? ($action === 'activate' ? 'activated' : ($action === 'deactivate' ? 'deactivated' : 'valid'));
$payload = [
    'v' => 1, 'valid' => $valid, 'code' => $code, 'action' => $action, 'project' => 'prj_n4cjpq3g4yxt2mww',
    'license_key' => $_POST['license_key'], 'instance' => $_POST['instance'], 'nonce' => $ctl['bad_nonce'] ?? $_POST['nonce'],
    'license' => $valid ? ['status' => 'active', 'expires_at' => $ctl['expires_at'] ?? null, 'max_activations' => 2, 'activations' => 1, 'features' => [], 'customer_name' => 'Test'] : null,
    'issued_at' => time(),
];
if ($action === 'check') {
    $payload['current_version'] = $_POST['current_version'];
    $payload['update'] = $ctl['update'] ?? null;
    $payload['code'] = $ctl['update_code'] ?? 'up_to_date';
}
$raw = rtrim(strtr(base64_encode(json_encode($payload)), '+/', '-_'), '=');
$sig = sodium_crypto_sign_detached($raw, base64_decode(getenv('SECRET_KEY')));
header('Content-Type: application/json');
echo json_encode(['valid' => true, 'signature' => [
    'algorithm' => 'Ed25519', 'payload' => $raw, 'signature' => rtrim(strtr(base64_encode($sig), '+/', '-_'), '='),
]]);
