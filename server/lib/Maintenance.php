<?php
declare(strict_types=1);

/** Periodic work, driven by the scheduled task and by dashboard requests. */
final class Maintenance
{
    public static function tick(): void
    {
        $wasUnlocked = License::unlocked();
        License::refreshIfDue();
        Updater::checkIfDue();
        if ($wasUnlocked && !License::unlocked()) {
            Mtx::kick();
        }
    }

    public static function cron(): void
    {
        self::tick();
        // A grace period can also run out without a refresh; running publishers
        // must stop then too, so this is checked on every scheduled run.
        if (!License::unlocked()) {
            Mtx::kick();
        }
        Mtx::writeConfig();
        Mtx::trimLog();
        $error = Mtx::start();
        Store::write('maintenance', ['ran_at' => time(), 'error' => $error]);
        if ($error !== null) {
            fwrite(STDERR, $error . "\n");
        }
    }
}
