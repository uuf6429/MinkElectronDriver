<?php

namespace Behat\Mink\Tests\Driver;

use PHPUnit_Framework_TestSuite as TestSuite;
use PHPUnit_Framework_Test as Test;
use PHPUnit_Framework_Warning as Warning;
use PHPUnit_Framework_AssertionFailedError as AssertionFailedError;
use PHPUnit_Framework_SelfDescribing as SelfDescribing;

class ElectronTestListener extends \PHPUnit_Framework_BaseTestListener
{
    /**
     * @inheritdoc
     */
    public function startTestSuite(TestSuite $suite)
    {
        ElectronConfig::getInstance()->getLogger()->info('PHPUnit Start Suite ' . $suite->getName());
        ElectronConfig::getInstance()->getLogger()->indent();
    }

    /**
     * @inheritdoc
     */
    public function endTestSuite(TestSuite $suite)
    {
        ElectronConfig::getInstance()->getLogger()->outdent();
        ElectronConfig::getInstance()->getLogger()->info('PHPUnit End Suite');
    }

    /**
     * @inheritdoc
     */
    public function startTest(Test $test)
    {
        $name = $test instanceof SelfDescribing ? $test->toString() : '';

        ElectronConfig::getInstance()->getLogger()->info('PHPUnit Start Test ' . $name);
        ElectronConfig::getInstance()->getLogger()->indent();
    }

    /**
     * @inheritdoc
     */
    public function endTest(Test $test, $time)
    {
        $name = $test instanceof SelfDescribing ? $test->toString() : '';

        ElectronConfig::getInstance()->getLogger()->outdent();
        ElectronConfig::getInstance()->getLogger()->info('PHPUnit End Test ' . $name);
    }

    /**
     * @inheritdoc
     */
    public function addError(Test $test, \Exception $e, $time)
    {
        ElectronConfig::getInstance()->getLogger()->error('PHPUnit Test Error ' . $e);
    }

    /**
     * @inheritdoc
     */
    public function addWarning(Test $test, Warning $e, $time)
    {
        ElectronConfig::getInstance()->getLogger()->warning('PHPUnit Test Warning ' . $e->toString());
    }

    /**
     * @inheritdoc
     */
    public function addFailure(Test $test, AssertionFailedError $e, $time)
    {
        ElectronConfig::getInstance()->getLogger()->error('PHPUnit Test Failure ' . $e->toString());
    }
}
