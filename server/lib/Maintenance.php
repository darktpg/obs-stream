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
        // An update restarts with the old code and thus the old config. Waits for a
        // quiet moment, since a restart would cut running broadcasts.
        $idle = !array_filter(Mtx::paths(), fn($p) => !empty($p['online']));
        if (Mtx::running() && Mtx::configStale() && $idle) {
            Mtx::restart();
        }
        $error = Mtx::start();
        Store::write('maintenance', ['ran_at' => time(), 'error' => $error]);
        if ($error !== null) {
            fwrite(STDERR, $error . "\n");
        }
        // The task runs once a minute; statistics want a finer resolution.
        for ($i = 0; $i < 4; $i++) {
            Stats::sample();
            sleep(10);
        }
    }
}
