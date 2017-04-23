<?php

namespace Behat\Mink\Tests\Driver\Custom;

use Behat\Mink\Driver\ElectronDriver;
use Behat\Mink\Exception\DriverException;
use Behat\Mink\Exception\UnsupportedDriverActionException;
use Behat\Mink\Tests\Driver\ElectronConfig;
use PHPUnit\Framework\TestCase;

class WebDriverTest extends TestCase
{
    /**
     * @var ElectronConfig
     */
    protected static $config;

    /**
     * @var ElectronDriver
     */
    protected $driver;

    public function setUp()
    {
        parent::setUp();

        $this->driver = ElectronConfig::getInstance()->createDriver();
        $this->driver->start();
    }

    public function tearDown()
    {
        if ($this->driver) {
            $this->driver->stop();
        }

        parent::tearDown();
    }

    public function testNavigation()
    {
        $this->driver->visit('https://bing.com/');
        $this->assertContains('bing.', $this->driver->getCurrentUrl());

        $this->driver->visit('https://httpbin.org/status/200');
        $this->assertContains('httpbin.org/status/200', $this->driver->getCurrentUrl());

        $this->driver->back();
        $this->assertContains('bing.', $this->driver->getCurrentUrl());

        $this->driver->forward();
        $this->assertContains('httpbin.org/status/200', $this->driver->getCurrentUrl());
    }

    public function testDriverHasStarted()
    {
        $this->assertTrue($this->driver->isStarted());
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
        $this->assertNull($this->driver->getContent());
    }

    public function testPostResponse()
    {
        $this->driver->visit('https://httpbin.org/forms/post');
        $this->driver->setValue('//input[@name="custname"]', 'john doe');
        $this->driver->submitForm('//form');

        $this->assertSame(200, $this->driver->getStatusCode());
        $this->assertContains('"custname": "john doe",', $this->driver->getContent());
    }

    /**
     * @param string $expression
     * @param mixed $expectedResult
     * @param \Exception|string|null $expectedException
     *
     * @dataProvider scriptExecutionDataProvider
     */
    public function testScriptExecution($expression, $expectedResult, $expectedException = null)
    {
        if ($expectedException) {
            if (is_string($expectedException)) {
                $this->expectException($expectedException);
            } else {
                $this->expectException(get_class($expectedException));
                $this->expectExceptionMessage($expectedException->getMessage());
            }
        }

        $this->driver->visit('https://httpbin.org/status/200');
        $this->assertSame($expectedResult, $this->driver->evaluateScript($expression));
    }

    public function testCustomRequestHeader()
    {
        $this->driver->setRequestHeader('User-Agent', 'Special Agent 493030398600');
        $this->driver->visit('https://httpbin.org/user-agent');
        $this->assertContains('Special Agent 493030398600', $this->driver->getContent());
    }

    public function testCustomResponseHeader()
    {
        $this->driver->visit('https://httpbin.org/response-headers?X-Custom-Response=SomeResponseValue');
        $this->assertContains('SomeResponseValue', json_encode($this->driver->getResponseHeaders()));
    }

    /**
     * @return array
     */
    public function scriptExecutionDataProvider()
    {
        return [
            'integer calculation' => [
                '$expression' => '5 * 4',
                '$expectedResult' => 20,
                '$expectedException' => null,
            ],
            'float calculation' => [
                '$expression' => '2.3 * 2',
                '$expectedResult' => 4.6,
                '$expectedException' => null,
            ],
            'syntax error' => [
                '$expression' => '*grd',
                '$expectedResult' => null,
                '$expectedException' => new DriverException('Could not evaluate script: Uncaught SyntaxError: Unexpected token *'),
            ],
            'undefined variable' => [
                '$expression' => 'someVar + 1',
                '$expectedResult' => null,
                '$expectedException' => new DriverException('Could not evaluate script: Uncaught ReferenceError: someVar is not defined'),
            ],
        ];
    }

    public function testWindowNameTracking()
    {
        $this->driver->visit('https://httpbin.org/status/200');

        $this->driver->executeScript('window.open("https://httpbin.org/status/200", "popup1")');
        $this->assertContains('popup1', $this->driver->getWindowNames());

        $this->driver->switchToWindow('popup1');
        $this->assertSame('popup1', $this->driver->getWindowName());

        $this->driver->executeScript('window.name = "popup1rev"');
        $this->assertContains('popup1rev', $this->driver->getWindowNames());
        $this->assertSame('popup1rev', $this->driver->getWindowName());
    }

    public function testWindowMaximize()
    {
        $this->driver->visit('https://httpbin.org/status/200');

        $windowOrigHeight = $this->driver->evaluateScript('window.outerHeight');

        try {
            $this->driver->maximizeWindow();
        } catch (UnsupportedDriverActionException $ex) {
            $this->markTestSkipped($ex);
        }
        $this->driver->wait(1000, 'false');

        $screenHeight = $this->driver->evaluateScript('screen.availHeight');
        $windowHeight = $this->driver->evaluateScript('window.outerHeight');

        $this->assertTrue(
            abs($screenHeight - $windowHeight) <= 100,
            "Maximize failed (screen height: $screenHeight, window height: $windowHeight, original: $windowOrigHeight)"
        );
    }
}
