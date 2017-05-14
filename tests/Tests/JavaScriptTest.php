<?php

namespace Behat\Mink\Tests\Driver\Electron\Tests;

use Behat\Mink\Exception\DriverException;
use Behat\Mink\Tests\Driver\Electron\DriverTestCase;

class JavaScriptTest extends DriverTestCase
{
    private static $tmpFile;
    private static $tmpFileUrl;

    public static function setUpBeforeClass()
    {
        parent::setUpBeforeClass();

        self::$tmpFile = tempnam(sys_get_temp_dir(), 'eletmp');
        file_put_contents(self::$tmpFile . '.html', '<!DOCTYPE html><html><head></head><body>blank</body></html>');
        self::$tmpFileUrl = 'file:///' . self::$tmpFile;
    }

    static function tearDownAfterClass()
    {
        unlink(self::$tmpFile);
        unlink(self::$tmpFile . '.html');

        parent::tearDownAfterClass();
    }

    /**
     * @param string $expression
     * @param mixed $expectedResult
     * @param \Exception|string|null $expectedException
     *
     * @dataProvider scriptExecutionDataProvider
     */
    public function testScriptExecution($expression, $expectedResult, $expectedException = null)
    {
        if ($expectedException) {
            if (is_string($expectedException)) {
                $this->expectException($expectedException);
            } else {
                $this->expectException(get_class($expectedException));
                $this->expectExceptionMessage($expectedException->getMessage());
            }
        }

        $this->driver->visit(self::$tmpFileUrl);
        $this->assertSame($expectedResult, $this->driver->evaluateScript($expression));
    }

    /**
     * @return array
     */
    public function scriptExecutionDataProvider()
    {
        return [
            'integer calculation' => [
                '$expression' => '5 * 4',
                '$expectedResult' => 20,
                '$expectedException' => null,
            ],
            'float calculation' => [
                '$expression' => '2.3 * 2',
                '$expectedResult' => 4.6,
                '$expectedException' => null,
            ],
            'syntax error' => [
                '$expression' => '*grd',
                '$expectedResult' => null,
                '$expectedException' => new DriverException('Could not evaluate script: SyntaxError: Unexpected token *'),
            ],
            'undefined variable' => [
                '$expression' => 'someVar + 1',
                '$expectedResult' => null,
                '$expectedException' => new DriverException('Could not evaluate script: ReferenceError: someVar is not defined'),
            ],
        ];
    }
}
