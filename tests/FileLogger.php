<?php

namespace Behat\Mink\Tests\Driver;

use Psr\Log\AbstractLogger;

class FileLogger extends AbstractLogger
{
    /**
     * @var \SplFileObject
     */
    protected $file;

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
        if (isset($context['srcTime'])) {
            $time = \DateTime::createFromFormat('U.u', (string)$context['srcTime']);
            unset($context['srcTime']);
        } else {
            $time = \DateTime::createFromFormat('U.u', implode('.', array_slice(gettimeofday(), 0, 2)));
        }

        $message = sprintf(
            '%s %s - %s' . PHP_EOL,
            $time->format('d-m-Y H:i:s.u'),
            strtoupper($level),
            str_replace(
                array_map(
                    function ($key) {
                        if (is_array($key)) die('wtf ' . print_r($key, true));
                        return "{{$key}}";
                    },
                    array_keys($context)
                ),
                array_map(
                    function ($val) {
                        return is_string($val)
                            ? $val
                            : is_scalar($val)
                                ? json_encode($val)
                                : var_export($val, true);
                    },
                    array_values($context)
                ),
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
}
