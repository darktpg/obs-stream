<?php
declare(strict_types=1);

// Probed by the updater: loading every class proves the new version actually runs.
require __DIR__ . '/lib/bootstrap.php';

Store::settings();
Http::json(['ok' => true, 'version' => APP_VERSION]);
