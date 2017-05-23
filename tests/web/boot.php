<?php

if (!getenv('TEST_SERVER')) {
    header('HTTP/1.0 403 Forbidden', true, 403);
    exit;
}
