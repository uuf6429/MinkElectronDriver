<?php

namespace Behat\Mink\Tests\Driver\Electron\Tests;

use Behat\Mink\Tests\Driver\Electron\DriverTestCase;

class HttpTest extends DriverTestCase
{
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
}
