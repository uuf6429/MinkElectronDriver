<?php

namespace Behat\Mink\Tests\Driver\Electron\Tests\ServiceContainer;

use Behat\Behat\Tester\ServiceContainer\TesterExtension;
use Behat\Mink\Driver\ElectronDriver;
use Behat\Mink\Driver\ServiceContainer\ElectronDriverExtension;
use Behat\Mink\Driver\ServiceContainer\ElectronDriverFactory;
use Behat\MinkExtension\ServiceContainer\MinkExtension;
use Behat\Testwork\ServiceContainer\ExtensionManager;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use Symfony\Component\Config\Definition\Builder\ArrayNodeDefinition;
use Symfony\Component\Config\Definition\Exception\InvalidConfigurationException;
use Symfony\Component\Config\Definition\Exception\InvalidTypeException;
use Symfony\Component\Config\Definition\Processor;
use Symfony\Component\DependencyInjection\Compiler\Compiler;
use Symfony\Component\DependencyInjection\ContainerBuilder;

class FactoryTest extends TestCase
{
    /**
     * @param mixed $rawConfig
     * @param string|null $expectedException
     * @param string|null $expectedExceptionMessage
     * @param string|null $expectedExceptionMessageRegExp
     * @dataProvider constructionDataProvider
     */
    public function testConstruction($rawConfig, $expectedException = null, $expectedExceptionMessage = null, $expectedExceptionMessageRegExp = null)
    {
        $factory = new ElectronDriverFactory();

        if (!is_null($expectedException)) {
            $this->expectException($expectedException);
        }
        if (!is_null($expectedExceptionMessage)) {
            $this->expectExceptionMessage($expectedExceptionMessage);
        }
        if (!is_null($expectedExceptionMessageRegExp)) {
            $this->expectExceptionMessageRegExp($expectedExceptionMessageRegExp);
        }

        $configTree = new ArrayNodeDefinition('root');
        $factory->configure($configTree);
        $processor = new Processor();
        $config = $processor->process($configTree->getNode(), ['root' => $rawConfig]);

        $definition = $factory->buildDriver($config);

        $cb = new ContainerBuilder();
        $cb->addDefinitions(['default' => $definition]);
        $driver = $cb->get('default');

        $this->assertInstanceOf(ElectronDriver::class, $driver);
    }

    /**
     * @return array
     */
    public function constructionDataProvider(){
        return [
            'defaults' => [
                '$rawConfig' => [],
                '$expectedException' => null,
                '$expectedExceptionMessage' => null,
                '$expectedExceptionMessageRegExp' => null,
            ],
            'bad config' => [
                '$rawConfig' => ['bad key' => 'bad value'],
                '$expectedException' => InvalidConfigurationException::class,
                '$expectedExceptionMessage' => 'Unrecognized option "bad key" under "root"',
                '$expectedExceptionMessageRegExp' => null,
            ],
            'bad logging level' => [
                '$rawConfig' => ['log_level' => 'api'],
                '$expectedException' => InvalidConfigurationException::class,
                '$expectedExceptionMessage' => null,
                '$expectedExceptionMessageRegExp' => '/The value "api" is not allowed for path "root\\.log_level"\\. Permissible values: .*/',
            ],
        ];
    }
}
