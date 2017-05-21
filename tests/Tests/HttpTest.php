<?php

namespace Behat\Mink\Tests\Driver\Electron\Tests;

use Behat\Mink\Tests\Driver\Electron\WebTestCase;

class HttpTest extends WebTestCase
{
    public function testResponseCodeAndContent()
    {
        $this->driver->visit(static::BASE_URL . 'status.php?status=200');
        $this->assertSame(200, $this->driver->getStatusCode());
        $this->assertContains('Status: 200', $this->driver->getContent());

        $this->driver->visit(static::BASE_URL . 'status.php?status=500');
        $this->assertSame(500, $this->driver->getStatusCode());
        $this->assertContains('Status: 500', $this->driver->getContent());
    }

    public function testPostResponse()
    {
        $this->driver->visit(static::BASE_URL . 'form.php');
        $this->driver->setValue('//input[@name="name"]', 'John');
        $this->driver->setValue('//input[@name="surname"]', 'Doe');
        $this->driver->submitForm('//form');

        $this->assertSame(200, $this->driver->getStatusCode());
        $content = htmlspecialchars_decode($this->driver->getContent(), ENT_QUOTES);
        $this->assertContains('\'name\' => \'John\',', $content);
        $this->assertContains('\'surname\' => \'Doe\',', $content);
    }

    public function testCustomRequestHeader()
    {
        $this->driver->setRequestHeader('User-Agent', 'Special Agent 493030398600');
        $this->driver->visit(static::BASE_URL . 'headers.php');
        $this->assertContains('Special Agent 493030398600', $this->driver->getContent());
    }

    public function testCustomResponseHeader()
    {
        $this->driver->visit(static::BASE_URL . 'headers.php?X-Custom-Response=SomeResponseValue');
        $this->assertContains('SomeResponseValue', json_encode($this->driver->getResponseHeaders()));
    }
}
