<?php
declare(strict_types=1);

final class License
{
    public const API = 'https://www.darktpg.de/licence/api/v1';
    public const PROJECT = 'prj_n4cjpq3g4yxt2mww';
    public const PUBLIC_KEY = 'upeyA+M5xq/o3CoSVntUr+hqa/9vmuZOkvTOyAJRM7g=';
    public const PORTAL = 'https://www.darktpg.de/licence/portal';

    private const REVALIDATE_AFTER = 43200; // 12 h
    private const RETRY_AFTER = 3600;
    private const GRACE = 604800; // 7 days

    private const MESSAGES = [
        'invalid_key' => 'Der Lizenzcode ist ungültig.',
        'license_not_found' => 'Dieser Lizenzcode wurde nicht gefunden.',
        'project_mismatch' => 'Dieser Lizenzcode gilt nicht für OBS Server.',
        'license_expired' => 'Die Lizenz ist abgelaufen.',
        'license_suspended' => 'Die Lizenz wurde gesperrt.',
        'license_revoked' => 'Die Lizenz wurde widerrufen.',
        'activation_limit_reached' => 'Das Aktivierungslimit dieser Lizenz ist erreicht. Gib im Kundenportal ein Gerät frei.',
        'instance_required' => 'Die Instanz-ID fehlt in der Anfrage.',
        'not_activated' => 'Diese Installation ist nicht aktiviert. Bitte den Lizenzcode erneut eingeben.',
        'grace_expired' => 'Der Lizenzserver war länger als 7 Tage nicht erreichbar.',
        'no_key' => 'Es ist kein Lizenzcode hinterlegt.',
        'tampered' => 'Die gespeicherten Lizenzdaten sind ungültig. Bitte den Lizenzcode erneut eingeben.',
    ];

    private static ?array $status = null;

    public static function normalize(string $key): string
    {
        return strtoupper(str_replace('-', '', trim($key)));
    }

    public static function base64urlDecode(string $s): string|false
    {
        return base64_decode(strtr($s, '-_', '+/'), true);
    }

    /**
     * Checks signature, project, nonce and key. Returns the signed payload,
     * the only data that may be trusted, or null.
     */
    public static function verify(array $signature, string $nonce, string $key): ?array
    {
        $raw = $signature['payload'] ?? null;
        $sig = self::base64urlDecode((string) ($signature['signature'] ?? ''));
        if (!is_string($raw) || $sig === false || strlen($sig) !== SODIUM_CRYPTO_SIGN_BYTES) {
            return null;
        }
        if (!sodium_crypto_sign_verify_detached($sig, $raw, base64_decode(self::PUBLIC_KEY))) {
            return null;
        }
        $payload = json_decode((string) self::base64urlDecode($raw), true);
        if (!is_array($payload)
            || ($payload['project'] ?? null) !== self::PROJECT
            || !hash_equals($nonce, (string) ($payload['nonce'] ?? ''))
            || self::normalize((string) ($payload['license_key'] ?? '')) !== self::normalize($key)) {
            return null;
        }
        return $payload;
    }

    /**
     * @return array{transient:bool, error:?string, payload:?array, signature:?array, nonce:string}
     */
    public static function call(string $path, string $key, array $extra = []): array
    {
        $settings = Store::settings();
        $nonce = bin2hex(random_bytes(16));
        $res = Http::request('POST', self::API . $path, [
            'form' => [
                'license_key' => $key,
                'project' => self::PROJECT,
                'instance' => $settings['instance_id'],
                'instance_label' => parse_url($settings['base_url'], PHP_URL_HOST) ?: 'OBS Server',
                'nonce' => $nonce,
            ] + $extra,
        ]);
        $out = ['transient' => false, 'error' => null, 'payload' => null, 'signature' => null, 'nonce' => $nonce];
        if ($res['status'] === 0 || $res['status'] === 429 || $res['status'] >= 500) {
            return ['transient' => true, 'error' => 'Der Lizenzserver ist nicht erreichbar.'] + $out;
        }
        if ($res['status'] !== 200) {
            return ['error' => 'Der Lizenzserver hat die Anfrage abgelehnt.'] + $out;
        }
        $signature = json_decode($res['body'], true)['signature'] ?? null;
        $payload = is_array($signature) ? self::verify($signature, $nonce, $key) : null;
        if ($payload === null) {
            return ['error' => 'Die Antwort des Lizenzservers ist nicht korrekt signiert.'] + $out;
        }
        return ['payload' => $payload, 'signature' => $signature] + $out;
    }

