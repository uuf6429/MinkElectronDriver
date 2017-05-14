<?php

namespace Behat\Mink\Tests\Driver\Electron;

use PHPUnit_Framework_TestSuite as TestSuite;
use PHPUnit_Framework_Test as Test;
use PHPUnit_Framework_Warning as Warning;
use PHPUnit_Framework_AssertionFailedError as AssertionFailedError;
use PHPUnit_Framework_SelfDescribing as SelfDescribing;

class TestListener extends \PHPUnit_Framework_BaseTestListener
{
    /**
     * @inheritdoc
     */
    public function startTestSuite(TestSuite $suite)
    {
        Config::getInstance()->getLogger()->info('PHPUnit Start Suite ' . $suite->getName());
        Config::getInstance()->getLogger()->indent();
    }

    /**
     * @inheritdoc
     */
    public function endTestSuite(TestSuite $suite)
    {
        Config::getInstance()->getLogger()->outdent();
        Config::getInstance()->getLogger()->info('PHPUnit End Suite');
    }

    /**
     * @inheritdoc
     */
    public function startTest(Test $test)
    {
        $name = $test instanceof SelfDescribing ? $test->toString() : '';

        Config::getInstance()->getLogger()->info('PHPUnit Start Test ' . $name);
        Config::getInstance()->getLogger()->indent();
    }

    /**
     * @inheritdoc
     */
    public function endTest(Test $test, $time)
    {
        $name = $test instanceof SelfDescribing ? $test->toString() : '';

        Config::getInstance()->getLogger()->outdent();
        Config::getInstance()->getLogger()->info('PHPUnit End Test ' . $name);
    }

    /**
     * @inheritdoc
     */
    public function addError(Test $test, \Exception $e, $time)
    {
        Config::getInstance()->getLogger()->error('PHPUnit Test Error ' . $e);
    }

    /**
     * @inheritdoc
     */
    public function addWarning(Test $test, Warning $e, $time)
    {
        Config::getInstance()->getLogger()->warning('PHPUnit Test Warning ' . $e->toString());
    }

    /**
     * @inheritdoc
     */
    public function addFailure(Test $test, AssertionFailedError $e, $time)
    {
        Config::getInstance()->getLogger()->error('PHPUnit Test Failure ' . $e->toString());
    }
}
