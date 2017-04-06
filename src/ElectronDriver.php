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
    private $electronProcess;

    /**
     * @var string
     */
    private $electronClientAddress = 'localhost:6666';

    /**
     * @var string
     */
    private $electronServerAddress = '0.0.0.0:6666';

    /**
     * @var Connection
     */
    private $dnodeClient;

    /**
     * @var bool
     */
    private $showElectron;

    /**
     * @var string
     */
    private $logLevel;

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
        $this->callRemoteProcedure('reset');
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
     * @param string $expr
     * @param array <string, mixed> $valueArgs
     * @param array <string, string> $exprArgs
     * @return mixed
     * @example $driver->evaluateScriptWithArgs('a * b', ['a' => 5], ['b' => '1 + 2']) => 15
     */
    private function evaluateExprWithArgs($expr, $valueArgs = [], $exprArgs = [])
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
    private function scriptXPathEval($xpath)
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
    private function evaluateForElementByXPath($xpath, $expr, $valueArgs = [], $exprArgs = [])
    {
        // add expression that resolves to "element"
        $exprArgs['element'] = $this->scriptXPathEval($xpath);

        return $this->evaluateExprWithArgs($expr, $valueArgs, $exprArgs);
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
    private function pollUntilNonNullResult($method, $arguments = [], $delay = 0.05, $timeout = 60)
    {
        $start = microtime(true);

        while (($result = $this->callRawRemote($method, $arguments)) === null) {
            usleep($delay * 1000000);

            if ($timeout && microtime(true) - $start > $timeout) {
                throw new DriverException(sprintf('Method "%s" reached timeout limit of %s seconds.', $method, $timeout));
            }
        }

        return $result;
    }

    /**
     * @param string $pid
     * @param string $errorMessageTpl
     * @param bool $allowRedirect
     * @param int|float $timeout Time out in seconds (0 for no timeout, default is 60).
     * @return mixed
     * @throws DriverException
     */
    private function waitForPayload($pid, $errorMessageTpl = '', $allowRedirect = true, $timeout = 60)
    {
        $result = $this->pollUntilNonNullResult('getPayload', [$pid], 0, $timeout);

        if (isset($result['error'])) {
            throw new DriverException(
                sprintf(
                    $errorMessageTpl ?: 'Could not dispatch mouse event: %s',
                    $result['error']
                )
            );
        }

        // TODO not sure if I should handle this generically here
        /*if ($allowRedirect && isset($result['redirect']) && $result['redirect']) {
            $this->waitForVisited();
        }*/

        return $result['payload'];
    }

    // region Basic RPC Functionality

    /**
     * @param string $method Name of remote method.
     * @param array $arguments Arguments to send to remote method.
     * @param int $expectedResultCount Number of expected parameters from server (or -1 to disable check)
     * @return mixed
     * @throws DriverException
     */
    private function callRawRemote($method, $arguments = [], $expectedResultCount = -1)
    {
        $result = $this->dnodeClient->call($method, $arguments);

        if ($expectedResultCount !== -1 && count($result) !== $expectedResultCount) {
            throw new DriverException(
                sprintf(
                    "Unexpected response from server; expected %d result, not %d.\nMethod: %s\nArguments: %s\nResponse: %s",
                    $expectedResultCount,
                    count($result),
                    $method,
                    var_export($arguments, true),
                    var_export($result, true)
                )
            );
        }

        return $result[0];
    }

    /**
     * @param string $method
     * @param array $arguments
     * @return mixed
     */
    private function callRemoteFunction($method, $arguments = [])
    {
        $pid = $this->callRawRemote($method, $arguments, 1);

        return $this->waitForPayload($pid);
    }

    /**
     * @param string $method
     * @param array $arguments
     */
    private function callRemoteProcedure($method, $arguments = [])
    {
        $this->callRawRemote($method, $arguments, 0);
    }

    // endregion
}
