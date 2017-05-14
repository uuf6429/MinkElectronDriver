<?php

namespace Behat\Mink\Tests\Driver\Electron\Tests;

use Behat\Mink\Tests\Driver\Electron\DriverTestCase;

class NavigationTest extends DriverTestCase
{
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
}
