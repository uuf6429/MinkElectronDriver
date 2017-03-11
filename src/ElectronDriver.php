<?php

namespace Behat\Mink\Driver;

use Behat\Mink\Exception\DriverException;
use Behat\Mink\Exception\UnsupportedDriverActionException;
use DnodeSyncClient\Connection;
use DnodeSyncClient\IOException;
use Psr\Log;
use Symfony\Component\Process\Process;
use DnodeSyncClient\Dnode;

class ElectronDriver extends CoreDriver implements Log\LoggerAwareInterface
{
    use Log\LoggerAwareTrait;

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
     * @var bool
     */
    protected $showElectron;

    /**
     * @param Log\LoggerInterface $logger
     * @param bool $showElectron
     */
    public function __construct(
        Log\LoggerInterface $logger = null,
        $showElectron = false
    )
    {
        $this->setLogger($logger ?: new Log\NullLogger());
        $this->showElectron = $showElectron;
    }

    /**
     * @inheritdoc
     */
    public function start()
    {
        try {
            // TODO add more config options (eg; node path, env vars, args, etc)
            $this->electronProcess = new Process($this->buildServerCmd(), dirname(__DIR__));
            $this->electronProcess->setTimeout(null);

            if ($this->logger instanceof Log\NullLogger) {
                $this->electronProcess->disableOutput();
            }

            $this->electronProcess->start(function ($type, $output) {
                array_map(function ($line) use ($type) {
                    if (trim($line)) {
                        if (is_array($record = @json_decode($line, true))
                            && isset($record['level'])
                            && isset($record['message'])
                            && isset($record['context'])
                        ) {
                            $this->logger->log($record['level'], $record['message'], (array)$record['context'] ?: []);
                        } else {
                            $this->logger->alert('Unexpected Electron server output line {output}.', ['stdio' => $type, 'output' => $line]);
                        }
                    }
                }, explode("\n", $output));
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
                            'Electron server process quit unexpectedly (exit Code: %d).',
                            $this->electronProcess->getExitCode()
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
                                'Gave up connecting to electron server after %d tries (exit Code: %d).',
                                $currTry,
                                $exitCode
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
        $this->clearVisited();
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
        $this->clearVisited();
        $this->sendAndWaitWithoutResult('reload');
        $this->waitForVisited();
    }

    /**
     * @inheritdoc
     */
    public function forward()
    {
        $this->clearVisited();
        $this->sendAndWaitWithoutResult('forward');
        $this->waitForVisited();
    }

    /**
     * @inheritdoc
     */
    public function back()
    {
        $this->clearVisited();
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
        $this->callBaseMethod(__FUNCTION__, func_get_args()); // TODO: Implement switchToIFrame() method.
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
        $result = $this->waitForAsyncResult('getCookieResponse', []);

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
        $result = $this->waitForAsyncResult('getCookieResponse');

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
        return $this->getOuterHtml('//html');
    }

    /**
     * @inheritdoc
     */
    public function getScreenshot()
    {
        $this->sendAndWaitWithoutResult('getScreenshot');

        $result = $this->waitForAsyncResult('getScreenshotResponse');

        if (isset($result['error'])) {
            throw new DriverException('Could not take a screen shot: ' . $result['error']);
        }

        return base64_decode($result['base64data']);
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
     * @inheritdoc
     */
    protected function findElementXpaths($xpath)
    {
        $count = $this->evaluateExprWithArgs(
            'document.evaluate(xpath, document, null, XPathResult.NUMBER_TYPE, null).numberValue',
            ['xpath' => sprintf('count(%s)', $xpath)]
        );

        return array_map(
            function ($index) use ($xpath) {
                return sprintf('(%s)[%d]', $xpath, $index + 1);
            },
            range(0, $count)
        );
    }

    /**
     * @inheritdoc
     */
    public function getTagName($xpath)
    {
        return $this->evaluateForElementByXPath($xpath, 'element.tagName');
    }

    /**
     * @inheritdoc
     */
    public function getText($xpath)
    {
        return $this->evaluateForElementByXPath($xpath, 'element.innerText');
    }

    /**
     * @inheritdoc
     */
    public function getHtml($xpath)
    {
        return $this->evaluateForElementByXPath($xpath, 'element.innerHTML');
    }

    /**
     * @inheritdoc
     */
    public function getOuterHtml($xpath)
    {
        return $this->evaluateForElementByXPath($xpath, 'element.outerHTML');
    }

    /**
     * @inheritdoc
     */
    public function getAttribute($xpath, $name)
    {
        return $this->evaluateForElementByXPath($xpath, 'element.getAttribute(name)', ['name' => $name]);
    }

    /**
     * @inheritdoc
     */
    public function getValue($xpath)
    {
        return $this->evaluateForElementByXPath($xpath, <<<'JS'
            (function () {
                var i;
                switch (true) {
                    case element.tagName == 'SELECT' && element.multiple:
                        var selected = [];
                        for (i = 0; i < element.options.length; i++) {
                            if (element.options[i].selected) {
                                selected.push(element.options[i].value);
                            }
                        }
                        return selected;
                    case element.tagName == 'INPUT' && element.type == 'checkbox':
                        return element.checked ? element.value : null;
                    case element.tagName == 'INPUT' && element.type == 'radio':
                        var name = element.getAttribute('name');
                        if (name) {
                            var radioButtons = window.document.getElementsByName(name);
                            for (i = 0; i < radioButtons.length; i++) {
                                var radioButton = radioButtons.item(i);
                                if (radioButton.form === element.form && radioButton.checked) {
                                    return radioButton.value;
                                }
                            }
                        }
                        return null;
                    default:
                        return element.value;
                }
            })();
JS
        );
    }

    /**
     * @inheritdoc
     */
    public function setValue($xpath, $value)
    {
        $this->evaluateForElementByXPath($xpath, <<<'JS'
            (function () {
                var i;
                switch (true) {
                    case element.tagName == 'SELECT':
                        if (value && value.constructor.name == 'Array') {
                            // select multiple items
                            for (i = 0; i < element.options.length; i++) {
                                element.options[i].selected = value.indexOf(element.options[i].value) !== -1;
                            }
                        } else {
                            // select one item
                            element.value = value;
                        }
                        break;
                    case element.tagName == 'INPUT' && element.type == 'checkbox':
                        element.checked = value;
                        break;
                    case element.tagName == 'INPUT' && element.type == 'radio':
                        // TODO should we uncheck other related radio buttons? chrome seems to do it automatically
                        element.checked = value;
                        break;
                    case element.tagName == 'INPUT' && element.type == 'file':
                        throw 'Changing ' + element.type + ' is not supported yet.';
                    default:
                        element.value = value;
                        break;
                }
                
                element.dispatchEvent(new Event('change', {
                    'view': window,
                    'bubbles': true,
                    'cancelable': true
                }));
            })();
JS
            ,
            ['value' => $value]
        );
    }

    /**
     * @inheritdoc
     */
    public function check($xpath)
    {
        $this->evaluateForElementByXPath($xpath, <<<'JS'
            (function () {
                if (!element || element.type != 'checkbox' || element.type != 'radio') throw 'Element is not a valid checkbox or radio button.';
                if (element.checked === false) element.click();
            })();
JS
        );
    }

    /**
     * @inheritdoc
     */
    public function uncheck($xpath)
    {
        $this->evaluateForElementByXPath($xpath, <<<'JS'
            (function () {
                if (!element || element.type != 'checkbox' || element.type != 'radio') throw 'Element is not a valid checkbox or radio button.';
                if (element.checked === true) element.click();
            })();
JS
        );
    }

    /**
     * @inheritdoc
     */
    public function isChecked($xpath)
    {
        return $this->evaluateForElementByXPath($xpath, 'element.checked');
    }

    /**
     * @inheritdoc
     */
    public function selectOption($xpath, $value, $multiple = false)
    {
        $this->setValue($xpath, ($multiple && !is_array($value) && !is_null($value)) ? [$value] : $value);
    }

    /**
     * @inheritdoc
     */
    public function isSelected($xpath)
    {
        // TODO what if parentElement points to, for example, an <optgoup>? this needs to be handled properly
        return $this->evaluateForElementByXPath($xpath, 'element.parentElement.value == element.value');
    }

    /**
     * @inheritdoc
     */
    public function click($xpath)
    {
        $this->evaluateForElementByXPath($xpath, 'element.click()');
    }

    /**
     * @inheritdoc
     */
    public function doubleClick($xpath)
    {
        $this->evaluateForElementByXPath($xpath, <<<'JS'
            element.dispatchEvent(new MouseEvent('dblclick', {
                'view': window,
                'bubbles': true,
                'cancelable': true
            }))
JS
        );
    }

    /**
     * @inheritdoc
     */
    public function rightClick($xpath)
    {
        $this->evaluateForElementByXPath($xpath, <<<'JS'
            element.dispatchEvent(new MouseEvent('contextmenu', {
                'view': window,
                'bubbles': true,
                'cancelable': true
            }))
JS
        );
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
        $this->callBaseMethod(__FUNCTION__, func_get_args()); // TODO: Implement attachFile() method.
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
        return $this->callBaseMethod(__FUNCTION__, func_get_args()); // TODO: Implement isVisible() method.
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
        $this->callBaseMethod(__FUNCTION__, func_get_args()); // TODO: Implement mouseOver() method.
    }

    /**
     * @inheritdoc
     */
    public function focus($xpath)
    {
        $this->evaluateForElementByXPath($xpath, 'element.focus()');
    }

    /**
     * @inheritdoc
     */
    public function blur($xpath)
    {
        $this->evaluateForElementByXPath($xpath, 'element.blur()');
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
        $this->callBaseMethod(__FUNCTION__, func_get_args()); // TODO: Implement keyPress() method.
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
        $this->callBaseMethod(__FUNCTION__, func_get_args()); // TODO: Implement keyDown() method.
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
        $this->callBaseMethod(__FUNCTION__, func_get_args()); // TODO: Implement keyUp() method.
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
        $this->callBaseMethod(__FUNCTION__, func_get_args()); // TODO: Implement dragTo() method.
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
        // remove return keyword if present
        if (substr($script, 0, 7) === 'return ') {
            $script = substr($script, 7);
        }

        $this->sendAndWaitWithoutResult('evaluateScript', [rtrim($script, ';') . ';']);

        $result = $this->waitForAsyncResult('getEvaluateScriptResponse');

        if (isset($result['error'])) {
            throw new DriverException('Could not evaluate script: ' . $result['error']);
        }

        if (isset($result['redirect']) && $result['redirect']) {
            $this->waitForVisited();
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
     * {@inheritdoc}
     */
    public function resizeWindow($width, $height, $name = null)
    {
        $this->sendAndWaitWithoutResult('resizeWindow', [$width, $height, $name]);
    }

    /**
     * {@inheritdoc}
     */
    public function maximizeWindow($name = null)
    {
        $this->sendAndWaitWithoutResult('maximizeWindow', [$name]);
    }

    /**
     * @inheritdoc
     */
    public function submitForm($xpath)
    {
        $this->evaluateForElementByXPath($xpath, 'element.submit()');
    }

    /**
     * @return string
     */
    protected function buildServerCmd()
    {
        // TODO Probably we can just do "ElectronServer <socket>" thanks to npm "bin" option... not sure though
        $electronPath = __DIR__
            . DIRECTORY_SEPARATOR . '..'
            . DIRECTORY_SEPARATOR . 'node_modules'
            . DIRECTORY_SEPARATOR . '.bin'
            . DIRECTORY_SEPARATOR . 'electron';

        return sprintf(
            '%s %s %s%s',
            escapeshellarg($electronPath),
            escapeshellarg(__DIR__ . DIRECTORY_SEPARATOR . 'ElectronServer.js'),
            escapeshellarg($this->electronServerAddress),
            $this->showElectron ? ' show' : ''
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
                    $mtd,
                    var_export($args, true),
                    var_export($result, true)
                )
            );
        }
    }

    protected function clearVisited()
    {
        $this->sendAndWaitWithoutResult('clearVisitedResponse');
    }

    protected function waitForVisited()
    {
        $this->waitForAsyncResult('getVisitedResponse');
    }

    /**
     * Call a web method repeatedly until timeout expires or a non-null value is returned.
     * @param string $method The method to retrieve data from.
     * @param array $arguments Parameters to pass to web method.
     * @param float $delay Delay between calls in seconds.
     * @param float $timeout Time out in seconds.
     * @return mixed
     */
    protected function waitForAsyncResult($method, $arguments = [], $delay = 0.05, $timeout = null)
    {
        while (($result = $this->sendAndWaitWithResult($method, $arguments)) === null) {
            usleep($delay * 1000000);

            // TODO implement timeout
            /*if($timeout && ){
                throw new DriverException(sprintf('Method "%s" reached timeout limit of %fs.', $method, $timeout));
            }*/
        }

        return $result;
    }

    /**
     * @param string $expr
     * @param array <string, mixed> $valueArgs
     * @param array <string, string> $exprArgs
     * @return mixed
     * @example $driver->evaluateScriptWithArgs('a * b', ['a' => 5], ['b' => '1 + 2']) => 15
     */
    protected function evaluateExprWithArgs($expr, $valueArgs = [], $exprArgs = [])
    {
        return $this->evaluateScript(
            sprintf(
                '(function(%s){ return %s; })(%s)',
                implode(', ', array_merge(array_keys($valueArgs), array_keys($exprArgs))),
                $expr,
                implode(', ', array_merge(array_map('json_encode', array_values($valueArgs)), array_values($exprArgs)))
            )
        );
    }

    /**
     * @param string $xpath
     * @param string $expr
     * @param array <string, mixed> $valueArgs
     * @param array <string, string> $exprArgs
     * @return mixed
     */
    protected function evaluateForElementByXPath($xpath, $expr, $valueArgs = [], $exprArgs = [])
    {
        // add expression that resolves to "element"
        $exprArgs['element'] = sprintf(
            'document.evaluate(%s, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue',
            json_encode($xpath)
        );

        return $this->evaluateExprWithArgs($expr, $valueArgs, $exprArgs);
    }

    /**
     * @todo To be removed; it's only useful during implementation!
     */
    protected function callBaseMethod($mtd, $args)
    {
        static $class;
        if (!$class) $class = new \ReflectionClass(CoreDriver::class);
        return $class->getMethod($mtd)->invokeArgs($this, $args);
    }
}
