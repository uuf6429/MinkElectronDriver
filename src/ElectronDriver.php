<?php

namespace Behat\Mink\Driver;

use Behat\Mink\Exception\DriverException;
use uuf6429\DnodeSyncClient\Connection;
use uuf6429\DnodeSyncClient\Dnode;
use Psr\Log;
use Symfony\Component\Process\Process;

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
    protected $electronClientAddress;

    /**
     * @var string
     */
    protected $electronServerAddress;

    /**
     * @var boolean
     */
    protected $autoStartServer;

    /**
     * @var Connection
     */
    protected $dnodeClient;

    /**
     * @var bool
     */
    protected $showElectron;

    /**
     * @var string
     */
    protected $logLevel;

    /**
     * @param Log\LoggerInterface|null $logger Logger object (use PSR NullLogger or null to disable logging).
     * @param bool $showElectron True to show electron window (also enables web dev tools), false otherwise.
     * @param string $logLevel A value from PSR LogLevel constants (defaults to LogLevel::WARNING).
     * @param string|null $serverAddress Address where ElectronServer will listen to (defaults to local unix socket or named pipes).
     * @param string|null $clientAddress Address where ElectronDriver will connect to (defaults to local unix socket or named pipes).
     * @param boolean $autoStartServer If true, starts ElectronServer automatically (defaults to true).
     */
    public function __construct(
        Log\LoggerInterface $logger = null,
        $showElectron = false,
        $logLevel = Log\LogLevel::WARNING,
        $serverAddress = null,
        $clientAddress = null,
        $autoStartServer = true
    )
    {
        $this->setLogger($logger ?: new Log\NullLogger());
        $this->showElectron = $showElectron;
        $this->logLevel = $logLevel;
        $this->electronServerAddress = $serverAddress;
        $this->electronClientAddress = $clientAddress;
        $this->autoStartServer = $autoStartServer;
    }

    /**
     * @inheritdoc
     */
    public function start()
    {
        try {
            list($clientAddress, $serverAddress) = $this->buildClientServerAddress();

            if ($this->autoStartServer) {
                $this->electronProcess = new Process($this->buildServerCmd($serverAddress), dirname(__DIR__));
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
            }

            $maxTries = 10;
            for ($currTry = 1; $currTry <= $maxTries; $currTry++) {
                if ($this->electronProcess && !$this->electronProcess->isRunning()) {
                    throw new \RuntimeException(
                        sprintf(
                            'Electron server process quit unexpectedly (exit Code: %d).',
                            $this->electronProcess->getExitCode()
                        )
                    );
                }

                try {
                    $this->dnodeClient = (new Dnode())->connectToAddress($clientAddress);
                    break;
                } catch (\Exception $ex) {
                    if ($currTry == $maxTries) {
                        if ($this->electronProcess && $this->electronProcess->isRunning()) {
                            $this->electronProcess->stop();
                        }

                        throw new \RuntimeException("Gave up connecting to electron server after $maxTries tries:\n$ex", 0, $ex);
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
        $serverRunning = !$this->autoStartServer || ($this->electronProcess && $this->electronProcess->isStarted());

        return $serverRunning && $this->dnodeClient && !$this->dnodeClient->isClosed();
    }

    /**
     * @inheritdoc
     */
    public function stop()
    {
        try {
            try {
                $this->sendAndWaitWithoutResult('shutdown');
            } catch (\Exception $ex) {
                $this->logger->warning("Exception thrown while shutting down server: $ex");
            }

            if ($this->dnodeClient) {
                @$this->dnodeClient->close();
                $this->dnodeClient = null;
            }
            if ($this->electronProcess) {
                $this->electronProcess->stop();
                $this->electronProcess = null;
            }
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
     * @inheritdoc
     * @todo Currently limited by Electron API, see: https://github.com/uuf6429/MinkElectronDriver/issues/11
     */
    public function switchToIFrame($name = null)
    {
        parent::switchToIFrame($name);

        $this->sendAndWaitWithoutResult('switchToIFrame', [$name]);
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
        return $this->waitForAsyncResult('getStatusCode');
    }

    /**
     * @inheritdoc
     */
    public function getContent()
    {
        $result = $this->waitForAsyncResult('getContent');

        if (isset($result['error'])) {
            throw new DriverException('Could not save page content: ' . $result['error']);
        }

        if (!array_key_exists('content', $result)) {
            throw new DriverException('Unexpected response from server: ' . json_encode($result));
        }

        return $result['content'];
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

        if (!$result['base64data']) {
            throw new DriverException('Screen shot data is empty.');
        }

        $result['data'] = base64_decode($result['base64data']);

        if (!$result['data']) {
            throw new DriverException('Screen shot could not be decoded, sources data: ' . $result['base64data']);
        }

        return $result['data'];
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
        return $this->evaluateScript('window.name');
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

        return $count
            ? array_map(
                function ($index) use ($xpath) {
                    return sprintf('(%s)[%d]', $xpath, $index);
                },
                range(1, $count)
            )
            : [];
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
        $text = $this->evaluateForElementByXPath($xpath, 'element.innerText');
        return str_replace(["\r\n", "\r", "\n"], ' ', $text);
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
        return $this->evaluateForElementByXPath($xpath, 'Electron.getValue(element)');
    }

    /**
     * @inheritdoc
     */
    public function setValue($xpath, $value)
    {
        $this->evaluateForElementByXPath(
            $xpath,
            'Electron.setValue(xpath, element, value)',
            ['value' => $value, 'xpath' => $xpath]
        );
    }

    /**
     * @inheritdoc
     */
    public function check($xpath)
    {
        $this->evaluateForElementByXPath($xpath, 'Electron.setChecked(element, true)');
    }

    /**
     * @inheritdoc
     */
    public function uncheck($xpath)
    {
        $this->evaluateForElementByXPath($xpath, 'Electron.setChecked(element, false)');
    }

    /**
     * @inheritdoc
     */
    public function isChecked($xpath)
    {
        return $this->evaluateForElementByXPath($xpath, 'Electron.isChecked(element)');
    }

    /**
     * @inheritdoc
     */
    public function selectOption($xpath, $value, $multiple = false)
    {
        $this->evaluateForElementByXPath(
            $xpath,
            'Electron.selectOption(element, value, multiple)',
            ['value' => $value, 'multiple' => $multiple]
        );
    }

    /**
     * @inheritdoc
     */
    public function isSelected($xpath)
    {
        return $this->evaluateForElementByXPath($xpath, 'Electron.isSelected(element)');
    }

    /**
     * @inheritdoc
     */
    public function click($xpath)
    {
        $pos = $this->getElementCenterPos($xpath);
        $this->dispatchMouseEvent('mousePressed', $pos['x'], $pos['y'], null, null, 'left', 1);
        $this->dispatchMouseEvent('mouseReleased', $pos['x'], $pos['y'], null, null, 'left', 1);
    }

    /**
     * @inheritdoc
     */
    public function doubleClick($xpath)
    {
        $pos = $this->getElementCenterPos($xpath);
        $this->dispatchMouseEvent('mousePressed', $pos['x'], $pos['y'], null, null, 'left', 2);
        $this->dispatchMouseEvent('mouseReleased', $pos['x'], $pos['y'], null, null, 'left', 2);
    }

    /**
     * @inheritdoc
     */
    public function rightClick($xpath)
    {
        $pos = $this->getElementCenterPos($xpath);
        $this->dispatchMouseEvent('mousePressed', $pos['x'], $pos['y'], null, null, 'right', 1);
        $this->dispatchMouseEvent('mouseReleased', $pos['x'], $pos['y'], null, null, 'right', 1);
    }

    /**
     * @inheritdoc
     */
    public function attachFile($xpath, $path)
    {
        $this->sendAndWaitWithoutResult('attachFile', [$xpath, $path]);
        $this->handleExecutionResponse('Could not attach file: %s');
    }

    /**
     * @inheritdoc
     */
    public function isVisible($xpath)
    {
        return $this->evaluateForElementByXPath($xpath, 'Electron.isVisible(element)');
    }

    /**
     * @inheritdoc
     */
    public function mouseOver($xpath)
    {
        $pos = $this->getElementCenterPos($xpath);
        $this->dispatchMouseEvent('mouseMoved', $pos['x'], $pos['y']);
    }

    /**
     * @inheritdoc
     */
    public function focus($xpath)
    {
        $this->synTrigger($xpath, 'focus');
    }

    /**
     * @inheritdoc
     */
    public function blur($xpath)
    {
        $this->synTrigger($xpath, 'blur');
    }

    /**
     * @inheritdoc
     */
    public function keyPress($xpath, $char, $modifier = null)
    {
        $this->synTrigger($xpath, 'keypress', $this->synKeyComToOptions($char, $modifier));
    }

    /**
     * @inheritdoc
     */
    public function keyDown($xpath, $char, $modifier = null)
    {
        $this->synTrigger($xpath, 'keydown', $this->synKeyComToOptions($char, $modifier));
    }

    /**
     * @inheritdoc
     */
    public function keyUp($xpath, $char, $modifier = null)
    {
        $this->synTrigger($xpath, 'keyup', $this->synKeyComToOptions($char, $modifier));
    }

    /**
     * @inheritdoc
     */
    public function dragTo($sourceXpath, $destinationXpath)
    {
        // TODO use native mouse events
        $this->evaluateExprWithArgs(
            'setTimeout(function(){ Electron.syn.drag(sourceElement, {to: targetElement, duration: 10}); }, 1);',
            [],
            [
                'sourceElement' => $this->scriptXPathEval($sourceXpath),
                'targetElement' => $this->scriptXPathEval($destinationXpath),
            ]
        );
        
        usleep(16000); // 10ms duration + 1ms setTimeout + 5ms overhead
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

        $this->sendAndWaitWithoutResult('evaluateScript', [sprintf('(%s);', rtrim($script, "\r\n\t ;"))]);

        $result = $this->handleExecutionResponse('Could not evaluate script: %s');

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
     *
     * @todo Currently fails headless CI test, see: https://github.com/uuf6429/MinkElectronDriver/issues/8
     */
    public function maximizeWindow($name = null)
    {
        parent::maximizeWindow($name);

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
     * This will cause PHP to receive & process any output from server process.
     */
    protected function flushServerOutput()
    {
        if ($this->electronProcess) {
            $this->electronProcess->getOutput();
        }
    }

    /**
     * @param string $serverAddress
     * @return string
     */
    protected function buildServerCmd($serverAddress)
    {
        $electronPath = __DIR__
            . DIRECTORY_SEPARATOR . '..'
            . DIRECTORY_SEPARATOR . 'node_modules'
            . DIRECTORY_SEPARATOR . '.bin'
            . DIRECTORY_SEPARATOR . 'electron';

        $serverScript = __DIR__
            . DIRECTORY_SEPARATOR . 'Server'
            . DIRECTORY_SEPARATOR . 'Server.js';

        return sprintf(
            '%s %s %s %s %s',
            escapeshellarg($electronPath),
            escapeshellarg($serverScript),
            escapeshellarg($serverAddress),
            $this->showElectron ? 'show' : 'hide',
            $this->logLevel
        );
    }

    /**
     * @return array Returns an array of two strings, with client and server address respectively.
     */
    protected function buildClientServerAddress()
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            // on Windows we fall back to regular network sockets since named pipes (eg: "\\\\.\\pipe\\med$sid") do not seem to work :(
            $GLOBALS['med_port'] = isset($GLOBALS['med_port']) ? $GLOBALS['med_port'] + 1 : 2200;

            return [
                $this->electronClientAddress ?: "tcp://127.0.0.1:{$GLOBALS['med_port']}",
                $this->electronServerAddress ?: "0.0.0.0:{$GLOBALS['med_port']}",
            ];
        } else {
            $sid = uniqid();

            return [
                $this->electronClientAddress ?: "unix:///tmp/med$sid.sock",
                $this->electronServerAddress ?: "/tmp/med$sid.sock",
            ];
        }
    }

    /**
     * @param string $mtd
     * @param array $args
     * @return mixed
     * @throws DriverException
     * @throws \Exception
     */
    protected function sendAndWaitWithResult($mtd, $args = [])
    {
        try {
            if (!$this->dnodeClient) {
                throw new DriverException('DNode client is not connected to ElectronServer.');
            }

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
        } catch (\Exception $ex) {
            $this->flushServerOutput();
            throw $ex;
        }

        $this->flushServerOutput();

        return $result[0];
    }

    /**
     * @param string $mtd
     * @param array $args
     * @throws DriverException
     * @throws \Exception
     */
    protected function sendAndWaitWithoutResult($mtd, $args = [])
    {
        try {
            if (!$this->dnodeClient) {
                throw new DriverException('DNode client is not connected to ElectronServer.');
            }

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
        } catch (\Exception $ex) {
            $this->flushServerOutput();
            throw $ex;
        }

        $this->flushServerOutput();
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
     * @param int|float $timeout Time out in seconds (0 for no timeout, default is 60).
     * @return mixed
     * @throws DriverException
     */
    protected function waitForAsyncResult($method, $arguments = [], $delay = 0.05, $timeout = 60)
    {
        $start = microtime(true);

        while (($result = $this->sendAndWaitWithResult($method, $arguments)) === null) {
            usleep($delay * 1000000);

            if ($timeout && microtime(true) - $start > $timeout) {
                throw new DriverException(sprintf('Method "%s" reached timeout limit of %s seconds.', $method, $timeout));
            }
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
     * @return string
     */
    protected function scriptXPathEval($xpath)
    {
        return sprintf('Electron.getElementByXPath(%s)', json_encode($xpath));
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
        $exprArgs['element'] = $this->scriptXPathEval($xpath);

        return $this->evaluateExprWithArgs($expr, $valueArgs, $exprArgs);
    }

    /**
     * @param string $event
     * @param array|object $options
     * @param string $elementVarName
     * @return string
     */
    protected function scriptSynTrigger($event, $options = [], $elementVarName = 'element')
    {
        return sprintf(
            'Electron.syn.trigger(%s, %s, %s)',
            $elementVarName,
            json_encode((string)$event),
            json_encode((object)$options)
        );
    }

    /**
     * @param string $xpath
     * @param string $event
     * @param array|object $options
     * @return mixed
     */
    protected function synTrigger($xpath, $event, $options = [])
    {
        return $this->evaluateForElementByXPath($xpath, $this->scriptSynTrigger($event, $options));
    }

    /**
     * @param string $char
     * @param string|null $modifier
     * @return array
     */
    protected function synKeyComToOptions($char, $modifier)
    {
        $ord = is_numeric($char) ? $char : ord($char);

        $options = array(
            'keyCode' => $ord,
            'charCode' => $ord
        );

        if ($modifier) {
            $options[$modifier . 'Key'] = 1;
        }

        return $options;
    }

    /**
     * @param string $type
     * @param integer $x
     * @param integer $y
     * @param null|int $modifiers
     * @param null|float $timestamp
     * @param null|string $button
     * @param null|integer $clickCount

     * @throws DriverException
     *
     * @see https://chromedevtools.github.io/debugger-protocol-viewer/1-2/Input/#method-dispatchMouseEvent
     */
    protected function dispatchMouseEvent($type, $x, $y, $modifiers = null, $timestamp = null, $button = null, $clickCount = null)
    {
        $params = [
            'type' => $type,
            'x' => $x,
            'y' => $y,
        ];

        if ($modifiers !== null) {
            $params['modifiers'] = $modifiers;
        }

        if ($timestamp !== null) {
            $params['timestamp'] = $timestamp;
        }

        if ($button !== null) {
            $params['button'] = $button;
        }

        if ($clickCount !== null) {
            $params['clickCount'] = $clickCount;
        }

        $this->sendAndWaitWithoutResult('dispatchMouseEvent', [$params]);

        usleep(10000); // FIXME Unfortunately, couldn't find a way to immediately detect location change
                       // One possible fix is to remove sleep from here and put it into click/dblclick/rightclick methods

        $this->handleExecutionResponse('Could not dispatch mouse event: %s');
    }

    /**
     * @param string $xpath
     * @return array Array with 'x' and 'y' keys.
     */
    protected function getElementCenterPos($xpath)
    {
        return $this->evaluateForElementByXPath($xpath, <<<'JS'
            (function(){
                const rect = element.getBoundingClientRect(),
                    x = Math.round(rect.left + (rect.width / 2)),
                    y = Math.round(rect.top + (rect.height / 2));
                return {'x': x, 'y': y};
            })();
JS
        );
    }

    /**
     * @param string $errorMessageTpl
     * @param boolean $allowRedirect
     * @return mixed
     * @throws DriverException
     */
    protected function handleExecutionResponse($errorMessageTpl, $allowRedirect = true)
    {
        $result = $this->waitForAsyncResult('getExecutionResponse');

        if (isset($result['error'])) {
            throw new DriverException(
                sprintf(
                    $errorMessageTpl ?: 'Could not dispatch mouse event: %s',
                    $result['error']
                )
            );
        }

        if ($allowRedirect && isset($result['redirect']) && $result['redirect']) {
            $this->waitForVisited();
        }

        return $result;
    }
}
