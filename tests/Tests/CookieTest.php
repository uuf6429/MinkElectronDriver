<?php

namespace Behat\Mink\Tests\Driver\Electron\Tests;

use Behat\Mink\Tests\Driver\Electron\DriverTestCase;

class CookieTest extends DriverTestCase
{
    public function testOverwritingCookies()
    {
        $this->driver->visit('http://google.com');

        $this->driver->setCookie('test1', 'ccc');
        $this->driver->setCookie('test2', 'bbb');
        $this->driver->setCookie('test1', 'aaa');
        $this->assertSame('aaa', $this->driver->getCookie('test1'));
        $this->assertSame('bbb', $this->driver->getCookie('test2'));

        $expected = [
            'test1' => 'aaa',
            'test2' => 'bbb',
        ];
        $cookies = array_column(
            array_filter(
                $this->driver->getCookies(),
                function ($cookie) use ($expected) {
                    return array_key_exists($cookie['name'], $expected);
                }
            ),
            'value',
            'name'
        );

        $this->assertEquals($expected, $cookies);
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
}
