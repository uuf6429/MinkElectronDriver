<?php

namespace Behat\Mink\Driver\ServiceContainer;

use Psr\Log\LogLevel;
use Behat\Mink\Driver\ElectronDriver;
use Behat\MinkExtension\ServiceContainer\Driver\DriverFactory;
use Symfony\Component\Config\Definition\Builder\ArrayNodeDefinition;
use Symfony\Component\Config\Definition\Exception\InvalidTypeException;
use Symfony\Component\DependencyInjection\Definition;

class ElectronDriverFactory implements DriverFactory
{
    /**
     * @inheritdoc
     */
    public function getDriverName()
    {
        return 'electron';
    }

    /**
     * @inheritdoc
     */
    public function supportsJavascript()
    {
        return true;
    }

    /**
     * @inheritdoc
     */
    public function configure(ArrayNodeDefinition $builder)
    {
        $builder
            ->children()
                ->arrayNode('logger')
                    ->info('A PSR3-compatible logger object definition (or leave empty to disable logging).')
                    ->children()
                        ->arrayNode('arguments')
                            ->info('Array of arguments to pass to constructor or factory method.')
                            ->prototype('scalar')->end()
                        ->end()
                        ->scalarNode('class')
                            ->info('Fully-qualified class name of the logger.')
                            ->cannotBeEmpty()
                        ->end()
                        ->variableNode('factory')
                            ->info('The static method to call for constructing object. Either a string ("class::method") or an array (["class", "method"]) allowed.')
                            ->defaultNull()
                            ->validate()
                                ->always(function ($value) {
                                    if (is_string($value) || is_array($value)) {
                                        return $value;
                                    }
                                    throw new InvalidTypeException();
                                })
                            ->end()
                        ->end()
                        ->scalarNode('file')
                            ->info('File to load before initialising object.')
                            ->defaultNull()
                        ->end()
                        ->arrayNode('properties')
                            ->info('Array of property names and values to overwrite.')
                            ->prototype('scalar')->end()
                        ->end()
                    ->end()
                ->end()
                ->booleanNode('show_electron')
                    ->info('Whether to show Electron windows or not.')
                    ->defaultFalse()
                ->end()
                ->enumNode('log_level')
                    ->info('Minimum logging level (PSR3-compliant), higher is better for performance.')
                    ->defaultValue(LogLevel::WARNING)
                    ->values((new \ReflectionClass(LogLevel::class))->getConstants())
                ->end()
                ->scalarNode('server_address')
                    ->info('Address the server should connect to. Leave empty to determine automatically.')
                    ->defaultNull()
                    ->end()
                ->scalarNode('client_address')
                    ->info('Address the client (driver) should connect to. Leave empty to determine automatically.')
                    ->defaultNull()
                ->end()
                ->booleanNode('auto_start_server')
                    ->info('Disable starting the server automatically. Useful when you want to connect to an existing server.')
                    ->defaultTrue()
                ->end()
            ->end();
    }

    /**
     * @inheritdoc
     */
    public function buildDriver(array $config)
    {
        $logger = null;

        if (!empty($config['logger'])) {
            $logger = (new Definition())
                ->setArguments($config['logger']['arguments'])
                ->setClass($config['logger']['class'])
                ->setFactory($config['logger']['factory'])
                ->setFile($config['logger']['file'])
                ->setProperties($config['logger']['properties']);
        }

        return new Definition(
            ElectronDriver::class,
            [
                $logger,
                $config['show_electron'],
                $config['log_level'],
                $config['server_address'],
                $config['client_address'],
                $config['auto_start_server'],
            ]
        );
    }
}
