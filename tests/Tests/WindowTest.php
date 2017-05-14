<?php

namespace Behat\Mink\Tests\Driver\Electron\Tests;

use Behat\Mink\Tests\Driver\Electron\DriverTestCase;

class WindowTest extends DriverTestCase
{
    public function testWindowNameTracking()
    {
        $this->driver->executeScript('window.open("about:blank;", "popup1")');
        $this->assertContains('popup1', $this->driver->getWindowNames());

        $this->driver->switchToWindow('popup1');
        $this->assertSame('popup1', $this->driver->getWindowName());

        $this->driver->executeScript('window.name = "popup1rev"');
        $this->assertContains('popup1rev', $this->driver->getWindowNames());
        $this->assertSame('popup1rev', $this->driver->getWindowName());
    }

    public function testWindowMaximize()
    {
        $windowOrigHeight = $this->driver->evaluateScript('window.outerHeight');

        $this->driver->maximizeWindow();
        $this->driver->wait(1000, 'false');

        $screenHeight = $this->driver->evaluateScript('screen.availHeight');
        $windowHeight = $this->driver->evaluateScript('window.outerHeight');

        $this->assertTrue(
            abs($screenHeight - $windowHeight) <= 100,
            "Maximize failed (screen height: $screenHeight, window height: $windowHeight, original: $windowOrigHeight)"
        );
    }

    public function testNewWindow()
    {
        $this->assertEquals(['electron_window_1'], $this->driver->getWindowNames());

        $this->assertSame(9, $this->driver->evaluateScript('4 + 5'));

        $this->driver->executeScript('window.open();');
        $this->assertEquals(['electron_window_1', 'electron_window_2'], $this->driver->getWindowNames());

        $this->driver->switchToWindow('electron_window_2');
        $this->assertEquals('electron_window_2', $this->driver->getWindowName());

        $this->driver->visit('about:blank;');
        $this->assertEquals('electron_window_2', $this->driver->getWindowName());

        $this->driver->executeScript('window.close();');
        $this->assertEquals(['electron_window_1'], $this->driver->getWindowNames());
    }
}
