<?php
declare(strict_types=1);

define('APP_ROOT', dirname(__DIR__));
define('APP_VERSION', trim((string) @file_get_contents(APP_ROOT . '/VERSION')) ?: '0.0.0');

require __DIR__ . '/Store.php';
require __DIR__ . '/Http.php';
require __DIR__ . '/Auth.php';
require __DIR__ . '/License.php';
require __DIR__ . '/Streams.php';
require __DIR__ . '/Mtx.php';
require __DIR__ . '/Updater.php';
require __DIR__ . '/Maintenance.php';
