<?php
declare(strict_types=1);

// Plesk scheduled task, every minute: keeps MediaMTX alive, renews the license check, looks for updates.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/lib/bootstrap.php';

Maintenance::cron();