    private static function remember(string $key, array $res): void
    {
        Store::write('license', [
            'key' => $key,
            'signature' => $res['signature'],
            'nonce' => $res['nonce'],
            'checked_at' => time(),
            'attempted_at' => time(),
        ]);
        self::$status = null;
    }

    /** @return string|null German error message, null on success */
    public static function activate(string $key): ?string
    {
        $key = trim($key);
        if ($key === '') {
            return self::MESSAGES['no_key'];
        }
        $res = self::call('/licenses/activate', $key);
        if ($res['payload'] === null) {
            return $res['error'];
        }
        if (empty($res['payload']['valid'])) {
            return self::message((string) $res['payload']['code']);
        }
        self::remember($key, $res);
        return null;
    }

    /** @return string|null German error message, null on success */
    public static function deactivate(): ?string
    {
        $key = (string) (Store::read('license')['key'] ?? '');
        if ($key === '') {
            return null;
        }
        $res = self::call('/licenses/deactivate', $key);
        if ($res['payload'] === null) {
            return $res['error'] . ' Der Aktivierungsplatz wurde nicht freigegeben, der Code bleibt gespeichert.';
        }
        Store::write('license', []);
        self::$status = null;
        return null;
    }

    public static function refresh(): void
    {
        $state = Store::read('license');
        if (empty($state['key'])) {
            return;
        }
        $res = self::call('/licenses/validate', $state['key']);
        if ($res['payload'] !== null) {
            self::remember($state['key'], $res);
            return;
        }
        // Keep the last verified result; the grace period decides from here.
        $state['attempted_at'] = time();
        Store::write('license', $state);
        self::$status = null;
    }

    public static function refreshIfDue(): void
    {
        $state = Store::read('license');
        $now = time();
        if (!empty($state['key'])
            && $now - ($state['checked_at'] ?? 0) >= self::REVALIDATE_AFTER
            && $now - ($state['attempted_at'] ?? 0) >= self::RETRY_AFTER) {
            self::refresh();
        }
    }

    public static function message(string $code): string
    {
        return self::MESSAGES[$code] ?? 'Die Lizenz ist nicht gültig (' . $code . ').';
    }

    public static function key(): string
    {
        return (string) (Store::read('license')['key'] ?? '');
    }

    public static function status(): array
    {
        if (self::$status !== null) {
            return self::$status;
        }
        $state = Store::read('license');
        $locked = fn(string $code) => ['unlocked' => false, 'code' => $code, 'message' => self::message($code)];

        if (empty($state['key'])) {
            return self::$status = $locked('no_key');
        }
        $payload = is_array($state['signature'] ?? null)
            ? self::verify($state['signature'], (string) ($state['nonce'] ?? ''), $state['key'])
            : null;
        if ($payload === null) {
            return self::$status = $locked('tampered');
        }

        $license = is_array($payload['license'] ?? null) ? $payload['license'] : [];
        $expires = $license['expires_at'] ?? null;
        $details = [
            'key_masked' => substr($state['key'], 0, 4) . '…' . substr($state['key'], -4),
            'customer' => $license['customer_name'] ?? null,
            'expires_at' => $expires,
            'features' => $license['features'] ?? [],
            'activations' => $license['activations'] ?? null,
            'max_activations' => $license['max_activations'] ?? null,
            'checked_at' => $state['checked_at'] ?? null,
        ];
        $age = time() - (int) ($state['checked_at'] ?? 0);

        if (empty($payload['valid'])) {
            return self::$status = $locked((string) $payload['code']) + $details;
        }
        if ($age > self::GRACE) {
            return self::$status = $locked('grace_expired') + $details;
        }
        if ($expires && ($ts = is_numeric($expires) ? (int) $expires : strtotime((string) $expires)) && $ts < time()) {
            return self::$status = $locked('license_expired') + $details;
        }
        return self::$status = [
            'unlocked' => true,
            'code' => (string) $payload['code'],
            'message' => '',
            'grace' => $age > self::REVALIDATE_AFTER + self::RETRY_AFTER,
        ] + $details;
    }

    public static function unlocked(): bool
    {
        return self::status()['unlocked'];
    }
}
