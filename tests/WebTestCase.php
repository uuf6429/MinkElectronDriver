<?php

namespace Behat\Mink\Tests\Driver\Electron;

use Symfony\Component\Process\Process;

abstract class WebTestCase extends DriverTestCase
{
    const BASE_URL = 'http://localhost:8079/';

    /**
     * @var Process
     */
    protected static $server;

    public static function setUpBeforeClass()
    {
        parent::setUpBeforeClass();

        static::startServer();
    }

    public static function tearDownAfterClass()
    {
        static::stopServer();

        parent::tearDownAfterClass();
    }

    private static function startServer()
    {
        $cmd = defined('HHVM_VERSION')
            ? 'hhvm -m server -p 8079'
            : 'php -S 0.0.0.0:8079';

        static::$server = new Process(
            (DIRECTORY_SEPARATOR === '/' ? 'exec ' : '') . $cmd,
            __DIR__ . DIRECTORY_SEPARATOR . 'web'
        );
        static::$server->inheritEnvironmentVariables();
        static::$server->setEnv(['TEST_SERVER' => '1']);
        static::$server->start();

        self::waitForServer();
    }

    private static function stopServer()
    {
        if (static::$server && static::$server->isRunning()) {
            static::$server->stop();
        }
    }

    private static function waitForServer()
    {
        $start = time();

        do {
            $headers = @get_headers(static::BASE_URL, true);

            if (isset($headers[0]) && strpos($headers[0], ' 200 ') !== false) {
                return;
            }

            if (!static::$server->isRunning()) {
                self::fail(
                    sprintf(
                        "Built-in server failed to start.\nExit code: %d\nStdout: %s\nStderr: %s",
                        static::$server->getExitCode(),
                        trim(static::$server->getOutput()),
                        trim(static::$server->getErrorOutput())
                    )
                );
            }
        } while (time() - $start <= 60);

        self::stopServer();

        self::fail('Timed out waiting for built-in server to start.');
    }
}
