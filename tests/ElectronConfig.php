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
        return new ElectronDriver();
    }

    /**
     * {@inheritdoc}
     */
    public function skipMessage($testCase, $test)
    {
        if (
            'Behat\Mink\Tests\Driver\Js\WindowTest' === $testCase
            && in_array($test, array('testResizeWindow', 'testWindowMaximize'))
        ) {
            return 'Electron driver does not support window resizing.';
        }

        if (
            'Behat\Mink\Tests\Driver\Js\WindowTest' === $testCase
            && 'testWindowMaximize' === $test
            && 'true' === getenv('TRAVIS')
        ) {
            return 'Electron driver does not support window maximizing.';
        }

        return parent::skipMessage($testCase, $test);
    }

    /**
     * {@inheritdoc}
     */
    protected function supportsCss()
    {
        return true;
    }
}