<?php

namespace Behat\Mink\Driver;

use Behat\Mink\Element\NodeElement;
use Behat\Mink\Exception\DriverException;
use Behat\Mink\Exception\UnsupportedDriverActionException;
use Behat\Mink\Session;
use DnodeSyncClient\Connection;
use DnodeSyncClient\IOException;
use Symfony\Component\Process\Process;
use DnodeSyncClient\Dnode;

class ElectronDriver extends CoreDriver
{
    /**
     * @var Session
     */
    protected $session;

    /**
     * @var Process
     */
    protected $electronProcess;

    /**
     * @var string
     */
    protected $electronClientAddress = 'localhost:6666';

    /**
     * @var string
     */
    protected $electronServerAddress = '0.0.0.0:6666';

    /**
     * @var Connection
     */
    protected $dnodeClient;

    /**
     * @var string
     */
    protected $serverOutput = '';

    /**
     * @var bool
     */
    protected $debug;

    /**
     * @param bool $debug
     */
    public function __construct($debug = false)
    {
        $this->debug = $debug;
    }

    /**
     * {@inheritdoc}
     */
    public function setSession(Session $session)
    {
        $this->session = $session;
    }

    /**
     * @inheritdoc
     */
    public function start()
    {
        try {
            $this->serverOutput = '';
            // TODO add more config options (eg; node path, env vars, args, etc)
            $this->electronProcess = new Process($this->buildServerCmd(), dirname(__DIR__));
            $this->electronProcess->setTimeout(null);

            if (!$this->debug) {
                $this->electronProcess->disableOutput();
            }

            $this->electronProcess->start(function ($type, $output) {
                $this->serverOutput .= strtoupper($type) . '> ' . $output;
            });

            $address = [];
            if (!preg_match('/(.*):(\d+)/', $this->electronClientAddress, $address)) {
                throw new DriverException('Could not parse the supplied address, expected "host:port".');
            }

            $maxTries = 10;
            for ($currTry = 1; $currTry <= $maxTries; $currTry++) {
                if (!$this->electronProcess->isRunning()) {
                    throw new DriverException(
                        sprintf(
                            "Electron server process quit unexpectedly.\nExit Code: %d\nOutput: %s",
                            $this->electronProcess->getExitCode(),
                            $this->debug ? $this->getServerOutput() : 'None; debug disabled.'
                        )
                    );
                }

                try {
                    $this->dnodeClient = (new Dnode())->connect($address[1], $address[2]);
                    break;
                } catch (IOException $ex) {
                    if ($currTry == $maxTries) {
                        $exitCode = $this->electronProcess->stop();
                        throw new DriverException(
                            sprintf(
                                "Gave up connecting to electron server after %d tries.\nExit Code: %d\nOutput: %s",
                                $currTry,
                                $exitCode,
                                $this->debug ? $this->getServerOutput() : 'None; debug disabled.'
                            ), 0, $ex
                        );
                    }
                    usleep(500000);
                }
            }
        } catch (\Exception $ex) {
            throw new DriverException('Error while starting: ' . $ex->getMessage(), $ex->getCode(), $ex);
        }
    }

    /**
     * @inheritdoc
     */
    public function isStarted()
    {
        return $this->electronProcess
            && $this->electronProcess->isStarted()
            /*&& !$this->dnodeClient->isClosed()*/
        ;
    }

    /**
     * @inheritdoc
     */
    public function stop()
    {
        try {
            @$this->dnodeClient->close();
            $this->electronProcess->stop();
        } catch (\Exception $ex) {
            throw new DriverException('Error while stopping: ' . $ex->getMessage(), $ex->getCode(), $ex);
        }
    }

    /**
     * @inheritdoc
     */
    public function reset()
    {
        $this->sendAndWaitWithoutResult('reset');
    }

    /**
     * @inheritdoc
     */
    public function visit($url)
    {
        $this->sendAndWaitWithoutResult('visit', [$url]);
        $this->waitForVisited();
    }

    /**
     * @inheritdoc
     */
    public function getCurrentUrl()
    {
        return $this->sendAndWaitWithResult('getCurrentUrl');
    }

    /**
     * @inheritdoc
     */
    public function reload()
    {
        $this->sendAndWaitWithoutResult('reload');
        $this->waitForVisited();
    }

    /**
     * @inheritdoc
     */
    public function forward()
    {
        $this->sendAndWaitWithoutResult('forward');
        $this->waitForVisited();
    }

    /**
     * @inheritdoc
     */
    public function back()
    {
        $this->sendAndWaitWithoutResult('back');
        $this->waitForVisited();
    }

