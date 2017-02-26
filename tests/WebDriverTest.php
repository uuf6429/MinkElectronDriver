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

        $this->driver = new ElectronDriver(true);
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

    public function testOverwritingCookies()
    {
        $this->driver->visit('http://google.com');

        $this->driver->setCookie('test1', 'ccc');
        $this->driver->setCookie('test2', 'bbb');
        $this->driver->setCookie('test1', 'aaa');
        $this->assertSame('aaa', $this->driver->getCookie('test1'));
        $this->assertSame('bbb', $this->driver->getCookie('test2'));
    }

    public function testResettingCookies()
    {
        $this->driver->visit('http://google.com');

        $this->driver->setCookie('test1', 'aaa');
        $this->driver->reset();
        $this->assertSame(null, $this->driver->getCookie('test1'));
    }

    public function testPersistingCookies()
    {
        $this->driver->visit('http://google.com');
        $this->driver->setCookie('test1', 'aaa');

        $this->driver->visit('http://bing.com');
        $this->assertSame(null, $this->driver->getCookie('test1'));

        $this->driver->visit('http://google.com');
        $this->assertSame('aaa', $this->driver->getCookie('test1'));
    }

    public function testResponseCodeAndContent()
    {
        $this->driver->visit('https://httpbin.org/xml');
        $this->assertSame(200, $this->driver->getStatusCode());
        $this->assertContains('Wake up to WonderWidgets!', $this->driver->getContent());

        $this->driver->visit('https://httpbin.org/status/500');
        $this->assertSame(500, $this->driver->getStatusCode());
        $this->assertSame('', $this->driver->getContent());
    }

    public function testScriptExecution()
    {
        $this->driver->visit('https://httpbin.org/status/200');
        $this->assertSame(20, $this->driver->evaluateScript('5 * 4'));
        $this->assertSame(4.6, $this->driver->evaluateScript('2.3 * 2'));
    }
}
