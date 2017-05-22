<?php

namespace Behat\Mink\Tests\Driver\Electron\Tests\Driver;

use Behat\Mink\Tests\Driver\Electron\WebTestCase;

class CookieTest extends WebTestCase
{
    public function testOverwritingCookies()
    {
        $this->driver->visit(static::BASE_URL);

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
        $this->driver->visit(static::BASE_URL);

        $this->driver->setCookie('test1', 'aaa');
        $this->driver->reset();
        $this->assertSame(null, $this->driver->getCookie('test1'));
    }

    public function testPersistingCookies()
    {
        $this->driver->visit(static::BASE_URL);
        $this->driver->setCookie('test1', 'aaa');

        $this->driver->visit('http://google.com');
        $this->assertSame(null, $this->driver->getCookie('test1'));

        $this->driver->visit(static::BASE_URL);
        $this->assertSame('aaa', $this->driver->getCookie('test1'));
    }
}
