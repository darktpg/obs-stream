<?php
declare(strict_types=1);

// Verifies a real response of the production License Manager against the embedded public key.
define('APP_ROOT', dirname(__DIR__) . '/server');
require APP_ROOT . '/lib/Store.php';
require APP_ROOT . '/lib/Http.php';
require APP_ROOT . '/lib/License.php';

$sig = [
    'payload' => 'eyJ2IjoxLCJ2YWxpZCI6ZmFsc2UsImNvZGUiOiJpbnZhbGlkX2tleSIsImFjdGlvbiI6InZhbGlkYXRlIiwicHJvamVjdCI6InByal9uNGNqcHEzZzR5eHQybXd3IiwibGljZW5zZV9rZXkiOiJURVNUIiwiaW5zdGFuY2UiOm51bGwsIm5vbmNlIjoiYWJjIiwibGljZW5zZSI6bnVsbCwiaXNzdWVkX2F0IjoxNzkzMzc1NjAyfQ',
    'signature' => 'q5TwKulv9xSGJOL9ex1tMYgCefufRmagfPxVLDXJ1a0Ra4Mo2j7CmP4V2nM19HRnvc73O4VSzaV_6I-Mnvo9AQ',
];
$checks = [
    'genuine response accepted' => (License::verify($sig, 'abc', 'TEST')['code'] ?? '') === 'invalid_key',
    'wrong nonce rejected' => License::verify($sig, 'other', 'TEST') === null,
    'wrong key rejected' => License::verify($sig, 'abc', 'OTHER') === null,
    'altered payload rejected' => License::verify(['payload' => 'a' . $sig['payload']] + $sig, 'abc', 'TEST') === null,
];
foreach ($checks as $name => $ok) {
    echo($ok ? '  ok  ' : 'FAIL  ') . $name . "\n";
}
exit(in_array(false, $checks, true) ? 1 : 0);
