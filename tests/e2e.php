<?php
declare(strict_types=1);

// End-to-end test of the PHP app against fake License Manager and MediaMTX processes.
// Run: php tests/e2e.php

$repo = dirname(__DIR__);
$tmp = sys_get_temp_dir() . '/obs-e2e-' . bin2hex(random_bytes(4));
$app = "$tmp/app";
$ctlFile = "$tmp/ctl.json";
$kickFile = "$tmp/kicks";
mkdir($tmp);
exec('cp -R ' . escapeshellarg("$repo/server") . ' ' . escapeshellarg($app));
exec('rm -rf ' . escapeshellarg($app) . '/data-*');
if (!is_dir("$app/ui")) {
    mkdir("$app/ui");
}
if (!is_dir("$app/bin")) {
    mkdir("$app/bin");
}

$pair = sodium_crypto_sign_keypair();
$public = base64_encode(sodium_crypto_sign_publickey($pair));
$secret = base64_encode(sodium_crypto_sign_secretkey($pair));

$lic = file_get_contents("$app/lib/License.php");
$lic = str_replace('https://www.darktpg.de/licence/api/v1', 'http://127.0.0.1:18101', $lic);
$lic = preg_replace("/PUBLIC_KEY = '[^']+'/", "PUBLIC_KEY = '$public'", $lic);
file_put_contents("$app/lib/License.php", $lic);

$ctl = fn(array $c) => file_put_contents($ctlFile, json_encode($c));
$ctl([]);

$procs = [];
function serve(array &$procs, int $port, string $dir, ?string $router, array $env): void
{
    $cmd = [PHP_BINARY, '-S', "127.0.0.1:$port", '-t', $dir];
    if ($router) {
        $cmd[] = $router;
    }
    $procs[] = proc_open($cmd, [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $dir, $env + getenv());
}
$liveId = 'abc';
serve($procs, 18100, $app, null, ['PHP_CLI_SERVER_WORKERS' => '4']);
serve($procs, 18101, $tmp, "$repo/tests/fixtures/fake-license.php", ['CTL_FILE' => $ctlFile, 'SECRET_KEY' => $secret]);
function startMtx(array &$procs, string $repo, string $tmp, string $kick, string $live): void
{
    foreach ([19997, 18888, 18889] as $port) {
        serve($procs, $port, $tmp, "$repo/tests/fixtures/fake-mtx.php", ['LIVE_ID' => $live, 'KICK_FILE' => $kick]);
    }
}
register_shutdown_function(function () use (&$procs, $tmp) {
    foreach ($procs as $p) {
        proc_terminate($p);
    }
    // PHP_CLI_SERVER_WORKERS forks children that outlive their parent.
    exec("pkill -f 'php -S 127.0.0.1:(18100|18101|19997|18888|18889)'");
    exec('rm -rf ' . escapeshellarg($tmp));
});
usleep(600000);

$fails = 0;
function t(string $name, bool $ok): void
{
    global $fails;
    echo($ok ? "  ok  " : "FAIL  ") . $name . "\n";
    $fails += $ok ? 0 : 1;
}

$jar = "$tmp/cookies";
$csrf = '';
function rtc(string $method, string $path, string $body = ''): array
{
    $headers = [];
    $ch = curl_init('http://127.0.0.1:18100/' . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/sdp'],
        CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$headers) {
            if (str_contains($line, ':')) {
                [$k, $v] = explode(':', $line, 2);
                $headers[strtolower($k)] = trim($v);
            }
            return strlen($line);
        },
    ]);
    $raw = (string) curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'body' => $raw, 'headers' => $headers];
}
function req(string $path, ?array $body = null, array $headers = []): array
{
    global $jar, $csrf;
    $ch = curl_init('http://127.0.0.1:18100/' . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_TIMEOUT => 30]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        $headers[] = 'X-CSRF-Token: ' . $csrf;
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $raw = (string) curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'body' => $raw, 'json' => json_decode($raw, true)];
}
function api(string $action, array $body = []): array
{
    return req('api.php?action=' . $action, $body);
}
function auth(string $action, string $path, string $query, string $protocol = 'rtmp', string $ip = '1.2.3.4', ?string $secret = null): int
{
    global $settings;
    $ch = curl_init('http://127.0.0.1:18100/mtx-auth.php?secret=' . ($secret ?? settings()['secret']));
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_POSTFIELDS => json_encode(compact('action', 'path', 'query', 'protocol', 'ip'))]);
    curl_exec($ch);
    return (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
}
function settings(): array
{
    global $app;
    return json_decode(file_get_contents(glob("$app/data-*")[0] . '/settings.json'), true);
}

