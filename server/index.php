<?php
declare(strict_types=1);

$html = (string) @file_get_contents(__DIR__ . '/ui/index.html');
header('Content-Type: text/html; charset=utf-8');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
echo str_replace('"./assets/', '"ui/assets/', $html);
