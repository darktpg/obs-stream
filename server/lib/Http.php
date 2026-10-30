<?php
declare(strict_types=1);

final class Http
{
    /** @return array{status:int, body:string} status 0 means a network error */
    public static function request(string $method, string $url, array $opts = []): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => $opts['follow'] ?? false,
            CURLOPT_CONNECTTIMEOUT => $opts['connect_timeout'] ?? 5,
            CURLOPT_TIMEOUT => $opts['timeout'] ?? 10,
            CURLOPT_HTTPHEADER => $opts['headers'] ?? [],
        ]);
        if (isset($opts['form'])) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($opts['form']));
        }
        $body = curl_exec($ch);
        $status = $body === false ? 0 : (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        return ['status' => $status, 'body' => $body === false ? '' : (string) $body];
    }

    public static function json(mixed $data, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    /** Scheme, host and directory of the current request, without trailing slash. */
    public static function baseUrl(): string
    {
        $https = ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
        $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
        return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir;
    }
}
