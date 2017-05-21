<?php

require_once('boot.php');

$status = isset($_REQUEST['status']) ? $_REQUEST['status'] : 200;
http_response_code($status);
echo 'Status: ' . http_response_code();
