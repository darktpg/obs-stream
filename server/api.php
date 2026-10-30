<?php
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';

Auth::start();

$action = (string) ($_GET['action'] ?? 'state');
$input = json_decode((string) file_get_contents('php://input'), true);
$input = is_array($input) ? $input : [];

function fail(string $message, int $status = 400): never
{
    Http::json(['error' => $message], $status);
}

function ok(array $data = []): never
{
    Http::json(['ok' => true] + $data);
}

function licenseView(): array
{
    $status = License::status();
    return $status + ['portal' => License::PORTAL];
}

function publicState(): array
{
    $authed = Auth::authenticated();
    $license = licenseView();
    return [
        'version' => APP_VERSION,
        'setup_required' => Auth::setupRequired(),
        'authenticated' => $authed,
        'csrf' => $_SESSION['csrf'],
        // Before login only the lock state is revealed.
        'license' => $authed ? $license : ['unlocked' => $license['unlocked']],
    ];
}

if ($action === 'state') {
    if (Auth::authenticated()) {
        // Keep the URL used for the auth callback and the generated links current.
        $base = Http::baseUrl();
        if (Store::settings()['base_url'] !== $base) {
            Store::update('settings', fn(array $s) => ['base_url' => $base] + $s);
            Mtx::writeConfig();
        }
        Maintenance::tick();
    }
    Http::json(publicState());
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('Methode nicht erlaubt.', 405);
}
Auth::checkCsrf();

if ($action === 'setup') {
    if (!Auth::setupRequired()) {
        fail('Das Passwort wurde bereits festgelegt.', 403);
    }
    $password = (string) ($input['password'] ?? '');
    if (strlen($password) < 10) {
        fail('Das Passwort muss mindestens 10 Zeichen lang sein.');
    }
    Auth::setPassword($password);
    Auth::grant();
    Store::update('settings', fn(array $s) => ['base_url' => Http::baseUrl()] + $s);
    Http::json(publicState());
}

if ($action === 'login') {
    $error = Auth::login((string) ($input['password'] ?? ''));
    if ($error !== null) {
        fail($error, 401);
    }
    Http::json(publicState());
}

if (!Auth::authenticated()) {
    fail('Bitte anmelden.', 401);
}

switch ($action) {
    case 'logout':
        $_SESSION = [];
        session_destroy();
        ok();

    case 'password':
        if (!password_verify((string) ($input['current'] ?? ''), Store::read('auth')['hash'] ?? '')) {
            fail('Das aktuelle Passwort ist falsch.');
        }
        if (strlen((string) ($input['password'] ?? '')) < 10) {
            fail('Das Passwort muss mindestens 10 Zeichen lang sein.');
        }
        Auth::setPassword((string) $input['password']);
        ok();

    case 'license.activate':
        $error = License::activate((string) ($input['key'] ?? ''));
        if ($error !== null) {
            fail($error);
        }
        Updater::check();
        Http::json(publicState());

    case 'license.deactivate':
        $error = License::deactivate();
        if ($error !== null) {
            fail($error);
        }
        Mtx::kick();
        Http::json(publicState());

    case 'license.refresh':
        License::refresh();
        Http::json(publicState());
}

// Everything below is licensed functionality.
if (!License::unlocked()) {
    fail('Die Lizenz ist nicht aktiv.', 402);
}

$settings = Store::settings();
$id = (string) ($input['id'] ?? '');

switch ($action) {
    case 'streams':
        $live = Mtx::paths();
        $list = array_map(fn($s) => Streams::present($s, $live, $settings), array_values(Streams::all()));
        Http::json(['streams' => $list, 'server_running' => Mtx::running()]);

    case 'streams.create':
        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 80) {
            fail('Bitte einen Namen mit höchstens 80 Zeichen angeben.');
        }
        Streams::create($name);
        ok();

    case 'streams.rename':
        $name = trim((string) ($input['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 80) {
            fail('Bitte einen Namen mit höchstens 80 Zeichen angeben.');
        }
        Streams::rename($id, $name);
        ok();

    case 'streams.rotate':
        $what = (string) ($input['what'] ?? '');
        Streams::rotate($id, $what === 'publish' ? 'publish' : 'view');
        if ($what === 'publish') {
            Mtx::kick(Mtx::PATH_PREFIX . $id);
        }
        ok();

    case 'streams.delete':
        Streams::delete($id);
        Mtx::kick(Mtx::PATH_PREFIX . $id);
        ok();

    case 'server':
        Http::json([
            'diagnostics' => Mtx::diagnostics(),
            'settings' => array_intersect_key($settings, array_flip(['rtmp_host', 'rtmp_port', 'base_url'])),
            'update' => Updater::state(),
        ]);

    case 'server.start':
        $error = Mtx::start();
        if ($error !== null) {
            fail($error);
        }
        ok();

    case 'server.restart':
        $error = Mtx::restart();
        if ($error !== null) {
            fail($error);
        }
        ok();

    case 'server.settings':
        $host = trim((string) ($input['rtmp_host'] ?? ''));
        $port = (int) ($input['rtmp_port'] ?? 1935);
        if ($host !== '' && !preg_match('/^[A-Za-z0-9.-]+$/', $host)) {
            fail('Der Hostname ist ungültig.');
        }
        if ($port < 1024 || $port > 65535) {
            fail('Der Port muss zwischen 1024 und 65535 liegen.');
        }
        Store::update('settings', fn(array $s) => ['rtmp_host' => $host, 'rtmp_port' => $port] + $s);
        Mtx::writeConfig();
        ok();

    case 'update.check':
        $error = Updater::check();
        if ($error !== null) {
            fail($error);
        }
        Http::json(['update' => Updater::state()]);

    case 'update.install':
        $error = Updater::install();
        if ($error !== null) {
            fail($error);
        }
        ok();
}

fail('Unbekannte Aktion.', 404);
