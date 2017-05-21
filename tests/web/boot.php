<?php

if (php_sapi_name() !== 'cli-server') {
    header('HTTP/1.0 403 Forbidden', true, 403);
    exit;
}
