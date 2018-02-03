<?php

namespace Behat\Mink\Tests\Driver\Electron;

use Behat\Mink\Driver\ElectronDriver;
use Behat\Mink\Exception\UnsupportedDriverActionException;
use PHPUnit\Framework\TestCase;

abstract class DriverTestCase extends TestCase
{
    /**
     * @var ElectronDriver
     */
    protected $driver;

    public function setUp()
    {
        parent::setUp();

        $this->driver = Config::getInstance()->createDriver();
        $this->driver->start();
    }

    /**
     * @throws \Behat\Mink\Exception\DriverException
     */
    public function tearDown()
    {
        if ($this->driver) {
            $this->driver->stop();
        }

        parent::tearDown();
    }

    /**
     * @param \Exception|\Throwable $e
     *
     * @throws \Exception|\Throwable
     */
    public function onNotSuccessfulTest($e)
    {
        if ($e instanceof UnsupportedDriverActionException) {
            $this->markTestSkipped($e);
        }

        parent::onNotSuccessfulTest($e);
    }
}