// Setup
$s = req('api.php?action=state')['json'];
$csrf = $s['csrf'];
t('fresh install requires setup', $s['setup_required'] === true);
t('stream list refused before login', api('streams')['status'] === 401);
t('short password refused', api('setup', ['password' => 'short'])['status'] === 400);
$r = api('setup', ['password' => 'correct-horse']);
t('setup logs in', $r['json']['authenticated'] === true);
$csrf = $r['json']['csrf'];
t('second setup refused', api('setup', ['password' => 'hijacked-pass'])['status'] === 403);
$keep = $csrf;
$csrf = 'wrong';
t('csrf enforced', api('streams')['status'] === 403);
$csrf = $keep;

// Locked without license
t('locked without a key', $r['json']['license']['unlocked'] === false);
t('streams refused while locked', api('streams')['status'] === 402);

// Bad signatures must not unlock
$ctl(['bad_nonce' => 'replayed']);
t('wrong nonce refused', api('license.activate', ['key' => 'AAAA-BBBB'])['status'] === 400);
$ctl(['valid' => false, 'code' => 'activation_limit_reached']);
$r = api('license.activate', ['key' => 'AAAA-BBBB']);
t('activation limit shown', str_contains((string) $r['json']['error'], 'Aktivierungslimit'));

// Activate
$ctl([]);
$r = api('license.activate', ['key' => 'aaaa-bbbb']);
t('activation unlocks', ($r['json']['license']['unlocked'] ?? false) === true);
t('portal link present', str_contains((string) ($r['json']['license']['portal'] ?? ''), '/portal'));

// Streams
api('streams.create', ['name' => 'Kamera']);
$st = api('streams')['json']['streams'][0];
$id = $st['id'];
$publishKey = substr($st['stream_key'], strpos($st['stream_key'], '=') + 1);
t('rtmp server url', str_ends_with($st['rtmp_server'], ':1935/live'));
t('offline while server down', $st['online'] === false);

// Publish permission
$path = "live/$id";
t('publish ok with key', auth('publish', $path, "key=$publishKey") === 204);
t('publish denied with wrong key', auth('publish', $path, 'key=nope') === 403);
t('publish denied without key', auth('publish', $path, '') === 403);
t('publish denied on unknown path', auth('publish', 'live/none', "key=$publishKey") === 403);
t('external rtmp read denied', auth('read', $path, "key=$publishKey") === 403);
t('external hls read denied', auth('read', $path, '', 'hls') === 403);
t('local hls read allowed', auth('read', $path, '', 'hls', '127.0.0.1') === 204);
t('wrong callback secret denied', auth('publish', $path, "key=$publishKey", 'rtmp', '1.2.3.4', 'x') === 403);

