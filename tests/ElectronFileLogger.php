<?php

namespace Behat\Mink\Tests\Driver;

use Psr\Log\AbstractLogger;
use Psr\Log\LogLevel;

class ElectronFileLogger extends AbstractLogger
{
    /**
     * @var \SplFileObject
     */
    protected $file;

    /**
     * @var array<string, string>
     */
    protected $psrLevelToShortMap = [
        LogLevel::EMERGENCY => 'EMER',
        LogLevel::ALERT => 'ALRT',
        LogLevel::CRITICAL => 'CRIT',
        LogLevel::ERROR => 'ERRR',
        LogLevel::WARNING => 'WARN',
        LogLevel::NOTICE => 'NOTE',
        LogLevel::INFO => 'INFO',
        LogLevel::DEBUG => 'DBUG',
    ];

    /**
     * @var int
     */
    protected $indentation = 0;

    /**
     * @param string $fileName
     * @param bool $append
     */
    public function __construct($fileName, $append = true)
    {
        if (!is_dir(dirname($fileName))) {
            mkdir(dirname($fileName), 0777, true);
        }

        $this->file = new \SplFileObject($fileName, $append ? 'ab' : 'wb');
    }

    /**
     * {@inheritdoc}
     * @param \DateTimeInterface|null $realTime
     */
    public function log($level, $message, array $context = array())
    {
        $indent = $this->indentation;

        if (isset($context['srcTime'])) {
            $time = explode('.', (string) $context['srcTime']);
            unset($context['srcTime']);
        }

        if (isset($context['logIndent'])) {
            $indent += intval($context['logIndent']);
            unset($context['logIndent']);
        }

        if (empty($time) || count($time) !== 2) {
            $time = array_values(array_slice(gettimeofday(), 0, 2));
        }

        $time = sprintf('%10s.%-06.6s', $time[0], $time[1]);
        $msgIndent = str_repeat('  ', $indent);
        $lineIndent = str_repeat(' ', strlen($time) + 8) . $msgIndent;

        $message = sprintf(
            '%s %s - %s%s' . PHP_EOL,
            $time,
            $this->psrLevelToShortMap[$level],
            $msgIndent,
            str_replace(
                array_map(
                    function ($key) {
                        return "{{$key}}";
                    },
                    array_keys($context)
                ) + ["\n"],
                array_map(
                    function ($val) {
                        return is_string($val)
                            ? $val
                            : is_scalar($val)
                                ? json_encode($val)
                                : var_export($val, true);
                    },
                    array_values($context)
                ) + ["\n$lineIndent"],
                $message
            )
        );

        try {
            $this->file->fwrite($message);
            $this->file->fflush();
        } catch (\Exception $ex) {
            throw new \RuntimeException(
                'An exception was thrown while logging the following entry:' . PHP_EOL . $message,
                $ex->getCode(),
                $ex
            );
        }
    }

    public function indent()
    {
        $this->indentation++;
    }

    public function outdent()
    {
        $this->indentation--;
    }
}
