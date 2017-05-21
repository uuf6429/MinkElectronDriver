<?php

require_once('boot.php');

?><!DOCTYPE html>
<html>
    <body>
        <form action="" method="post">
            <input type="text" name="name" title="Name"/>
            <input type="text" name="surname" title="Surname"/>
            <input type="submit" value="Submit"/>
        </form>
        <pre>$_REQUEST => <?php echo htmlspecialchars(var_export($_REQUEST, true), ENT_QUOTES); ?></pre>
    </body>
</html>