// Playback
startMtx($procs, $repo, $tmp, $kickFile, $id);
usleep(500000);
$pw = $st['view_password'];
t('hls refused with wrong password', req("hls.php?s=$id&t=wrong&f=index.m3u8")['status'] === 403);
$r = req("hls.php?s=$id&t=$pw&f=index.m3u8");
t('master playlist proxied', $r['status'] === 200);
t('playlist rewritten through php', str_contains($r['body'], "hls.php?s=$id&t=$pw&f=main_stream.m3u8"));
t('upstream query dropped', !str_contains($r['body'], 'x=1'));
$r = req("hls.php?s=$id&t=$pw&f=main_stream.m3u8");
t('init segment uri rewritten', str_contains($r['body'], "URI=\"hls.php?s=$id&t=$pw&f=init.mp4\""));
t('segment url ends in .mp4', preg_match('/f=seg1\.mp4$/m', $r['body']) === 1);
$r = req("hls.php?s=$id&t=$pw&f=seg1.mp4");
t('segment streamed intact', $r['status'] === 200 && strlen($r['body']) === 70000);
t('path traversal refused', req("hls.php?s=$id&t=$pw&f=" . urlencode('../x.mp4'))['status'] === 400);
$r = req("hls.php?s=$id&t=$pw&m=1&f=index.m3u8");
t('monitor flag survives the playlist rewrite', str_contains($r['body'], '&m=1&f=main_stream.m3u8'));
$st = api('streams')['json']['streams'][0];
t('live state shown', $st['online'] === true && $st['tracks'] === ['H264', 'MPEG-4 Audio']);
t('viewer counted, webrtc readers included', $st['viewers'] === 2 && $st['viewers_rtc'] === 1);
t('media details', $st['media']['video']['height'] === 1080 && $st['media']['audio']['channels'] === 2 && $st['source'] === 'RTMP');
t('aac stream is not instant ready', $st['instant_ready'] === false);

// WebRTC signaling
$r = rtc('POST', "hls.php?s=$id&t=wrong&f=whep", 'offer');
t('whep refused with wrong password', $r['status'] === 403);
$r = rtc('POST', "hls.php?s=$id&t=$pw&f=whep", 'offer');
t('whep answered through php', $r['status'] === 201 && str_starts_with($r['body'], 'answer:offer'));
t('whep session url stays on hls.php', str_contains($r['headers']['location'] ?? '', "/hls.php?s=$id&t=$pw&f=whep&session=11111111-"));
$session = rtc('DELETE', substr($r['headers']['location'], strlen('http://127.0.0.1:18100/')));
t('whep session can be closed', $session['status'] === 200 && str_contains((string) @file_get_contents("$kickFile.rtc"), 'DELETE /live/'));
t('bad session id refused', rtc('DELETE', "hls.php?s=$id&t=$pw&f=whep&session=../../x")['status'] === 400);
t('whip refused with wrong key', rtc('POST', "hls.php?s=$id&key=nope&f=whip", 'offer')['status'] === 403);
$r = rtc('POST', "hls.php?s=$id&key=$publishKey&f=whip", 'offer');
t('whip passes the key on for mtx-auth', $r['status'] === 201 && str_ends_with($r['body'], "key=$publishKey"));
t('webrtc publish allowed with key', auth('publish', $path, "key=$publishKey", 'webrtc', '127.0.0.1') === 204);
t('webrtc publish denied without key', auth('publish', $path, '', 'webrtc', '127.0.0.1') === 403);
t('external webrtc read denied', auth('read', $path, '', 'webrtc') === 403);
t('local webrtc read allowed', auth('read', $path, '', 'webrtc', '127.0.0.1') === 204);

// Playback settings
t('unknown latency refused', api('streams.configure', ['id' => $id, 'latency' => 'x', 'idle_color' => ''])['status'] === 400);
t('bad color refused', api('streams.configure', ['id' => $id, 'latency' => 'low', 'idle_color' => 'red;'])['status'] === 400);
api('streams.configure', ['id' => $id, 'latency' => 'instant', 'idle_color' => '#00ff00']);
$r = req("hls.php?s=$id&t=$pw&f=status")['json'];
t('status carries playback settings', $r['latency'] === 'instant' && $r['idle_color'] === '#00ff00' && $r['instant_ready'] === false);

