<?php

namespace Behat\Mink\Tests\Driver;

use Behat\Mink\Driver\ElectronDriver;
use Psr\Log\LogLevel;

class ElectronConfig extends AbstractConfig
{
    /**
     * @var ElectronFileLogger
     */
    protected $logger;

    /**
     * @var ElectronConfig
     */
    protected static $instance;

    protected function __construct()
    {
        $this->logger = new ElectronFileLogger(__DIR__ . '/../tmp/output.log', false);
    }

    /**
     * @return ElectronConfig
     */
    public static function getInstance()
    {
        if(!self::$instance){
            self::$instance = new self();
        }

        return self::$instance;
    }

    /**
     * {@inheritdoc}
     */
    public function createDriver()
    {
        return new ElectronDriver($this->logger, false, LogLevel::DEBUG);
    }

    /**
     * {@inheritdoc}
     */
    protected function supportsCss()
    {
        return true;
    }

    /**
     * @return ElectronFileLogger
     */
    public function getLogger()
    {
        return $this->logger;
    }
}
