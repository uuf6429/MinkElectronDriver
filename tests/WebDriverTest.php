<?php

namespace Behat\Mink\Tests\Driver\Custom;

use Behat\Mink\Driver\NightmareDriver;
use Behat\Mink\Exception\UnsupportedDriverActionException;
use PHPUnit\Framework\TestCase;

class WebDriverTest extends TestCase
{
    /**
     * @var NightmareDriver
     */
    protected $driver;

    public function setUp()
    {
        parent::setUp();

        $this->driver = new NightmareDriver();
        $this->driver->start();
    }

    public function tearDown()
    {
        $this->driver->stop();

        parent::tearDown();
    }

    public function testCanNavigateToGoogle()
    {
        $this->driver->visit('http://google.com/');

        $this->assertContains('google.com', $this->driver->getCurrentUrl());
    }

    public function testDriverHasStarted()
    {
        $this->assertTrue($this->driver->isStarted());
    }

    public function testWindowResizingNotSupported()
    {
        $this->expectException(UnsupportedDriverActionException::class);
        $this->driver->resizeWindow(10, 10);
    }

    public function testWindowMaximizingNotSupported()
    {
        $this->expectException(UnsupportedDriverActionException::class);
        $this->driver->maximizeWindow();
    }
}
