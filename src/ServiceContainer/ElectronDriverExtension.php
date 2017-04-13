<?php

namespace Behat\Mink\Driver\ServiceContainer;

use Behat\MinkExtension\ServiceContainer\MinkExtension;
use Behat\Testwork\ServiceContainer\Extension;
use Behat\Testwork\ServiceContainer\ExtensionManager;
use Symfony\Component\Config\Definition\Builder\ArrayNodeDefinition;
use Symfony\Component\DependencyInjection\ContainerBuilder;

class ElectronDriverExtension implements Extension
{

    /**
     * @inheritdoc
     */
    public function getConfigKey()
    {
        return 'electron';
    }

    /**
     * @inheritdoc
     */
    public function initialize(ExtensionManager $extensionManager)
    {
        $minkExtension = $extensionManager->getExtension('mink');

        if ($minkExtension && $minkExtension instanceof MinkExtension) {
            $minkExtension->registerDriverFactory(new ElectronDriverFactory());
        }
    }

    /**
     * @inheritdoc
     */
    public function configure(ArrayNodeDefinition $builder)
    {
        // unused
    }

    /**
     * @inheritdoc
     */
    public function process(ContainerBuilder $container)
    {
        // unused
    }

    /**
     * @inheritdoc
     */
    public function load(ContainerBuilder $container, array $config)
    {
        // unused
    }
}
