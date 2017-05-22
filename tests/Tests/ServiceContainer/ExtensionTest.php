<?php

namespace Behat\Mink\Tests\Driver\Electron\Tests\ServiceContainer;

use Behat\Behat\Tester\ServiceContainer\TesterExtension;
use Behat\Mink\Driver\ServiceContainer\ElectronDriverExtension;
use Behat\MinkExtension\ServiceContainer\MinkExtension;
use Behat\Testwork\ServiceContainer\ExtensionManager;
use PHPUnit\Framework\TestCase;

class ExtensionTest extends TestCase
{
    public function testConfigKey()
    {
        $ext = new ElectronDriverExtension();

        $this->assertSame('electron', $ext->getConfigKey());
    }

    public function testRegisteringFactory()
    {
        $electronExt = new ElectronDriverExtension();

        $minkExt = $this->getMockBuilder(MinkExtension::class)
            ->disableOriginalConstructor()
            ->setMethods(['registerDriverFactory'])
            ->getMock();
        $minkExt->expects($this->once())
            ->method('registerDriverFactory');

        $otherExt = $this->getMockBuilder(TesterExtension::class)
            ->disableOriginalConstructor()
            ->setMethods(['registerDriverFactory'])
            ->getMock();
        $otherExt->expects($this->never())
            ->method('registerDriverFactory');

        $electronExt->initialize(new ExtensionManager([$minkExt, $otherExt]));
    }
}
