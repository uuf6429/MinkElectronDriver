<?php

namespace Behat\Mink\Tests\Driver;

use Behat\Mink\Driver\ElectronDriver;

class ElectronConfig extends AbstractConfig
{
    public static function getInstance()
    {
        return new self();
    }

    /**
     * {@inheritdoc}
     */
    public function createDriver()
    {
        return new ElectronDriver(new FileLogger(__DIR__ . '/../tmp/output.log'), true);
    }

    /**
     * {@inheritdoc}
     */
    protected function supportsCss()
    {
        return true;
    }
}