    /**
     * @inheritdoc
     */
    public function setBasicAuth($user, $password)
    {
        $this->sendAndWaitWithoutResult('setBasicAuth', [$user ?: false, $password]);
    }

    /**
     * @inheritdoc
     */
    public function switchToWindow($name = null)
    {
        $this->sendAndWaitWithoutResult('switchToWindow', [$name]);
    }

    /**
     * Switches to specific iFrame.
     *
     * @param string $name iframe name (null for switching back)
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function switchToIFrame($name = null)
    {
        // TODO: Implement switchToIFrame() method.
    }

    /**
     * @inheritdoc
     */
    public function setRequestHeader($name, $value)
    {
        $this->sendAndWaitWithoutResult('setRequestHeader', [$name, $value]);
    }

    /**
     * @inheritdoc
     */
    public function getResponseHeaders()
    {
        return (array)$this->sendAndWaitWithResult('getResponseHeaders');
    }

    /**
     * @inheritdoc
     */
    public function setCookie($name, $value = null)
    {
        $this->sendAndWaitWithoutResult('setCookie', [$name, $value]);
        $result = $this->waitForCookieResponse();

        if (!array_key_exists('set', $result) || !empty($result['error']) || !$result['set']) {
            throw new DriverException(
                sprintf(
                    'Cookie "%s" could not be set. Response: %s',
                    $name,
                    json_encode($result)
                )
            );
        }
    }

    /**
     * @inheritdoc
     */
    public function getCookie($name)
    {
        $this->sendAndWaitWithoutResult('getCookie', [$name]);
        $result = $this->waitForCookieResponse();

        if (!array_key_exists('get', $result) || !empty($result['error'])) {
            throw new DriverException(
                sprintf(
                    'Cookie "%s" could not be get. Response: %s',
                    $name,
                    json_encode($result)
                )
            );
        }

        return $result['get'];
    }

    /**
     * @inheritdoc
     */
    public function getStatusCode()
    {
        return $this->sendAndWaitWithResult('getStatusCode');
    }

    /**
     * @inheritdoc
     */
    public function getContent()
    {
        $started = $this->sendAndWaitWithResult('getContent');

        if (!$started) {
            throw new DriverException('Could not start saving page content.');
        }

        $result = $this->waitForGetContentResponse();

        if (isset($result['error'])) {
            throw new DriverException('Could saving page content: ' . $result['error']);
        }

        return $result['content'];
    }

    /**
     * Capture a screenshot of the current window.
     *
     * @return string screenshot of MIME type image/* depending
     *                on driver (e.g., image/png, image/jpeg)
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function getScreenshot()
    {
        // TODO: Implement getScreenshot() method.
    }

    /**
     * @inheritdoc
     */
    public function getWindowNames()
    {
        return $this->sendAndWaitWithResult('getWindowNames');
    }

    /**
     * @inheritdoc
     */
    public function getWindowName()
    {
        return $this->sendAndWaitWithResult('getWindowName');
    }

    /**
     * Finds elements with specified XPath query.
     *
     * @param string $xpath
     *
     * @return NodeElement[]
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function find($xpath)
    {
        $matchingXPaths = []; // TODO get from server

        return array_map(
            function ($xpath) {
                return new NodeElement($xpath, $this->session);
            },
            $matchingXPaths
        );
    }

    /**
     * Returns element's tag name by it's XPath query.
     *
     * @param string $xpath
     *
     * @return string
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function getTagName($xpath)
    {
        // TODO: Implement getTagName() method.
    }

    /**
     * Returns element's text by it's XPath query.
     *
     * @param string $xpath
     *
     * @return string
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function getText($xpath)
    {
        // TODO: Implement getText() method.
    }

    /**
     * Returns element's inner html by it's XPath query.
     *
     * @param string $xpath
     *
     * @return string
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function getHtml($xpath)
    {
        return $this->evaluateScriptWithArgs(
            'document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.innerHTML',
            ['path' => $xpath]
        );
    }

    /**
     * Returns element's outer html by it's XPath query.
     *
     * @param string $xpath
     *
     * @return string
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function getOuterHtml($xpath)
    {
        return $this->evaluateScriptWithArgs(
            'document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.outerHTML',
            ['path' => $xpath]
        );
    }

    /**
     * Returns element's attribute by it's XPath query.
     *
     * @param string $xpath
     * @param string $name
     *
     * @return string|null
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function getAttribute($xpath, $name)
    {
        return $this->evaluateScriptWithArgs(
            'document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.getAttribute(name)',
            ['path' => $xpath, 'name' => $name]
        );
    }

    /**
     * Returns element's value by it's XPath query.
     *
     * @param string $xpath
     *
     * @return string|bool|array
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     *
     * @see \Behat\Mink\Element\NodeElement::getValue
     */
    public function getValue($xpath)
    {
        // TODO: Implement getValue() method.
    }

