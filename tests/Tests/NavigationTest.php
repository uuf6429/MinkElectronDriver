<?php

namespace Behat\Mink\Tests\Driver\Electron\Tests;

use Behat\Mink\Tests\Driver\Electron\WebTestCase;

class NavigationTest extends WebTestCase
{
    public function testNavigation()
    {
        $this->driver->visit('https://google.com/');
        $this->assertContains('google.', $this->driver->getCurrentUrl());

        $this->driver->visit(static::BASE_URL);
        $this->assertContains(static::BASE_URL, $this->driver->getCurrentUrl());

        $this->driver->back();
        $this->assertContains('google.', $this->driver->getCurrentUrl());

        $this->driver->forward();
        $this->assertContains(static::BASE_URL, $this->driver->getCurrentUrl());
    }
}
