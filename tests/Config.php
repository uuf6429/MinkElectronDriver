<?php

namespace Behat\Mink\Tests\Driver\Electron;

use Behat\Mink\Driver\ElectronDriver;
use Behat\Mink\Tests\Driver\AbstractConfig;
use Psr\Log\LogLevel;

class Config extends AbstractConfig
{
    /**
     * @var FileLogger
     */
    protected $logger;

    /**
     * @var Config
     */
    protected static $instance;

    protected function __construct()
    {
        $this->logger = new FileLogger(__DIR__ . '/../tmp/electron.log', false);
    }

    /**
     * @return Config
     */
    public static function getInstance()
    {
        if (!self::$instance) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    /**
     * {@inheritdoc}
     */
    public function createDriver()
    {
        return new ElectronDriver($this->logger, false, getenv('ELECTRON_LOG') ?: LogLevel::DEBUG);
    }

    /**
     * {@inheritdoc}
     */
    protected function supportsCss()
    {
        return true;
    }

    /**
     * @return FileLogger
     */
    public function getLogger()
    {
        return $this->logger;
    }
}
