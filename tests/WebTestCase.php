<?php

namespace Behat\Mink\Tests\Driver\Electron;

use Symfony\Component\Process\Process;

abstract class WebTestCase extends DriverTestCase
{
    const BASE_ADDR = 'localhost:8079';
    const BASE_URL = 'http://localhost:8079/';

    /**
     * @var Process
     */
    protected static $server;

    public static function setUpBeforeClass()
    {
        parent::setUpBeforeClass();

        static::$server = new Process(
            sprintf(
                'php -S %s -t %s',
                escapeshellarg(static::BASE_ADDR),
                escapeshellarg(__DIR__ . DIRECTORY_SEPARATOR . 'web')
            )
        );
        static::$server->start();
    }

    public static function tearDownAfterClass()
    {
        if (static::$server && static::$server->isRunning()) {
            static::$server->stop();
        }

        parent::tearDownAfterClass();
    }
}