// Statistics
$statsFile = glob("$app/data-*")[0] . '/stats.json';
$rewind = function () use ($statsFile) {
    $d = json_decode(file_get_contents($statsFile), true);
    $d['at'] -= 30;
    foreach ($d['open'] ?? [] as $k => $o) {
        $d['open'][$k]['last'] -= 30;
    }
    file_put_contents($statsFile, json_encode($d));
};
api('streams');
$rewind();
$rep = api('stats')['json'];
t('broadcast tracked', count($rep['open']) === 1 && $rep['open'][0]['video']['height'] === 1080 && $rep['open'][0]['source'] === 'RTMP');
t('bytes and bitrate sampled', $rep['open'][0]['bytes'] > 0 && $rep['open'][0]['peak_kbps'] > 0);
t('rollups written', count($rep['hours']) === 1 && count($rep['days']) === 1 && $rep['days'][0]['live'] > 0 && $rep['days'][0]['viewer_s'] > 0);
t('heat and clients filled', count($rep['heat']) === 1 && $rep['clients']['webrtc'] > 0);
t('denied viewer counted', req("hls.php?s=$id&t=wrong&f=status")['status'] === 403 && api('stats')['json']['counters']['total']['view_denied'] === 1);
$viewerFile = glob(glob("$app/data-*")[0] . "/viewers/$id/*")[0];
touch($viewerFile, time() - 3600);
req("hls.php?s=$id&t=$pw&f=main_stream.m3u8");
t('media playlist polling keeps viewer alive', api('streams')['json']['streams'][0]['viewers'] === 2);

// Keys
api('streams.rotate', ['id' => $id, 'what' => 'publish']);
t('rotated key invalidates old', auth('publish', $path, "key=$publishKey") === 403);
$rotated = api('streams')['json']['streams'][0]['stream_key'];
$currentKey = substr($rotated, strpos($rotated, '=') + 1);
t('rotated key works', auth('publish', $path, "key=$currentKey") === 204);
t('rotate leaves other streams connected', !is_file($kickFile));
api('streams.rotate', ['id' => $id, 'what' => 'view']);
t('rotating the password cuts webrtc viewers', str_contains((string) @file_get_contents($kickFile), 'webrtc/sessions/kick/ws1'));
$pw = api('streams')['json']['streams'][0]['view_password'];

// Grace period and lock
$data = glob("$app/data-*")[0];
$patch = function (array $fields) use ($data) {
    $l = json_decode(file_get_contents("$data/license.json"), true);
    file_put_contents("$data/license.json", json_encode($fields + $l));
};
$ctl(['down' => true]);
$patch(['checked_at' => time() - 86400 * 3, 'attempted_at' => 0]);
$r = req('api.php?action=state')['json'];
t('server down: grace keeps working', $r['license']['unlocked'] === true && $r['license']['grace'] === true);
$patch(['checked_at' => time() - 86400 * 8, 'attempted_at' => 0]);
$r = req('api.php?action=state')['json'];
t('grace over after 7 days', $r['license']['unlocked'] === false && $r['license']['code'] === 'grace_expired');
t('hls locked', req("hls.php?s=$id&t=$pw&f=index.m3u8")['status'] === 403);
t('publish locked', auth('publish', $path, "key=$currentKey") === 403);
$ctl([]);
$patch(['attempted_at' => 0]);
$r = req('api.php?action=state')['json'];
t('recovers when the server answers again', $r['license']['unlocked'] === true);

// Revocation locks and kicks
@unlink($kickFile);
$ctl(['valid' => false, 'code' => 'license_revoked']);
$patch(['checked_at' => time() - 86400, 'attempted_at' => 0]);
$r = req('api.php?action=state')['json'];
t('revoked license locks', $r['license']['unlocked'] === false && $r['license']['code'] === 'license_revoked');
t('lock kicks publishers and webrtc', str_contains((string) @file_get_contents($kickFile), 'conn1') && str_contains((string) @file_get_contents($kickFile), 'ws2'));
$ctl([]);
$r = api('license.activate', ['key' => 'AAAA-BBBB']);
t('re-entering the key unlocks', $r['json']['license']['unlocked'] === true);

