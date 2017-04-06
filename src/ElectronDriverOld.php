<?php

namespace Behat\Mink\Driver;

use Behat\Mink\Exception\DriverException;
use Behat\Mink\Exception\UnsupportedDriverActionException;
use DnodeSyncClient\Connection;
use DnodeSyncClient\IOException;
use Psr\Log;
use Symfony\Component\Process\Process;
use DnodeSyncClient\Dnode;

class ElectronDriverOld extends CoreDriver implements Log\LoggerAwareInterface
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
     * @var string
     */
    protected $logLevel;

    /**
     * @param Log\LoggerInterface $logger
     * @param bool $showElectron
     * @param string $logLevel
     */
    public function __construct(
        Log\LoggerInterface $logger = null,
        $showElectron = false,
        $logLevel = Log\LogLevel::WARNING
    )
    {
        $this->setLogger($logger ?: new Log\NullLogger());
        $this->showElectron = $showElectron;
        $this->logLevel = $logLevel;
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
        parent::switchToIFrame($name); // TODO: Implement switchToIFrame() method.
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
        return $this->evaluateForElementByXPath($xpath, <<<'JS'
            (function () {
                var i;
                switch (true) {
                    case element.tagName === 'SELECT' && element.multiple:
                        var selected = [];
                        for (i = 0; i < element.options.length; i++) {
                            if (element.options[i].selected) {
                                selected.push(element.options[i].value);
                            }
                        }
                        return selected;
                    case element.tagName === 'INPUT' && element.type === 'checkbox':
                        return element.checked ? element.value : null;
                    case element.tagName === 'INPUT' && element.type === 'radio':
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
        // TODO See also: https://github.com/segmentio/nightmare/blob/5ee597175861023cd23ccc5421f4fe3e00e54159/lib/runner.js#L369
        $this->evaluateForElementByXPath($xpath, <<<JS
            (function () {
                var i;
                switch (true) {
                    case element.tagName === 'SELECT':
                        if (value && value.constructor.name === 'Array') {
                            {$this->scriptDeselectAllOptions()}
                            var oldValue = value;
                            for (var n = 0; n < oldValue.length; n++) {
                                value = oldValue[n];
                                multiple = true;
                                {$this->scriptSelectOptionOnElement()}
                            }
                        } else {
                            {$this->scriptSelectOptionOnElement()}
                        }
                        return;
                        
                    case element.tagName === 'INPUT' && element.type === 'checkbox':
                        if (element.checked === !value) element.click();
                        return;
                        
                    case element.tagName === 'INPUT' && element.type === 'radio':
                        {$this->scriptSelectRadioValue()}
                        return;
                        
                    case element.tagName === 'INPUT' && element.type === 'file':
                        return Electron.setFileFromScript(xpath, value);
                        
                    default:
                        element.value = value;
                        break;
                }

                {$this->scriptSynTrigger('change')};
            })();
JS
            ,
            ['value' => $value, 'xpath' => $xpath]
        );
    }

    /**
     * @inheritdoc
     */
    public function check($xpath)
    {
        $this->evaluateForElementByXPath($xpath, <<<'JS'
            (function () {
                if (!element || !((element.type === 'checkbox') || (element.type === 'radio')))
                    throw new Error('Element is not a valid checkbox or radio button.');
                
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
                if (!element || !((element.type === 'checkbox') || (element.type === 'radio')))
                    throw new Error('Element is not a valid checkbox or radio button.');
                
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
        return $this->evaluateForElementByXPath($xpath, <<<'JS'
            (function () {
                if (!element || !((element.type === 'checkbox') || (element.type === 'radio')))
                    throw new Error('Element is not a valid checkbox or radio button.');
                
                return element.checked;
            })();
JS
        );
    }

    /**
     * @inheritdoc
     */
    public function selectOption($xpath, $value, $multiple = false)
    {
        $this->evaluateForElementByXPath($xpath, <<<JS
            (function () {
                if (element.tagName === 'INPUT' && element.type === 'radio') {
                    {$this->scriptSelectRadioValue()}
                    return;
                }
        
                if (element.tagName === 'SELECT') {
                    {$this->scriptSelectOptionOnElement()}
                    return;
                }
        
                throw new Error('Element is not a valid select or radio input');
            })();
JS
            ,
            ['value' => $value, 'multiple' => $multiple]
        );
    }

    /**
     * @return string
     */
    protected function scriptSelectRadioValue()
    {
        return <<<'JS'
            var name = element.name,
                form = element.form,
                input = null;
        
            if (element.value === value) {
                element.click();
                return;
            }
            
            if (!name) {
                throw new Error('The radio button does not have the value "' + value + '".');
            }
            
            if (form) {
                var group = form[name];
                for (var i = 0; i < group.length; i++) {
                    if (group[i].value === value) {
                        input = group[i];
                    }
                }
            } else {
                throw new Error('The radio group "' + name + '" is not in a form.');
            }

            if (!input) {
                throw new Error('The radio group "' + name + '" does not have an option "' + value + '".');
            }

            input.click();
JS;
    }

    /**
     * @return string
     */
    protected function scriptSelectOptionOnElement()
    {
        return <<<JS
            var option = null;

            for (var i = 0; i < element.options.length; i++) {
                if (element.options[i].value === value) {
                    option = element.options[i];
                    break;
                }
            }

            if (!option) {
                throw new Error('Select box "' + (element.name || element.id) + '" does not have an option "' + value + '".');
            }

            if ((typeof(multiple) !== 'undefined' && multiple) || !element.multiple){
                if (!option.selected) {
                    option.selected = true; // FIXME Should have been "option.click();" but it doesn't work... are we losing events now?
                }
            } else {
                {$this->scriptDeselectAllOptions()}
                option.selected = true; // FIXME Should have been "option.click();" but it doesn't work... are we losing events now?
            }
            
            {$this->scriptSynTrigger('change')};
JS;
    }

    /**
     * @return string
     */
    protected function scriptDeselectAllOptions()
    {
        return <<<'JS'
            for (var i = 0; i < element.options.length; i++) {
                element.options[i].selected = false;
            }
JS;
    }

    /**
     * @inheritdoc
     */
    public function isSelected($xpath)
    {
        return $this->evaluateForElementByXPath($xpath, <<<'JS'
            (function () {
                if (!element || element.tagName !== 'OPTION')
                    throw new Error('Element is not a valid option element.');
                
                var select;
                if (element.parentElement.tagName === 'SELECT') { // select -> option
                    select = element.parentElement;
                } else if(element.parentElement.parentElement.tagName === 'SELECT') { // select -> optgroup -> option
                    select = element.parentElement.parentElement;
                } else {
                    throw new Error('Could not find a containing select element.');
                }
                
                return select.value === element.value;
            })();
JS
        );
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
        $electronPath = __DIR__
            . DIRECTORY_SEPARATOR . '..'
            . DIRECTORY_SEPARATOR . 'node_modules'
            . DIRECTORY_SEPARATOR . '.bin'
            . DIRECTORY_SEPARATOR . 'electron';

        return sprintf(
            '%s %s %s %s %s',
            escapeshellarg($electronPath),
            escapeshellarg(__DIR__ . DIRECTORY_SEPARATOR . 'ElectronServer.js'),
            escapeshellarg($this->electronServerAddress),
            $this->showElectron ? 'show' : 'hide',
            $this->logLevel
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
        return sprintf(
            'document.evaluate(%s, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue',
            json_encode($xpath)
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
                var rect = element.getBoundingClientRect(),
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