<?php

require_once('boot.php');

echo '<ul>';
foreach (glob('*') as $file) {
    if (!in_array($file, ['boot.php', 'index.php'])) {
        echo "<li><a href='/$file'>$file</a></li>";
    }
}
echo '</ul>';
