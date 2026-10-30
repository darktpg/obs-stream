<?php
declare(strict_types=1);

// Standalone player for OBS browser sources. The password is checked by hls.php.
$html = (string) @file_get_contents(__DIR__ . '/ui/watch.html');
header('Content-Type: text/html; charset=utf-8');
header('Referrer-Policy: no-referrer');
echo str_replace('"./assets/', '"ui/assets/', $html);
