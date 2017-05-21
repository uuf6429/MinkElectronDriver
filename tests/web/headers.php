<?php

require_once('boot.php');

foreach($_GET as $header => $value){
    header("$header: $value");
}

echo htmlspecialchars(var_export(getallheaders(), true), ENT_QUOTES);
