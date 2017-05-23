<?php

namespace Behat\Mink\Tests\Driver\Electron\Tests\Driver;

use Behat\Mink\Driver\ElectronDriver;
use PHPUnit\Framework\TestCase;

class LifecycleTest extends TestCase
{
    public function testDriverWithDefaultsCanRun()
    {
        $driver = new ElectronDriver();

        $driver->start();
        $this->assertTrue($driver->isStarted());

        $driver->stop();
        $this->assertFalse($driver->isStarted());
    }

    public function testDriverWithDefaultsCanReset()
    {
        $driver = new ElectronDriver();

        $driver->start();
        $this->assertTrue($driver->isStarted());

        $driver->reset();
        $this->assertTrue($driver->isStarted());

        $driver->stop();
        $this->assertFalse($driver->isStarted());
    }

    public function testDriverCanRunInParallel()
    {
        $drivers = [
            new ElectronDriver(),
            new ElectronDriver(),
            new ElectronDriver(),
        ];

        // starts drivers
        array_map(
            function (ElectronDriver $driver) {
                $driver->start();
            },
            $drivers
        );
        // ensure drivers are running
        array_map(
            function (ElectronDriver $driver) {
                $this->assertTrue($driver->isStarted());
            },
            $drivers
        );

        // ensure driver indeed works
        array_map(
            function (ElectronDriver $driver) {
                $this->assertSame(42, $driver->evaluateScript('21 * 2'));
            },
            $drivers
        );

        // stop drivers
        array_map(
            function (ElectronDriver $driver) {
                $driver->stop();
            },
            $drivers
        );
        // ensure drivers have stopped
        array_map(
            function (ElectronDriver $driver) {
                $this->assertFalse($driver->isStarted());
            },
            $drivers
        );
    }
}