// Tampered cache
$l = json_decode(file_get_contents("$data/license.json"), true);
$good = $l['signature'];
$l['signature']['payload'] = 'x' . $l['signature']['payload'];
file_put_contents("$data/license.json", json_encode($l));
$r = req('api.php?action=state')['json'];
t('tampered cache locks', $r['license']['unlocked'] === false);
$l['signature'] = $good;
file_put_contents("$data/license.json", json_encode($l));

// Updates
function buildZip(string $app, string $tmp, string $version, bool $broken): string
{
    $src = "$tmp/rel-$version";
    exec('cp -R ' . escapeshellarg($app) . ' ' . escapeshellarg($src));
    exec('rm -rf ' . escapeshellarg($src) . '/data-*');
    file_put_contents("$src/VERSION", "$version\n");
    if ($broken) {
        file_put_contents("$src/health.php", "<?php this is broken");
    }
    $zipFile = "$tmp/$version.zip";
    $zip = new ZipArchive();
    $zip->open($zipFile, ZipArchive::CREATE);
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        $zip->addFile($f->getPathname(), substr($f->getPathname(), strlen($src) + 1));
    }
    $zip->close();
    return $zipFile;
}
$offer = function (string $zip, string $version, ?string $sha = null) use ($ctl) {
    $ctl(['zip' => $zip, 'update_code' => 'update_available', 'update' => [
        'version' => $version, 'changelog' => 'neu', 'size' => filesize($zip),
        'sha256' => $sha ?? hash_file('sha256', $zip), 'download_url' => 'http://127.0.0.1:18101/download',
    ]]);
};
$r = api('update.check');
t('up to date', ($r['json']['update']['update'] ?? null) === null);

$current = trim(file_get_contents("$app/VERSION"));
$bad = buildZip($app, $tmp, '1.0.2', true);
$offer($bad, '1.0.2');
$r = api('update.install');
t('failing update reports rollback', str_contains((string) ($r['json']['error'] ?? ''), 'wiederhergestellt'));
t('rollback restored version', trim(file_get_contents("$app/VERSION")) === $current);
t('app works after rollback', req('health.php')['json']['version'] === $current);

$good = buildZip($app, $tmp, '1.0.1', false);
$offer($good, '1.0.1', str_repeat('0', 64));
$r = api('update.install');
t('sha256 mismatch refused', str_contains((string) ($r['json']['error'] ?? ''), 'Prüfsumme'));

$offer($good, '1.0.1');
$r = api('update.check');
t('update offered with changelog', $r['json']['update']['update']['changelog'] === 'neu');
$r = api('update.install');
t('update installs', ($r['json']['ok'] ?? false) === true);
t('new version live', req('health.php')['json']['version'] === '1.0.1');
t('data survives update', count(glob("$app/data-*/streams.json")) === 1);

// Deactivate
$ctl([]);
$r = api('license.deactivate');
t('removing the key locks', $r['json']['license']['unlocked'] === false && $r['json']['license']['code'] === 'no_key');

// Config changed behind a running server, as after an update
$dataDir = glob("$app/data-*")[0];
file_put_contents("$dataDir/mediamtx.yml", 'x');
file_put_contents("$dataDir/mediamtx.pid", '0');
$stale = function () use ($app) {
    $code = 'require ' . var_export("$app/lib/bootstrap.php", true) . '; echo Mtx::configStale() ? "yes" : "no";';
    return shell_exec(escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg($code));
};
touch("$dataDir/mediamtx.yml", 2000);
touch("$dataDir/mediamtx.pid", 2000);
t('fresh start is not stale', $stale() === 'no');
touch("$dataDir/mediamtx.yml", 3000);
t('newer config is stale', $stale() === 'yes');
unlink("$dataDir/mediamtx.pid");
t('stopped server is not stale', $stale() === 'no');

echo $fails ? "\n$fails failed\n" : "\nall passed\n";
exit($fails ? 1 : 0);
