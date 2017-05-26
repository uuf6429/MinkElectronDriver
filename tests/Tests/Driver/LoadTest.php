<?php

namespace Behat\Mink\Tests\Driver\Electron\Tests\Driver;

use Behat\Mink\Driver\ElectronDriver;
use Behat\Mink\Tests\Driver\Electron\Config;
use Behat\Mink\Tests\Driver\Electron\WebTestCase;
use PHPUnit\Framework\TestCase;

class LoadTest extends TestCase
{
    /**
     * @var ElectronDriver
     */
    protected static $session;

    public static function setUpBeforeClass()
    {
        parent::setUpBeforeClass();

        WebTestCase::setUpBeforeClass();
        self::$session = Config::getInstance()->createDriver();
        self::$session->start();
    }

    public static function tearDownAfterClass()
    {
        WebTestCase::tearDownAfterClass();
        if (self::$session && self::$session->isStarted()) {
            self::$session->stop();
        }

        parent::tearDownAfterClass();
    }

    /*public function testFormPostSessions()
    {
        $sessionCount = 5;
        $iterations = 10;

        $sessions = [];

        for ($i = 0; $i < $sessionCount; $i++) {
            $sessions[] = Config::getInstance()->createDriver();
        }

        for ($i = 0; $i < $iterations; $i++) {
            foreach ($sessions as $session) {
                $session->visit(WebTestCase::BASE_URL . 'form.php');
                $session->setValue('//input[@name="name"]', 'John');
                $session->setValue('//input[@name="surname"]', 'Doe');
                $session->submitForm('//form');

                $this->assertSame(200, $session->getStatusCode());
                $content = htmlspecialchars_decode($session->getContent(), ENT_QUOTES);
                $this->assertContains('\'name\' => \'John\',', $content);
                $this->assertContains('\'surname\' => \'Doe\',', $content);
            }
        }
    }*/

    public function testFormPostWindows()
    {
        $iterations = 10;
        $windows = array_map(
            function ($index) {
                $name = 'window_' . $index;
                self::$session->executeScript("window.open('', '$name');");

                return $name;
            },
            range(0, 5)
        );

        $errors = [];
        $actual = array_fill_keys($windows, '');

        for ($i = 0; $i < $iterations; $i++) {
            foreach ($windows as $window) {
                try {
                    self::$session->switchToWindow($window);

                    self::$session->visit(WebTestCase::BASE_URL . 'form.php');
                    self::$session->setValue('//input[@name="name"]', 'John');
                    self::$session->setValue('//input[@name="surname"]', 'Doe');
                    self::$session->submitForm('//form');

                    $this->assertSame(200, self::$session->getStatusCode());
                    $content = htmlspecialchars_decode(self::$session->getContent(), ENT_QUOTES);
                    $this->assertContains('\'name\' => \'John\',', $content);
                    $this->assertContains('\'surname\' => \'Doe\',', $content);

                    $actual[$window] .= '.';
                } catch (\Exception $ex) {
                    $actual[$window] .= 'F';
                    $errors[] = $ex->getMessage();
                }
            }
        }

        $expected = array_fill_keys($windows, str_repeat('.', $iterations));

        $this->assertEquals($expected, $actual, implode(PHP_EOL, $errors));
    }
}
