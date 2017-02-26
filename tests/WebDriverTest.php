<?php

namespace Behat\Mink\Tests\Driver\Custom;

use Behat\Mink\Driver\ElectronDriver;
use Behat\Mink\Exception\UnsupportedDriverActionException;
use PHPUnit\Framework\TestCase;

class WebDriverTest extends TestCase
{
    /**
     * @var ElectronDriver
     */
    protected $driver;

    public function setUp()
    {
        parent::setUp();

        $this->driver = new ElectronDriver();
        $this->driver->start();
    }

    public function tearDown()
    {
        $this->driver->stop();

        if ($this->hasFailed()) {
            echo 'Server Output:' . PHP_EOL . $this->driver->getServerOutput();
        }

        parent::tearDown();
    }

    public function testNavigation()
    {
        $this->driver->visit('http://google.com/');
        $this->assertContains('www.google', $this->driver->getCurrentUrl());

        $this->driver->visit('http://bing.com/');
        $this->assertContains('www.bing', $this->driver->getCurrentUrl());

        $this->driver->back();
        $this->assertContains('www.google', $this->driver->getCurrentUrl());

        $this->driver->forward();
        $this->assertContains('www.bing', $this->driver->getCurrentUrl());
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