    /**
     * Sets element's value by it's XPath query.
     *
     * @param string $xpath
     * @param string|bool|array $value
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     *
     * @see \Behat\Mink\Element\NodeElement::setValue
     */
    public function setValue($xpath, $value)
    {
        // TODO: Implement setValue() method.
    }

    /**
     * Checks checkbox by it's XPath query.
     *
     * @param string $xpath
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     *
     * @see \Behat\Mink\Element\NodeElement::check
     */
    public function check($xpath)
    {
        // TODO: Implement check() method.
    }

    /**
     * Unchecks checkbox by it's XPath query.
     *
     * @param string $xpath
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     *
     * @see \Behat\Mink\Element\NodeElement::uncheck
     */
    public function uncheck($xpath)
    {
        // TODO: Implement uncheck() method.
    }

    /**
     * Checks whether checkbox or radio button located by it's XPath query is checked.
     *
     * @param string $xpath
     *
     * @return Boolean
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     *
     * @see \Behat\Mink\Element\NodeElement::isChecked
     */
    public function isChecked($xpath)
    {
        // TODO: Implement isChecked() method.
    }

    /**
     * Selects option from select field or value in radio group located by it's XPath query.
     *
     * @param string $xpath
     * @param string $value
     * @param Boolean $multiple
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     *
     * @see \Behat\Mink\Element\NodeElement::selectOption
     */
    public function selectOption($xpath, $value, $multiple = false)
    {
        // TODO: Implement selectOption() method.
    }

    /**
     * Checks whether select option, located by it's XPath query, is selected.
     *
     * @param string $xpath
     *
     * @return Boolean
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     *
     * @see \Behat\Mink\Element\NodeElement::isSelected
     */
    public function isSelected($xpath)
    {
        // TODO: Implement isSelected() method.
    }

    /**
     * Clicks button or link located by it's XPath query.
     *
     * @param string $xpath
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function click($xpath)
    {
        // TODO: Implement click() method.
    }

    /**
     * Double-clicks button or link located by it's XPath query.
     *
     * @param string $xpath
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function doubleClick($xpath)
    {
        // TODO: Implement doubleClick() method.
    }

    /**
     * Right-clicks button or link located by it's XPath query.
     *
     * @param string $xpath
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function rightClick($xpath)
    {
        // TODO: Implement rightClick() method.
    }

    /**
     * Attaches file path to file field located by it's XPath query.
     *
     * @param string $xpath
     * @param string $path
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     *
     * @see \Behat\Mink\Element\NodeElement::attachFile
     */
    public function attachFile($xpath, $path)
    {
        // TODO: Implement attachFile() method.
    }

    /**
     * Checks whether element visible located by it's XPath query.
     *
     * @param string $xpath
     *
     * @return Boolean
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function isVisible($xpath)
    {
        // TODO: Implement isVisible() method.
    }

    /**
     * Simulates a mouse over on the element.
     *
     * @param string $xpath
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function mouseOver($xpath)
    {
        // TODO: Implement mouseOver() method.
    }

    /**
     * Brings focus to element.
     *
     * @param string $xpath
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function focus($xpath)
    {
        // TODO: Implement focus() method.
    }

    /**
     * Removes focus from element.
     *
     * @param string $xpath
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function blur($xpath)
    {
        // TODO: Implement blur() method.
    }

    /**
     * Presses specific keyboard key.
     *
     * @param string $xpath
     * @param string|int $char could be either char ('b') or char-code (98)
     * @param string $modifier keyboard modifier (could be 'ctrl', 'alt', 'shift' or 'meta')
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function keyPress($xpath, $char, $modifier = null)
    {
        // TODO: Implement keyPress() method.
    }

    /**
     * Pressed down specific keyboard key.
     *
     * @param string $xpath
     * @param string|int $char could be either char ('b') or char-code (98)
     * @param string $modifier keyboard modifier (could be 'ctrl', 'alt', 'shift' or 'meta')
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function keyDown($xpath, $char, $modifier = null)
    {
        // TODO: Implement keyDown() method.
    }

    /**
     * Pressed up specific keyboard key.
     *
     * @param string $xpath
     * @param string|int $char could be either char ('b') or char-code (98)
     * @param string $modifier keyboard modifier (could be 'ctrl', 'alt', 'shift' or 'meta')
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function keyUp($xpath, $char, $modifier = null)
    {
        // TODO: Implement keyUp() method.
    }

    /**
     * Drag one element onto another.
     *
     * @param string $sourceXpath
     * @param string $destinationXpath
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     */
    public function dragTo($sourceXpath, $destinationXpath)
    {
        // TODO: Implement dragTo() method.
    }

    /**
     * @inheritdoc
     */
    public function executeScript($script)
    {
        $this->evaluateScript($script); // ignoring expression result ain't so hard
    }

    /**
     * @inheritdoc
     */
    public function evaluateScript($script)
    {
        $this->sendAndWaitWithoutResult('evaluateScript', [$script]);

        $result = $this->waitForEvaluateScriptResponse();

        if (isset($result['error'])) {
            throw new DriverException('Could not evaluate script: ' . $result['error']);
        }

        return $result['result'];
    }

    /**
     * @inheritdoc
     */
    public function wait($timeout, $condition)
    {
        $start = microtime(true);
        $end = $start + ($timeout / 1000);

        do {
            $result = $this->evaluateScript($condition);
            usleep(1000);
        } while (microtime(true) < $end && !$result);

        return (bool)$result;
    }

    /**
     * Submits the form.
     *
     * @param string $xpath Xpath.
     *
     * @throws UnsupportedDriverActionException When operation not supported by the driver
     * @throws DriverException                  When the operation cannot be done
     *
     * @see \Behat\Mink\Element\NodeElement::submitForm
     */
    public function submitForm($xpath)
    {
        // TODO: Implement submitForm() method.
    }

    /**
     * @return string
     */
    protected function buildServerCmd()
    {
        // TODO Probably we can just do "ElectronServer <socket>" thanks to npm "bin" option... not sure though
        return sprintf(
            '%s %s %s%s',
            escapeshellarg(__DIR__ . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . 'node_modules' . DIRECTORY_SEPARATOR . '.bin' . DIRECTORY_SEPARATOR . 'electron'),
            escapeshellarg(__DIR__ . DIRECTORY_SEPARATOR . 'ElectronServer.js'),
            escapeshellarg($this->electronServerAddress),
            $this->debug ? ' debug' : ''
        );
    }

    /**
     * @param string $mtd
     * @param array $args
     * @return mixed
     * @throws DriverException
     */
    protected function sendAndWaitWithResult($mtd, $args = [])
    {
        $result = $this->dnodeClient->call($mtd, $args);

        if (count($result) !== 1) {
            throw new DriverException(
                sprintf(
                    "Unexpected response from server; expected one result, not %d.\nMethod: %s\nArguments: %s\nResponse: %s",
                    count($result),
                    $mtd,
                    var_export($args, true),
                    var_export($result, true)
                )
            );
        }

        return $result[0];
    }

    /**
     * @param string $mtd
     * @param array $args
     * @throws DriverException
     */
    protected function sendAndWaitWithoutResult($mtd, $args = [])
    {
        $result = $this->dnodeClient->call($mtd, $args);

        if (count($result) !== 0) {
            throw new DriverException(
                sprintf(
                    "Unexpected response from server; no result was not expected.\nMethod: %s\nArguments: %s\nResponse: %s",
                    count($result),
                    $mtd,
                    var_export($args, true),
                    var_export($result, true)
                )
            );
        }
    }

    /**
     * @return string
     */
    public function getServerOutput()
    {
        return $this->serverOutput;
    }

    protected function waitForVisited()
    {
        while (!$this->sendAndWaitWithResult('visited')) {
            usleep(50000);
        }
    }

    /**
     * @return array
     */
    protected function waitForCookieResponse()
    {
        while (($result = $this->sendAndWaitWithResult('getCookieResponse')) === null) {
            usleep(1000);
        }

        return $result;
    }

    /**
     * @return array
     */
    protected function waitForGetContentResponse()
    {
        while (($result = $this->sendAndWaitWithResult('getContentResponse')) === null) {
            usleep(1000);
        }

        return $result;
    }

    /**
     * @return array
     */
    protected function waitForEvaluateScriptResponse()
    {
        while (($result = $this->sendAndWaitWithResult('getEvaluateScriptResponse')) === null) {
            usleep(500);
        }

        return $result;
    }

    /**
     * @param string $script
     * @param array <string, mixed> $args
     * @return mixed
     * @example $driver->evaluateScriptWithArgs('a * b', ['a' => 5, 'b' => 6])
     */
    protected function evaluateScriptWithArgs($script, $args)
    {
        return $this->evaluateScript(
            sprintf(
                '(function(%s){ %s })(%s)',
                implode(', ', array_keys($args)),
                $script,
                implode(', ', array_map('json_encode', array_values($args)))
            )
        );
    }
}
